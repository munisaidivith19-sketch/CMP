package com.vexon.campus.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Terms and Conditions / Privacy Policy (port of client/src/utils/legal.js).
 * The server decides whether the Terms must be accepted — `user.legal` on
 * sign-in / refresh / me, or a 403 TERMS_ACCEPTANCE_REQUIRED from any API —
 * and records every acceptance. Nothing here is a security boundary.
 */
object Legal {
    const val TERMS = "terms"
    const val PRIVACY = "privacy"
    const val TERMS_REQUIRED_CODE = "TERMS_ACCEPTANCE_REQUIRED"
    const val VERSION_CHANGED_CODE = "POLICY_VERSION_CHANGED"
    const val CHECKBOX_LABEL = "I have read and agree to the Terms and Conditions."
    const val APP_NAME = "J.N.N Campus Connect"
    const val INSTITUTION = "J.N.N Institute of Engineering"

    data class Entry(val label: String, val path: String)

    /** The profile's "About the App" section: exactly these three entries. */
    val ABOUT_ENTRIES = listOf(
        Entry("About the App", "/about"),
        Entry("Terms and Conditions", "/terms"),
        Entry("Privacy Policy", "/privacy-policy"),
    )

    /** Only a real JSON `true` from the server (the same strict check as the web client). */
    fun termsRequired(user: JsonElement?): Boolean =
        (user["legal"]["termsRequired"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true

    fun isTermsRequired(status: Int, body: JsonElement?): Boolean = status == 403 && body["code"].str == TERMS_REQUIRED_CODE

    fun isVersionChanged(e: Throwable?): Boolean = e is ApiException && e.status == 409 && e.data["code"].str == VERSION_CHANGED_CODE

    /** The user with `legal` replaced (from POST /legal/accept). */
    fun withLegal(user: JsonElement?, legal: JsonElement?): JsonElement? {
        val obj = user as? JsonObject ?: return user
        val l = legal as? JsonObject ?: return user
        return JsonObject(obj + ("legal" to l))
    }

    /** The user marked as needing to accept (after a 403 from the Terms gate). */
    fun withTermsRequired(user: JsonElement?): JsonElement? {
        val obj = user as? JsonObject ?: return user
        val legal = (obj["legal"] as? JsonObject) ?: JsonObject(emptyMap())
        return JsonObject(obj + ("legal" to JsonObject(legal + ("termsRequired" to JsonPrimitive(true)))))
    }

    private val DATE = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH).withZone(ZoneOffset.UTC)

    /** "22 October 2026" — effective dates are calendar dates (UTC). */
    fun formatEffective(iso: String?): String =
        iso?.let { runCatching { DATE.format(Instant.parse(it)) }.getOrNull() }.orEmpty()
}
