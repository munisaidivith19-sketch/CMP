package com.vexon.campus.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Assignment
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.EventBusy
import androidx.compose.material.icons.rounded.EventAvailable
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Shield
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
import androidx.compose.ui.unit.dp
import com.vexon.campus.core.Api
import com.vexon.campus.core.ApiException
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.Omit
import com.vexon.campus.core.Params
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
import com.vexon.campus.ui.Avatar
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.ChipRow
import com.vexon.campus.ui.DateField
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.Grid2
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.H3
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.Opt
import com.vexon.campus.ui.ProgressBar
import com.vexon.campus.ui.ROLE_LABELS
import com.vexon.campus.ui.RowCard
import com.vexon.campus.ui.STAFF
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.Segmented
import com.vexon.campus.ui.SelectField
import com.vexon.campus.ui.Sheet
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.StatusBadge
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.T
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Type
import com.vexon.campus.ui.Variant
import com.vexon.campus.ui.YEAR_LABELS
import com.vexon.campus.ui.fmtHolidayDates
import com.vexon.campus.ui.pctColor
import kotlinx.serialization.json.JsonElement
import java.time.LocalDate

/* ── Shared: reporting period (the web's RangeFilter) ───────────── */

data class Period(val range: String, val from: LocalDate? = null, val to: LocalDate? = LocalDate.now()) {
    val ready get() = range != "custom" || (from != null && to != null)
    fun params(): Params = if (range == "custom") mapOf("range" to range, "from" to from?.toString(), "to" to to?.toString()) else mapOf("range" to range)
}

private val PERIODS = listOf(Opt("day", "Today"), Opt("week", "Week"), Opt("month", "Month"), Opt("semester", "Semester"), Opt("custom", "Custom"))

@Composable
fun PeriodFilter(value: Period, onChange: (Period) -> Unit) {
    Segmented(PERIODS, value.range, { onChange(value.copy(range = it)) })
    if (value.range == "custom") Card(Wide, gap = 10.dp) {
        DateField("Start date", value.from, { onChange(value.copy(from = it)) }, max = value.to ?: LocalDate.now())
        DateField("End date", value.to, { onChange(value.copy(to = it)) }, min = value.from, max = LocalDate.now())
    }
}

@Composable
private fun PercentText(value: JsonElement?, threshold: Double = 75.0, hasData: Boolean = true) {
    T(if (hasData) "${num(value)}%" else "—", Type.strong, color = if (hasData) pctColor(value.dbl ?: 0.0, threshold) else C.soft)
}

@Composable
private fun MiniStatCell(label: String, value: String, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(Color(0x99FFFFFF)).padding(10.dp)) {
        Small(label)
        H3(value)
    }
}

/* ── History (marked sessions) ──────────────────────────────────── */

/** Previously marked classes; "Edit"/"View" re-opens one in Mark class. */
@Composable
fun AttendanceHistory(onOpen: (subjectId: String, section: String, date: String, period: String) -> Unit) {
    var period by remember { mutableStateOf(Period("month")) }
    var search by rememberSaveable { mutableStateOf("") }
    val q = Api.attendanceSessions(period.params(), skip = !period.ready)
    PeriodFilter(period) { period = it }
    Input(search, { search = it }, placeholder = "Search by subject or section…")
    val needle = search.trim().lowercase()
    val sessions = q.data.list.filter { s ->
        needle.isEmpty() || listOfNotNull(s["subject"]["code"].str, s["subject"]["name"].str, s["section"].str).any { it.lowercase().contains(needle) }
    }
    when {
        !period.ready -> Card(Wide) { EmptyState(Icons.Rounded.EventAvailable, "Choose a start and an end date") }
        q.data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
        q.data == null -> Loading()
        sessions.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.EventAvailable, "No class records found", "No attendance sessions recorded for the selected time range.") }
        else -> sessions.forEach { s ->
            val editable = s["editable"].bool
            Card(Wide, gap = 8.dp) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Strong("${s["subject"]["code"].str ?: ""} · ${s["subject"]["name"].str ?: ""}", Modifier.weight(1f), maxLines = 1)
                    s["section"].text?.let { Badge("Sec $it", Tone.Primary) }
                }
                Small(
                    "${Fmt.classDay(s["date"], "EEEE, dd MMM")} · Period ${s["period"].str ?: ""}" +
                        (s["snapshot"].takeIf { it != null }?.let { " · ${Fmt.to12h(it["startTime"])} – ${Fmt.to12h(it["endTime"])}" } ?: "") +
                        " · ${num(s["present"])} of ${num(s["total"])} present" +
                        ((s["edits"].int ?: 0).takeIf { it > 0 }?.let { " · $it edit${if (it > 1) "s" else ""}" } ?: ""),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.weight(1f)) { PercentText(s["percentage"]) }
                    Button(if (editable) "Edit" else "View", {
                        onOpen(s["subject"].id.orEmpty(), s["section"].str.orEmpty(), s["date"].str.orEmpty().take(10), s["period"].str.orEmpty())
                    }, variant = if (editable) Variant.Primary else Variant.Outline, icon = if (editable) Icons.Rounded.Edit else Icons.Rounded.Lock, small = true)
                }
            }
        }
    }
}

