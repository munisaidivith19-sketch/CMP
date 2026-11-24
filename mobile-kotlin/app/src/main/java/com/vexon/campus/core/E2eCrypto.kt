package com.vexon.campus.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * End-to-end encryption for chat, protocol v1 (docs/chat-e2e.md) — the same
 * bytes as the web app's services/e2eCrypto.js. Pure JVM crypto, so it is unit
 * tested against the shared vector (docs/chat-e2e-vector.json).
 */
object E2eCrypto {
    const val VERSION = 1
    private const val LABEL = "vexon-chat-e2e-v1"
    private val random = SecureRandom()
    private val b64e = Base64.getEncoder()
    private val b64d = Base64.getDecoder()

    class NoKeyForDevice : Exception("This message was not encrypted for this device")

    /** A device's key: the private key as PKCS#8 and the public key as SPKI, both base64. */
    data class DeviceKey(val deviceId: String?, val privatePkcs8: String, val publicSpki: String)

    fun generateKeyPair(): KeyPair =
        KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1"), random) }.generateKeyPair()

    fun newDeviceKey(): DeviceKey {
        val pair = generateKeyPair()
        return DeviceKey(null, b64e.encodeToString(pair.private.encoded), b64e.encodeToString(pair.public.encoded))
    }

    private fun publicKey(spkiB64: String): PublicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(b64d.decode(spkiB64)))
    private fun privateKey(pkcs8B64: String): PrivateKey = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(b64d.decode(pkcs8B64)))
    private fun bytes(n: Int) = ByteArray(n).also { random.nextBytes(it) }

    /** HKDF-SHA256 (RFC 5869) for a single 32-byte output block. */
    private fun hkdf32(ikm: ByteArray, salt: ByteArray, info: ByteArray): ByteArray {
        val extract = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(salt, "HmacSHA256")) }.doFinal(ikm)
        val expand = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(extract, "HmacSHA256")) }
        return expand.doFinal(info + byteArrayOf(1))
    }

    private fun kek(mine: PrivateKey, theirs: PublicKey, deviceId: String): ByteArray {
        val shared = KeyAgreement.getInstance("ECDH").apply { init(mine); doPhase(theirs, true) }.generateSecret()
        return hkdf32(shared, LABEL.toByteArray(), deviceId.toByteArray())
    }

    private fun gcm(mode: Int, key: ByteArray, iv: ByteArray, aad: ByteArray, data: ByteArray): ByteArray =
        Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            updateAAD(aad)
        }.doFinal(data)

    private fun contentAad(conversationId: String) = "$LABEL|$conversationId".toByteArray()

    /** One recipient device: its id and SPKI public key (base64). */
    data class Recipient(val deviceId: String, val publicKey: String)

    /** The envelope the server stores: { v, epk, iv, ct, keys: [{ d, iv, wk }] }. */
    fun encrypt(conversationId: String, text: String, devices: List<Recipient>): JsonObject {
        val ck = bytes(32)
        val iv = bytes(12)
        val plain = JsonObject(mapOf("t" to JsonPrimitive(text))).toString().toByteArray()
        val ct = gcm(Cipher.ENCRYPT_MODE, ck, iv, contentAad(conversationId), plain)
        val eph = generateKeyPair()
        val keys = devices.map { d ->
            val kiv = bytes(12)
            val wk = gcm(Cipher.ENCRYPT_MODE, kek(eph.private, publicKey(d.publicKey), d.deviceId), kiv, d.deviceId.toByteArray(), ck)
            JsonObject(mapOf("d" to JsonPrimitive(d.deviceId), "iv" to JsonPrimitive(b64e.encodeToString(kiv)), "wk" to JsonPrimitive(b64e.encodeToString(wk))))
        }
        ck.fill(0)
        return JsonObject(
            mapOf(
                "v" to JsonPrimitive(VERSION),
                "epk" to JsonPrimitive(b64e.encodeToString(eph.public.encoded)),
                "iv" to JsonPrimitive(b64e.encodeToString(iv)),
                "ct" to JsonPrimitive(b64e.encodeToString(ct)),
                "keys" to JsonArray(keys),
            )
        )
    }

    /** Plain text of an envelope; throws [NoKeyForDevice], or a crypto error if tampered with. */
    fun decrypt(conversationId: String, envelope: JsonElement, deviceId: String, privatePkcs8: String): String {
        require(envelope["v"].int == VERSION) { "Unsupported message version" }
        val entry = envelope["keys"].list.firstOrNull { it["d"].str == deviceId } ?: throw NoKeyForDevice()
        val unwrap = kek(privateKey(privatePkcs8), publicKey(envelope["epk"].str!!), deviceId)
        val ck = gcm(Cipher.DECRYPT_MODE, unwrap, b64d.decode(entry["iv"].str!!), deviceId.toByteArray(), b64d.decode(entry["wk"].str!!))
        val plain = gcm(Cipher.DECRYPT_MODE, ck, b64d.decode(envelope["iv"].str!!), contentAad(conversationId), b64d.decode(envelope["ct"].str!!))
        ck.fill(0)
        return parseJson(String(plain, Charsets.UTF_8))["t"].str.orEmpty()
    }
}
