package com.vexon.campus.core

import kotlin.math.roundToInt

/**
 * Pure helpers for the bus map (no Android types) — the same rules as the web
 * map's busGeo.js, so both apps move, rotate and label buses identically.
 * Unit-tested in BusMathTest.
 */
object BusMath {
    data class LatLng(val lat: Double, val lng: Double)

    /**
     * Where the map opens before a bus, route or the user's position is known:
     * Chennai at city level. Applied once when the map is created — never
     * re-applied, so the user can still pan / zoom out to Tamil Nadu, India or the world.
     */
    val DEFAULT_CENTER = LatLng(13.0827, 80.2707)
    const val DEFAULT_ZOOM = 11.0

    fun lerp(a: LatLng, b: LatLng, t: Double): LatLng {
        val k = t.coerceIn(0.0, 1.0)
        return LatLng(a.lat + (b.lat - a.lat) * k, a.lng + (b.lng - a.lng) * k)
    }

    fun easeOut(t: Double): Double = 1 - (1 - t.coerceIn(0.0, 1.0)).let { it * it * it }

    /** Shortest signed turn from one heading to another (350° → 10° is +20°). */
    fun shortestTurn(from: Double, to: Double): Double {
        val d = ((((to - from) % 360) + 540) % 360) - 180
        return if (d == -180.0) 180.0 else d
    }

    /** A heading worth showing: reported AND the bus is moving (≥ 2 m/s). */
    fun reliableHeading(heading: Double?, speed: Double?): Double? =
        if (heading != null && speed != null && speed >= 2.0 && heading in 0.0..360.0) heading else null

    enum class Tracking { LIVE, STALE, OFFLINE }

    fun freshness(fixAtMs: Long?, nowMs: Long, liveSeconds: Int = 60, staleSeconds: Int = 300): Tracking {
        if (fixAtMs == null) return Tracking.OFFLINE
        val age = (nowMs - fixAtMs) / 1000.0
        return when {
            age <= liveSeconds -> Tracking.LIVE
            age <= staleSeconds -> Tracking.STALE
            else -> Tracking.OFFLINE
        }
    }

    fun agoText(fixAtMs: Long?, nowMs: Long): String {
        if (fixAtMs == null) return "never"
        val s = ((nowMs - fixAtMs) / 1000.0).roundToInt().coerceAtLeast(0)
        return when {
            s < 10 -> "just now"
            s < 60 -> "$s s ago"
            s < 3600 -> "${s / 60} min ago"
            else -> "${s / 3600} h ago"
        }
    }

    /** Coarser than this (metres) is an estimate — Wi-Fi / network / "approximate" permission — not GPS. */
    const val COARSE_FIX_M = 100f

    /** "± 8 m", "± 350 m", "± 2.4 km". */
    fun accuracyText(meters: Float): String =
        if (meters < 1000f) "± ${meters.roundToInt()} m" else "± ${"%.1f".format(java.util.Locale.ROOT, meters / 1000f)} km"

