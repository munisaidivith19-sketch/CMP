package com.vexon.campus.core

import kotlinx.serialization.json.JsonObject
import kotlin.math.roundToInt

/*
 * Gate pass "Return to campus": the device-side rules, kept free of Android
 * APIs so they run under JUnit. The phone only reads one fresh position and
 * sends the raw reading; the server alone decides distance, accuracy and age.
 */

/**
 * One location reading. [elapsedMs] is the fix time on the device's monotonic
 * clock (SystemClock.elapsedRealtime), so its age is right even when the wall
 * clock is wrong or the GNSS chip reports a bad UTC time.
 */
data class Fix(
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float,
    val elapsedMs: Long,
    val mocked: Boolean,
    /** The Android provider that produced it ("gps", "network", "fused"), when known — for diagnostics. */
    val provider: String? = null,
    /** Satellite fixes carry an altitude; network estimates usually do not. */
    val hasAltitude: Boolean = false,
)

/** Outcome of trying to read one fresh position. */
sealed interface LocationRead {
    data class Ok(val fix: Fix) : LocationRead
    /** Device location (GPS / Location toggle) is switched off. */
    data object ServicesOff : LocationRead
    /** No provider could be used (no Play services location and no usable platform provider), or the provider failed. */
    data object Unavailable : LocationRead
    /** Listening ran out of time without any reading. */
    data object Timeout : LocationRead
    /** Only out-of-date readings arrived. */
    data object Stale : LocationRead
    /** The OS refused the request: permission was revoked while asking. */
    data object PermissionDenied : LocationRead
}

object ReturnLocation {
    const val SAMPLE_MS = 20_000L // keep listening this long for a precise fix (cold GPS start)
    const val GOOD_ENOUGH_M = 20f // stop early once a fix is this precise
    const val MAX_FIX_AGE_MS = 25_000L // never send a reading this old (server limit: 30 s)
    /** Readings this coarse come from "approximate" location. */
    const val APPROXIMATE_M = 500f

    const val PERMISSION = "Location permission is required to verify your return to campus. Tap Allow location and choose \"While using the app\"."
    const val PERMISSION_BLOCKED = "Location permission is turned off for Vexon. Open Settings → Permissions → Location, choose \"Allow only while using the app\" and turn on \"Use precise location\", then come back and try again."
    const val SERVICES_OFF = "Your phone's Location is switched off. Turn on Location (quick settings or Settings → Location), then try again."
    const val UNAVAILABLE = "Your phone could not provide a location right now. Make sure Location is on and Google Location Accuracy is enabled (Settings → Location → Location services), then try again."
    const val TIMEOUT = "Finding your location took too long. Move outdoors or near a window, keep the app open, and try again."
    const val STALE = "Your phone only returned an old location reading. Please try again."
    const val MOCKED = "A mock-location app appears to be active. Turn it off and try again."
    const val APPROXIMATE = "Vexon has only approximate location, which cannot confirm you are on campus. Tap Allow precise location (or Settings → Permissions → Location → \"Use precise location\"), then try again."
    const val NETWORK = "Your location was read, but it could not be sent — check your internet connection and try again."
    const val FAILED = "Could not verify your location. Please try again."

    fun poorAccuracy(meters: Float) =
        "Your location is not accurate enough yet (about ±${meters.roundToInt()} m). Move to an open area or near a window and try again."

    fun problem(read: LocationRead): String = when (read) {
        is LocationRead.Ok -> if (read.fix.mocked) MOCKED else ""
        LocationRead.ServicesOff -> SERVICES_OFF
        LocationRead.Unavailable -> UNAVAILABLE
        LocationRead.Timeout -> TIMEOUT
        LocationRead.Stale -> STALE
        LocationRead.PermissionDenied -> PERMISSION
    }

    /** The server's rejection code (outside_geofence, low_accuracy, stale_location), if any. */
    fun rejectionCode(e: Throwable?): String? = (e as? ApiException)?.data["errors"][0]["code"].str

    /**
     * Message for a failed verify request. Server rejections use the server's
     * wording; an accuracy rejection explains the device's own accuracy (never
     * its coordinates or the campus distance), and says "approximate" when the
     * app only has coarse permission or the fix is that coarse. Internal (5xx)
     * details are never shown.
     */
    fun verifyProblem(e: Throwable?, fix: Fix?, preciseGranted: Boolean): String {
        if (e is ApiException && e.isNetwork) return NETWORK
        if (rejectionCode(e) == "low_accuracy" && fix != null) {
            return if (!preciseGranted || fix.accuracy >= APPROXIMATE_M) APPROXIMATE else poorAccuracy(fix.accuracy)
        }
        val api = e as? ApiException
        val message = api?.data["message"].text
        return if (api != null && api.status in 400..499 && message != null) message else FAILED
    }

    /** Whether an "approximate only" situation should offer to upgrade to precise permission. */
    fun needsPrecise(e: Throwable?, fix: Fix?, preciseGranted: Boolean): Boolean =
        !preciseGranted && fix != null && (rejectionCode(e) == "low_accuracy" || fix.accuracy >= APPROXIMATE_M)

    /**
     * The request body: the raw reading, its time on the wall clock derived from
     * its monotonic age, and the wall clock at send time — so the server can
     * measure the age on this device's own clock even if that clock is off.
     */
    fun body(fix: Fix, nowElapsedMs: Long, nowWallMs: Long): JsonObject = jsonOf(
        "latitude" to fix.latitude,
        "longitude" to fix.longitude,
        "accuracy" to fix.accuracy,
        "timestamp" to nowWallMs - (nowElapsedMs - fix.elapsedMs).coerceAtLeast(0),
        "sentAt" to nowWallMs,
    )
}

/**
 * Collects readings while listening: keeps the most precise one that is still
 * fresh, ignores out-of-date ones, and says when a reading is good enough to
 * stop. Times are on the monotonic clock. Not thread-safe: feed it from one thread.
 */
class FixSampler(
    private val maxAgeMs: Long = ReturnLocation.MAX_FIX_AGE_MS,
    private val goodEnoughM: Float = ReturnLocation.GOOD_ENOUGH_M,
) {
    private var best: Fix? = null
    private var sawOld = false

    private fun fresh(fix: Fix, nowMs: Long) = nowMs - fix.elapsedMs in -1_000..maxAgeMs

    /** Returns true when [fix] is precise enough to stop listening. */
    fun offer(fix: Fix, nowMs: Long): Boolean {
        if (!fix.accuracy.isFinite() || fix.accuracy < 0 || !fresh(fix, nowMs)) {
            sawOld = true
            return false
        }
        val b = best
        if (b == null || fix.accuracy <= b.accuracy || !fresh(b, nowMs)) best = fix
        return fix.accuracy <= goodEnoughM
    }

    /** What listening produced, judged at [nowMs]. */
    fun result(nowMs: Long): LocationRead {
        val b = best
        return when {
            b != null && fresh(b, nowMs) -> LocationRead.Ok(b)
            b != null || sawOld -> LocationRead.Stale
            else -> LocationRead.Timeout
        }
    }
}
