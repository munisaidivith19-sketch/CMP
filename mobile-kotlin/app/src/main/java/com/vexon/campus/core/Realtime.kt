package com.vexon.campus.core

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import io.socket.client.AckWithTimeout
import io.socket.client.IO
import io.socket.client.Manager
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * One Socket.io connection to the SAME server the web app uses (port of
 * services/socket.js). The server authenticates the access token on connect and
 * only lets the socket into rooms it is authorised for (own user room, verified
 * chat rooms).
 */
object Realtime {
    data class Event(val name: String, val args: List<JsonElement>)

    private val main = Handler(Looper.getMainLooper())
    private var socket: Socket? = null
    private val auth = HashMap<String, String>()
    private val connectHooks = LinkedHashSet<(Socket) -> Unit>()
    val events = MutableSharedFlow<Event>(extraBufferCapacity = 128)

    // Live event → cached data to refresh (identical to the web app's mapping).
    val LIVE_TAGS = mapOf(
        "notification" to listOf("Notification", "Dashboard", "Achievement"),
        "announcement:changed" to listOf("Announcement", "Dashboard"),
        "event:changed" to listOf("Event", "Dashboard"),
        "club:changed" to listOf("Club", "Dashboard"),
        "discussion:changed" to listOf("Discussion", "Dashboard"),
        "attendance:updated" to listOf("Attendance", "Correction"),
        "gatepass:updated" to listOf("GatePass"),
        "timetable:updated" to listOf("Timetable"),
        "holiday:changed" to listOf("Holiday", "Attendance", "Timetable"),
        "lostfound:updated" to listOf("LostFound"),
        "complaint:updated" to listOf("Complaint"),
        "chat:message" to listOf("Chat"),
        "chat:conversation" to listOf("Chat"),
        "chat:read" to listOf("Chat"),
        "chat:messageDeleted" to listOf("Chat"),
    )

    private fun toJson(arg: Any?): JsonElement = when (arg) {
        null, JSONObject.NULL -> JsonNull
        is JSONObject, is JSONArray -> parseJson(arg.toString()) ?: JsonNull
        is Number -> JsonPrimitive(arg)
        is Boolean -> JsonPrimitive(arg)
        else -> JsonPrimitive(arg.toString())
    }

    private fun toWire(payload: Any?): Any? = when (payload) {
        null -> null
        is kotlinx.serialization.json.JsonObject -> JSONObject(payload.toString())
        is kotlinx.serialization.json.JsonArray -> JSONArray(payload.toString())
        is JsonPrimitive -> payload.str
        else -> payload
    }

    private fun dispatch(name: String, args: Array<out Any?>) {
        val event = Event(name, args.map(::toJson))
        main.post { events.tryEmit(event) }
    }

    /**
     * Connect for the signed-in user. [onUnauthorized] refreshes the session and
     * returns true when the socket should try again with the new token.
     */
    fun connect(onUnauthorized: suspend () -> Boolean) {
        if (socket != null) return
        auth["token"] = Auth.accessToken.orEmpty()
        val opts = IO.Options.builder()
            .setTransports(arrayOf(WebSocket.NAME))
            .setReconnectionDelayMax(10_000)
            .setAuth(auth)
            .build()
        val s = runCatching { IO.socket(ServerConfig.apiUrl, opts) }.getOrNull() ?: return
        socket = s

        // The token is read again before every (re)connect, like the JS `auth` callback.
        s.io().on(Manager.EVENT_RECONNECT_ATTEMPT) { auth["token"] = Auth.accessToken.orEmpty() }
        s.onAnyIncoming { args ->
            val name = args.firstOrNull()?.toString() ?: return@onAnyIncoming
            dispatch(name, args.drop(1).toTypedArray())
        }

        var retrying = false
        fun reauth() {
            if (retrying) return
            retrying = true
            QueryClient.scope.launch {
                val ok = runCatching { onUnauthorized() }.getOrDefault(false)
                retrying = false
                val current = socket
                if (ok && current != null && !current.connected()) {
                    auth["token"] = Auth.accessToken.orEmpty()
                    current.connect()
                }
            }
        }

        s.on(Socket.EVENT_CONNECT) {
            main.post {
                Connection.set(true)
                socket?.let { sock -> connectHooks.toList().forEach { it(sock) } }
                events.tryEmit(Event("connect", emptyList()))
            }
        }
        s.on(Socket.EVENT_CONNECT_ERROR) { args ->
            val message = (args.firstOrNull() as? JSONObject)?.optString("message") ?: (args.firstOrNull() as? Exception)?.message
            main.post { if (message == "unauthorized") reauth() else Connection.set(false) }
        }
        s.on(Socket.EVENT_DISCONNECT) { args ->
            val reason = args.firstOrNull()?.toString()
            main.post {
                // Transport loss (not a deliberate logout) means the server is unreachable right now.
                if (reason in listOf("transport close", "ping timeout", "transport error")) Connection.set(false)
                if (reason == "io server disconnect") reauth()
            }
        }
        s.connect()
    }

    /** Android suspends background sockets; reconnect as soon as the app is foregrounded. */
    fun onForeground() {
        socket?.takeIf { !it.connected() }?.let {
            auth["token"] = Auth.accessToken.orEmpty()
            it.connect()
        }
    }

    fun disconnect() {
        socket?.off()
        socket?.disconnect()
        socket = null
    }

    val connected: Boolean get() = socket?.connected() == true

    fun emit(event: String, payload: Any?) {
        socket?.takeIf { it.connected() }?.emit(event, toWire(payload))
    }

    /** Emit and wait (max 5s) for the server's acknowledgement; null when offline or timed out. */
    suspend fun emitWithAck(event: String, payload: Any?): JsonElement? {
        val s = socket?.takeIf { it.connected() } ?: return null
        return suspendCancellableCoroutine { cont ->
            s.emit(event, arrayOf(toWire(payload)), object : AckWithTimeout(5000) {
                override fun onSuccess(vararg args: Any?) {
                    main.post { if (cont.isActive) cont.resume(args.firstOrNull()?.let(::toJson)) }
                }

                override fun onTimeout() {
                    main.post { if (cont.isActive) cont.resume(null) }
                }
            })
        }
    }

    internal fun addConnectHook(hook: (Socket) -> Unit) {
        connectHooks += hook
        socket?.takeIf { it.connected() }?.let(hook)
    }

    internal fun removeConnectHook(hook: (Socket) -> Unit) {
        connectHooks -= hook
    }
}

/** Run [handler] for every live [event] while this composable is on screen. */
@Composable
fun SocketEvent(event: String, handler: (List<JsonElement>) -> Unit) {
    val latest = rememberUpdatedState(handler)
    LaunchedEffect(event) {
        Realtime.events.collect { if (it.name == event) latest.value(it.args) }
    }
}

/** Join a socket room (e.g. a chat) while on screen; re-joined after every reconnect. */
@Composable
fun SocketRoom(joinEvent: String, leaveEvent: String, id: String?) {
    DisposableEffect(joinEvent, leaveEvent, id) {
        if (id == null) return@DisposableEffect onDispose { }
        val join: (Socket) -> Unit = { it.emit(joinEvent, id) }
        Realtime.addConnectHook(join)
        onDispose {
            Realtime.removeConnectHook(join)
            Realtime.emit(leaveEvent, JsonPrimitive(id))
        }
    }
}