/* ── Student attendance sheet ───────────────────────────────────── */

@Composable
fun StudentAttendanceSheet(id: String, onClose: () -> Unit) {
    val q = Api.studentAttendance(id)
    val d = q.data
    Sheet(d["student"]["name"].text ?: "Student attendance", onClose) {
        when {
            d == null && q.error != null -> ErrorState(q.error)
            d == null -> Loading()
            else -> {
                val st = d["student"]
                Small(listOfNotNull(st["rollNo"].text, st["department"].text, st["section"].text?.let { "Sec $it" }).joinToString(" · "))
                val o = d["overall"]
                val threshold = d["threshold"].dbl ?: 75.0
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MiniStatCell("Overall", "${num(o["percentage"])}%", Modifier.weight(1f))
                    MiniStatCell("Present", num(o["presentPeriods"]), Modifier.weight(1f))
                    MiniStatCell("Conducted", num(o["totalPeriods"]), Modifier.weight(1f))
                }
                d["subjects"].list.forEach { s ->
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row {
                            Strong("${s["subject"]["code"].str ?: ""} · ${s["subject"]["name"].str ?: ""}", Modifier.weight(1f), maxLines = 1)
                            Small("${num(s["presentPeriods"])}/${num(s["totalPeriods"])}")
                        }
                        ProgressBar(s["percentage"].dbl, threshold)
                    }
                }
            }
        }
    }
}

/* ── Low attendance ─────────────────────────────────────────────── */

