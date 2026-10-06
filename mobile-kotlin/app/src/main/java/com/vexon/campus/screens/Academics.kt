package com.vexon.campus.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Assignment
import androidx.compose.material.icons.rounded.AccessTime
import androidx.compose.material.icons.rounded.Cancel
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Coffee
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.EventBusy
import androidx.compose.material.icons.rounded.EventNote
import androidx.compose.material.icons.rounded.FactCheck
import androidx.compose.material.icons.rounded.FlightTakeoff
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vexon.campus.core.Api
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.Omit
import com.vexon.campus.core.bool
import com.vexon.campus.core.dbl
import com.vexon.campus.core.errMsg
import com.vexon.campus.core.get
import com.vexon.campus.core.id
import com.vexon.campus.core.int
import com.vexon.campus.core.jsonOf
import com.vexon.campus.core.list
import com.vexon.campus.core.num
import com.vexon.campus.core.rememberMutation
import com.vexon.campus.core.str
import com.vexon.campus.core.strings
import com.vexon.campus.core.text
import com.vexon.campus.nav.Nav
import com.vexon.campus.nav.Route
import com.vexon.campus.ui.ATTENDANCE_READ_ONLY
import com.vexon.campus.ui.Avatar
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.COLLEGE_WIDE
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.DateField
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.Grid2
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.H3
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.HolidayCard
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.Opt
import com.vexon.campus.ui.PercentRing
import com.vexon.campus.ui.ProgressBar
import com.vexon.campus.ui.RowCard
import com.vexon.campus.ui.STUDENT_ROLES
import com.vexon.campus.ui.SUMMARY_VIEW
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.SectionTitle
import com.vexon.campus.ui.Segmented
import com.vexon.campus.ui.Sheet
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.StatusBadge
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.T
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Type
import com.vexon.campus.ui.Variant
import com.vexon.campus.ui.YEAR_LABELS
import com.vexon.campus.ui.isFirstYearHod
import com.vexon.campus.ui.pctColor
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonElement
import java.time.LocalDate
import java.time.LocalTime

/* ── Timetable ──────────────────────────────────────────────────── */

private val DAYS = listOf("monday", "tuesday", "wednesday", "thursday", "friday", "saturday")
private fun todayName() = LocalDate.now().dayOfWeek.name.lowercase()
private fun hhmm(): String = LocalTime.now().let { "%02d:%02d".format(it.hour, it.minute) }

@Composable
fun TimetableScreen() {
    val me = me()
    val isFaculty = me.role == "faculty"
    val isStudent = me.role in STUDENT_ROLES
    // Faculty: "Our Class" = the complete timetable of their Class In-Charge class;
    // "Handling Class" = only the periods they teach. Same server scope as the web.
    var scope by rememberSaveable { mutableStateOf("class") }
    var chosen by rememberSaveable { mutableStateOf(false) }
    val q = Api.timetable(if (isFaculty) mapOf("scope" to scope) else null)
    val data = q.data
    LaunchedEffect(data) {
        if (!isFaculty || chosen || data == null || scope != "class") return@LaunchedEffect
        chosen = true
        if (data["classInCharge"] == null) scope = "handling"
    }
    fun pickScope(v: String) { chosen = true; scope = v }
    val ourClass = if (isFaculty && scope == "class") data["classInCharge"] else null
    val noOurClass = isFaculty && scope == "class" && data != null && data["classInCharge"] == null
    var day by rememberSaveable { mutableStateOf(if (todayName() in DAYS) todayName() else "monday") }
    var now by remember { mutableStateOf(hhmm()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = hhmm() } }

    val slots = data["slots"].list.filter { it["dayOfWeek"].str == day }.sortedBy { it["startTime"].str.orEmpty() }
    val isToday = day == todayName()
    // Holidays are annotated per slot by the server for this week's date.
    val next = if (isToday) slots.firstOrNull { !it["isBreak"].bool && it["holiday"] == null && it["startTime"].str.orEmpty() > now } else null
    val classes = slots.filter { !it["isBreak"].bool }
    val dayHoliday = if (classes.isNotEmpty() && classes.all { it["holiday"] != null }) classes[0]["holiday"] else null

    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header(
            "Timetable",
            when {
                isStudent -> me["section"].text?.let {
                    "${me["department"].str ?: ""} · ${YEAR_LABELS[me["year"].int] ?: ""} · Section $it${me["semester"].text?.let { s -> " · Sem $s" } ?: ""}"
                } ?: "Your class schedule"
                ourClass != null -> "Our Class · ${YEAR_LABELS[ourClass["year"].int] ?: ""} · Sec ${ourClass["section"].str ?: ""} · Sem ${ourClass["semester"].str ?: ""}"
                isFaculty && scope == "handling" -> "Handling Class · the periods you teach"
                else -> "Your teaching schedule"
            },
            back = true,
        )
        if (isFaculty) Segmented(listOf(Opt("class", "Our Class"), Opt("handling", "Handling Class")), scope, ::pickScope)
        Segmented(DAYS.map { d -> Opt(d, if (d == todayName()) "Today" else d.take(3).replaceFirstChar { it.uppercase() }) }, day, { day = it })
        when {
            data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            data == null -> Loading()
            noOurClass -> Card(Wide) {
                EmptyState(
                    Icons.Rounded.School, "No class is currently assigned to you as Class In-Charge.", "Your own teaching periods are under Handling Class.",
                    action = { Button("Show Handling Class", { pickScope("handling") }, variant = Variant.Soft, small = true) },
                )
            }
            data["needsSection"].bool -> Card(Wide) {
                EmptyState(Icons.Rounded.EventNote, "Your section isn’t set yet", "An administrator assigns your department, section and semester. Your timetable appears here automatically after that.")
            }
            slots.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.Coffee, "No classes", "Nothing scheduled on this day.") }
            else -> {
                if (dayHoliday != null) HolidayCard(dayHoliday, "No classes scheduled · Attendance unavailable")
                slots.forEach { s -> TimetableSlot(s, isToday, now, s === next, isStudent || ourClass != null, isStudent) }
            }
        }
    }
}

