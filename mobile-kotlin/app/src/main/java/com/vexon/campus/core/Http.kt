package com.vexon.campus.core

import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import com.vexon.campus.VexonApp
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import okhttp3.Call
import okhttp3.Callback

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** What went wrong with a request — mirrors RTK Query's error shape ({ status, data }). */
class ApiException(
    val status: Int,
    val data: JsonElement? = null,
    val kind: Kind = Kind.HTTP,
) : Exception(data["message"].str ?: kind.name) {
    enum class Kind { HTTP, NETWORK, TIMEOUT }

    val isNetwork get() = kind != Kind.HTTP
}

/** User-facing message for a failed request (port of `errMsg`). */
fun errMsg(e: Throwable?, fallback: String = "Something went wrong"): String = when {
    e is ApiException && e.data["message"].text != null -> e.data["message"].str!!
    e is ApiException && e.kind == ApiException.Kind.NETWORK -> "Cannot reach the JNN server — check your internet connection"
    e is ApiException && e.kind == ApiException.Kind.TIMEOUT -> "The server is taking too long — please try again"
    else -> fallback
}

object Http {
    private val JSON = "application/json; charset=utf-8".toMediaType()

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    /** Headers that tell the backend this is the Android app (refresh token in body, device label). */
    val mobileHeaders: Map<String, String> by lazy {
        val name = listOf(Build.MANUFACTURER, Build.MODEL).filter { !it.isNullOrBlank() }
            .joinToString(" ").replaceFirstChar { it.uppercase() }.take(60).ifBlank { "Android" }
        mapOf("x-client-platform" to "mobile", "x-device-name" to name)
    }

    // Auth endpoints that must never trigger the refresh-and-replay dance.
    private val NO_RETRY = listOf("/auth/login", "/auth/refresh", "/auth/logout", "/auth/forgot-password", "/auth/reset-password")

    /**
     * One API call against `${server}/api${path}`. On 401 the session is refreshed
     * once and the request replayed (same as the web client). Reads (GET) are
     * retried with backoff when the network drops; writes never are, so a slow
     * "Save" can't be applied twice.
     */
    suspend fun request(
        method: String,
        path: String,
        params: Map<String, Any?>? = null,
        body: Any? = null,
        timeoutMs: Long = 20_000,
    ): JsonElement {
        var attempt = 0
        while (true) {
            try {
                return authed(method, path, params, body, timeoutMs)
            } catch (e: ApiException) {
                if (method != "GET" || !e.isNetwork || attempt >= 2) throw e
                attempt++
                delay(500L * (1 shl attempt))
            }
        }
    }

    private suspend fun authed(method: String, path: String, params: Map<String, Any?>?, body: Any?, timeoutMs: Long): JsonElement {
        try {
            val res = try {
                raw(method, path, params, body, timeoutMs, Auth.accessToken)
            } catch (e: ApiException) {
                if (e.status != 401 || NO_RETRY.any { path.startsWith(it) }) throw e
                when (val r = Auth.refreshSession()) {
                    is RefreshResult.Ok -> raw(method, path, params, body, timeoutMs, Auth.accessToken)
                    RefreshResult.Offline -> throw e
                    RefreshResult.Expired -> { Auth.sessionExpired(); throw e }
                }
            }
            Connection.set(true)
            return res
        } catch (e: ApiException) {
            Connection.set(!e.isNetwork)
            // The Terms gate: AppRoot then shows the acceptance screen.
            if (Legal.isTermsRequired(e.status, e.data)) Auth.markTermsRequired()
            throw e
        }
    }

    /**
     * Built segment by segment (ApiPath.url → HttpUrl.Builder.addPathSegment).
     * A path with a rejected id (see ApiPath.oid) sends no request at all.
     */
    private fun url(path: String, params: Map<String, Any?>?): String {
        if (ServerConfig.apiUrl.isEmpty()) throw ApiException(0, kind = ApiException.Kind.NETWORK)
        val built = ApiPath.url(ServerConfig.apiUrl, path, params, Omit)
            ?: throw ApiException(400, jsonOf("message" to "This item could not be opened (invalid link)"))
        return built.toString()
    }

    private suspend fun raw(method: String, path: String, params: Map<String, Any?>?, body: Any?, timeoutMs: Long, token: String?): JsonElement {
        val reqBody: RequestBody? = when (body) {
            null -> if (method == "GET") null else ByteArray(0).toRequestBody(null)
            is RequestBody -> body
            else -> toJson(body).toString().toRequestBody(JSON)
        }
        val builder = Request.Builder().url(url(path, params)).method(method, reqBody)
        mobileHeaders.forEach { (k, v) -> builder.header(k, v) }
        if (token != null) builder.header("authorization", "Bearer $token")
        val c = if (timeoutMs == 20_000L) client else client.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build()
        val response = c.newCall(builder.build()).await()
        return response.use { res ->
            val text = withContext(Dispatchers.IO) { res.body?.string().orEmpty() }
            val json = if (text.isBlank()) JsonNull else parseJson(text) ?: JsonNull
            if (!res.isSuccessful) throw ApiException(res.code, json)
            json
        }
    }

    suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
        enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) = cont.resume(response)
            override fun onFailure(call: Call, e: IOException) {
                val kind = if (e is InterruptedIOException) ApiException.Kind.TIMEOUT else ApiException.Kind.NETWORK
                cont.resumeWithException(ApiException(0, kind = kind))
            }
        })
        cont.invokeOnCancellation { runCatching { cancel() } }
    }

    /** POST without auth retry (refresh / logout use the refresh token in the body). */
    suspend fun postPublic(path: String, body: JsonObject, timeoutMs: Long = 15_000): JsonElement =
        raw("POST", path, null, body, timeoutMs, null)

    /** multipart/form-data body with one image file read from a content:// Uri. */
    suspend fun imagePart(uri: Uri): RequestBody = withContext(Dispatchers.IO) {
        val resolver = VexonApp.instance.contentResolver
        val type = resolver.getType(uri) ?: "image/jpeg"
        val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        } ?: "photo.jpg"
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: throw ApiException(0, kind = ApiException.Kind.NETWORK)
        MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", name, bytes.toRequestBody(type.toMediaType()))
            .build()
    }
}

sealed interface RefreshResult {
    data class Ok(val session: JsonElement) : RefreshResult
    data object Offline : RefreshResult
    data object Expired : RefreshResult
}

/**
 * Signed-in state (port of store/authSlice.js + services/session.js). The refresh
 * token is NOT kept in memory state — it lives only in the encrypted SecureStore.
 */
object Auth {
    private const val REFRESH_KEY = "vexon.refreshToken"

    data class State(
        val user: JsonElement? = null,
        val accessToken: String? = null,
        val ready: Boolean = false,
        /** True when the server ended the session (revoked, expired, password changed) — not a manual sign-out. */
        val sessionEnded: Boolean = false,
    )

    val state = kotlinx.coroutines.flow.MutableStateFlow(State())
    val accessToken: String? get() = state.value.accessToken
    val user: JsonElement? get() = state.value.user

    fun setCredentials(session: JsonElement) {
        state.value = state.value.copy(user = session["user"], accessToken = session["accessToken"].str, sessionEnded = false)
    }

    fun setUser(user: JsonElement?) {
        state.value = state.value.copy(user = user)
    }

    /** The server refused a request until the current Terms are accepted. */
    fun markTermsRequired() {
        val user = state.value.user ?: return
        if (!Legal.termsRequired(user)) state.value = state.value.copy(user = Legal.withTermsRequired(user))
    }

    /** `legal` from POST /legal/accept (versions only). */
    fun setLegal(legal: JsonElement) {
        state.value = state.value.copy(user = Legal.withLegal(state.value.user, legal))
    }

    fun loggedOut() {
        state.value = state.value.copy(user = null, accessToken = null, sessionEnded = false)
    }

    /** The server rejected the session: sign out and tell the user why on the sign-in screen. */
    fun sessionExpired() {
        state.value = state.value.copy(user = null, accessToken = null, sessionEnded = state.value.user != null)
    }

    fun sessionChecked() {
        state.value = state.value.copy(ready = true)
    }

    fun saveRefreshToken(token: String?) = SecureStore.set(REFRESH_KEY, token?.takeIf { it.isNotBlank() })
    fun readRefreshToken(): String? = SecureStore.get(REFRESH_KEY)
    fun clearRefreshToken() = SecureStore.delete(REFRESH_KEY)

    private val refreshLock = Mutex()
    private var inflight: CompletableDeferred<RefreshResult>? = null

    /**
     * Exchange the stored refresh token for a new session. The server rotates the
     * token on every call (and revokes the session if an old one is replayed), so a
     * single in-flight refresh is shared by every caller.
     */
    suspend fun refreshSession(): RefreshResult {
        val (deferred, owner) = refreshLock.withLock {
            inflight?.let { it to false } ?: CompletableDeferred<RefreshResult>().also { inflight = it }.let { it to true }
        }
        if (!owner) return deferred.await()
        val result = try {
            doRefresh()
        } finally {
            refreshLock.withLock { inflight = null }
        }
        deferred.complete(result)
        return result
    }

    private suspend fun doRefresh(): RefreshResult {
        val token = withContext(Dispatchers.IO) { readRefreshToken() }
        if (token == null || ServerConfig.apiUrl.isEmpty()) return RefreshResult.Expired
        return try {
            val session = Http.postPublic("/auth/refresh", jsonOf("refreshToken" to token))
            withContext(Dispatchers.IO) { saveRefreshToken(session["refreshToken"].str) }
            setCredentials(session)
            RefreshResult.Ok(session)
        } catch (e: ApiException) {
            if (e.status == 401) {
                withContext(Dispatchers.IO) { clearRefreshToken() }
                RefreshResult.Expired
            } else RefreshResult.Offline // network down / server error — keep the stored token
        }
    }
}