@Composable
fun LowAttendanceTab() {
    val me = me()
    val isFaculty = me.role == "faculty"
    val canNotify = me.role in STAFF
    var period by remember { mutableStateOf(Period("semester")) }
    var section by rememberSaveable { mutableStateOf("") }
    var severity by rememberSaveable { mutableStateOf("all") }
    var search by rememberSaveable { mutableStateOf("") }
    var selected by remember { mutableStateOf<String?>(null) }
    val notify = rememberMutation()
    val options = Api.reportOptions(skip = isFaculty)
    // Faculty: the server scopes to their own teaching assignments (no section filter).
    val q = Api.lowAttendance(period.params() + mapOf("section" to (if (isFaculty) null else section.ifEmpty { null })), skip = !period.ready)
    val threshold = q.data["threshold"].dbl ?: 75.0
    val all = q.data["students"].list
    val critical = all.count { (it["percentage"].dbl ?: 0.0) < 65 }
    val atRisk = all.size - critical
    val needle = search.trim().lowercase()
    val rows = all.filter { r ->
        val p = r["percentage"].dbl ?: 0.0
        (needle.isEmpty() || listOfNotNull(r["student"]["name"].str, r["student"]["rollNo"].str).any { it.lowercase().contains(needle) }) &&
            when (severity) {
                "critical" -> p < 65
                "risk" -> p >= 65 && p < threshold
                else -> true
            }
    }

    PeriodFilter(period) { period = it }
    if (!isFaculty) {
        val sections = options.data["sections"].strings
        if (sections.isNotEmpty()) ChipRow {
            Chip("All sections", section.isEmpty()) { section = "" }
            sections.forEach { s -> Chip("Sec $s", section == s) { section = s } }
        }
    }
    ChipRow {
        Chip("All at risk (${all.size})", severity == "all") { severity = "all" }
        Chip("🔴 Critical <65% ($critical)", severity == "critical") { severity = "critical" }
        Chip("🟡 Warning 65–${num(threshold)}% ($atRisk)", severity == "risk") { severity = "risk" }
    }
    Input(search, { search = it }, placeholder = "Search student…")
    when {
        !period.ready -> Card(Wide) { EmptyState(Icons.Rounded.Group, "Choose a start and an end date") }
        q.data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
        q.data == null -> Loading()
        rows.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.Check, "No students in this band 🎉", "All students are above the filtered attendance range.") }
        else -> rows.forEach { r ->
            val st = r["student"]
            val pct = r["percentage"].dbl ?: 0.0
            Row(Wide.clip(RoundedCornerShape(28.dp)).background(C.card)) {
                Box(Modifier.width(5.dp).height(86.dp).background(if (pct < 65) C.danger else C.warning))
                Column(Modifier.weight(1f).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.clickable { selected = st.id }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Avatar(st, size = 34.dp)
                        Column(Modifier.weight(1f)) {
                            Strong(st["name"].str, maxLines = 1)
                            Small("${st["rollNo"].text ?: "—"} · ${st["department"].str ?: ""}${st["section"].text?.let { " · Sec $it" } ?: ""} · ${num(r["present"])} of ${num(r["total"])}", maxLines = 1)
                        }
                        PercentText(r["percentage"], threshold)
                    }
                    if (canNotify) Button("Notify", {
                        notify.launch(onError = { Dialogs.alert("Could not notify", errMsg(it)) }) {
                            Api.notifyLowAttendance(
                                st.id.orEmpty(),
                                "Notice: Your attendance is currently ${num(pct)}%, which is below the mandatory ${num(threshold)}% requirement. Please contact your department HOD / class advisor immediately.",
                            )
                            Dialogs.alert("Warning sent", "A notification was sent to ${st["name"].str ?: "the student"}.")
                        }
                    }, variant = Variant.Soft, icon = Icons.Rounded.Notifications, small = true, loading = notify.isLoading)
                }
            }
        }
    }
    selected?.let { StudentAttendanceSheet(it) { selected = null } }
}

/* ── Correction requests (faculty / HOD / admin review) ─────────── */