@Composable
private fun TimetableSlot(s: JsonElement, isToday: Boolean, now: String, isNext: Boolean, showFaculty: Boolean, isStudent: Boolean) {
    val holiday = s["holiday"]
    val start = s["startTime"].str.orEmpty()
    val end = s["endTime"].str.orEmpty()
    when {
        holiday != null -> Card(Wide, background = C.dangerSoft, border = Color(0x4DF43F5E), gap = 4.dp) {
            Label("HOLIDAY · Period ${s["period"].str ?: ""}", color = Color(0xFFBE123C))
            Strong(holiday["reason"].str)
            T("${s["subject"]["code"].str ?: ""} · ${s["subject"]["name"].str ?: ""}", Type.small.copy(textDecoration = TextDecoration.LineThrough))
            Small("${Fmt.to12h(start)} – ${Fmt.to12h(end)} · No class · Attendance unavailable")
        }
        s["isBreak"].bool -> Row(
            Wide.clip(RoundedCornerShape(18.dp)).border(1.dp, C.primary300, RoundedCornerShape(18.dp)).padding(12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Rounded.Coffee, null, Modifier.size(16.dp), tint = C.soft)
            Small(s["breakLabel"].text ?: "Break", Modifier.weight(1f))
            Small("${Fmt.to12h(start)} – ${Fmt.to12h(end)}")
        }
        else -> {
            val current = isToday && start <= now && end > now
            val past = isToday && end <= now
            Card(Wide.alpha(if (past) 0.55f else 1f), background = if (current) C.primary else C.card, border = if (current) C.primary else C.border, gap = 6.dp) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Label("${s["subject"]["code"].str ?: ""} · Period ${s["period"].str ?: ""}", color = if (current) Color(0xD9FFFFFF) else C.primary)
                    when {
                        current -> Badge("Now", Tone.Neutral)
                        isNext -> Badge("Next", Tone.Info)
                        s["subject"]["type"].str == "lab" -> Badge("Lab", Tone.Warning)
                    }
                }
                H3(s["subject"]["name"].str, color = if (current) Color.White else Color.Unspecified)
                val meta = buildList<Pair<ImageVector, String>> {
                    add(Icons.Rounded.AccessTime to "${Fmt.to12h(start)} – ${Fmt.to12h(end)}")
                    s["room"].text?.let { add(Icons.Rounded.Place to it) }
                    if (showFaculty) add(Icons.Rounded.Person to (s["faculty"]["name"].str ?: ""))
                    if (!isStudent) add(Icons.Rounded.School to "${YEAR_LABELS[s["year"].int] ?: "Year ${s["year"].str}"} · Sec ${s["section"].str ?: ""} · Sem ${s["semester"].str ?: ""} · ${s["department"].str ?: ""}")
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    meta.forEach { (icon, label) ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Icon(icon, null, Modifier.size(13.dp), tint = if (current) Color.White else C.soft)
                            Small(label, color = if (current) Color(0xE6FFFFFF) else Color.Unspecified)
                        }
                    }
                }
            }
        }
    }
}

/* ── Attendance ─────────────────────────────────────────────────── */

@Composable
fun AttendanceScreen(route: Route? = null) {
    if (me().role in STUDENT_ROLES) StudentAttendance() else StaffAttendance(route)
}

private val RANGES = listOf(Opt("week", "Week"), Opt("month", "Month"), Opt("semester", "Semester"), Opt("all", "All"))

@Composable
private fun CorrectionSheet(record: JsonElement, onClose: () -> Unit) {
    var reason by remember { mutableStateOf("") }
    val send = rememberMutation()
    val requested = if (record["status"].str == "present") "absent" else "present"
    Sheet(null, onClose = onClose) {
        H2("Request a correction")
        Small("${record["subject"]["code"].str ?: ""} · ${Fmt.classDay(record["date"])} · Period ${record["period"].str ?: ""} — marked ${record["status"].str}, asking for $requested.")
        Input(reason, { reason = it }, label = "Reason", multiline = true, maxLength = 500, placeholder = "Explain what happened", hint = "At least 5 characters")
        Button("Send request", {
            send.launch(onError = { Dialogs.alert("Could not send", errMsg(it)) }) {
                Api.requestCorrection(jsonOf(
                    "subjectId" to record["subject"].id, "date" to record["date"].str.orEmpty().take(10),
                    "period" to record["period"].int, "requestedStatus" to requested, "reason" to reason.trim(),
                ))
                Dialogs.alert("Request sent", "Your faculty will review it. You’ll get a notification.")
                onClose()
            }
        }, Wide, loading = send.isLoading, enabled = reason.trim().length >= 5)
        Button("Cancel", onClose, Wide, variant = Variant.Ghost)
    }
}

