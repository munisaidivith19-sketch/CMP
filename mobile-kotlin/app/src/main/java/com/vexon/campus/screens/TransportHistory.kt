package com.vexon.campus.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.History
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonElement
import com.vexon.campus.core.Api
import com.vexon.campus.core.Journey
import com.vexon.campus.core.bool
import com.vexon.campus.core.dbl
import com.vexon.campus.core.get
import com.vexon.campus.core.id
import com.vexon.campus.core.int
import com.vexon.campus.core.list
import com.vexon.campus.core.str
import com.vexon.campus.nav.Nav
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.InfoRow
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.RowCard
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Variant

/**
 * Journey history (same server data as the web's Transport → Journey history).
 * The server decides scope: transport managers, principal, dean, AO and chairman
 * see every trip; staff who share a bus see only their own trips. Only RECORDED
 * times are shown here — no predictions, no GPS tracks. Reports and manual stop
 * records stay on the web console.
 */
@Composable
fun TransportHistoryScreen() {
    var range by rememberSaveable { mutableStateOf("week") }
    var direction by rememberSaveable { mutableStateOf("") }
    var status by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableStateOf(1) }
    val q = Api.transportHistory(mapOf("range" to range, "direction" to direction.ifEmpty { null }, "status" to status.ifEmpty { null }, "page" to page, "limit" to 20))
    val data = q.data
    val tz = data["timezone"].str
    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header(
            "Journey history",
            if (data["scope"].str == "own") "Trips you shared, with recorded stop times" else "Recorded bus trips and stop times",
            back = true, titleMaxLines = 2,
        )
        HistoryFilter("Period", listOf("day" to "Today", "week" to "This week", "month" to "This month", "all" to "All"), range) { range = it; page = 1 }
        HistoryFilter("Direction", listOf("" to "Both", "towards_college" to "Towards college", "towards_home" to "Towards home"), direction) { direction = it; page = 1 }
        HistoryFilter("Status", listOf("" to "All", "completed" to "Completed", "interrupted" to "Interrupted", "active" to "In progress"), status) { status = it; page = 1 }
        when {
            data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            data == null -> Loading()
            data["trips"].list.isEmpty() -> Card { EmptyState(Icons.Rounded.History, "No trips found", "No recorded trips match these filters.") }
            else -> {
                data["trips"].list.forEach { t -> TripRow(t, tz) }
                val total = data["total"].int ?: 0
                val pages = (total + 19) / 20
                if (pages > 1) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button("Previous", { page -= 1 }, variant = Variant.Outline, small = true, enabled = page > 1)
                    Small("Page $page of $pages · $total trips", Modifier.weight(1f), color = C.muted)
                    Button("Next", { page += 1 }, variant = Variant.Outline, small = true, enabled = page < pages)
                }
            }
        }
        Small("Times are on the campus clock and were recorded from the bus’s GPS or by transport staff.", color = C.muted)
    }
}

@Composable
private fun HistoryFilter(label: String, options: List<Pair<String, String>>, value: String, onChange: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Label(label)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            options.forEach { (v, l) -> Chip(l, value == v) { onChange(v) } }
        }
    }
}

private fun statusTone(t: JsonElement?): Tone = when {
    t["status"].str == "active" -> Tone.Primary
    t["status"].str == "completed" -> Tone.Success
    t["interrupted"].bool -> Tone.Warning
    else -> Tone.Neutral
}

@Composable
private fun TripRow(t: JsonElement, tz: String?) {
    RowCard(Modifier.fillMaxWidth(), onClick = { Nav.push("/transport/history/${t.id}") }, verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Strong("Bus ${t["bus"]["number"].str ?: "—"} · ${Journey.directionText(t["direction"].str, t["directionAssumed"].bool).ifEmpty { "Direction not recorded" }}")
            Small(t["route"]["name"].str ?: "No route", color = C.muted)
            Small("${Journey.campusDate(t["tripStartedAt"].str, tz)}, started ${Journey.campusTime(t["tripStartedAt"].str, tz)}" +
                Journey.durationText(t["durationMinutes"].dbl).let { if (it.isEmpty()) "" else " · $it" })
            Small("Stops recorded: ${t["stopsRecorded"].int ?: 0} of ${t["stopsPlanned"].int ?: 0}" +
                (if ((t["manualRecords"].int ?: 0) > 0) " · ${t["manualRecords"].int} by staff" else "") +
                (t["operator"]["name"].str?.let { " · $it" } ?: ""), color = C.muted)
        }
        Badge(Journey.tripStatus(t["status"].str, t["interrupted"].bool), statusTone(t))
    }
}