@Composable
fun CorrectionsTab() {
    val me = me()
    val canReview = me.role in STAFF
    var status by rememberSaveable { mutableStateOf("pending") }
    var page by rememberSaveable { mutableStateOf(1) }
    var search by rememberSaveable { mutableStateOf("") }
    val notes = remember { mutableStateMapOf<String, String>() }
    val review = rememberMutation()
    val q = Api.corrections(mapOf("status" to status, "page" to page))
    val needle = search.trim().lowercase()
    val requests = q.data["requests"].list.filter { c ->
        needle.isEmpty() || listOfNotNull(c["student"]["name"].str, c["student"]["rollNo"].str, c["subject"]["code"].str).any { it.lowercase().contains(needle) }
    }

    Segmented(listOf(Opt("pending", "Pending"), Opt("approved", "Approved"), Opt("rejected", "Rejected")), status, { status = it; page = 1 })
    Input(search, { search = it }, placeholder = "Search student or subject…")
    if (canReview && status == "pending" && requests.size > 1) Button("Approve all (${requests.size})", {
        Dialogs.confirm("Approve all ${requests.size} requests?", "Each student's attendance will be updated.", "Approve all") {
            review.launch(onError = { Dialogs.alert("Could not approve all", errMsg(it)) }) {
                requests.forEach { Api.reviewCorrection(it.id.orEmpty(), "approved", null) }
                Dialogs.alert("Approved all ${requests.size} requests")
            }
        }
    }, Wide, variant = Variant.Success, icon = Icons.Rounded.DoneAll, loading = review.isLoading)

    when {
        q.data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
        q.data == null -> Loading()
        requests.isEmpty() -> Card(Wide) { EmptyState(Icons.AutoMirrored.Rounded.Assignment, "No $status correction requests") }
        else -> requests.forEach { c ->
            val id = c.id.orEmpty()
            Card(Wide, gap = 10.dp) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Avatar(c["student"], size = 34.dp)
                    Column(Modifier.weight(1f)) {
                        Strong("${c["student"]["name"].str ?: ""} · ${c["student"]["rollNo"].str ?: ""}", maxLines = 1)
                        Small("${c["subject"]["code"].str ?: ""} · ${Fmt.classDay(c["date"], "EEEE, dd MMM")} · Period ${c["period"].str ?: ""}")
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusBadge(c["currentStatus"].str)
                    Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, Modifier.size(14.dp), tint = C.muted)
                    StatusBadge(c["requestedStatus"].str)
                }
                Column(Wide.clip(RoundedCornerShape(12.dp)).background(C.whiteGlass).padding(10.dp)) {
                    Label("Reason given")
                    Small("“${c["reason"].str ?: ""}”")
                }
                if (c["status"].str == "pending") {
                    if (canReview) {
                        Input(notes[id].orEmpty(), { notes[id] = it }, placeholder = "Optional note to student…", maxLength = 300)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button("Approve", {
                                review.launch(onError = { Dialogs.alert("Could not update", errMsg(it)) }) { Api.reviewCorrection(id, "approved", notes[id]) }
                            }, Modifier.weight(1f), variant = Variant.Success, icon = Icons.Rounded.Check, small = true, loading = review.isLoading)
                            Button("Reject", {
                                review.launch(onError = { Dialogs.alert("Could not update", errMsg(it)) }) { Api.reviewCorrection(id, "rejected", notes[id]) }
                            }, Modifier.weight(1f), variant = Variant.Danger, icon = Icons.Rounded.Close, small = true, loading = review.isLoading)
                        }
                    } else Small("Awaiting review by the class faculty.", color = C.muted)
                } else Small(
                    "Reviewed by ${c["reviewedBy"]["name"].text ?: "Staff"} · ${Fmt.dateTime(c["reviewedAt"])}" + (c["reviewNote"].text?.let { " · Note: “$it”" } ?: ""),
                    color = C.muted,
                )
            }
        }
    }
    val pages = q.data["pagination"]["pages"].int ?: 1
    if (pages > 1) Row(Wide, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Button("Previous", { page-- }, variant = Variant.Soft, small = true, enabled = page > 1)
        Small("Page $page of $pages")
        Button("Next", { page++ }, variant = Variant.Soft, small = true, enabled = page < pages)
    }
}

/* ── My Classes (faculty) ───────────────────────────────────────── */

@Composable
fun MyClassesTab() {
    val options = Api.myClassOptions()
    var subjectId by rememberSaveable { mutableStateOf("") }
    var section by rememberSaveable { mutableStateOf("") }
    var period by remember { mutableStateOf(Period("semester")) }
    val subjects = options.data["subjects"].list
    val sections = subjects.firstOrNull { it.id == subjectId }["sections"].strings
    // First subject automatically, and its only section when it has one.
    LaunchedEffect(subjects.size) { if (subjectId.isEmpty() && subjects.isNotEmpty()) subjectId = subjects[0].id.orEmpty() }
    LaunchedEffect(sections) {
        if (sections.size == 1) section = sections[0] else if (section.isNotEmpty() && section !in sections) section = ""
    }
    val ready = subjectId.isNotEmpty() && section.isNotEmpty() && period.ready
    val q = Api.myClassAttendance(mapOf("subjectId" to subjectId, "section" to section) + period.params(), skip = !ready)

    when {
        options.data == null && options.error != null -> { ErrorState(options.error) { options.refetch() }; return }
        options.data == null -> { Loading(); return }
        subjects.isEmpty() -> {
            Card(Wide) { EmptyState(Icons.Rounded.MenuBook, "No classes assigned to you yet", "Your subjects and sections appear here once you are scheduled in the timetable.") }
            return
        }
    }
    SelectField("Subject", subjectId, subjects.map { Opt(it.id.orEmpty(), "${it["code"].str ?: ""} · ${it["name"].str ?: ""}") }, { subjectId = it; section = "" })
    if (sections.isNotEmpty()) ChipRow { sections.forEach { s -> Chip("Section $s", section == s) { section = s } } }
    PeriodFilter(period) { period = it }
    val d = q.data
    when {
        section.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.Group, "Choose a section", "Pick one of the sections you teach this subject to.") }
        !period.ready -> Card(Wide) { EmptyState(Icons.Rounded.Group, "Choose a start and an end date") }
        d == null && q.error != null -> ErrorState(q.error) { q.refetch() }
        d == null -> Loading()
        else -> Column(Modifier.alpha(if (q.isFetching) 0.6f else 1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val cls = d["class"]
            Small(listOfNotNull(cls["department"].text, YEAR_LABELS[cls["year"].int] ?: cls["year"].text?.let { "Year $it" }, cls["section"].text?.let { "Section $it" }, cls["semester"].text?.let { "Semester $it" }).joinToString(" · "))
            val o = d["overall"]
            Grid2(listOf(
                "Students" to num(o["totalStudents"]), "Periods held" to num(o["classesConducted"]),
                "Below 75%" to d["belowThreshold"].list.size.toString(), "Class average" to "${num(o["percentage"])}%",
            ), gap = 8.dp) { (l, v), mod -> MiniStatCell(l, v, mod) }
            val students = d["students"].list
            if (students.isEmpty()) Card(Wide) { EmptyState(Icons.AutoMirrored.Rounded.Assignment, "No students in this class yet") }
            students.forEach { s ->
                val total = s["totalPeriods"].int ?: 0
                RowCard(Wide, gap = 10.dp) {
                    Column(Modifier.weight(1f)) {
                        Strong(s["name"].str, maxLines = 1)
                        Small("${s["rollNo"].text ?: "—"} · ${num(s["presentPeriods"])} present · ${num(s["absentPeriods"])} absent · ${num(s["totalPeriods"])} held", maxLines = 1)
                    }
                    PercentText(s["percentage"], hasData = total > 0)
                }
            }
        }
    }
}

