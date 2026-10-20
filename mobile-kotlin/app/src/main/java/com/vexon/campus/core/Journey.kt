package com.vexon.campus.core

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Display rules for server-recorded bus journeys — the same wording as the web
 * app (client/src/pages/transport/journeyFormat.js). Pure, unit-tested.
 *
 * The server decides direction, next stop, recorded arrival / departure times
 * and ETAs; the app only shows them. Times are UTC on the wire and shown on
 * the CAMPUS clock (Asia/Kolkata unless the server says otherwise), whatever
 * zone the phone is set to. Recorded and predicted times are never mixed up.
 */
object Journey {
    const val CAMPUS_TZ = "Asia/Kolkata"
    private val clock = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)

    fun zone(tz: String?): ZoneId = runCatching { ZoneId.of(tz ?: CAMPUS_TZ) }.getOrDefault(ZoneId.of(CAMPUS_TZ))

    /** "7:42 am" on the campus clock; "" for a missing or invalid time. */
    fun campusTime(iso: String?, tz: String? = null): String {
        if (iso.isNullOrBlank()) return ""
        val t = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
        return t.atZone(zone(tz)).format(clock).lowercase(Locale.ENGLISH)
    }

    fun directionLabel(direction: String?): String = when (direction) {
        "towards_college" -> "Towards college"
        "towards_home" -> "Towards home"
        else -> ""
    }

    fun directionText(direction: String?, assumed: Boolean): String =
        directionLabel(direction).let { if (it.isNotEmpty() && assumed) "$it (assumed)" else it }

    /** An ETA from the server: "about 6 min · 7:48 am" (marked when approximate), or its reason when unavailable. */
    data class Eta(val ok: Boolean, val minutes: Int?, val predictedArrivalAt: String?, val approximate: Boolean, val method: String?, val confidence: String?, val reason: String?)

    fun etaLine(eta: Eta?, tz: String? = null): String {
        if (eta == null) return ""
        if (!eta.ok) return eta.reason ?: "ETA unavailable"
        val m = eta.minutes ?: 0
        val mins = if (m <= 0) "arriving now" else "about $m min"
        val p = if (eta.approximate) "~" else ""
        return "$p$mins · $p${campusTime(eta.predictedArrivalAt, tz)}"
    }

    fun methodText(method: String?): String? = when (method) {
        "history" -> "from earlier recorded trips"
        "recent_speed" -> "from the bus’s recent speed"
        "assumed_speed" -> "assumed average speed — approximate"
        else -> null
    }

    /** One planned stop of the journey. `status`: upcoming | arrived | departed | not_recorded. */
    data class Stop(
        val order: Int,
        val stopId: String,
        val name: String,
        val status: String,
        val actualArrivalAt: String?,
        val actualDepartureAt: String?,
        val notRecordedReason: String?,
        val eta: Eta?,
        val manual: Boolean = false,
        val isCollege: Boolean = false,
    )

    fun stopLine(s: Stop, tz: String? = null): String = when (s.status) {
        "departed" -> if (s.actualDepartureAt != null) "Arrived ${campusTime(s.actualArrivalAt, tz)} · left ${campusTime(s.actualDepartureAt, tz)}" else "Arrived ${campusTime(s.actualArrivalAt, tz)}"
        "arrived" -> "At the stop since ${campusTime(s.actualArrivalAt, tz)}"
        "not_recorded" -> if (s.notRecordedReason == "before_tracking") "Passed before tracking started" else "Passed — arrival not detected"
        else -> if (s.eta != null) "Expected ${etaLine(s.eta, tz)}" else "Upcoming"
    }

    private val day = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH)

    /** "20 Oct 2026" on the campus calendar; "" for a missing or invalid time. */
    fun campusDate(iso: String?, tz: String? = null): String {
        if (iso.isNullOrBlank()) return ""
        val t = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
        return t.atZone(zone(tz)).format(day)
    }

    /** Trip status as the history shows it (same labels as the web). */
    fun tripStatus(status: String?, interrupted: Boolean = false): String = when (status) {
        "active" -> "In progress"
        "completed" -> "Completed"
        "stopped" -> if (interrupted) "Stopped early" else "Ended"
        "timeout" -> "Ended — no GPS"
        else -> status.orEmpty()
    }

    /** "42 min" / "1 h 5 min"; "" when unknown. */
    fun durationText(minutes: Double?): String {
        if (minutes == null || minutes.isNaN() || minutes < 0) return ""
        val m = Math.round(minutes).toInt()
        return if (m < 60) "$m min" else "${m / 60} h${if (m % 60 > 0) " ${m % 60} min" else ""}"
    }

    /** "3 min late" / "2 min early" / "on time" against a real timetable; null when there is none. */
    fun delayText(minutes: Double?, toleranceMinutes: Int = 0): String? {
        if (minutes == null || minutes.isNaN()) return null
        val m = Math.round(minutes).toInt()
        return when {
            kotlin.math.abs(m) <= toleranceMinutes -> "on time"
            m > 0 -> "$m min late"
            else -> "${-m} min early"
        }
    }

    /** One stop of a past trip: RECORDED times only, or why none was recorded. */
    fun historyStopLine(arrivalAt: String?, departureAt: String?, notRecorded: String?, tz: String? = null): String = when {
        arrivalAt != null && departureAt != null -> "Arrived ${campusTime(arrivalAt, tz)} · left ${campusTime(departureAt, tz)}"
        arrivalAt != null -> "Arrived ${campusTime(arrivalAt, tz)}"
        notRecorded == "pending" -> "Not reached yet"
        notRecorded == "before_tracking" -> "Passed before tracking started"
        else -> "Arrival not detected"
    }

    /** Stops already behind the bus, as sequences of the route drawn on the map (matched by stop id). */
    fun passedSequences(stops: List<Stop>, routeStops: List<Pair<String, Int>>): Set<Int> {
        val done = stops.filter { it.status in setOf("departed", "arrived", "not_recorded") }.map { it.stopId }.toSet()
        return routeStops.filter { it.first in done }.map { it.second }.toSet()
    }
}
