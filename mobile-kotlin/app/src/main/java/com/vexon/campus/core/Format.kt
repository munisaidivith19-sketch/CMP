package com.vexon.campus.core

import kotlinx.serialization.json.JsonElement
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/** Date helpers — port of src/utils/format.js (date-fns patterns map 1:1 onto java.time). */
object Fmt {
    private val zone: ZoneId get() = ZoneId.systemDefault()
    private val cache = HashMap<String, DateTimeFormatter>()
    private fun f(p: String) = cache.getOrPut(p) { DateTimeFormatter.ofPattern(p, Locale.ENGLISH) }

    /** Parse a server date (ISO instant, ISO local date-time or YYYY-MM-DD) into local time, like `new Date(x)`. */
    fun parse(value: String?): ZonedDateTime? {
        if (value.isNullOrBlank()) return null
        return runCatching { Instant.parse(value).atZone(zone) }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(value).atZoneSameInstant(zone) }.getOrNull()
            ?: runCatching { LocalDateTime.parse(value).atZone(zone) }.getOrNull()
            // `new Date('2024-05-01')` is UTC midnight.
            ?: runCatching { LocalDate.parse(value.take(10)).atStartOfDay(ZoneId.of("UTC")).withZoneSameInstant(zone) }.getOrNull()
    }

    fun parse(value: JsonElement?): ZonedDateTime? = parse(value.str)

    fun format(d: ZonedDateTime?, pattern: String): String = d?.format(f(pattern)) ?: ""
    fun format(d: LocalDate?, pattern: String): String = d?.format(f(pattern)) ?: ""

    fun date(v: JsonElement?, p: String = "dd MMM yyyy") = format(parse(v), p)
    fun date(v: String?, p: String = "dd MMM yyyy") = format(parse(v), p)
    fun time(v: JsonElement?) = format(parse(v), "h:mm a")
    fun dateTime(v: JsonElement?) = format(parse(v), "dd MMM, h:mm a")
    fun dateTime(v: String?) = format(parse(v), "dd MMM, h:mm a")
    fun dateTime(v: ZonedDateTime?) = format(v, "dd MMM, h:mm a")

    /** "5 minutes ago" (date-fns formatDistanceToNowStrict + " ago"). */
    fun timeAgo(v: JsonElement?): String = parse(v)?.let { "${distanceStrict(it)} ago" } ?: ""
    fun timeAgo(v: String?): String = parse(v)?.let { "${distanceStrict(it)} ago" } ?: ""

    fun distanceStrict(d: ZonedDateTime): String {
        val secs = abs(Duration.between(d.toInstant(), Instant.now()).seconds)
        fun unit(n: Long, u: String) = "$n $u${if (n == 1L) "" else "s"}"
        val mins = (secs / 60.0).roundToLong()
        val hours = (secs / 3600.0).roundToLong()
        val days = (secs / 86400.0).roundToLong()
        return when {
            secs < 60 -> unit(secs, "second")
            mins < 60 -> unit(mins, "minute")
            hours < 24 -> unit(hours, "hour")
            days < 30 -> unit(days, "day")
            days < 365 -> unit((days / 30.0).roundToLong().coerceAtLeast(1), "month")
            else -> unit((days / 365.0).roundToLong().coerceAtLeast(1), "year")
        }
    }

    /** Attendance days are calendar dates stored as UTC midnight — show the calendar date itself. */
    fun classDay(v: String?, p: String = "EEE, dd MMM"): String =
        v?.takeIf { it.length >= 10 }?.let { runCatching { LocalDate.parse(it.take(10)).format(f(p)) }.getOrNull() } ?: ""

    fun classDay(v: JsonElement?, p: String = "EEE, dd MMM") = classDay(v.str, p)

    fun titleCase(s: String?): String =
        (s ?: "").replace(Regex("[-_]"), " ").replace(Regex("\\b\\w")) { it.value.uppercase() }

    /** Chat list time: today → time, yesterday → "Yesterday", else "dd MMM". */
    fun listTime(v: JsonElement?): String {
        val d = parse(v) ?: return ""
        val today = LocalDate.now(zone)
        return when (d.toLocalDate()) {
            today -> format(d, "h:mm a")
            today.minusDays(1) -> "Yesterday"
            else -> format(d, "dd MMM")
        }
    }

    /** "14:05" → "2:05 PM". */
    fun to12h(t: String?): String {
        val s = t ?: return ""
        val parts = s.split(":")
        val h = parts.getOrNull(0)?.toIntOrNull() ?: return s
        val m = parts.getOrNull(1)?.toIntOrNull() ?: 0
        return "${(h + 11) % 12 + 1}:${m.toString().padStart(2, '0')} ${if (h < 12) "AM" else "PM"}"
    }

    fun to12h(t: JsonElement?) = to12h(t.str)

    fun todayKey(): String = LocalDate.now(zone).toString()
    fun isoInstant(d: ZonedDateTime): String = d.toInstant().toString()
}

/** JS-style number display: 82.5 → "82.5", 80.0 → "80". */
fun num(v: Double?): String = when {
    v == null -> "—"
    v == Math.floor(v) && !v.isInfinite() -> v.toLong().toString()
    else -> "%.2f".format(Locale.ENGLISH, v).trimEnd('0').trimEnd('.')
}

fun num(v: JsonElement?): String = num(v.dbl)

/** Title and "other person" of a conversation from the viewer's side (utils/chat.js). */
data class ConvInfo(val title: String?, val other: JsonElement?, val group: Boolean)

fun describeConversation(conv: JsonElement?, me: JsonElement?): ConvInfo {
    if (conv == null) return ConvInfo(null, null, false)
    if (conv["type"].str == "private") {
        val parts = conv["participants"].list
        val other = parts.firstOrNull { !sameId(it, me) } ?: parts.firstOrNull()
        return ConvInfo(other["name"].str, other, false)
    }
    return ConvInfo(conv["name"].str, null, true)
}

/** Pure gate-pass QR helpers (port of utils/gateQr.js). */
object GateQr {
    const val EXIT_PREFIX = "CCGP:"
    const val RETURN_PREFIX = "CCRT:"

    /**
     * Early, UX-only check that a scanned value is a Vexon gate-pass QR meant for
     * this screen. It can only reject — anything that passes still goes to the
     * backend, which alone decides whether the credential is valid.
     */
    fun scanProblem(value: String?, expected: String): String? {
        val v = (value ?: "").trim().uppercase()
        val isExit = v.startsWith(EXIT_PREFIX)
        val isReturn = v.startsWith(RETURN_PREFIX)
        if (!isExit && !isReturn) return "Invalid Gate Pass QR code."
        if (expected == "exit" && isReturn) return "This is a return QR. Use Return verification to record the student coming back."
        if (expected == "return" && isExit) return "This is an exit QR. Use the OUT screen to record the student leaving."
        return null
    }

    /**
     * Wraps a scan callback so it fires exactly once until re-armed: the camera
     * reports the same QR on many consecutive frames, and each must not become
     * another backend request.
     */
    class ScanGate(private val onScan: (String) -> Unit) {
        @Volatile
        var fired = false
            private set

        @Synchronized
        fun handle(data: String?): Boolean {
            if (fired || data.isNullOrEmpty()) return false
            fired = true
            onScan(data)
            return true
        }

        fun reset() {
            fired = false
        }
    }
}