/* ── Class Overview (HOD / admin / college-wide) ────────────────── */

@Composable
fun ClassOverviewTab() {
    val me = me()
    val scope = when (me.role) {
        "faculty" -> mapOf("mine" to "true")
        "hod" -> mapOf("department" to me["department"].str)
        else -> null
    }
    val subjects = Api.subjects(scope)
    var subjectId by rememberSaveable { mutableStateOf("") }
    var section by rememberSaveable { mutableStateOf("") }
    var search by rememberSaveable { mutableStateOf("") }
    var period by remember { mutableStateOf(Period("semester")) }
    val subject = subjects.data.list.firstOrNull { it.id == subjectId }
    val q = Api.subjectAttendance(subjectId, mapOf("section" to section.ifEmpty { null }) + period.params(), skip = subjectId.isEmpty() || !period.ready)

    when {
        subjects.data == null && subjects.error != null -> ErrorState(subjects.error) { subjects.refetch() }
        subjects.data == null -> Loading()
        subjects.data.list.isEmpty() -> Card(Wide) { Small("No subjects are available for your scope.") }
        else -> SelectField("Subject", subjectId.ifEmpty { null }, subjects.data.list.map { Opt(it.id.orEmpty(), "${it["code"].str ?: ""} · ${it["name"].str ?: ""}") }, { subjectId = it; section = "" }, "Choose subject")
    }
    val subjectSections = subject["sections"].strings
    if (subjectSections.isNotEmpty()) ChipRow {
        Chip("All sections", section.isEmpty()) { section = "" }
        subjectSections.forEach { s -> Chip("Section $s", section == s) { section = s } }
    }
    PeriodFilter(period) { period = it }
    val d = q.data
    when {
        subjectId.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.School, "Select a subject", "Choose a subject above to see each student's attendance.") }
        !period.ready -> Card(Wide) { EmptyState(Icons.Rounded.Group, "Choose a start and an end date") }
        d == null && q.error != null -> ErrorState(q.error) { q.refetch() }
        d == null -> Loading()
        else -> {
            val o = d["overall"]
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MiniStatCell("Students", num(o["totalStudents"]), Modifier.weight(1f))
                MiniStatCell("Classes held", num(o["classesConducted"]), Modifier.weight(1f))
                MiniStatCell("Average", "${num(o["averagePercentage"])}%", Modifier.weight(1f))
            }
            Input(search, { search = it }, placeholder = "Filter student…")
            val needle = search.trim().lowercase()
            val students = d["students"].list.filter { s ->
                needle.isEmpty() || listOfNotNull(s["studentInfo"]["name"].str, s["studentInfo"]["rollNo"].str).any { it.lowercase().contains(needle) }
            }
            if (students.isEmpty()) Card(Wide) { EmptyState(Icons.AutoMirrored.Rounded.Assignment, "No attendance recorded", "No records match this filter.") }
            students.forEachIndexed { i, s ->
                RowCard(Wide, gap = 10.dp) {
                    Small("${i + 1}", color = C.muted)
                    Column(Modifier.weight(1f)) {
                        Strong(s["studentInfo"]["name"].str, maxLines = 1)
                        Small("${s["studentInfo"]["rollNo"].text ?: "—"} · ${num(s["presentPeriods"])} / ${num(s["totalPeriods"])} attended")
                    }
                    PercentText(s["percentage"])
                }
            }
        }
    }
}