@Composable
private fun StudentAttendance() {
    var range by rememberSaveable { mutableStateOf("semester") }
    var correct by remember { mutableStateOf<JsonElement?>(null) }
    val summary = Api.myAttendance(mapOf("range" to range))
    val records = Api.attendanceRecords(mapOf("limit" to 30))
    val corrections = Api.corrections(mapOf("limit" to 10))
    val data = summary.data
    val o = data["overall"]
    val threshold = data["threshold"].dbl ?: 75.0
    val low = o != null && (o["totalPeriods"].int ?: 0) > 0 && (o["percentage"].dbl ?: 0.0) < threshold

    Screen(refreshing = summary.isFetching && !summary.isLoading, onRefresh = { summary.refetch(); records.refetch(); corrections.refetch() }) {
        Header("Attendance", "Present ÷ conducted periods", back = true)
        Segmented(RANGES, range, { range = it })
        when {
            data == null && summary.error != null -> ErrorState(summary.error) { summary.refetch() }
            data == null -> Loading()
            else -> {
                if (low) RowCard(Wide, background = C.dangerSoft, border = Color(0x4DF43F5E), gap = 10.dp, verticalAlignment = Alignment.Top) {
                    Icon(Icons.Rounded.Warning, null, Modifier.size(20.dp), tint = C.danger)
                    val must = o["mustAttend"].int ?: 0
                    Small("Below ${num(threshold)}%. Attend the next $must class${if (must == 1) "" else "es"} to recover.", Modifier.weight(1f), Color(0xFFBE123C))
                }
                RowCard(Wide, gap = 16.dp) {
                    PercentRing(o["percentage"].dbl, threshold = threshold, sub = "${num(o["presentPeriods"])}/${num(o["totalPeriods"])}")
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        KeyValue("Present", num(o["presentPeriods"]))
                        KeyValue("Absent", num(o["absentPeriods"]))
                        KeyValue("Conducted", num(o["totalPeriods"]))
                        KeyValue(if (low) "Must attend" else "Can still miss", num(if (low) o["mustAttend"] else o["canMiss"]))
                    }
                }
                SectionTitle("Subject-wise")
                val subjects = data["subjects"].list
                if (subjects.isEmpty()) Card(Wide) { EmptyState(Icons.Rounded.FactCheck, "No classes recorded in this period") }
                else Card(Wide, gap = 14.dp) {
                    subjects.forEach { s ->
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Strong("${s["subject"]["code"].str ?: ""} · ${s["subject"]["name"].str ?: ""}", Modifier.weight(1f), maxLines = 1)
                                Strong("${num(s["percentage"])}%")
                            }
                            ProgressBar(s["percentage"].dbl, threshold)
                            Small("${num(s["presentPeriods"])}/${num(s["totalPeriods"])} periods")
                        }
                    }
                }
            }
        }

        SectionTitle("Recent classes")
        val recs = records.data["records"].list
        when {
            records.isLoading -> Loading()
            recs.isEmpty() -> Card(Wide) { EmptyState(title = "No attendance yet") }
            else -> Card(Wide, padded = false, gap = 2.dp) {
                recs.forEach { r ->
                    val present = r["status"].str == "present"
                    Row(
                        Modifier.fillMaxWidth().clickable { correct = r }.padding(horizontal = 16.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(if (present) Icons.Rounded.CheckCircle else Icons.Rounded.Cancel, null, Modifier.size(18.dp), tint = if (present) C.success else C.danger)
                        Column(Modifier.weight(1f)) {
                            Strong("${r["subject"]["code"].str ?: ""} · ${r["subject"]["name"].str ?: ""}", maxLines = 1)
                            Small("${Fmt.classDay(r["date"])} · P${r["period"].str ?: ""}${if (r["correctedAt"] != null) " · corrected" else ""}")
                        }
                        StatusBadge(r["status"].str)
                    }
                }
                Small("Tap a class to request a correction", Wide.padding(12.dp), C.muted, TextAlign.Center)
            }
        }

        val reqs = corrections.data["requests"].list
        if (reqs.isNotEmpty()) {
            SectionTitle("My correction requests")
            reqs.forEach { c ->
                Card(Wide, gap = 4.dp) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Strong("${c["subject"]["code"].str ?: ""} · ${Fmt.classDay(c["date"])} · P${c["period"].str ?: ""}", Modifier.weight(1f))
                        StatusBadge(c["status"].str)
                    }
                    Small("“${c["reason"].str ?: ""}”")
                    c["reviewNote"].text?.let { Small("Reviewer: $it") }
                }
            }
        }
    }
    correct?.let { CorrectionSheet(it) { correct = null } }
}

@Composable
private fun KeyValue(label: String, value: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Small("$label:")
        T(value, Type.strong.copy(fontSize = 12.sp))
    }
}

/* ── Staff attendance ───────────────────────────────────────────── */

private fun todayKey() = LocalDate.now().toString()
private fun yesterdayKey() = LocalDate.now().minusDays(1).toString()

private data class StatusOpt(val value: String, val label: String, val icon: ImageVector, val color: Color)

private val STUDENT_OPTIONS = listOf(
    StatusOpt("present", "PRESENT", Icons.Rounded.Check, C.success),
    StatusOpt("absent", "ABSENT", Icons.Rounded.Close, C.danger),
)
private val FACULTY_OPTIONS = STUDENT_OPTIONS + StatusOpt("leave", "LEAVE", Icons.Rounded.FlightTakeoff, C.warning)

/** Row of big tap targets: the "[PRESENT] [ABSENT]" buttons. */
@Composable
private fun StatusButtons(value: String?, options: List<StatusOpt>, enabled: Boolean, onChange: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        options.forEach { o ->
            val on = value == o.value
            Row(
                Modifier.alpha(if (enabled) 1f else 0.5f).clip(RoundedCornerShape(12.dp))
                    .background(if (on) o.color else Color(0xB3FFFFFF)).border(1.dp, if (on) o.color else C.border, RoundedCornerShape(12.dp))
                    .clickable(enabled = enabled) { onChange(o.value) }.padding(horizontal = 10.dp, vertical = 8.dp)
                    .semantics { contentDescription = o.label },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(o.icon, null, Modifier.size(14.dp), tint = if (on) Color.White else o.color)
                T(o.label, Type.small.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp), color = if (on) Color.White else o.color)
            }
        }
    }
}

@Composable
private fun LockNote(text: String?) {
    RowCard(Wide, background = C.warningSoft, gap = 8.dp, verticalAlignment = Alignment.Top) {
        Icon(Icons.Rounded.Lock, null, Modifier.size(16.dp), tint = C.amberText)
        Small(text, Modifier.weight(1f), C.amberText)
    }
}

