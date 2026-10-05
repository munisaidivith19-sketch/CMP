package com.vexon.campus.core

import com.vexon.campus.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit

/**
 * Where the Vexon backend lives (port of src/config.js). The app never assumes localhost:
 *  1. A server address saved on the device (login screen → "Server") wins, so one
 *     APK can point at a deployed URL or an internet tunnel without a rebuild.
 *  2. The build-time address (gradle property vexon.apiUrl / VEXON_API_URL /
 *     EXPO_PUBLIC_API_URL).
 *  3. Debug builds with nothing configured use the emulator's host (10.0.2.2:5000).
 */
object ServerConfig {
    private const val SERVER_KEY = "vexon.serverUrl"

    fun clean(url: String?): String = (url ?: "").trim().trimEnd('/').removeSuffix("/api")

    val defaultUrl: String = clean(BuildConfig.API_URL)
    private var current = defaultUrl
    private val _overridden = MutableStateFlow(false)
    val overridden: StateFlow<Boolean> = _overridden.asStateFlow()

    val apiUrl: String get() = current
    val isOverridden: Boolean get() = _overridden.value

    /** Read the saved server address once at launch (before restoring the session). */
    fun loadOverride(): String {
        SecureStore.get(SERVER_KEY)?.let {
            current = clean(it)
            _overridden.value = true
        }
        return current
    }

    /** Save (or clear, with an empty value) the server address used by every request. */
    fun setServerUrl(url: String?): String {
        val next = clean(url)
        if (next.isNotEmpty()) {
            SecureStore.set(SERVER_KEY, next)
            current = next
            _overridden.value = true
        } else {
            SecureStore.delete(SERVER_KEY)
            current = defaultUrl
            _overridden.value = false
        }
        return current
    }

    /** Server address without the scheme, for display. */
    fun shown(): String = current.replace(Regex("^https?://"), "")

    data class Check(val ok: Boolean, val message: String)

    /** Is a Vexon server answering at this address? */
    suspend fun checkServer(url: String): Check {
        val base = clean(url)
        if (!Regex("^https?://[^\\s/]+").containsMatchIn(base)) return Check(false, "Enter a full address starting with http:// or https://")
        return withContext(Dispatchers.IO) {
            try {
                val client = Http.client.newBuilder().callTimeout(8, TimeUnit.SECONDS).build()
                client.newCall(Request.Builder().url("$base/api/health").build()).execute().use { res ->
                    val body = parseJson(res.body?.string().orEmpty())
                    if (res.isSuccessful && body["status"].str == "ok") Check(true, "Connected")
                    else Check(false, "Server answered ${res.code} — is this the JNN API?")
                }
            } catch (e: InterruptedIOException) {
                Check(false, "The server did not answer in time")
            } catch (e: Exception) {
                Check(false, "Cannot reach this address")
            }
        }
    }

    /** Turn a server-relative upload path ("/uploads/x.png") into a full URL. */
    fun assetUrl(path: String?): String? = when {
        path.isNullOrBlank() -> null
        path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:") -> path
        else -> "$current$path"
    }
}

/**
 * App-wide "can we reach the server?" flag (port of services/connection.js). Fed by
 * the socket and by every API request (network error vs. any HTTP answer).
 */
object Connection {
    private val _online = MutableStateFlow(true)
    val online: StateFlow<Boolean> = _online.asStateFlow()

    fun set(value: Boolean) {
        if (_online.value == value) return
        _online.value = value
        if (value) QueryClient.refetchActive()
    }
}