/* ── Holidays ───────────────────────────────────────────────────── */

private fun scopePreview(dept: String, year: String, section: String): String =
    if (dept == "ALL") "Entire college" else listOfNotNull(dept, year.takeIf { it != "ALL" }?.let { "Year $it" }, section.takeIf { it != "ALL" }?.let { "Section $it" }).joinToString(" → ")

/** Principal-only declare / edit form. The server re-validates everything. */
@Composable
private fun HolidayForm(editing: JsonElement?, onDone: () -> Unit) {
    val opts = Api.holidayOptions()
    var reason by remember { mutableStateOf(editing["reason"].str.orEmpty()) }
    var type by remember { mutableStateOf(editing["type"].text ?: "SINGLE") }
    var start by remember { mutableStateOf(editing["startDate"].str?.let { runCatching { LocalDate.parse(it) }.getOrNull() }) }
    var end by remember { mutableStateOf(editing["endDate"].str?.let { runCatching { LocalDate.parse(it) }.getOrNull() }) }
    var dept by remember { mutableStateOf(editing["department"].text ?: "ALL") }
    var year by remember { mutableStateOf(editing["year"].text ?: "ALL") }
    var section by remember { mutableStateOf(editing["section"].text ?: "ALL") }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }
    val save = rememberMutation()

    fun doSave() = save.launch(onError = { Dialogs.alert("Could not save", errMsg(it)) }) {
        val body = jsonOf(
            "reason" to reason.trim(), "type" to type, "startDate" to start.toString(),
            "endDate" to (if (type == "CUSTOM") end.toString() else Omit),
            "department" to dept, "year" to (year.toIntOrNull() ?: "ALL"), "section" to section,
        )
        if (editing != null) Api.updateHoliday(editing.id.orEmpty(), body) else Api.createHoliday(body)
        Dialogs.alert(if (editing != null) "Holiday updated" else "Holiday declared")
        onDone()
    }

    fun submit() {
        val e = mutableMapOf<String, String>()
        if (reason.trim().length < 3) e["reason"] = "Enter a reason (at least 3 characters)"
        if (start == null) e["start"] = if (type == "SINGLE") "Choose the date" else "Choose the \"From\" date"
        if (type == "CUSTOM") {
            val s = start
            val en = end
            if (en == null) e["end"] = "Choose the \"To\" date" else if (s != null && en.isBefore(s)) e["end"] = "\"To\" cannot be before \"From\""
        }
        errors = e
        if (e.isNotEmpty()) return
        if (dept == "ALL") Dialogs.confirm("Entire college", "This holiday will apply to the entire college. Continue?", "Continue") { doSave() }
        else doSave()
    }

    Card(Wide, gap = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            H3(if (editing != null) "Edit holiday" else "Declare a holiday", Modifier.weight(1f))
            Icon(Icons.Rounded.Close, "Close form", Modifier.size(20.dp).clickable(onClick = onDone), tint = C.soft)
        }
        Input(reason, { reason = it }, label = "Reason", placeholder = "e.g. Diwali", maxLength = 200, error = errors["reason"])
        Segmented(listOf(Opt("SINGLE", "Single day"), Opt("CUSTOM", "Custom range")), type, { type = it; if (it == "SINGLE") end = null })
        if (type == "SINGLE") DateField("Date", start, { start = it }, error = errors["start"])
        else {
            DateField("From date", start, { start = it }, max = end, error = errors["start"])
            DateField("To date", end, { end = it }, min = start, error = errors["end"])
        }
        val departments = opts.data["departments"].strings
        val sections = opts.data["sections"].strings
        val years = opts.data["years"].list.mapNotNull { it.int }.ifEmpty { listOf(1, 2, 3, 4) }
        SelectField("Department", dept, listOf(Opt("ALL", "ALL")) + departments.map { Opt(it, it) }, { v ->
            dept = v
            // The scope is a hierarchy: choosing ALL above clears what sits below it.
            if (v == "ALL") { year = "ALL"; section = "ALL" }
        })
        if (dept != "ALL") SelectField("Year", year, listOf(Opt("ALL", "ALL")) + years.map { Opt("$it", "$it") }, { v -> year = v; if (v == "ALL") section = "ALL" })
        if (year != "ALL") SelectField("Section", section, listOf(Opt("ALL", "ALL SECTIONS")) + sections.map { Opt(it, it) }, { section = it })
        Small(
            "Holiday applies to: ${scopePreview(dept, year, section)}",
            Wide.clip(RoundedCornerShape(12.dp)).background(if (dept == "ALL") C.warningSoft else C.primarySoft).padding(10.dp),
            if (dept == "ALL") C.amberText else C.primary600,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button("Cancel", onDone, Modifier.weight(1f), variant = Variant.Ghost)
            Button(if (editing != null) "Save changes" else "Submit", ::submit, Modifier.weight(1f), loading = save.isLoading)
        }
    }
}

