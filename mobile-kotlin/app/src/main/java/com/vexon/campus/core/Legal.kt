package com.vexon.campus.core

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Terms and Conditions / Privacy Policy (port of client/src/utils/legal.js).
 * Shown from the profile; the app does not ask for acceptance.
 */
object Legal {
    const val TERMS = "terms"
    const val PRIVACY = "privacy"
    const val APP_NAME = "J.N.N Campus Connect"
    const val INSTITUTION = "J.N.N Institute of Engineering"

    data class Entry(val label: String, val path: String)

    /** The profile's "About the App" section: exactly these three entries. */
    val ABOUT_ENTRIES = listOf(
        Entry("About the App", "/about"),
        Entry("Terms and Conditions", "/terms"),
        Entry("Privacy Policy", "/privacy-policy"),
    )

    private val DATE = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH).withZone(ZoneOffset.UTC)

    /** "22 October 2026" — effective dates are calendar dates (UTC). */
    fun formatEffective(iso: String?): String =
        iso?.let { runCatching { DATE.format(Instant.parse(it)) }.getOrNull() }.orEmpty()
}