/* Mark a class */
@Composable
private fun MarkClass(preset: MarkPreset? = null, onPresetUsed: () -> Unit = {}) {
    val me = me()
    val scope = when (me.role) {
        "faculty" -> mapOf("mine" to "true")
        "hod" -> mapOf("department" to me["department"].str)
        else -> null
    }
    val subjects = Api.subjects(scope)
    val now = Api.currentClass()
    var subjectId by rememberSaveable { mutableStateOf("") }
    var section by rememberSaveable { mutableStateOf("") }
    var period by rememberSaveable { mutableStateOf("") }
    var date by rememberSaveable { mutableStateOf(todayKey()) }
    LaunchedEffect(preset) {
        val p = preset ?: return@LaunchedEffect
        subjectId = p.subjectId; section = p.section; date = p.date; period = p.period
        onPresetUsed()
    }
    val marks = remember { mutableStateMapOf<String, String>() }
    val save = rememberMutation()

    val subject = subjects.data.list.firstOrNull { it.id == subjectId }
    val subjectSections = subject["sections"].strings
    val ready = subjectId.isNotEmpty() && period.isNotEmpty() && (subjectSections.isEmpty() || section.isNotEmpty())
    val roster = Api.roster(mapOf("subjectId" to subjectId, "date" to date, "period" to period, "section" to section.ifEmpty { null }), skip = !ready)
    val r = roster.data

    // Start from what is saved; unmarked students default to present.
    LaunchedEffect(r) {
        if (r != null) {
            marks.clear()
            r["students"].list.forEach { s -> marks[s.id.orEmpty()] = s["status"].text ?: "present" }
        }
    }
    val todays = now.data["today"].list.filter { !it["isBreak"].bool && it["subject"].id != null }
    val present = marks.values.count { it == "present" }
    val absent = marks.values.count { it == "absent" }

    fun submit() = save.launch(onError = { Dialogs.alert("Could not save", errMsg(it)) }) {
        val res = Api.markClassAttendance(jsonOf(
            "subjectId" to subjectId, "date" to date, "period" to period.toInt(), "section" to (section.ifEmpty { null } ?: Omit),
            "records" to marks.map { (student, status) -> mapOf("student" to student, "status" to status) },
        ))
        Dialogs.alert("Attendance saved", "${res["message"].str ?: ""}\n$present present · $absent absent")
    }

    if (todays.isNotEmpty()) {
        SectionTitle("Your classes today")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            todays.forEach { s ->
                val sid = s["subject"].id.orEmpty()
                Chip(
                    "P${s["period"].str} · ${s["subject"]["code"].str ?: ""}${s["section"].text?.let { " · $it" } ?: ""} · ${if (s["holiday"] != null) "Holiday" else Fmt.to12h(s["startTime"])}",
                    subjectId == sid && period == s["period"].str && date == todayKey(),
                ) { subjectId = sid; section = s["section"].str.orEmpty(); period = s["period"].str.orEmpty(); date = todayKey() }
            }
        }
    }

    Card(Wide, gap = 12.dp) {
        Label("Subject")
        val list = subjects.data
        when {
            list == null && subjects.error != null -> ErrorState(subjects.error) { subjects.refetch() }
            list == null -> Loading()
            list.list.isEmpty() -> Small("No subjects are assigned to you yet.")
            else -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                list.list.forEach { s -> Chip("${s["code"].str ?: ""} · Sem ${s["semester"].str ?: ""}", subjectId == s.id) { subjectId = s.id.orEmpty(); section = "" } }
            }
        }
        if (subjectSections.isNotEmpty()) {
            Label("Section")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                subjectSections.forEach { sec -> Chip("Section $sec", section == sec) { section = sec } }
            }
        }
        Label("Period")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            (1..8).forEach { p -> Chip("P$p", period == "$p") { period = "$p" } }
        }
        Label("Day")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("Today", date == todayKey()) { date = todayKey() }
            Chip("Yesterday", date == yesterdayKey()) { date = yesterdayKey() }
            // A class opened from History keeps its own date.
            if (date != todayKey() && date != yesterdayKey()) Chip(Fmt.classDay(date), true) {}
        }
    }

    when {
        !ready -> Card(Wide) { EmptyState(Icons.AutoMirrored.Rounded.Assignment, "Choose a class", "Pick the subject, section and period to load your students.") }
        r == null && roster.error != null -> ErrorState(roster.error) { roster.refetch() }
        r == null -> Loading()
        r["students"].list.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.Group, "No students in this class", "Students appear once an admin assigns them to this department and section.") }
        else -> {
            val editable = r["editable"].bool
            val students = r["students"].list
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                H3("${r["subject"]["code"].str ?: ""}${r["section"].text?.let { " · Section $it" } ?: ""} · P${r["period"].str ?: ""}")
                Small(Fmt.classDay(r["date"], "EEEE, dd MMM") + if (r["alreadyMarked"].bool) " · marked by ${r["markedBy"]["name"].text ?: "staff"}" else "")
            }
            if (r["holiday"] != null) HolidayCard(r["holiday"]) else if (!editable) LockNote(r["lockedReason"].str)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button("All present", { students.forEach { marks[it.id.orEmpty()] = "present" } }, variant = Variant.Success, small = true, enabled = editable)
                Button("All absent", { students.forEach { marks[it.id.orEmpty()] = "absent" } }, variant = Variant.Danger, small = true, enabled = editable)
            }
            Card(Wide, padded = false) {
                students.forEachIndexed { i, s ->
                    if (i > 0) Box(Modifier.fillMaxWidth().background(Color(0x1A1D6FEB)).padding(top = 1.dp))
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f)) {
                            Strong(s["name"].str, maxLines = 1)
                            Small(s["rollNo"].text ?: "—")
                        }
                        StatusButtons(marks[s.id], STUDENT_OPTIONS, editable) { marks[s.id.orEmpty()] = it }
                    }
                }
            }
            Small("$present present · $absent absent · ${students.size} students", Wide, align = TextAlign.Center)
            Button("Save attendance", ::submit, Wide, icon = Icons.Rounded.Save, loading = save.isLoading, enabled = editable)
        }
    }
}