    /** Points of a circle of [meters] around a position (the accuracy area), closed. */
    fun circle(center: LatLng, meters: Double, steps: Int = 48): List<LatLng> {
        val r = 6371008.8
        val d = meters / r
        val la = Math.toRadians(center.lat)
        val lo = Math.toRadians(center.lng)
        return (0..steps).map { i ->
            val b = 2 * Math.PI * i / steps
            val lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b))
            val lng2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2))
            LatLng(Math.toDegrees(lat2), Math.toDegrees(lng2))
        }
    }

    // ── "My location": the viewer's own device position, never a bus position ──

    enum class MyLocation { IDLE, REQUESTING, AVAILABLE, APPROXIMATE, PERMISSION_DENIED, UNAVAILABLE, TIMEOUT, INVALID }

    /** A usable position: finite, in range, and not 0,0 (a failed reading, not a place). */
    fun validPosition(lat: Double, lng: Double): Boolean =
        lat.isFinite() && lng.isFinite() && lat in -90.0..90.0 && lng in -180.0..180.0 && !(lat == 0.0 && lng == 0.0)

    /**
     * The state of one reading. Mocked or invalid readings are INVALID (never
     * drawn); a coarse reading, or any reading while the app holds only
     * "approximate" permission, is APPROXIMATE.
     */
    fun myLocationState(read: LocationRead, precisePermission: Boolean): MyLocation = when (read) {
        is LocationRead.Ok -> {
            val f = read.fix
            when {
                f.mocked || !validPosition(f.latitude, f.longitude) || !f.accuracy.isFinite() || f.accuracy <= 0f -> MyLocation.INVALID
                !precisePermission || f.accuracy > COARSE_FIX_M -> MyLocation.APPROXIMATE
                else -> MyLocation.AVAILABLE
            }
        }
        LocationRead.PermissionDenied -> MyLocation.PERMISSION_DENIED
        LocationRead.Timeout, LocationRead.Stale -> MyLocation.TIMEOUT
        LocationRead.ServicesOff, LocationRead.Unavailable -> MyLocation.UNAVAILABLE
    }

    /** What to tell the viewer for a reading — only the accuracy the phone reported. */
    fun myLocationMessage(read: LocationRead, precisePermission: Boolean): String = when (myLocationState(read, precisePermission)) {
        MyLocation.AVAILABLE -> "Location found. Accuracy: about ${accuracyText((read as LocationRead.Ok).fix.accuracy).removePrefix("± ")}."
        MyLocation.APPROXIMATE ->
            if (!precisePermission) APPROXIMATE_PERMISSION
            else if (!showsDot((read as LocationRead.Ok).fix.accuracy))
                "Your phone did not get a GPS or Wi-Fi fix, only a network estimate (${accuracyText(read.fix.accuracy)}). Such estimates often point to your mobile network's hub city, which can be a different town far from you, so it is shown as a shaded area, not as your position. Go outdoors, turn on Google Location Accuracy, and tap My location again."
            else "Only an approximate location is available (${accuracyText((read as LocationRead.Ok).fix.accuracy)}), so the blue dot may be off. Go outdoors or near a window, make sure Google Location Accuracy is on, and tap My location again."
        MyLocation.INVALID ->
            if ((read as? LocationRead.Ok)?.fix?.mocked == true) "A mock-location app is active, so your real position cannot be shown. Turn it off and try again."
            else "Your phone returned a location that is not valid, so it was not shown. Tap My location to try again."
        MyLocation.PERMISSION_DENIED -> "Location permission denied. Allow location for VEXON in Settings, then tap My location again."
        MyLocation.TIMEOUT ->
            if (read == LocationRead.Stale) "Your phone only returned an old location reading, so it was not used. Tap My location to try again."
            else "No GPS fix yet. Go outdoors or near a window and tap My location again."
        MyLocation.UNAVAILABLE ->
            if (read == LocationRead.ServicesOff) "Your phone’s Location is switched off. Turn it on and tap My location again."
            else "Unable to obtain your location. Make sure Location and Google Location Accuracy are on, then retry."
        MyLocation.IDLE, MyLocation.REQUESTING -> ""
    }

    /**
     * Coarser than this (metres) is a city-level estimate — cell / IP based —
     * that can place the phone in its network's hub city, far from where it is.
     * Shown as a shaded AREA with a warning, never as a "you are here" dot.
     */
    const val AREA_ONLY_M = 3000f

    fun showsDot(accuracy: Float): Boolean = accuracy.isFinite() && accuracy <= AREA_ONLY_M

    /** Where a reading came from: the provider Android names, else inferred from accuracy (labelled "likely"). */
    fun sourceOf(fix: Fix): String = when {
        fix.provider == "gps" -> "Satellite GPS"
        fix.provider == "network" && fix.accuracy > AREA_ONLY_M -> "Mobile network / IP estimate"
        fix.provider == "network" -> "Wi-Fi / mobile network"
        !fix.accuracy.isFinite() -> "Unknown"
        fix.accuracy <= 30f || (fix.accuracy <= 100f && fix.hasAltitude) -> "Satellite GPS (likely)"
        fix.accuracy <= 300f -> "Wi-Fi / nearby networks (likely)"
        fix.accuracy <= AREA_ONLY_M -> "Mobile-network towers (likely)"
        else -> "Network / IP estimate (likely) — not the phone's own position"
    } + (fix.provider?.takeIf { it != "gps" && it != "network" }?.let { " · provider: $it" } ?: "")

    /** fresh | stale | invalid — the same freshness rule as the shared reader (FixSampler). */
    fun readingVerdict(fix: Fix, nowElapsedMs: Long): String = when {
        fix.mocked || !validPosition(fix.latitude, fix.longitude) || !fix.accuracy.isFinite() || fix.accuracy <= 0f -> "invalid"
        nowElapsedMs - fix.elapsedMs !in -1_000..ReturnLocation.MAX_FIX_AGE_MS -> "stale"
        else -> "fresh"
    }

    /** One raw reading as recorded for the "Location details" view and the debug log. */
    data class Reading(val fix: Fix, val ageMs: Long, val source: String, val verdict: String)

    fun reading(fix: Fix, nowElapsedMs: Long) = Reading(fix, nowElapsedMs - fix.elapsedMs, sourceOf(fix), readingVerdict(fix, nowElapsedMs))

    fun readingText(r: Reading): String =
        "%.5f, %.5f · %s · %d s old\n%s · %s".format(
            java.util.Locale.ROOT, r.fix.latitude, r.fix.longitude,
            if (r.fix.accuracy.isFinite()) accuracyText(r.fix.accuracy) else "no accuracy",
            r.ageMs / 1000, r.source,
            when (r.verdict) { "fresh" -> "fresh"; "stale" -> "rejected: old reading"; else -> "rejected: invalid" },
        )

    const val APPROXIMATE_PERMISSION =
        "VEXON has only APPROXIMATE location, which can be off by a kilometre or more. Tap \"Use precise location\" and choose Precise to see exactly where you are."

    /**
     * Points that frame the whole accuracy area (at least [minMeters]) — street
     * level for a precise fix, zoomed out for a rough one, so an estimate never looks exact.
     */
    fun accuracyFrame(center: LatLng, accuracyMeters: Float, minMeters: Double = 60.0): List<LatLng> =
        circle(center, maxOf(accuracyMeters.toDouble(), minMeters), steps = 8)

    /** The marker label: bus number above the route name. */
    fun markerLabel(number: String, route: String?): String = if (route.isNullOrBlank()) number else "$number\n$route"

    /** ETA text — never more precise than the data allows. */
    fun etaText(ok: Boolean, minutes: Int?, confidence: String?, reason: String?): String = when {
        !ok || minutes == null -> reason ?: "ETA unavailable"
        minutes <= 0 -> "Arriving now"
        confidence == "low" -> "About $minutes min (approximate)"
        else -> "About $minutes min"
    }
}