/** One past trip: recorded stop-by-stop times, dwell, gaps and (with a timetable) delay. */
@Composable
fun TransportHistoryTripScreen(id: String) {
    val q = Api.transportHistoryTrip(id)
    val data = q.data
    val tz = data["timezone"].str
    val t = data["trip"]
    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header(if (t != null) "Bus ${t["bus"]["number"].str ?: "—"}" else "Trip", t?.let { Journey.campusDate(it["tripStartedAt"].str, tz) }, back = true)
        when {
            data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            data == null -> Loading()
            else -> {
                Card(Modifier.fillMaxWidth(), gap = 6.dp) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Badge(Journey.tripStatus(t["status"].str, t["interrupted"].bool), statusTone(t))
                        Journey.directionText(t["direction"].str, t["directionAssumed"].bool).takeIf { it.isNotEmpty() }?.let { Badge(it, if (t["directionAssumed"].bool) Tone.Warning else Tone.Neutral) }
                    }
                    InfoRow("Route", t["route"]["name"].str ?: "—")
                    InfoRow("Started", Journey.campusTime(t["tripStartedAt"].str, tz))
                    t["endedAt"].str?.let { InfoRow("Ended", Journey.campusTime(it, tz)) }
                    Journey.durationText(t["durationMinutes"].dbl).takeIf { it.isNotEmpty() }?.let { InfoRow("Trip duration", it) }
                    Journey.durationText(t["journeyMinutes"].dbl).takeIf { it.isNotEmpty() }?.let { InfoRow("First departure → final stop", it) }
                    t["collegeArrivedAt"].str?.let { InfoRow("Reached college", Journey.campusTime(it, tz)) }
                    t["operator"]["name"].str?.let { InfoRow("Shared by", it) }
                }
                val stops = data["stops"].list
                if (stops.isEmpty()) Card { EmptyState(Icons.Rounded.History, "No stop records", "This trip was recorded before stop arrival times were kept.") }
                else {
                    Label("Stops in travel order")
                    stops.forEach { s -> StopRecord(s, tz) }
                }
                Small("Only recorded times are shown. “Late / early” is measured against the route timetable, where one exists.", color = C.muted)
            }
        }
    }
}

@Composable
private fun StopRecord(s: JsonElement, tz: String?) {
    val arrived = s["actualArrivalAt"].str
    RowCard(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top, gap = 10.dp) {
        Badge("${(s["order"].int ?: 0) + 1}", if (arrived != null) Tone.Success else Tone.Neutral)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Strong(s["name"].str + if (s["isCollege"].bool) " (college)" else "")
            Small(Journey.historyStopLine(arrived, s["actualDepartureAt"].str, s["notRecorded"].str, tz))
            val details = listOfNotNull(
                s["minutesFromPreviousStop"].dbl?.let { "${Journey.durationText(it)} from previous stop" },
                s["dwellMinutes"].dbl?.let { "stopped ${Journey.durationText(it)}" },
                Journey.delayText(s["delayMinutes"].dbl),
                if (s["arrivalSource"].str == "manual" || s["departureSource"].str == "manual") "recorded by staff" else null,
                if (s["arrival"]["corrected"].bool || s["departure"]["corrected"].bool) "corrected" else null,
            )
            if (details.isNotEmpty()) Small(details.joinToString(" · "), color = C.muted)
            s["arrival"]["reason"].str?.let { Small("Reason: $it", color = C.muted) }
        }
    }
}