/* Daily summary + view-all lists */
@Composable
private fun DailySummary() {
    val context = LocalContext.current
    var date by rememberSaveable { mutableStateOf(todayKey()) }
    var who by rememberSaveable { mutableStateOf("students") }
    var status by rememberSaveable { mutableStateOf("absent") }
    val params = mapOf("date" to date, "status" to status.ifEmpty { null })
    val summary = Api.attendanceSummary(mapOf("date" to date))
    val students = Api.summaryStudents(params, skip = who != "students")
    val faculty = Api.summaryFaculty(params, skip = who != "faculty")
    val list = if (who == "students") students else faculty
    val rows = (if (who == "students") students.data["students"] else faculty.data["faculty"]).list
    val s = summary.data["students"]
    val f = summary.data["faculty"]

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Chip("Today", date == todayKey()) { date = todayKey() }
        Chip("Yesterday", date == yesterdayKey()) { date = yesterdayKey() }
    }
    when {
        summary.data == null && summary.error != null -> ErrorState(summary.error) { summary.refetch() }
        summary.data == null -> Loading()
        else -> {
            Small(summary.data["department"].str)
            val stats = listOf(
                Triple("Students", num(s["total"]), Color.Unspecified),
                Triple("Present", num(s["present"]), C.success),
                Triple("Absent", num(s["absent"]), C.danger),
                Triple("Not marked", num(s["unmarked"]), Color.Unspecified),
                Triple("Faculty present", "${num(f["present"])}/${num(f["total"])}", C.success),
                Triple("Faculty absent", num((f["absent"].dbl ?: 0.0) + (f["leave"].dbl ?: 0.0)), C.danger),
            )
            Grid2(stats, gap = 10.dp) { (label, value, tone), mod ->
                Card(mod, gap = 2.dp) {
                    Label(label)
                    H2(value, color = tone)
                }
            }
        }
    }
    Segmented(listOf(Opt("students", "Students"), Opt("faculty", "Faculty")), who, { who = it; status = "absent" })
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        (listOf("absent" to "Absent", "present" to "Present") + (if (who == "faculty") listOf("leave" to "Leave") else emptyList()) + listOf("unmarked" to "Not marked", "" to "All"))
            .forEach { (v, l) -> Chip(l, status == v) { status = v } }
    }
    when {
        list.data == null && list.error != null -> ErrorState(list.error) { list.refetch() }
        list.data == null -> Loading()
        rows.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.Group, "Nobody here", "No one matches this filter for the day.") }
        else -> Card(Wide, padded = false) {
            rows.forEachIndexed { i, row ->
                if (i > 0) Box(Modifier.fillMaxWidth().background(Color(0x1A1D6FEB)).padding(top = 1.dp))
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Avatar(row, size = 36.dp)
                    Column(Modifier.weight(1f)) {
                        Strong(row["name"].str, maxLines = 1)
                        val ids = if (who == "students") listOfNotNull(row["rollNo"].text, row["section"].text?.let { "Sec $it" }) else listOfNotNull(row["employeeId"].text, row["department"].text)
                        Small(ids.joinToString(" · ") + (row["phone"].text?.let { " · $it" } ?: ""), maxLines = 1)
                    }
                    if (row["status"].str == "unmarked") Badge("Not marked", Tone.Neutral) else StatusBadge(row["status"].str)
                    row["phone"].text?.let { phone ->
                        Icon(
                            Icons.Rounded.Phone, "Call ${row["name"].str}",
                            Modifier.clickable { runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) } }.padding(6.dp).size(18.dp),
                            tint = C.primary,
                        )
                    }
                }
            }
        }
    }
}

/* HOD / admin: faculty attendance */
@Composable
private fun FacultyMarking() {
    var date by rememberSaveable { mutableStateOf(todayKey()) }
    val roster = Api.facultyRoster(mapOf("date" to date))
    val marks = remember { mutableStateMapOf<String, String>() }
    val save = rememberMutation()
    val r = roster.data
    LaunchedEffect(r) {
        if (r != null) {
            marks.clear()
            r["faculty"].list.forEach { f -> marks[f.id.orEmpty()] = f["status"].text ?: "present" }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Chip("Today", date == todayKey()) { date = todayKey() }
        Chip("Yesterday", date == yesterdayKey()) { date = yesterdayKey() }
    }
    when {
        r == null && roster.error != null -> ErrorState(roster.error) { roster.refetch() }
        r == null -> Loading()
        r["faculty"].list.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.Group, "No faculty to mark") }
        else -> {
            val editable = r["editable"].bool
            Small(r["department"].str)
            if (!editable) LockNote(r["lockedReason"].str)
            Card(Wide, padded = false) {
                r["faculty"].list.forEachIndexed { i, f ->
                    if (i > 0) Box(Modifier.fillMaxWidth().background(Color(0x1A1D6FEB)).padding(top = 1.dp))
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column {
                            Strong(f["name"].str, maxLines = 1)
                            Small(listOfNotNull(f["employeeId"].text, f["designation"].text, f["department"].text).joinToString(" · "), maxLines = 1)
                        }
                        StatusButtons(marks[f.id], FACULTY_OPTIONS, editable) { marks[f.id.orEmpty()] = it }
                    }
                }
            }
            Button("Save faculty attendance", {
                save.launch(onError = { Dialogs.alert("Could not save", errMsg(it)) }) {
                    val res = Api.markFacultyAttendance(jsonOf("date" to date, "records" to marks.map { (faculty, status) -> mapOf("faculty" to faculty, "status" to status) }))
                    Dialogs.alert("Saved", res["message"].str)
                }
            }, Wide, icon = Icons.Rounded.Save, loading = save.isLoading, enabled = editable)
        }
    }
}

/**
 * Attendance for staff: faculty mark their classes and see Our Class (their
 * Class In-Charge class, view only); HOD/admin also see the day and mark faculty;
 * principal, chairman, dean and AO view without marking.
 */