/**
 * Holidays: everyone sees the ones that apply to them; only the Principal gets
 * declare / edit / delete (and the server refuses those calls from anyone else).
 */
@Composable
fun HolidaysScreen() {
    val q = Api.holidays()
    val remove = rememberMutation()
    var formFor by remember { mutableStateOf<JsonElement?>(null) }
    var formOpen by remember { mutableStateOf(false) }
    val canManage = q.data["canManage"].bool
    val holidays = q.data["holidays"].list
    val today = Fmt.todayKey()
    val upcoming = holidays.filter { (it["endDate"].str ?: "") >= today }
    val past = holidays.filter { (it["endDate"].str ?: "") < today }.reversed()

    @Composable
    fun HolidayRow(h: JsonElement, muted: Boolean) {
        Row(
            Wide.alpha(if (muted) 0.6f else 1f).clip(RoundedCornerShape(18.dp)).background(C.card).padding(12.dp),
            verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.padding(top = 2.dp).width(5.dp).height(40.dp).clip(RoundedCornerShape(3.dp)).background(C.danger))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Strong(h["reason"].str, maxLines = 2)
                Small(fmtHolidayDates(h))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Badge(h["scope"].str, if (h["entireCollege"].bool) Tone.Warning else Tone.Info)
                    Badge(if (h["type"].str == "SINGLE") "Single day" else "Custom", Tone.Neutral)
                }
            }
            if (canManage) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Rounded.Edit, "Edit ${h["reason"].str}", Modifier.size(20.dp).clickable { formFor = h; formOpen = true }, tint = C.primary)
                Icon(Icons.Rounded.Delete, "Delete ${h["reason"].str}", Modifier.size(20.dp).clickable {
                    Dialogs.confirm("Delete holiday?", "This removes the holiday and restores normal timetable and attendance rules.", "Delete", destructive = true) {
                        remove.launch(onError = { Dialogs.alert("Could not delete", errMsg(it)) }) {
                            Api.deleteHoliday(h.id.orEmpty())
                            Dialogs.alert("Holiday deleted")
                        }
                    }
                }, tint = C.danger)
            }
        }
    }

    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header(
            "Holidays",
            if (canManage) "Declare, edit or delete college holidays. Attendance is closed on these days." else "Holidays that apply to you. Attendance is not taken on these days.",
            back = true,
        )
        if (canManage && !formOpen) Button("Add holiday", { formFor = null; formOpen = true }, Wide, icon = Icons.Rounded.Add)
        if (canManage && formOpen) HolidayForm(formFor) { formOpen = false; formFor = null }
        when {
            q.data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            q.data == null -> Loading()
            else -> {
                Label("Upcoming")
                if (upcoming.isEmpty()) Card(Wide) { EmptyState(Icons.Rounded.EventBusy, "No upcoming holidays") }
                upcoming.forEach { HolidayRow(it, false) }
                if (past.isNotEmpty()) {
                    Label("Past")
                    past.take(10).forEach { HolidayRow(it, true) }
                }
            }
        }
    }
}

