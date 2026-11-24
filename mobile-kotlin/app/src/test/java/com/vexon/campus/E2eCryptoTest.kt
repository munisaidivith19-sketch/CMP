package com.vexon.campus

import com.vexon.campus.core.E2eCrypto
import com.vexon.campus.core.get
import com.vexon.campus.core.parseJson
import com.vexon.campus.core.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File

/** End-to-end chat encryption (docs/chat-e2e.md): same bytes as the web app. */
class E2eCryptoTest {
    private val conv = "6650a1b2c3d4e5f601234567"

    @Test
    fun readsTheSharedVectorFromTheNodeImplementation() {
        // Unit tests run in the app module directory; the vector lives in the repo's docs/.
        val file = listOf("../../docs/chat-e2e-vector.json", "../docs/chat-e2e-vector.json").map(::File).first { it.exists() }
        val v = parseJson(file.readText())!!
        val text = E2eCrypto.decrypt(v["conversationId"].str!!, v["envelope"]!!, v["deviceId"].str!!, v["devicePrivatePkcs8"].str!!)
        assertEquals(v["text"].str, text)
    }

    @Test
    fun everyListedDeviceReadsItAndNoOneElse() {
        val alice = E2eCrypto.newDeviceKey().copy(deviceId = "alice")
        val bob = E2eCrypto.newDeviceKey().copy(deviceId = "bob")
        val eve = E2eCrypto.newDeviceKey().copy(deviceId = "eve")
        val text = "Lab moved to 3rd floor 🙂 — ಸರಿ"
        val env = E2eCrypto.encrypt(conv, text, listOf(alice, bob).map { E2eCrypto.Recipient(it.deviceId!!, it.publicSpki) })

        assertFalse(env.toString().contains("Lab moved"))
        assertEquals(text, E2eCrypto.decrypt(conv, env, "alice", alice.privatePkcs8))
        assertEquals(text, E2eCrypto.decrypt(conv, env, "bob", bob.privatePkcs8))
        assertThrows(E2eCrypto.NoKeyForDevice::class.java) { E2eCrypto.decrypt(conv, env, "eve", eve.privatePkcs8) }
        // Eve using Bob's entry cannot unwrap it, and the text is bound to its conversation.
        assertThrows(Exception::class.java) { E2eCrypto.decrypt(conv, env, "bob", eve.privatePkcs8) }
        assertThrows(Exception::class.java) { E2eCrypto.decrypt("ffffffffffffffffffffffff", env, "bob", bob.privatePkcs8) }
    }

    @Test
    fun tamperedCiphertextIsRejected() {
        val bob = E2eCrypto.newDeviceKey().copy(deviceId = "bob")
        val env = E2eCrypto.encrypt(conv, "secret", listOf(E2eCrypto.Recipient("bob", bob.publicSpki)))
        val ct = java.util.Base64.getDecoder().decode(env["ct"].str!!).also { it[0] = (it[0].toInt() xor 1).toByte() }
        val tampered = JsonObject(env + ("ct" to JsonPrimitive(java.util.Base64.getEncoder().encodeToString(ct))))
        assertThrows(Exception::class.java) { E2eCrypto.decrypt(conv, tampered, "bob", bob.privatePkcs8) }
        assertEquals(1, (env["keys"] as JsonArray).size)
    }
}