@Composable
private fun StaffAttendance(route: Route?) {
    val me = me()
    val role = me.role
    // Same tabs as the web Attendance Center (server enforces every one of them).
    val tabs = buildList {
        if (role !in ATTENDANCE_READ_ONLY) add(Opt("mark", "Mark class"))
        if (role in SUMMARY_VIEW) add(Opt("today", "Daily summary"))
        if (role == "faculty") add(Opt("my-classes", "My Classes"))
        add(Opt("sessions", "History"))
        add(Opt("overview", if (role == "faculty") "Our Class" else "Class Overview"))
        add(Opt("low", "Low Attendance"))
        add(Opt("corrections", "Corrections", pendingCorrections()))
        if (role in setOf("faculty", "hod") + COLLEGE_WIDE) add(Opt("reports", "Reports"))
        if (role in setOf("admin", "hod")) add(Opt("faculty", "Faculty"))
    }
    // Notification links open a tab directly, e.g. /attendance?tab=corrections.
    val requested = route?.q("tab")?.let { if (it == "our") "overview" else it }
    var tab by rememberSaveable { mutableStateOf(tabs.firstOrNull { it.value == requested }?.value ?: tabs.firstOrNull()?.value) }
    var preset by remember { mutableStateOf<MarkPreset?>(null) }
    Screen {
        Header("Attendance", if (isFirstYearHod(role, me["department"].str)) "First Year (All Departments)" else if (role == "hod") "${me["department"].str ?: ""} department" else if (role == "faculty") "Your classes" else "Whole college", back = true,
            right = { Button("Holidays", { Nav.push("/holidays") }, variant = Variant.Danger, icon = Icons.Rounded.EventBusy, small = true) })
        if (tabs.size > 1) Segmented(tabs, tab ?: "", { tab = it })
        when (tab) {
            "mark" -> MarkClass(preset) { preset = null }
            "today" -> DailySummary()
            "my-classes" -> MyClassesTab()
            "sessions" -> AttendanceHistory { subjectId, section, date, period ->
                preset = MarkPreset(subjectId, section, date, period)
                tab = if (role !in ATTENDANCE_READ_ONLY) "mark" else tab
            }
            "overview" -> if (role == "faculty") OurClassAttendance() else ClassOverviewTab()
            "low" -> LowAttendanceTab()
            "corrections" -> CorrectionsTab()
            "faculty" -> FacultyMarking()
            "reports" -> AttendanceReports()
        }
        Small("Attendance % is always total present periods ÷ total conducted periods.", color = C.muted)
    }
}

/** Pending correction requests waiting for this reviewer (tab badge). */
@Composable
private fun pendingCorrections(): Int? =
    Api.corrections(mapOf("status" to "pending", "limit" to 1)).data["pagination"]["total"].int?.takeIf { it > 0 }

/** A class picked in History, opened in Mark class. */
data class MarkPreset(val subjectId: String, val section: String, val date: String, val period: String)

/* ── Our Class (faculty, view only) ─────────────────────────────── */

private val OUR_RANGES = listOf(Opt("day", "Today"), Opt("week", "Week"), Opt("month", "Month"), Opt("semester", "Semester"), Opt("custom", "Custom"))

@Composable
private fun MiniStat(label: String, value: String, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(Color(0x99FFFFFF)).padding(10.dp)) {
        Small(label)
        H3(value)
    }
}

/**
 * "Our Class": the complete attendance of the faculty member's Class In-Charge
 * class. The class comes from the account on the server — only the reporting
 * window is chosen here.
 */
@Composable
private fun OurClassAttendance() {
    var range by rememberSaveable { mutableStateOf("day") }
    var from by rememberSaveable { mutableStateOf<LocalDate?>(null) }
    var to by rememberSaveable { mutableStateOf<LocalDate?>(LocalDate.now()) }
    val custom = range == "custom"
    val params = if (custom) mapOf("range" to range, "from" to from?.toString(), "to" to to?.toString()) else mapOf("range" to range)
    val q = Api.ourClassAttendance(params, skip = custom && (from == null || to == null))
    val data = q.data

    Segmented(OUR_RANGES, range, { range = it })
    if (custom) Card(Wide, gap = 10.dp) {
        DateField("Start date", from, { from = it }, max = to ?: LocalDate.now())
        DateField("End date", to, { to = it }, min = from, max = LocalDate.now())
    }
    when {
        custom && (from == null || to == null) -> Card(Wide) { EmptyState(Icons.Rounded.Group, "Choose a start and an end date") }
        data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
        data == null -> Loading()
        data["class"] == null -> Card(Wide) {
            EmptyState(Icons.Rounded.School, "No class is currently assigned to you as Class In-Charge.", "Your administrator sets your Class In-Charge section, year and semester.")
        }
        else -> Column(Modifier.alpha(if (q.isFetching) 0.6f else 1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val cls = data["class"]
            val o = data["overall"]
            Card(Wide, gap = 4.dp) {
                Label("OUR CLASS", color = C.primary)
                H3(cls["department"].str)
                Small("${YEAR_LABELS[cls["year"].int] ?: ""} · Section ${cls["section"].str ?: ""} · Semester ${cls["semester"].str ?: ""}")
            }
            Grid2(listOf(
                "Students" to num(o["totalStudents"]),
                "Periods held" to num(o["classesConducted"]),
                "Present / absent" to "${num(o["presentPeriods"])} / ${num(o["absentPeriods"])}",
                "Class attendance" to "${num(o["percentage"])}%",
            ), gap = 8.dp) { (l, v), mod -> MiniStat(l, v, mod) }

            SectionTitle("Periods")
            val sessions = data["sessions"].list
            if (sessions.isEmpty()) Card(Wide) { Small("No completed attendance records are available for this period.") }
            sessions.forEach { p ->
                Card(Wide, gap = 2.dp) {
                    Label("${if (range == "day") "" else "${p["date"].str} · "}P${p["period"].str} · ${p["subjectCode"].str ?: ""}", color = C.primary)
                    T(p["subject"].str, Type.strong)
                    Small("${Fmt.to12h(p["startTime"])} – ${Fmt.to12h(p["endTime"])} · ${p["facultyName"].text ?: "—"}")
                    Row {
                        T("${num(p["present"])} present", Type.small.copy(fontWeight = FontWeight.Bold), color = C.success)
                        Small(" · ")
                        T("${num(p["absent"])} absent", Type.small.copy(fontWeight = FontWeight.Bold), color = C.danger)
                    }
                }
            }
            SectionTitle("Students")
            data["students"].list.forEach { s ->
                val total = s["totalPeriods"].int ?: 0
                RowCard(Wide, gap = 10.dp) {
                    Column(Modifier.weight(1f)) {
                        Strong(s["name"].str, maxLines = 1)
                        Small("${s["rollNo"].text ?: "—"} · Y${s["year"].str ?: ""} · Sec ${s["section"].str ?: ""} · Sem ${s["semester"].text ?: "—"}", maxLines = 1)
                        Small("${num(s["presentPeriods"])}/${num(s["totalPeriods"])} present · ${num(s["absentPeriods"])} absent")
                    }
                    T(if (total > 0) "${num(s["percentage"])}%" else "—", Type.strong, color = if (total > 0) pctColor(s["percentage"].dbl ?: 0.0) else C.soft)
                }
            }
        }
    }
}

/* ── Attendance reports ─────────────────────────────────────────── */

private val REPORT_TYPES = mapOf(
    "class" to listOf(Opt("current", "Current data"), Opt("period", "Date & period"), Opt("weekly", "Weekly"), Opt("monthly", "Monthly"), Opt("semester", "Semester"), Opt("custom", "Custom")),
    "handling" to listOf(Opt("period", "Period"), Opt("date", "Date"), Opt("weekly", "Weekly"), Opt("monthly", "Monthly"), Opt("semester", "Semester"), Opt("custom", "Custom")),
)

@Composable
private fun Names(title: String, list: List<JsonElement>, color: Color) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Label("$title (${list.size})", color = color)
        if (list.isEmpty()) Small("None.")
        list.forEachIndexed { i, s -> Small("${i + 1}. ${s["rollNo"].text ?: "—"} · ${s["name"].str ?: ""}") }
    }
}

