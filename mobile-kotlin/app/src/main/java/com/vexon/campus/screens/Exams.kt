package com.vexon.campus.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Assignment
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.EventNote
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.dp
import com.vexon.campus.core.Api
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.get
import com.vexon.campus.core.list
import com.vexon.campus.core.str
import com.vexon.campus.core.text
import com.vexon.campus.nav.Nav
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.RowCard
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.Tone
import kotlinx.serialization.json.JsonElement

private val STATUS_TONE = mapOf("draft" to Tone.Neutral, "published" to Tone.Success, "cancelled" to Tone.Danger)
private val STATUS_LABEL = mapOf("draft" to "Draft", "published" to "Published", "cancelled" to "Cancelled")

/**
 * Exam timetable (read-only on the phone). The server decides which exams this
 * account sees: a student their class, faculty the classes they teach, an HOD
 * their department, the campus-wide roles and the COE everything. Creating,
 * editing, publishing and cancelling are done on the web Timetable dashboard.
 */
@Composable
fun ExamTimetableScreen() {
    val q = Api.exams(mapOf("from" to Fmt.todayKey()))
    val exams = q.data["exams"].list
    val byDate = exams.groupBy { it["date"].str.orEmpty() }

    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header("Exam timetable", "Upcoming exams that concern you. A published exam pauses regular attendance for its periods.", back = true)
        when {
            q.data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            q.data == null -> Loading()
            exams.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.EventNote, "No upcoming exams", "Published exams for your class appear here.") }
            else -> byDate.forEach { (date, list) ->
                Label(Fmt.classDay(date, "EEEE, dd MMM yyyy"))
                list.forEach { ExamRow(it) }
            }
        }
    }
}

@Composable
private fun ExamRow(e: JsonElement) {
    val status = e["status"].str.orEmpty()
    val cancelled = status == "cancelled"
    RowCard(Wide.alpha(if (cancelled) 0.65f else 1f), verticalAlignment = Alignment.Top) {
        Icon(Icons.Rounded.Schedule, null, Modifier.size(18.dp), tint = C.primary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Strong("${e["subjectCode"].str ?: ""} · ${e["subjectName"].str ?: ""}", maxLines = 2)
            Small("${Fmt.to12h(e["startTime"])} – ${Fmt.to12h(e["endTime"])}")
            Small(e["scope"].str, color = C.muted, maxLines = 2)
            if (cancelled) e["cancelReason"].text?.let { Small("Cancelled: $it", color = C.roseText) }
        }
        Badge(STATUS_LABEL[status] ?: status, STATUS_TONE[status] ?: Tone.Neutral)
    }
}

/**
 * Home for the Controller of Examinations, whose work is the Timetable
 * dashboard only: Exam Timetable, Class Timetable and Attendance (both
 * read-only, campus-wide). The server refuses every other module to this role.
 */
@Composable
fun CoeHome(user: JsonElement) {
    Screen {
        Header("Controller of Examinations", user["name"].str)
        CoeAction(Icons.Rounded.EventNote, "Exam timetable", "Campus-wide exams · manage them on the web dashboard") { Nav.push("/exams") }
        CoeAction(Icons.Rounded.CalendarMonth, "Class timetable", "Any department, year and section · read-only") { Nav.push("/timetable") }
        CoeAction(Icons.AutoMirrored.Rounded.Assignment, "Attendance", "Campus-wide attendance · read-only") { Nav.push("/attendance") }
    }
}

@Composable
private fun CoeAction(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, text: String, onClick: () -> Unit) {
    RowCard(Wide, onClick = onClick) {
        Icon(icon, null, Modifier.size(24.dp), tint = C.primary)
        Column(Modifier.weight(1f)) {
            Strong(title)
            Small(text, color = C.muted)
        }
    }
}

/**
 * Home for the administrative Office: read-only college-wide attendance
 * (students and faculty) and the low-attendance list. Reports and CSV exports
 * are on the web dashboard.
 */
@Composable
fun OfficeHome(user: JsonElement) {
    Screen {
        Header("Office", user["name"].str)
        CoeAction(Icons.AutoMirrored.Rounded.Assignment, "Attendance", "College-wide student and faculty attendance · read-only") { Nav.push("/attendance") }
        CoeAction(Icons.Rounded.EventNote, "Students below 75 %", "Low-attendance list") { Nav.push("/attendance?tab=low") }
    }
}

/** Who sees the live bus map (mirrors the server's TRANSPORT_VIEW_ROLES). */
val TRANSPORT_VIEW = setOf("student", "club_admin", "faculty", "hod", "principal", "admin", "security", "dean", "ao", "chairman", "warden", "transport")

/**
 * Home for the transport officer: the live bus map (and trips). Managing
 * buses, routes and rider assignments is on the web dashboard.
 */
@Composable
fun TransportHome(user: JsonElement) {
    Screen {
        Header("Transport", user["name"].str)
        CoeAction(Icons.Rounded.EventNote, "Bus Tracking", "Live buses, trips and ETAs") { Nav.push("/transport") }
        Small("Buses, routes, stops and rider assignments are managed on the web dashboard (Bus Tracking → Manage buses).", color = C.muted)
    }
}

/** True when the signed-in account is the Controller of Examinations. */
fun isCoe(role: String?) = role == "coe"
