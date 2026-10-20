package com.vexon.campus.push

import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * MainActivity is exported (it is the launcher), so any app on the phone can
 * start it with any extras. A notification's link and notificationId are only
 * honoured when the intent also carries this install's secret nonce, which
 * only the app's own PendingIntents (immutable) contain. The nonce is random,
 * kept in app-private storage (so taps on notifications posted before a
 * process restart still work) and never leaves the device.
 */
object IntentNonce {
    const val EXTRA = "vexon.nonce"
    private const val PREFS = "vexon.intent"
    private const val KEY = "nonce"

    @Volatile private var cached: String? = null

    fun get(context: Context): String = cached ?: synchronized(this) {
        cached ?: run {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val value = prefs.getString(KEY, null)?.takeIf { it.length == 64 } ?: generate().also { prefs.edit().putString(KEY, it).apply() }
            cached = value
            value
        }
    }

    /** 32 random bytes as hex. */
    fun generate(): String {
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        return bytes.joinToString("") { "%02x".format(it) }
    }

    /** Constant-time check that an intent carried the expected nonce. */
    fun matches(expected: String, given: String?): Boolean =
        given != null && expected.isNotEmpty() && MessageDigest.isEqual(expected.toByteArray(), given.toByteArray())
}