/**
 * Attendance reports — the same server-authorized reports as the web app, shown
 * in-app. Faculty choose Our Class (date + period only) or Handling Class (their
 * own subject + section). An HOD / college-wide account picks year / section.
 * The server decides scope and which periods have finished.
 */
@Composable
private fun AttendanceReports() {
    val me = me()
    val isFaculty = me.role == "faculty"
    val optionsQ = Api.reportOptions()
    val options = optionsQ.data

    var scope by rememberSaveable { mutableStateOf<String?>(null) }
    var type by rememberSaveable { mutableStateOf("period") }
    var subjectId by rememberSaveable { mutableStateOf("") }
    var section by rememberSaveable { mutableStateOf("") }
    var year by rememberSaveable { mutableStateOf("") }
    var date by rememberSaveable { mutableStateOf(LocalDate.now()) }
    var period by rememberSaveable { mutableStateOf("all") }
    var from by rememberSaveable { mutableStateOf<LocalDate?>(null) }
    var to by rememberSaveable { mutableStateOf<LocalDate?>(LocalDate.now()) }

    LaunchedEffect(options) {
        if (!isFaculty || scope != null || options == null) return@LaunchedEffect
        val hasClass = options["ourClass"] != null
        scope = if (hasClass) "class" else "handling"
        type = if (hasClass) "current" else "period"
    }
    val facultyScope = if (isFaculty) scope ?: "handling" else null
    val isClass = facultyScope == "class"
    val subjects = options["subjects"].list
    val subject = subjects.firstOrNull { it.id == subjectId }
    val sections = if (isFaculty) subject["sections"].strings else options["sections"].strings
    LaunchedEffect(facultyScope, subjects.size, subjectId) {
        if (facultyScope == "handling" && subjectId.isEmpty() && subjects.isNotEmpty()) subjectId = subjects[0].id.orEmpty()
    }
    LaunchedEffect(sections, section) {
        if (sections.size == 1) section = sections[0]
        else if (section.isNotEmpty() && section !in sections) section = ""
    }

    val needsDate = type == "period" || type == "date"
    val needsPeriod = type == "period"
    val day = date.toString()
    val ourClass = options["ourClass"]
    val periodQuery: Map<String, Any?> = when {
        isClass -> mapOf("scope" to "class", "date" to day)
        isFaculty -> mapOf("scope" to "handling", "subjectId" to subjectId, "section" to section, "date" to day)
        else -> mapOf("date" to day, "section" to section, "year" to year.ifEmpty { null })
    }
    val canListPeriods = needsPeriod && (if (isClass) ourClass != null else if (isFaculty) subjectId.isNotEmpty() && section.isNotEmpty() else section.isNotEmpty())
    val periodList = Api.reportPeriods(periodQuery, skip = !canListPeriods).data

    val params = buildMap<String, Any?> {
        if (isFaculty) put("scope", facultyScope)
        if (facultyScope == "handling") { if (subjectId.isNotEmpty()) put("subjectId", subjectId); if (section.isNotEmpty()) put("section", section) }
        if (!isFaculty) { if (year.isNotEmpty()) put("year", year); if (section.isNotEmpty()) put("section", section) }
        if (needsDate) put("date", day)
        if (needsPeriod) put("period", period)
        if (type == "custom") { from?.let { put("from", it.toString()) }; to?.let { put("to", it.toString()) } }
    }
    val blocked = (isClass && ourClass == null) ||
        (facultyScope == "handling" && !(subjectId.isNotEmpty() && section.isNotEmpty())) ||
        (!isFaculty && needsPeriod && section.isEmpty()) ||
        (type == "custom" && (from == null || to == null))
    val reportQ = Api.attendanceReport(type, params, skip = blocked || (isFaculty && scope == null))
    val report = reportQ.data

    if (options == null && optionsQ.error != null) { ErrorState(optionsQ.error) { optionsQ.refetch() }; return }
    if (options == null || (isFaculty && scope == null)) { Loading(); return }

    if (isFaculty) Segmented(listOf(Opt("class", "Our Class"), Opt("handling", "Handling Class")), facultyScope ?: "handling", { v ->
        scope = v; type = if (v == "class") "current" else "period"; period = "all"
    })
    Segmented(REPORT_TYPES.getValue(if (isClass) "class" else "handling"), type, { type = it })

    if (isClass && ourClass == null) {
        Card(Wide) { EmptyState(Icons.Rounded.School, "No class is currently assigned to you as Class In-Charge.", "Choose Handling Class for the subjects you teach.") }
    } else Card(Wide, gap = 10.dp) {
        if (isClass && ourClass != null) Small("Our Class · ${ourClass["department"].str ?: ""} · ${YEAR_LABELS[ourClass["year"].int] ?: ""} · Sec ${ourClass["section"].str ?: ""} · Sem ${ourClass["semester"].str ?: ""}")
        if (facultyScope == "handling") {
            Label("Subject")
            if (subjects.isEmpty()) Small("No subject classes are currently assigned to you.")
            else FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                subjects.forEach { s -> Chip(s["code"].str.orEmpty(), subjectId == s.id) { subjectId = s.id.orEmpty(); section = "" } }
            }
            Label("Section")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                sections.forEach { s -> Chip("Section $s", section == s) { section = s } }
            }
        }
        if (!isFaculty) {
            Label("Year")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("All", year.isEmpty()) { year = "" }
                options["years"].list.mapNotNull { it.int }.forEach { y -> Chip(YEAR_LABELS[y] ?: "Year $y", year == "$y") { year = "$y" } }
            }
            Label("Section")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("All", section.isEmpty()) { section = "" }
                sections.forEach { s -> Chip(s, section == s) { section = s } }
            }
        }
        if (needsDate) DateField("Date", date, { date = it }, max = LocalDate.now())
        if (needsPeriod) {
            Label("Period")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("All Periods", period == "all") { period = "all" }
                periodList["periods"].list.forEach { p ->
                    val pn = p["period"].str.orEmpty()
                    Chip("P$pn · ${Fmt.to12h(p["startTime"])}${if (p["completed"].bool) "" else " ⏳"}", period == pn) { period = pn }
                }
            }
        }
        if (type == "custom") {
            DateField("Start date", from, { from = it }, max = to ?: LocalDate.now())
            DateField("End date", to, { to = it }, min = from, max = LocalDate.now())
        }
        if (type == "current") Small("Today’s completed periods only — the server’s clock decides.")
    }

    when {
        blocked -> Unit
        report == null && reportQ.error != null -> RowCard(Wide, gap = 10.dp, verticalAlignment = Alignment.Top) {
            Icon(Icons.Rounded.Warning, null, Modifier.size(18.dp), tint = C.warning)
            Column(Modifier.weight(1f)) {
                Strong("Report not available")
                Small(errMsg(reportQ.error))
            }
        }
        report == null -> if (reportQ.isFetching) Loading()
        else -> Column(Modifier.alpha(if (reportQ.isFetching) 0.6f else 1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val h = report["header"]
            Card(Wide, gap = 2.dp) {
                H3(report["title"].str)
                Small(listOfNotNull(h["department"].text, YEAR_LABELS[h["year"].int], h["section"].text?.let { "Sec $it" }, h["semester"].text?.let { "Sem $it" }).joinToString(" · "))
                h["classInCharge"].text?.let { Small("Class In-Charge: $it") }
                Small("Generated ${h["generatedAt"].str ?: ""} (server time)")
            }
            // Holiday for the whole class: not applicable — never a list of absentees.
            HolidayCard(report["holiday"], "Attendance not applicable.")
            val otherHolidays = report["holidays"].list.filter { it.id != report["holiday"].id }
            if (otherHolidays.isNotEmpty()) Card(Wide, gap = 2.dp) {
                Label("Holidays in this report (not counted)")
                otherHolidays.forEach { x ->
                    val sd = x["startDate"].str; val ed = x["endDate"].str
                    Small("${if (sd == ed) sd else "$sd → $ed"} · ${x["reason"].str ?: ""} (${x["scope"].str ?: ""})")
                }
            }
            val isPeriod = report["type"].str == "period"
            val wholeHoliday = report["holiday"] != null && (if (isPeriod) (report["totals"]["total"].int ?: 0) == 0 else report["periods"].list.isEmpty())
            when {
                wholeHoliday -> Unit
                isPeriod && report["notTaken"].bool -> Card(Wide) { EmptyState(Icons.Rounded.Description, "Attendance was not taken for this period") }
                isPeriod -> Card(Wide, gap = 8.dp) {
                    Small("P${h["period"].str ?: ""} · ${h["subjectCode"].str ?: ""} ${h["subject"].str ?: ""} · ${Fmt.to12h(h["startTime"])} – ${Fmt.to12h(h["endTime"])} · ${h["facultyName"].str ?: ""}")
                    Names("PRESENT STUDENTS", report["present"].list, C.success)
                    Names("ABSENT STUDENTS", report["absent"].list, C.danger)
                }
                else -> {
                    val t = report["totals"]
                    Card(Wide) { Small("${num(t["periodsConducted"])} periods · ${num(t["present"])} present · ${num(t["absent"])} absent · ${num(t["percentage"])}%") }
                    report["periods"].list.forEach { p ->
                        Card(Wide, gap = 6.dp) {
                            Strong("Period ${p["period"].str ?: ""} · ${p["subjectCode"].str ?: ""} ${p["subject"].str ?: ""}")
                            Small("${Fmt.to12h(p["startTime"])} – ${Fmt.to12h(p["endTime"])} · ${p["facultyName"].text ?: "—"}")
                            Names("PRESENT", p["present"].list, C.success)
                            Names("ABSENT", p["absent"].list, C.danger)
                        }
                    }
                    val students = report["students"].list
                    if (students.isNotEmpty()) SectionTitle("Students")
                    students.forEach { s ->
                        val total = s["totalPeriods"].int ?: 0
                        RowCard(Wide, gap = 10.dp) {
                            Column(Modifier.weight(1f)) {
                                Strong(s["name"].str, maxLines = 1)
                                Small("${s["rollNo"].text ?: "—"} · ${num(s["presentPeriods"])}/${num(s["totalPeriods"])} present · ${num(s["absentPeriods"])} absent")
                            }
                            T(if (total > 0) "${num(s["percentage"])}%" else "—", Type.strong, color = if (total > 0) pctColor(s["percentage"].dbl ?: 0.0) else C.soft)
                        }
                    }
                }
            }
        }
    }
}