/* ── People directory (faculty / HOD / college-wide) ────────────── */

/**
 * Which filters appear is decided by the server from the signed-in account: a
 * faculty member gets search only (their teaching assignment); an HOD gets year,
 * section and role inside their own department. Every query is scoped again on
 * the server, so an out-of-scope value simply returns nothing.
 */
@Composable
fun PeopleScreen() {
    val config = Api.peopleFilters()
    var search by rememberSaveable { mutableStateOf("") }
    var department by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("") }
    var year by rememberSaveable { mutableStateOf("") }
    var section by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableStateOf(1) }
    val c = config.data
    val can = c["filters"].strings.ifEmpty { listOf("search") }.toSet()
    val q = Api.users(
        mapOf(
            "q" to search.trim().ifEmpty { null },
            "department" to (if ("department" in can) department.ifEmpty { null } else null),
            "role" to (if ("role" in can) role.ifEmpty { null } else null),
            "year" to (if ("year" in can) year.ifEmpty { null } else null),
            "section" to (if ("section" in can) section.ifEmpty { null } else null),
            "page" to page,
        ),
        skip = c == null,
    )
    fun reset(block: () -> Unit) { block(); page = 1 }

    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header(
            "People",
            when (c["scope"].str) {
                "assignment" -> "The students of the classes you teach."
                "department" -> "${c["department"].str ?: ""} — students and faculty of your department."
                else -> "Find students and faculty by name, department or skill."
            },
            back = true,
        )
        if (c == null) {
            if (config.error != null) ErrorState(config.error) { config.refetch() } else Loading()
            return@Screen
        }
        Card(Wide, gap = 10.dp) {
            Input(search, { reset { search = it } }, placeholder = "Search by name, skill or interest…")
            if ("department" in can) SelectField(null, department, listOf(Opt("", "All departments")) + c["departments"].strings.map { Opt(it, it) }, { reset { department = it } })
            if ("year" in can) {
                val years = c["years"].list.mapNotNull { it.int }.ifEmpty { listOf(1, 2, 3, 4) }
                ChipRow {
                    Chip("All years", year.isEmpty()) { reset { year = "" } }
                    years.forEach { y -> Chip(YEAR_LABELS[y] ?: "Year $y", year == "$y") { reset { year = "$y" } } }
                }
            }
            if ("section" in can) ChipRow {
                Chip("All sections", section.isEmpty()) { reset { section = "" } }
                c["sections"].strings.forEach { s -> Chip("Sec $s", section == s) { reset { section = s } } }
            }
            if ("role" in can) {
                val roles = c["roles"].strings.ifEmpty { ROLE_LABELS.keys.toList() }
                SelectField(null, role, listOf(Opt("", "All roles")) + roles.map { Opt(it, ROLE_LABELS[it] ?: it) }, { reset { role = it } })
            }
        }
        if (c["scope"].str == "assignment") RowCard(Wide, gap = 10.dp) {
            Icon(Icons.Rounded.Shield, null, Modifier.size(16.dp), tint = C.primary)
            Small("Your People list follows your teaching assignment — department, year, section and semester are set automatically.", Modifier.weight(1f))
        }
        val items = q.data["items"].list
        when {
            q.data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            q.data == null -> Loading()
            items.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.Group, "No people found", "Try a different search or filter.") }
            else -> items.forEach { u ->
                RowCard(Wide, onClick = { Nav.push("/people/${u.id}") }) {
                    Avatar(u, size = 46.dp)
                    Column(Modifier.weight(1f)) {
                        Strong(u["name"].str, maxLines = 1)
                        Small(
                            listOfNotNull(ROLE_LABELS[u.role], u["department"].text, u["year"].text?.let { "Year $it" }, u["section"].text?.let { "Sec $it" }, u["rollNo"].text)
                                .joinToString(" · "),
                            maxLines = 1,
                        )
                    }
                }
            }
        }
        val pages = q.data["pages"].int ?: 1
        if (pages > 1) Row(Wide, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Button("Previous", { page-- }, variant = Variant.Soft, small = true, enabled = page > 1)
            Small("Page $page of $pages")
            Button("Next", { page++ }, variant = Variant.Soft, small = true, enabled = page < pages)
        }
    }
}

