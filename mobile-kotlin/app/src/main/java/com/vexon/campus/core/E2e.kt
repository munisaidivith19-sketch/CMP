package com.vexon.campus.core

import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * End-to-end encrypted chat on this phone (docs/chat-e2e.md). The device's
 * private key is kept in [SecureStore] (encrypted with a hardware-backed
 * Keystore key) and never leaves the phone; the server only sees ciphertext.
 */
object E2e {
    const val PENDING = "🔒 Decrypting…"
    const val NO_KEY = "🔒 Sent before this device was set up for encrypted chat, so it cannot be read here."
    const val FAILED = "🔒 This message could not be decrypted on this device."

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val lock = Mutex()
    private var device: Deferred<E2eCrypto.DeviceKey>? = null
    private var deviceUser: String? = null
    private val plain = object : LinkedHashMap<String, String>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 3000
    }

    private fun storeKey(userId: String) = "chat_e2e_device:$userId"

    private fun load(userId: String): E2eCrypto.DeviceKey? = SecureStore.get(storeKey(userId))?.let { parseJson(it) }?.let {
        val priv = it["privateKey"].str ?: return null
        val pub = it["publicKey"].str ?: return null
        E2eCrypto.DeviceKey(it["deviceId"].str, priv, pub)
    }

    private fun save(userId: String, k: E2eCrypto.DeviceKey) =
        SecureStore.set(storeKey(userId), jsonOf("deviceId" to (k.deviceId ?: Omit), "privateKey" to k.privatePkcs8, "publicKey" to k.publicSpki).toString())

    private suspend fun setUp(userId: String): E2eCrypto.DeviceKey = withContext(Dispatchers.IO) {
        var key = load(userId) ?: E2eCrypto.newDeviceKey().also { save(userId, it) }
        // Announce the key on every start: registers it, or marks the device as still in use.
        val res = try {
            Http.request("POST", "/chat/e2e/devices", body = jsonOf("publicKey" to key.publicSpki, "platform" to "android"))
        } catch (e: ApiException) {
            if (e.data["code"].str != "E2E_DEVICE_REVOKED") throw e
            // Removed from the account: start again with a brand-new key.
            key = E2eCrypto.newDeviceKey()
            save(userId, key)
            Http.request("POST", "/chat/e2e/devices", body = jsonOf("publicKey" to key.publicSpki, "platform" to "android"))
        }
        val id = res["deviceId"].str ?: error("No device id")
        if (key.deviceId != id) key = key.copy(deviceId = id).also { save(userId, it) }
        key
    }

    /** This phone's chat device for the signed-in user (set up once per session). */
    suspend fun ensureDevice(): E2eCrypto.DeviceKey? {
        val userId = Auth.user.id ?: return null
        val job = lock.withLock {
            if (deviceUser != userId || device?.isCancelled == true) {
                deviceUser = userId
                device = scope.async { setUp(userId) }
            }
            device!!
        }
        return try {
            job.await()
        } catch (e: Exception) {
            lock.withLock { if (device === job) device = null } // try again next time
            throw e
        }
    }

    private fun envId(env: JsonElement) = "${env["epk"].str}|${env["iv"].str}"

    // ── Sending ─────────────────────────────────────────────────────
    private suspend fun keys(conversationId: String) = Http.request("GET", "/chat/conversations/$conversationId/e2e-keys")

    /** Whether messages in this conversation will be end-to-end encrypted (every participant has a device). */
    suspend fun isOn(conversationId: String): Boolean = runCatching { ensureDevice(); keys(conversationId)["complete"].bool }.getOrDefault(false)

    /**
     * The request body for `text`: `{ e2e }` when every participant has a
     * device, else `{ body }` (still encrypted at rest by the server).
     * [request] performs the call; a 409 "devices changed" is retried once.
     */
    suspend fun send(conversationId: String, text: String, extra: Map<String, Any?> = emptyMap(), request: suspend (JsonObject) -> JsonElement): JsonElement {
        suspend fun attempt(): JsonElement {
            val me = runCatching { ensureDevice() }.getOrNull()
            val k = if (me != null) keys(conversationId) else null
            if (k == null || !k["complete"].bool) return request(JsonObject(mapOf("body" to toJson(text)) + extra.mapValues { toJson(it.value) }))
            val recipients = k["devices"].list.map { E2eCrypto.Recipient(it["deviceId"].str!!, it["publicKey"].str!!) }
            val env = withContext(Dispatchers.Default) { E2eCrypto.encrypt(conversationId, text, recipients) }
            synchronized(plain) { plain[envId(env)] = text }
            return request(JsonObject(mapOf("e2e" to env) + extra.mapValues { toJson(it.value) }))
        }
        return try {
            attempt()
        } catch (e: ApiException) {
            if (e.status == 409 && e.data["code"].str == "E2E_DEVICES_CHANGED") attempt() else throw e
        }
    }

    // ── Reading ─────────────────────────────────────────────────────
    fun cached(env: JsonElement): String? = synchronized(plain) { plain[envId(env)] }

    /** Plain text of an envelope on this phone (never throws). */
    suspend fun open(conversationId: String, env: JsonElement): String {
        cached(env)?.let { return it }
        val me = try { ensureDevice() } catch (_: Exception) { return FAILED } ?: return FAILED
        val text = withContext(Dispatchers.Default) {
            try {
                E2eCrypto.decrypt(conversationId, env, me.deviceId.orEmpty(), me.privatePkcs8)
            } catch (_: E2eCrypto.NoKeyForDevice) {
                NO_KEY
            } catch (_: Exception) {
                FAILED
            }
        }
        synchronized(plain) { plain[envId(env)] = text }
        return text
    }

    /** `message` with readable `body` (and reply quote) when end-to-end encrypted. */
    suspend fun reveal(conversationId: String, message: JsonElement?): JsonElement? {
        if (message == null) return null
        var out: JsonElement = message
        message["e2e"]?.let { out = out.with("body" to open(conversationId, it)) }
        message["replyTo"]?.let { r -> r["e2e"]?.let { out = out.with("replyTo" to r.with("body" to open(conversationId, it))) } }
        return out
    }

    suspend fun revealAll(conversationId: String, messages: List<JsonElement>): List<JsonElement> = messages.map { reveal(conversationId, it) ?: it }
}

/** Readable text of a message or chat preview: its body, or the decrypted end-to-end text. */
@Composable
fun rememberChatText(conversationId: String?, item: JsonElement?): String? {
    val env = item["e2e"]
    val initial = if (env == null) item["body"].str else E2e.cached(env) ?: E2e.PENDING
    return produceState(initial, conversationId, env, item["body"].str) {
        value = if (env != null && conversationId != null) E2e.open(conversationId, env) else item["body"].str
    }.value
}
