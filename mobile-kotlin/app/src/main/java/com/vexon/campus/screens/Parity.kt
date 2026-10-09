package com.vexon.campus.screens

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AttachFile
import androidx.compose.material.icons.rounded.Bed
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.DoorFront
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.EventAvailable
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.LinkOff
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.vexon.campus.core.Api
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.Omit
import com.vexon.campus.core.ServerConfig
import com.vexon.campus.core.bool
import com.vexon.campus.core.errMsg
import com.vexon.campus.core.get
import com.vexon.campus.core.id
import com.vexon.campus.core.int
import com.vexon.campus.core.jsonOf
import com.vexon.campus.core.list
import com.vexon.campus.core.num
import com.vexon.campus.core.rememberMutation
import com.vexon.campus.core.sameId
import com.vexon.campus.core.str
import com.vexon.campus.core.text
import com.vexon.campus.nav.Nav
import com.vexon.campus.ui.Avatar
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.Body
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.DateField
import com.vexon.campus.ui.DateTimeField
import com.vexon.campus.ui.DialogButton
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.H3
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.IconButton
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.Opt
import com.vexon.campus.ui.PickerField
import com.vexon.campus.ui.STUDENT_ROLES
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.SectionTitle
import com.vexon.campus.ui.Segmented
import com.vexon.campus.ui.Sheet
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.StatusBadge
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Variant
import com.vexon.campus.ui.nowMinute
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit

/*
 * Screens that the web app has and the Android app did not: OD & Leave,
 * Hostel, Class In-Charge students, mass outpass, bind groups and Campus SOS.
 * Same endpoints as the web; every rule is enforced by the server — these
 * screens only hide actions a role cannot take.
 */

private const val MAX_UPLOAD_BYTES = 5L * 1024 * 1024
private val DOCUMENT_TYPES = arrayOf("image/*", "application/pdf")

/* ── Attach a supporting document (photo or PDF) ─────────────────── */

/**
 * Pick an image or PDF, upload it as a document and report { url, name, mimeType }.
 * The server checks the real file type from its bytes before storing it.
 */
@Composable
fun AttachDocument(label: String, value: JsonElement?, onChange: (JsonElement?) -> Unit, required: Boolean = false, error: String? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var uploading by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val size = withContext(Dispatchers.IO) {
                context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst()) c.getLong(0) else null }
            }
            if (size != null && size > MAX_UPLOAD_BYTES) {
                Dialogs.alert("File too large", "Please choose a file under 5 MB.")
                return@launch
            }
            uploading = true
            try {
                onChange(Api.uploadDocument(uri))
            } catch (e: Exception) {
                Dialogs.alert("Upload failed", errMsg(e, "Could not upload the document"))
            } finally {
                uploading = false
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Label(label + if (required) " *" else " (optional)")
        if (value != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Rounded.Description, null, Modifier.size(16.dp), tint = C.primary)
                Small(value["name"].text ?: "Attachment", Modifier.weight(1f), maxLines = 1)
                IconButton(Icons.Rounded.Close, "Remove attachment") { onChange(null) }
            }
        } else {
            Button(if (uploading) "Uploading…" else "Attach photo or PDF", { picker.launch(DOCUMENT_TYPES) }, variant = Variant.Soft, icon = Icons.Rounded.AttachFile, small = true, loading = uploading)
        }
        if (error != null) Small(error, color = C.danger)
    }
}

/** The part of an upload result the API stores as an attachment. */
fun docBody(d: JsonElement?): Any = if (d == null) Omit else mapOf("url" to d["url"].str, "name" to d["name"].str, "mimeType" to d["mimeType"].str)

@Composable
private fun DocLink(doc: JsonElement?) {
    val url = doc["url"].text ?: return
    val context = LocalContext.current
    Button(doc["name"].text ?: "Supporting document", { openUrl(context, ServerConfig.assetUrl(url)) }, variant = Variant.Ghost, icon = Icons.Rounded.Description, small = true)
}

/* ── OD & Leave ─────────────────────────────────────────────────── */

private val OD_CATEGORIES = listOf(
    "Academic Conference / Seminar", "Paper Presentation", "Technical Symposium", "Sports Tournament / Meet", "Cultural Event / Fest",
    "Hackathon / Project Expo", "Industrial Visit / Workshop", "Official College Representation", "Other",
)
private val LEAVE_CATEGORIES = listOf("Medical / Sick Leave", "Personal / Family Reason", "Out of Station", "Family Function / Event", "Emergency", "Other")
private val OD_STATUS_LABEL = mapOf("pending_faculty" to "waiting: class in-charge", "pending_hod" to "waiting: HOD", "pending_principal" to "waiting: principal")
private val OD_STAGE_NAME = mapOf("faculty" to "class in-charge", "hod" to "HOD", "principal" to "principal")
private val OD_MY_STAGE = mapOf("faculty" to "pending_faculty", "hod" to "pending_hod", "principal" to "pending_principal")
private val OD_REVIEW_ROLES = setOf("faculty", "hod", "principal", "admin")

data class Cutoff(val danger: Boolean, val message: String)

/**
 * OD / Leave cut-off hint, the same rule the server enforces: the start day is
 * at least tomorrow, and a request for tomorrow goes in before 5:00 PM today.
 */
fun odLeaveCutoff(from: LocalDate, now: LocalDateTime = LocalDateTime.now()): Cutoff? {
    val days = ChronoUnit.DAYS.between(now.toLocalDate(), from)
    return when {
        days <= 0 -> Cutoff(true, "Requests cannot be made for today or past dates — apply at least 1 day in advance, before 5:00 PM.")
        days == 1L && now.hour >= 17 -> Cutoff(true, "The 5:00 PM cut-off for tomorrow has passed.")
        days == 1L -> Cutoff(false, "Requests for tomorrow must be sent before 5:00 PM today.")
        else -> null
    }
}

private fun odRange(r: JsonElement): String {
    val from = r["fromDate"].str.orEmpty().take(10)
    val to = r["toDate"].str.orEmpty().take(10)
    val n = r["daysCount"].int ?: 1
    return (if (from == to) Fmt.classDay(from) else "${Fmt.classDay(from)} → ${Fmt.classDay(to)}") + " · $n day${if (n == 1) "" else "s"}"
}

@Composable
private fun OdTypeBadge(type: String?) = Badge(if (type == "od") "On Duty (OD)" else "Leave", if (type == "od") Tone.Info else Tone.Warning)

@Composable
private fun OdStatus(status: String?) = StatusBadge(if (status?.startsWith("pending_") == true) "pending" else status, OD_STATUS_LABEL[status] ?: status)

@Composable
fun OdLeaveScreen() {
    val role = me().role
    when {
        role in STUDENT_ROLES -> StudentOdLeave()
        role in OD_REVIEW_ROLES -> OdLeaveReviews()
        else -> Screen {
            Header("OD & Leave", back = true)
            Card(Wide) { EmptyState(Icons.Rounded.EventAvailable, "Not available for your role") }
        }
    }
}

@Composable
private fun OdApplyForm(onDone: () -> Unit) {
    val tomorrow = LocalDate.now().plusDays(1)
    var type by rememberSaveable { mutableStateOf("od") }
    var from by rememberSaveable { mutableStateOf(tomorrow) }
    var to by rememberSaveable { mutableStateOf(tomorrow) }
    var category by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var doc by remember { mutableStateOf<JsonElement?>(null) }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }
    val create = rememberMutation()
    val cutoff = odLeaveCutoff(from)

    fun submit() {
        val e = mutableMapOf<String, String>()
        if (category.isEmpty()) e["category"] = "Select a category"
        if (description.trim().length < 5) e["description"] = "At least 5 characters"
        if (to.isBefore(from)) e["to"] = "Cannot be before the start date"
        if (type == "od" && doc == null) e["doc"] = "A supporting document is compulsory for On Duty"
        errors = e
        if (e.isNotEmpty() || cutoff?.danger == true) return
        create.launch(onError = { Dialogs.alert("Could not submit", errMsg(it)) }) {
            Api.createOdLeave(jsonOf(
                "requestType" to type, "category" to category, "fromDate" to from.toString(), "toDate" to to.toString(),
                "description" to description.trim(), "document" to docBody(doc),
            ))
            Dialogs.alert("Request sent", "Your class in-charge reviews it first, then the HOD and the principal.")
            onDone()
        }
    }

    Card(Wide, gap = 14.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("On Duty (OD)", type == "od") { type = "od"; category = "" }
            Chip("Leave", type == "leave") { type = "leave"; category = "" }
        }
        Small(
            (if (type == "od") "Approved OD counts as Present for every period." else "Approved Leave marks scheduled periods Absent with an authorised Leave record.") +
                " Goes Class In-Charge → HOD → Principal.",
        )
        if (cutoff != null) Row(
            Wide.clip(RoundedCornerShape(14.dp)).background(if (cutoff.danger) C.dangerSoft else C.warningSoft).padding(10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Rounded.Warning, null, Modifier.size(16.dp), tint = if (cutoff.danger) C.danger else C.amberText)
            Small(cutoff.message, Modifier.weight(1f), color = if (cutoff.danger) C.roseText else C.amberText)
        }
        DateField("From date", from, { from = it; if (to.isBefore(it)) to = it }, min = tomorrow)
        DateField("To date", to, { to = it }, min = from, error = errors["to"])
        PickerField("Category", category, { category = it }, if (type == "od") OD_CATEGORIES else LEAVE_CATEGORIES, "Select category", errors["category"])
        Input(description, { description = it }, label = "Description", multiline = true, maxLength = 1000, placeholder = "Explain the reason", error = errors["description"])
        AttachDocument("Supporting document", doc, { doc = it }, required = type == "od", error = errors["doc"])
        Button("Submit request", ::submit, Wide, loading = create.isLoading, enabled = cutoff?.danger != true)
    }
}

@Composable
private fun StudentOdLeave() {
    var applying by rememberSaveable { mutableStateOf(false) }
    var type by rememberSaveable { mutableStateOf("") }
    val q = Api.myOdLeave(mapOf("limit" to 30, "requestType" to type.ifEmpty { null }), pollMs = 30_000)
    val cancel = rememberMutation()
    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header("OD & Leave", "Apply in advance — before 5 PM the day before.", back = true, right = if (!applying) ({
            Button("Apply", { applying = true }, icon = Icons.Rounded.Add, small = true)
        }) else null)
        if (applying) {
            OdApplyForm { applying = false }
            Button("Close form", { applying = false }, Wide, variant = Variant.Ghost)
        }
        Segmented(listOf(Opt("", "All"), Opt("od", "OD"), Opt("leave", "Leave")), type, { type = it })
        val data = q.data
        when {
            data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            data == null -> Loading()
            data["requests"].list.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.EventAvailable, "No requests yet", "Apply for On Duty or Leave and track every approval stage here.") }
            else -> data["requests"].list.forEach { r ->
                val status = r["status"].str.orEmpty()
                val canCancel = status.startsWith("pending_") || (status == "approved" && r["requestType"].str == "od")
                Card(Wide, gap = 8.dp) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        OdTypeBadge(r["requestType"].str)
                        OdStatus(status)
                    }
                    Strong(r["category"].str)
                    Small(odRange(r))
                    Small("“${r["description"].str.orEmpty()}”")
                    DocLink(r["document"])
                    r["rejectedReason"].text?.let { reason ->
                        if (status == "rejected") Small("Rejected${r["rejectedStage"].str?.let { " by ${OD_STAGE_NAME[it] ?: it}" } ?: ""}: “$reason”", color = C.danger)
                    }
                    if (canCancel) Button("Cancel request", {
                        Dialogs.confirm(
                            "Cancel this request?",
                            if (status == "approved") "Your OD attendance credit for these days will be removed." else "The request is withdrawn immediately.",
                            "Cancel request", destructive = true,
                        ) { cancel.launch(onError = { Dialogs.alert("Could not cancel", errMsg(it)) }) { Api.cancelOdLeave(r.id.orEmpty()) } }
                    }, variant = Variant.Danger, small = true, loading = cancel.isLoading)
                }
            }
        }
    }
}

@Composable
private fun OdLeaveReviews() {
    val me = me()
    val role = me.role
    var status by rememberSaveable { mutableStateOf(OD_MY_STAGE[role] ?: "") }
    val q = Api.odLeaveReviews(mapOf("limit" to 30, "status" to status.ifEmpty { null }), pollMs = 30_000)
    val review = rememberMutation()
    val principal = role in setOf("principal", "admin")

    fun act(r: JsonElement, action: String, reason: String? = null) = review.launch(onError = { Dialogs.alert("Could not update", errMsg(it)) }) {
        Api.reviewOdLeave(r.id.orEmpty(), jsonOf("action" to action, "reason" to (reason?.takeIf { it.isNotBlank() } ?: Omit)))
        Dialogs.alert(
            when (action) { "reject" -> "Rejected"; "approve" -> "Approved"; else -> "Forwarded" },
            if (action == "approve") "Attendance has been updated for these days." else null,
        )
    }
    fun canAct(r: JsonElement): Boolean {
        val s = r["status"].str.orEmpty()
        return if (role == "admin") s.startsWith("pending_") else s == OD_MY_STAGE[role]
    }

    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header("OD & Leave", when (role) { "faculty" -> "Requests from your class"; "hod" -> "Forwarded by class in-charges"; else -> "Final approval" }, back = true)
        Segmented(
            buildList {
                OD_MY_STAGE[role]?.let { add(Opt(it, "To review")) }
                add(Opt("", "All")); add(Opt("approved", "Approved")); add(Opt("rejected", "Rejected"))
            },
            status, { status = it },
        )
        val data = q.data
        when {
            data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            data == null -> Loading()
            data["requests"].list.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.CheckCircle, "Nothing here", "New requests appear here as students send them.") }
            else -> data["requests"].list.forEach { r ->
                val s = r["student"]
                Card(Wide, gap = 8.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Avatar(s, size = 40.dp)
                        Column(Modifier.weight(1f)) {
                            Strong(s["name"].str, maxLines = 1)
                            Small("${s["rollNo"].str ?: "—"} · ${r["department"].str ?: ""} · Y${r["year"].str ?: ""} · Sec ${r["section"].str ?: ""}", maxLines = 1)
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        OdTypeBadge(r["requestType"].str)
                        OdStatus(r["status"].str)
                    }
                    Strong(r["category"].str)
                    Small(odRange(r))
                    Small("“${r["description"].str.orEmpty()}”")
                    DocLink(r["document"])
                    if (canAct(r)) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (principal) Button("Approve", { act(r, "approve") }, Modifier.weight(1f), variant = Variant.Success, small = true, loading = review.isLoading)
                        else Button(if (role == "faculty") "Forward to HOD" else "Forward to Principal", { act(r, "forward") }, Modifier.weight(1f), small = true, loading = review.isLoading)
                        Button("Reject", {
                            Dialogs.prompt("Reject request", "Reason (shared with the student, 3+ characters)", "Reason", "Reject", required = true) { act(r, "reject", it) }
                        }, Modifier.weight(1f), variant = Variant.Danger, small = true, loading = review.isLoading)
                    }
                }
            }
        }
    }
}

/* ── Hostel ─────────────────────────────────────────────────────── */

val HOSTEL_ROLES = setOf("admin", "principal", "dean", "ao", "chairman", "warden")

@Composable
fun HostelScreen() {
    val me = me()
    val allowed = me.role in HOSTEL_ROLES
    var gender by rememberSaveable { mutableStateOf("") }
    var status by rememberSaveable { mutableStateOf("outside") }
    var q by rememberSaveable { mutableStateOf("") }
    val summary = Api.hostelSummary(skip = !allowed, pollMs = 60_000)
    val list = Api.hostelStudents(mapOf("status" to status, "gender" to gender.ifEmpty { null }, "q" to q.trim().ifEmpty { null }, "limit" to 100), skip = !allowed)
    val context = LocalContext.current
    if (!allowed) {
        Screen {
            Header("Hostel", back = true)
            Card(Wide) { EmptyState(Icons.Rounded.Bed, "Not available for your role") }
        }
        return
    }
    Screen(refreshing = summary.isFetching || list.isFetching, onRefresh = { summary.refetch(); list.refetch() }) {
        Header("Hostel", "Who is inside and outside campus right now.", back = true)
        Segmented(listOf(Opt("", "Everyone"), Opt("male", "Boys"), Opt("female", "Girls")), gender, { gender = it })
        val s = summary.data
        when {
            s == null && summary.error != null -> ErrorState(summary.error) { summary.refetch() }
            s == null -> Loading()
            else -> {
                val counts = when (gender) { "male" -> s["boys"]; "female" -> s["girls"]; else -> s }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    listOf(Triple("all", "Hostelers", counts["total"]), Triple("inside", "Inside", counts["inside"]), Triple("outside", "Outside", counts["outside"])).forEach { (value, label, n) ->
                        Card(Modifier.weight(1f), onClick = { status = value }, border = if (status == value) C.primary else C.border, horizontalAlignment = Alignment.CenterHorizontally, gap = 2.dp) {
                            Label(label)
                            H2(num(n))
                        }
                    }
                }
            }
        }
        Input(q, { q = it }, placeholder = "Search name or roll no.", maxLength = 60)
        val d = list.data
        when {
            d == null && list.error != null -> ErrorState(list.error) { list.refetch() }
            d == null -> Loading()
            d["students"].list.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.Bed, if (status == "outside") "Everyone is on campus" else "No hostelers found") }
            else -> {
                val rows = d["students"].list
                if ((d["total"].int ?: 0) > rows.size) Small("Showing ${rows.size} of ${d["total"].int} — search to narrow down.")
                rows.forEach { st ->
                    Card(Wide, gap = 6.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Avatar(st, size = 38.dp)
                            Column(Modifier.weight(1f)) {
                                Strong(st["name"].str, maxLines = 1)
                                Small(
                                    "${st["rollNo"].str ?: "—"} · ${st["department"].str ?: ""}" + (st["year"].text?.let { " · Y$it" } ?: "") + (st["section"].text?.let { " · Sec $it" } ?: ""),
                                    maxLines = 1,
                                )
                            }
                            st["phone"].text?.let { phone ->
                                IconButton(Icons.Rounded.Phone, "Call ${st["name"].str ?: ""}", C.primary) { openUrl(context, "tel:${phone.filter { it.isDigit() || it == '+' }}") }
                            }
                        }
                        if (status == "outside") FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Small("Left ${Fmt.dateTime(st["leftAt"])}")
                            st["returnBy"].text?.let { Badge("due ${Fmt.classDay(it)}", Tone.Info) }
                        }
                    }
                }
            }
        }
    }
}

/* ── Class In-Charge: students of my class ──────────────────────── */

fun isClassInCharge(user: JsonElement?): Boolean =
    user.role == "faculty" && user["section"].text != null && user["inChargeYear"].text != null && user["inChargeSemester"].text != null

private fun digits10(v: String) = v.filter { it.isDigit() }.takeLast(10)
private fun strongPassword(p: String) = p.length in 8..72 && p.any { it.isLetter() } && p.any { it.isDigit() }

@Composable
private fun ChoiceRow(label: String, options: List<Pair<String, String>>, value: String, onChange: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Label(label)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { options.forEach { (v, l) -> Chip(l, value == v) { onChange(v) } } }
    }
}

@Composable
private fun AddStudentSheet(onClose: () -> Unit) {
    var title by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var rollNo by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var stayType by remember { mutableStateOf("") }
    var parentPhone by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    val create = rememberMutation()
    fun submit() {
        val problem = when {
            title.isEmpty() -> "Choose Mr or Ms"
            name.trim().length < 2 -> "Enter the student’s name"
            !Regex("^\\S+@\\S+\\.\\S+$").matches(email.trim()) -> "Enter a valid college email"
            rollNo.isBlank() -> "Roll number is required"
            !strongPassword(password) -> "Password: 8–72 characters with a letter and a number"
            stayType.isEmpty() -> "Select hosteler or day scholar"
            digits10(parentPhone).length != 10 -> "Parent's mobile must be 10 digits"
            phone.isNotBlank() && digits10(phone).length != 10 -> "Student mobile must be 10 digits"
            phone.isNotBlank() && digits10(phone) == digits10(parentPhone) -> "Student mobile number and parent mobile number cannot be the same"
            else -> null
        }
        if (problem != null) { Dialogs.alert("Check the form", problem); return }
        create.launch(onError = { Dialogs.alert("Could not add student", errMsg(it)) }) {
            Api.createClassStudent(jsonOf(
                "title" to title, "gender" to (if (title == "Mr") "male" else "female"), "name" to name.trim(), "email" to email.trim(),
                "rollNo" to rollNo.trim(), "password" to password, "stayType" to stayType, "parentPhone" to parentPhone,
                "phone" to (phone.ifBlank { null } ?: Omit),
            ))
            Dialogs.alert("Student added", "Share the password with the student — they can change it after signing in.")
            onClose()
        }
    }
    Sheet("Add a student", onClose, footer = { Button("Add student", ::submit, Wide, icon = Icons.Rounded.Add, loading = create.isLoading) }) {
        ChoiceRow("Title", listOf("Mr" to "Mr", "Ms" to "Ms"), title) { title = it }
        Input(name, { name = it }, label = "Full name", maxLength = 80)
        Input(email, { email = it }, label = "College email", keyboardType = KeyboardType.Email)
        Input(rollNo, { rollNo = it.uppercase() }, label = "Roll number", maxLength = 30)
        Input(password, { password = it }, label = "Password", password = true, hint = "8+ characters with a letter and a number")
        ChoiceRow("Stay", listOf("hosteler" to "Hosteler", "day_scholar" to "Day scholar"), stayType) { stayType = it }
        Input(parentPhone, { parentPhone = it }, label = "Parent's mobile", keyboardType = KeyboardType.Phone, maxLength = 14, hint = "Gate pass OTPs go to this number")
        Input(phone, { phone = it }, label = "Student mobile (optional)", keyboardType = KeyboardType.Phone, maxLength = 14)
    }
}

@Composable
private fun EditStudentSheet(student: JsonElement, onClose: () -> Unit) {
    // The class list carries no phone numbers; load them for this one student before editing.
    val q = Api.classStudent(student.id.orEmpty())
    val detail = q.data
    var stayType by remember { mutableStateOf("") }
    var parentPhone by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    LaunchedEffect(detail) {
        if (detail == null) return@LaunchedEffect
        stayType = detail["stayType"].str.orEmpty()
        parentPhone = detail["parentPhone"].str.orEmpty()
        phone = detail["phone"].str.orEmpty()
    }
    val save = rememberMutation()
    fun submit() {
        if (digits10(parentPhone).length != 10) { Dialogs.alert("Parent's mobile must be 10 digits"); return }
        if (phone.isNotBlank() && digits10(phone).length != 10) { Dialogs.alert("Student mobile must be 10 digits"); return }
        if (phone.isNotBlank() && digits10(phone) == digits10(parentPhone)) { Dialogs.alert("Student mobile number and parent mobile number cannot be the same"); return }
        save.launch(onError = { Dialogs.alert("Could not save", errMsg(it)) }) {
            Api.updateClassStudent(student.id.orEmpty(), jsonOf("parentPhone" to parentPhone, "phone" to phone, "stayType" to (stayType.ifEmpty { null } ?: Omit)))
            onClose()
        }
    }
    Sheet("Edit ${student["name"].str ?: ""}", onClose, footer = {
        Button("Save", ::submit, Wide, loading = save.isLoading || (detail == null && q.error == null), enabled = detail != null)
    }) {
        if (q.error != null) ErrorState(q.error) { q.refetch() }
        ChoiceRow("Stay", listOf("hosteler" to "Hosteler", "day_scholar" to "Day scholar"), stayType) { stayType = it }
        Input(parentPhone, { parentPhone = it }, label = "Parent's mobile", keyboardType = KeyboardType.Phone, maxLength = 14)
        Input(phone, { phone = it }, label = "Student mobile (optional)", keyboardType = KeyboardType.Phone, maxLength = 14, hint = "Leave empty to clear it")
    }
}

@Composable
private fun ResetPasswordSheet(student: JsonElement, onClose: () -> Unit) {
    var pw by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    val reset = rememberMutation()
    fun submit() {
        if (!strongPassword(pw)) { Dialogs.alert("Password: 8–72 characters with a letter and a number"); return }
        if (pw != confirm) { Dialogs.alert("Passwords do not match"); return }
        reset.launch(onError = { Dialogs.alert("Could not reset", errMsg(it)) }) {
            Api.resetUserPassword(student.id.orEmpty(), jsonOf("newPassword" to pw, "confirmPassword" to confirm))
            Dialogs.alert("Password reset", "The student is signed out of every device and must use the new password.")
            onClose()
        }
    }
    Sheet("Reset password · ${student["name"].str ?: ""}", onClose, footer = { Button("Reset password", ::submit, Wide, variant = Variant.Danger, icon = Icons.Rounded.Key, loading = reset.isLoading) }) {
        Input(pw, { pw = it }, label = "New password", password = true)
        Input(confirm, { confirm = it }, label = "Confirm password", password = true)
    }
}

@Composable
fun ClassStudentsScreen() {
    val me = me()
    val allowed = isClassInCharge(me)
    val q = Api.classStudents(skip = !allowed)
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<JsonElement?>(null) }
    var resetting by remember { mutableStateOf<JsonElement?>(null) }
    var search by rememberSaveable { mutableStateOf("") }
    if (!allowed) {
        Screen {
            Header("My class", back = true)
            Card(Wide) { EmptyState(Icons.Rounded.Groups, "For Class In-Charge faculty only", "Ask the administrator to assign you a class.") }
        }
        return
    }
    val data = q.data
    val scope = data["scope"]
    val needle = search.trim().lowercase()
    val items = data["items"].list.filter { needle.isEmpty() || it["name"].str.orEmpty().lowercase().contains(needle) || it["rollNo"].str.orEmpty().lowercase().contains(needle) }
    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header(
            "My class",
            if (scope["department"].text != null) "${scope["department"].str} · Year ${scope["year"].str} · Sec ${scope["section"].str} · Sem ${scope["semester"].str}" else "Students of your class",
            back = true,
            right = { Button("Add", { adding = true }, icon = Icons.Rounded.Add, small = true) },
        )
        Input(search, { search = it }, placeholder = "Search name or roll no.")
        when {
            data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            data == null -> Loading()
            items.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.Groups, if (needle.isNotEmpty()) "No students match" else "No students yet", if (needle.isEmpty()) "Add your class’s student logins here." else null) }
            else -> {
                Small("${items.size} student${if (items.size == 1) "" else "s"}")
                items.forEach { s ->
                    Card(Wide, gap = 8.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Avatar(s, size = 38.dp)
                            Column(Modifier.weight(1f)) {
                                Strong(s["name"].str, maxLines = 1)
                                Small("${s["rollNo"].str ?: "—"} · ${s["email"].str ?: ""}", maxLines = 1)
                            }
                            s["stayType"].text?.let { Badge(if (it == "hosteler") "Hosteler" else "Day scholar", if (it == "hosteler") Tone.Info else Tone.Neutral) }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button("Edit", { editing = s }, Modifier.weight(1f), variant = Variant.Soft, icon = Icons.Rounded.Edit, small = true)
                            Button("Reset password", { resetting = s }, Modifier.weight(1f), variant = Variant.Outline, icon = Icons.Rounded.Key, small = true)
                        }
                    }
                }
            }
        }
    }
    if (adding) AddStudentSheet { adding = false }
    editing?.let { EditStudentSheet(it) { editing = null } }
    resetting?.let { ResetPasswordSheet(it) { resetting = null } }
}

/* ── Principal: institutional mass outpass ──────────────────────── */

@Composable
fun MassOutpassScreen() {
    val me = me()
    val isPrincipal = me.role == "principal"
    val dash = Api.gateDashboard(skip = !isPrincipal)
    val approve = rememberMutation()
    var from by remember { mutableStateOf(nowMinute()) }
    var to by remember { mutableStateOf(nowMinute().plusDays(3)) }
    var regarding by rememberSaveable { mutableStateOf("home") }
    var area by rememberSaveable { mutableStateOf("Home / Native") }
    var district by rememberSaveable { mutableStateOf("") }
    var state by rememberSaveable { mutableStateOf("Tamil Nadu") }
    var description by rememberSaveable { mutableStateOf("") }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }
    if (!isPrincipal) {
        Screen {
            Header("Mass outpass", back = true)
            Card(Wide) { EmptyState(Icons.Rounded.DoorFront, "Only the principal can authorise a mass outpass") }
        }
        return
    }
    val summary = dash.data["hostelSummary"]
    fun submit() {
        val e = mutableMapOf<String, String>()
        if (description.trim().length < 3) e["description"] = "At least 3 characters"
        if (!to.isAfter(from)) e["to"] = "Return must be after departure"
        else if (ChronoUnit.DAYS.between(from, to) >= 30) e["to"] = "A gate pass can cover at most 30 days"
        if (area.isBlank()) e["area"] = "Required"
        errors = e
        if (e.isNotEmpty()) return
        Dialogs.confirm(
            "Authorise mass outpass?",
            "Every eligible hosteler inside campus${summary["inside"].text?.let { " ($it)" } ?: ""} gets an approved gate pass. Their pending requests are replaced.",
            "Authorise",
        ) {
            approve.launch(onError = { Dialogs.alert("Could not authorise", errMsg(it)) }) {
                val res = Api.massApproveGatePass(jsonOf(
                    "fromDate" to Fmt.isoInstant(from), "toDate" to Fmt.isoInstant(to), "regarding" to regarding, "description" to description.trim(),
                    "destination" to mapOf("area" to area.trim(), "district" to district.trim(), "state" to state.trim()),
                ))
                Dialogs.alert("Done", res["message"].text ?: "Authorised ${res["count"].str ?: ""} outpass(es).")
                Nav.back()
            }
        }
    }
    Screen {
        Header("Mass outpass", "Pre-approved passes for hostelers — no student request needed.", back = true)
        if (summary != null) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf("Inside" to summary["inside"], "Outside" to summary["outside"], "Hostelers" to summary["total"]).forEach { (l, v) ->
                Card(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, gap = 2.dp) { Label(l); H2(num(v)) }
            }
        }
        Card(Wide, gap = 14.dp) {
            DateTimeField("Departure", from, { from = it }, min = nowMinute())
            DateTimeField("Return due", to, { to = it }, min = from, error = errors["to"])
            ChoiceRow("Regarding", listOf("home" to "Home / Vacation", "outing" to "Outing / Event"), regarding) { regarding = it }
            Input(area, { area = it }, label = "Destination area", maxLength = 120, error = errors["area"])
            Input(district, { district = it }, label = "District", maxLength = 120, placeholder = "Optional")
            Input(state, { state = it }, label = "State", maxLength = 120)
            Input(description, { description = it }, label = "Purpose", multiline = true, maxLength = 500, placeholder = "e.g. Pongal festival holidays", error = errors["description"])
            Button("Authorise mass outpass${summary["inside"].text?.let { " ($it eligible)" } ?: ""}", ::submit, Wide, icon = Icons.Rounded.CheckCircle, loading = approve.isLoading)
        }
    }
}

/* ── Bind groups (bulk gate-pass approval) ──────────────────────── */

private val GROUP_LABEL = mapOf("open" to "Draft", "pending_hod" to "Waiting on HOD", "pending_principal" to "Waiting on principal", "approved" to "Approved", "rejected" to "Rejected")
private val GROUP_TONE = mapOf("open" to Tone.Neutral, "pending_hod" to Tone.Warning, "pending_principal" to Tone.Warning, "approved" to Tone.Success, "rejected" to Tone.Danger)
private val MEMBER_LABEL = mapOf("parent_verified" to "parent verified", "pending_hod" to "waiting: HOD", "pending_principal" to "waiting: principal")
val BIND_ROLES = setOf("faculty", "hod", "principal", "admin")

@Composable
private fun CreateBindGroup() {
    var title by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    val create = rememberMutation()
    val valid = title.trim().length >= 2 && name.trim().length >= 2 && reason.trim().length >= 5
    Card(Wide, gap = 10.dp) {
        H3("Create a bind group")
        Small("Group students from your class leaving for the same reason and send them to the HOD together.")
        Input(title, { title = it }, label = "Title", maxLength = 120, placeholder = "e.g. Pongal holidays")
        Input(name, { name = it }, label = "Group name", maxLength = 80, placeholder = "e.g. III CSE-A · Pongal batch")
        Input(reason, { reason = it }, label = "Reason", multiline = true, maxLength = 500, placeholder = "Why these students are leaving (5+ characters)")
        Button("Create bind group", {
            create.launch(onError = { Dialogs.alert("Could not create", errMsg(it)) }) {
                Api.createBindGroup(jsonOf("title" to title.trim(), "name" to name.trim(), "reason" to reason.trim()))
                title = ""; name = ""; reason = ""
                Dialogs.alert("Bind group created", "Bind parent-verified requests to it from the Review tab.")
            }
        }, Wide, icon = Icons.Rounded.Add, loading = create.isLoading, enabled = valid)
    }
}

@Composable
private fun BindGroupCard(group: JsonElement, me: JsonElement, defaultOpen: Boolean) {
    var open by rememberSaveable(group.id) { mutableStateOf(defaultOpen) }
    val busy = rememberMutation()
    val role = me.role
    val status = group["status"].str.orEmpty()
    val id = group.id.orEmpty()
    val members = group["members"].list
    val canBuild = status == "open" && (sameId(group["createdBy"], me) || role == "admin")
    val canHod = status == "pending_hod" && role in setOf("hod", "admin")
    val canPrincipal = status == "pending_principal" && role in setOf("principal", "admin")
    val ready = members.count { it["status"].str == "parent_verified" }
    val waiting = members.count { it["status"].str == status }
    val counts = group["counts"]

    fun run(ok: String?, block: suspend () -> Unit) = busy.launch(onError = { Dialogs.alert("Could not update", errMsg(it)) }) {
        block()
        if (ok != null) Dialogs.alert(ok)
    }
    fun rejectGroup() = Dialogs.prompt("Reject the entire group", "Reason (shared with the students)", "Optional", "Reject") { reason ->
        val body = jsonOf("action" to "reject", "reason" to (reason.ifBlank { null } ?: Omit))
        run("Group rejected") { if (status == "pending_hod") Api.hodReviewBindGroup(id, body) else Api.principalReviewBindGroup(id, body) }
    }

    Card(Wide, gap = 10.dp) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Rounded.Groups, null, Modifier.size(20.dp), tint = C.primary)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Strong(group["name"].str)
                Badge(GROUP_LABEL[status] ?: status, GROUP_TONE[status] ?: Tone.Neutral)
                Small("${group["title"].str ?: ""} · ${group["reason"].str ?: ""}")
                val total = counts["total"].int ?: members.size
                Small(
                    (if (group["department"].text != null) "${group["department"].str} · Year ${group["year"].str} · Sec ${group["section"].str}" else "Class is set by the first student you bind") +
                        " · $total student${if (total == 1) "" else "s"}" + (group["createdBy"]["name"].text?.let { " · by $it" } ?: "") + " · ${Fmt.timeAgo(group["updatedAt"])}",
                    color = C.muted,
                )
            }
            Button(if (open) "Hide" else "Show", { open = !open }, variant = Variant.Ghost, small = true)
        }
        if (status == "approved") Small(
            "QR codes ready: ${counts["codesIssued"].int ?: 0} / ${counts["approved"].int ?: 0}" + ((counts["codesWaiting"].int ?: 0).takeIf { it > 0 }?.let { " · $it being generated" } ?: ""),
            color = C.emeraldText,
        )
        if (status == "rejected") group["rejectedReason"].text?.let { Small("Rejected: “$it”", color = C.danger) }
        if (open) {
            if (members.isEmpty()) Small("No students yet. In the Review tab, verify a student’s parent OTP, then tap Bind.")
            members.forEach { m ->
                val s = m["student"]
                val mStatus = m["status"].str
                val code = m["codeIssue"]
                Column(Modifier.fillMaxWidth().padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column(Modifier.weight(1f)) {
                            Strong(s["name"].str, maxLines = 1)
                            Small("${s["rollNo"].str ?: "—"} · ${s["department"].str ?: "—"} · Y${s["year"].str ?: "—"} · Sec ${s["section"].str ?: "—"}", maxLines = 1)
                        }
                        when {
                            mStatus == "approved" && code["state"].str == "issued" -> Badge("QR ready", Tone.Success)
                            mStatus == "approved" && code["state"].str in setOf("queued", "processing") -> Badge("QR at ${Fmt.dateTime(code["scheduledAt"])}", Tone.Info)
                            else -> StatusBadge(mStatus, MEMBER_LABEL[mStatus])
                        }
                    }
                    if (mStatus == "rejected") m["rejectedReason"].text?.let { Small("“$it”", color = C.danger) }
                    if (canBuild) Button("Unbind", { run(null) { Api.unbindGatePass(m.id.orEmpty()) } }, variant = Variant.Ghost, icon = Icons.Rounded.LinkOff, small = true, loading = busy.isLoading)
                    if ((canHod || canPrincipal) && mStatus == status) Button("Reject student", {
                        Dialogs.prompt("Reject this student", s["name"].str, "Reason (optional)", "Reject") { reason ->
                            run("Student rejected") { Api.rejectBindMember(id, m.id.orEmpty(), reason) }
                        }
                    }, variant = Variant.Danger, small = true)
                }
            }
        }
        if (canBuild) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button("Send to HOD${if (ready > 0) " ($ready)" else ""}", {
                Dialogs.confirm("Send this group to the HOD?", "$ready parent-verified student(s) move to the HOD together. You cannot add students afterwards.", "Send") {
                    run("Sent to the HOD") { Api.submitBindGroup(id) }
                }
            }, Modifier.weight(1f), icon = Icons.AutoMirrored.Rounded.Send, small = true, enabled = ready > 0, loading = busy.isLoading)
            Button("Delete", {
                Dialogs.confirm("Delete this bind group?", "Its requests go back to your Review queue.", "Delete", destructive = true) { run("Bind group deleted") { Api.deleteBindGroup(id) } }
            }, variant = Variant.Danger, icon = Icons.Rounded.Delete, small = true)
        }
        if (canHod || canPrincipal) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (canHod) Button("Forward to Principal", {
                Dialogs.confirm("Forward this group?", "$waiting student(s) go to the principal.", "Forward") {
                    run("Forwarded to the principal") { Api.hodReviewBindGroup(id, jsonOf("action" to "forward")) }
                }
            }, Modifier.weight(1f), icon = Icons.AutoMirrored.Rounded.ArrowForward, small = true, enabled = waiting > 0, loading = busy.isLoading)
            else Button("Approve all", {
                Dialogs.confirm("Approve every student in this group?", "$waiting student(s) are approved. QR codes are generated a few at a time.", "Approve") {
                    run("Approved") { Api.principalReviewBindGroup(id, jsonOf("action" to "approve")) }
                }
            }, Modifier.weight(1f), variant = Variant.Success, small = true, enabled = waiting > 0, loading = busy.isLoading)
            Button("Reject group", ::rejectGroup, Modifier.weight(1f), variant = Variant.Danger, small = true)
        }
    }
}

/** The Bind tab of the staff gate-pass screen. */
@Composable
fun BindPanel() {
    val me = me()
    val q = Api.bindGroups()
    fun actionable(g: JsonElement): Boolean {
        val s = g["status"].str
        return (s == "open" && (sameId(g["createdBy"], me) || me.role == "admin")) ||
            (s == "pending_hod" && me.role in setOf("hod", "admin")) ||
            (s == "pending_principal" && me.role in setOf("principal", "admin"))
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (me.role == "faculty") CreateBindGroup()
        val groups = q.data.list
        when {
            q.data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            q.data == null -> Loading()
            groups.isEmpty() -> Card(Wide) {
                EmptyState(Icons.Rounded.Link, "No bind groups", if (me.role == "faculty") "Create a group, then bind parent-verified requests to it from the Review tab." else "Groups sent to you appear here.")
            }
            else -> {
                val (pending, rest) = groups.partition(::actionable)
                pending.forEach { BindGroupCard(it, me, defaultOpen = me.role != "principal") }
                if (rest.isNotEmpty()) SectionTitle("Earlier groups")
                rest.forEach { BindGroupCard(it, me, defaultOpen = false) }
            }
        }
    }
}

/** Review card action: put a parent-verified request into one of my open groups. */
@Composable
fun BindButton(pass: JsonElement, onDone: () -> Unit) {
    var choosing by remember { mutableStateOf(false) }
    val bind = rememberMutation()
    val bound = pass["bindGroup"]
    if (bound != null && bound.id != null) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Badge("In group: ${bound["name"].text ?: "bind group"}", Tone.Info)
            Button("Unbind", {
                bind.launch(onError = { Dialogs.alert("Could not unbind", errMsg(it)) }) { Api.unbindGatePass(pass.id.orEmpty()); onDone() }
            }, variant = Variant.Ghost, icon = Icons.Rounded.LinkOff, small = true, loading = bind.isLoading)
        }
        return
    }
    Button("Bind", { choosing = true }, variant = Variant.Soft, icon = Icons.Rounded.Link, small = true)
    if (choosing) {
        val groups = Api.bindGroups(mapOf("status" to "open"))
        Sheet("Bind to a group", { choosing = false }) {
            Small(pass["student"]["name"].str)
            when {
                groups.data == null && groups.error != null -> ErrorState(groups.error) { groups.refetch() }
                groups.data == null -> Loading()
                groups.data.list.isEmpty() -> Small("You have no open bind groups. Create one in the Bind tab first.")
                else -> groups.data.list.forEach { g ->
                    Button("${g["name"].str ?: ""} — ${g["title"].str ?: ""} (${g["counts"]["total"].int ?: 0})", {
                        bind.launch(onError = { Dialogs.alert("Could not bind", errMsg(it)) }) {
                            Api.bindGatePass(pass.id.orEmpty(), g.id.orEmpty())
                            choosing = false
                            onDone()
                        }
                    }, Wide, variant = Variant.Outline, loading = bind.isLoading)
                }
            }
        }
    }
}

/* ── Campus SOS ─────────────────────────────────────────────────── */

private val SOS_TYPES = listOf("medical" to "Medical emergency", "security" to "Security threat", "fire" to "Fire hazard", "ragging" to "Ragging / harassment", "other" to "Other immediate help")
val SOS_RESPONDER_ROLES = setOf("security", "admin", "hod", "principal", "chairman")
private val SOS_STATUS_TONE = mapOf("active" to Tone.Danger, "acknowledged" to Tone.Warning, "resolved" to Tone.Success, "false_alarm" to Tone.Neutral)

@Composable
private fun RaiseSosSheet(onClose: () -> Unit) {
    var type by remember { mutableStateOf("medical") }
    var note by remember { mutableStateOf("") }
    val send = rememberMutation()
    Sheet("Emergency SOS alert", onClose, footer = {
        Button("Send SOS now", {
            send.launch(onError = { Dialogs.alert("Failed to send SOS", errMsg(it)) }) {
                Api.createSos(jsonOf("type" to type, "note" to (note.trim().ifEmpty { null } ?: Omit)))
                Dialogs.alert("Emergency alert sent", "Campus security, wardens and management have been notified immediately.")
                onClose()
            }
        }, Wide, variant = Variant.Danger, icon = Icons.Rounded.Warning, loading = send.isLoading)
    }) {
        Small("Alerts campus security and administration immediately.")
        Label("Emergency type")
        SOS_TYPES.forEach { (value, label) -> Chip(label, type == value) { type = value } }
        Input(note, { note = it }, label = "Details (optional)", multiline = true, maxLength = 300, placeholder = "Where are you? What happened?")
    }
}

@Composable
fun SosScreen() {
    val me = me()
    val responder = me.role in SOS_RESPONDER_ROLES
    var raising by remember { mutableStateOf(false) }
    var filter by rememberSaveable { mutableStateOf("") }
    // Only responders can list alerts (server rule); everyone else can raise one.
    val q = Api.sosAlerts(mapOf("status" to filter.ifEmpty { null }), skip = !responder, pollMs = 10_000)
    val act = rememberMutation()
    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header("Campus SOS", if (responder) "Live emergency dispatch & responder feed" else "Rapid emergency alert system", back = true)
        Card(Wide, background = C.dangerSoft, border = C.danger.copy(alpha = 0.3f), gap = 10.dp) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Rounded.Warning, null, Modifier.size(24.dp), tint = C.danger)
                Column(Modifier.weight(1f)) {
                    Strong("Need immediate emergency help?", color = C.danger)
                    Small("Press below to alert Security & Administration instantly.")
                }
            }
            Button("Trigger emergency SOS", { raising = true }, Wide, variant = Variant.Danger, icon = Icons.Rounded.Warning)
        }
        if (responder) {
            Segmented(listOf(Opt("", "All"), Opt("active", "Active"), Opt("acknowledged", "Acked"), Opt("resolved", "Resolved")), filter, { filter = it })
            val data = q.data
            when {
                data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
                data == null -> Loading()
                data["items"].list.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.CheckCircle, "No emergency alerts", "All clear on campus. Live alerts appear here.") }
                else -> data["items"].list.forEach { a ->
                    val status = a["status"].str
                    val active = status == "active"
                    Card(Wide, border = if (active) C.danger else C.border, gap = 8.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Strong("${Fmt.titleCase(a["type"].str)} alert", Modifier.weight(1f))
                            Badge(Fmt.titleCase(status), SOS_STATUS_TONE[status] ?: Tone.Neutral)
                        }
                        val u = a["user"]
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Avatar(u, size = 30.dp)
                            Small("${u["name"].str ?: "Someone"} · ${a["department"].str ?: u["department"].str ?: "Campus"}${a["section"].text?.let { " - $it" } ?: ""} · ${Fmt.timeAgo(a["createdAt"])}", Modifier.weight(1f))
                        }
                        a["note"].text?.let { Body("“$it”") }
                        val lat = a["location"]["lat"].str
                        val lng = a["location"]["lng"].str
                        if (lat != null && lng != null) {
                            val context = LocalContext.current
                            Button("Open location", { openUrl(context, "geo:$lat,$lng?q=$lat,$lng") }, variant = Variant.Ghost, small = true)
                        }
                        a["acknowledgedBy"]["name"].text?.let { Small("Acknowledged by $it", color = C.amberText) }
                        a["resolutionNote"].text?.let { Small("Resolution: $it", color = C.emeraldText) }
                        if (status in setOf("active", "acknowledged")) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (active) Button("Acknowledge", {
                                act.launch(onError = { Dialogs.alert("Could not acknowledge", errMsg(it)) }) {
                                    Api.ackSos(a.id.orEmpty())
                                    Dialogs.alert("Acknowledged", "The person who raised it has been told help is on the way.")
                                }
                            }, Modifier.weight(1f), small = true, loading = act.isLoading)
                            Button("Resolve", {
                                Dialogs.alert("Close this alert", null, listOf(
                                    DialogButton("Cancel", cancel = true),
                                    DialogButton("False alarm") { resolveSos(act, a, "false_alarm") },
                                    DialogButton("Resolved") { resolveSos(act, a, "resolved") },
                                ))
                            }, Modifier.weight(1f), variant = Variant.Success, small = true, loading = act.isLoading)
                        }
                    }
                }
            }
        } else {
            Card(Wide) { Small("Your alert goes to security, the wardens, HODs, the principal and the chairman at once. You will get a notification when someone acknowledges it.") }
        }
    }
    if (raising) RaiseSosSheet { raising = false }
}

private fun resolveSos(act: com.vexon.campus.core.Mutation, alert: JsonElement, status: String) =
    Dialogs.prompt(if (status == "resolved") "Resolve alert" else "Mark as false alarm", "Resolution note (required)", "What happened?", "Close alert", required = true) { note ->
        act.launch(onError = { Dialogs.alert("Could not close the alert", errMsg(it)) }) {
            Api.resolveSos(alert.id.orEmpty(), jsonOf("status" to status, "resolutionNote" to note))
        }
    }

/* ── Announcements: post (Principal / HOD), pin, delete ─────────── */

/**
 * Who can post where — the same rules the API enforces (it re-checks every one):
 * Principal: whole campus, or any department / year / section.
 * Branch HOD: own department, 2nd–4th year. First-year HOD: 1st year.
 */
fun announcementScopes(role: String): List<String> = when (role) {
    "principal" -> listOf("all", "department", "year", "section")
    "hod" -> listOf("department", "year", "section")
    else -> emptyList()
}
private val SCOPE_LABEL = mapOf("all" to "Whole campus", "department" to "Department", "year" to "Year", "section" to "Section")

@Composable
fun AnnouncementFormSheet(onClose: () -> Unit) {
    val me = me()
    val role = me.role
    val firstYear = com.vexon.campus.ui.isFirstYearHod(role, me["department"].str)
    val lockedDept = if (role == "hod" && !firstYear) me["department"].str.orEmpty() else ""
    val years = when {
        role != "hod" -> com.vexon.campus.ui.ACADEMIC_YEARS
        firstYear -> listOf(1)
        else -> com.vexon.campus.ui.ACADEMIC_YEARS.filter { it != 1 }
    }
    val scopes = announcementScopes(role)
    var title by remember { mutableStateOf("") }
    var content by remember { mutableStateOf("") }
    var priority by remember { mutableStateOf("normal") }
    var scope by remember { mutableStateOf(scopes.firstOrNull() ?: "all") }
    var department by remember { mutableStateOf(if (firstYear) com.vexon.campus.ui.FIRST_YEAR_HOD_DEPT else lockedDept) }
    var year by remember { mutableStateOf(years.first()) }
    var section by remember { mutableStateOf("") }
    val post = rememberMutation()
    val deptOptions = if (firstYear) com.vexon.campus.ui.DEPARTMENTS else com.vexon.campus.ui.DEPARTMENTS.filter { it != com.vexon.campus.ui.FIRST_YEAR_HOD_DEPT }

    fun submit() {
        if (title.trim().length < 3) { Dialogs.alert("Title must be at least 3 characters"); return }
        if (content.trim().length < 5) { Dialogs.alert("Please write the announcement (5+ characters)"); return }
        val audience = mutableMapOf<String, Any?>("scope" to scope)
        if (scope == "department") audience["department"] = department
        if (scope == "year" || scope == "section") {
            audience["year"] = year
            // A first-year HOD posting to "Year 1" means every 1st year, unless a branch is chosen.
            if (department.isNotEmpty() && !(firstYear && department == com.vexon.campus.ui.FIRST_YEAR_HOD_DEPT)) audience["department"] = department
        }
        if (scope == "section") audience["section"] = section
        if (scope == "department" && department.isEmpty()) { Dialogs.alert("Choose a department"); return }
        if (scope == "section" && (audience["department"] == null || section.isEmpty())) { Dialogs.alert("Choose a department and a section"); return }
        post.launch(onError = { Dialogs.alert("Could not post", errMsg(it)) }) {
            Api.createAnnouncement(jsonOf("title" to title.trim(), "content" to content.trim(), "priority" to priority, "audience" to audience))
            onClose()
        }
    }

    Sheet("New announcement", onClose, footer = { Button("Post announcement", ::submit, Wide, icon = Icons.AutoMirrored.Rounded.Send, loading = post.isLoading) }) {
        Input(title, { title = it }, label = "Title", maxLength = 160)
        Input(content, { content = it }, label = "Message", multiline = true, maxLength = 5000)
        ChoiceRow("Priority", listOf("normal" to "Normal", "important" to "Important", "urgent" to "Urgent"), priority) { priority = it }
        Label("Audience")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            scopes.forEach { s -> Chip(SCOPE_LABEL[s] ?: s, scope == s) { scope = s } }
        }
        if (scope != "all") {
            if (lockedDept.isNotEmpty()) Small("Department: $lockedDept")
            else PickerField(if (scope == "year") "Department (optional)" else "Department", department, { department = it }, deptOptions, "Select department")
        }
        if (scope == "year" || scope == "section") {
            Label("Year")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { years.forEach { y -> Chip("Year $y", year == y) { year = y } } }
        }
        if (scope == "section") {
            Label("Section")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                com.vexon.campus.ui.SECTIONS.forEach { s -> Chip(s, section == s) { section = s } }
            }
        }
    }
}

/* ── Study materials: upload (faculty / HOD) ─────────────────────── */

val MATERIAL_UPLOAD_ROLES = setOf("faculty", "hod")
private val MATERIAL_CATEGORIES = listOf("notes" to "Notes", "question_bank" to "Question Bank", "lab_manual" to "Lab Manual", "syllabus" to "Syllabus", "assignment" to "Assignment", "other" to "Other")

/**
 * Faculty choose one of their current teaching assignments; an HOD picks a
 * semester and a subject inside their department. The server re-verifies the
 * assignment / department on every upload — nothing here is trusted.
 */
@Composable
fun MaterialUploadSheet(onClose: () -> Unit) {
    val me = me()
    val isFaculty = me.role == "faculty"
    val firstYearHod = com.vexon.campus.ui.isFirstYearHod(me.role, me["department"].str)
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("notes") }
    var assignment by remember { mutableStateOf<JsonElement?>(null) }
    var semester by remember { mutableStateOf(0) }
    var subject by remember { mutableStateOf<JsonElement?>(null) }
    var section by remember { mutableStateOf("") }
    var file by remember { mutableStateOf<JsonElement?>(null) }
    val assignments = Api.myTeachingAssignments(skip = !isFaculty)
    val subjects = Api.subjects(mapOf("department" to me["department"].str?.takeIf { !firstYearHod }, "semester" to semester.takeIf { it > 0 }), skip = isFaculty || semester == 0)
    val upload = rememberMutation()

    fun submit() {
        val problem = when {
            title.trim().length < 2 -> "Enter a title"
            file == null -> "Choose a file to upload"
            isFaculty && assignment == null -> "Choose a teaching assignment"
            !isFaculty && subject == null -> "Choose a subject"
            else -> null
        }
        if (problem != null) { Dialogs.alert(problem); return }
        val a = assignment
        upload.launch(onError = { Dialogs.alert("Could not upload", errMsg(it)) }) {
            Api.uploadStudyMaterial(jsonOf(
                "title" to title.trim(),
                "description" to (description.trim().ifEmpty { null } ?: Omit),
                "category" to category,
                "subjectId" to (if (isFaculty) a["subject"].id else subject.id),
                // An HOD's department is always forced server-side.
                "department" to (if (isFaculty) a["department"].str else Omit),
                "section" to (if (isFaculty) a["section"].str.orEmpty() else section),
                "semester" to (if (isFaculty) a["semester"].int else semester),
                "file" to mapOf("url" to file["url"].str, "name" to file["name"].str, "mimeType" to file["mimeType"].str),
            ))
            Dialogs.alert("Material uploaded")
            onClose()
        }
    }

    Sheet("Upload study material", onClose, footer = { Button("Upload", ::submit, Wide, icon = Icons.AutoMirrored.Rounded.Send, loading = upload.isLoading) }) {
        if (isFaculty) {
            val list = assignments.data.list
            Label("Teaching assignment")
            when {
                assignments.data == null && assignments.error != null -> ErrorState(assignments.error) { assignments.refetch() }
                assignments.data == null -> Loading()
                list.isEmpty() -> Small("You can only upload for classes you currently teach — check your timetable.", color = C.danger)
                else -> list.forEach { x ->
                    Chip(
                        "${x["subject"]["name"].str ?: ""} — ${x["subject"]["code"].str ?: ""} · ${x["department"].str ?: ""} · Sec ${x["section"].str ?: ""} · Sem ${x["semester"].str ?: ""}",
                        assignment === x,
                    ) { assignment = x }
                }
            }
        } else {
            Label("Semester")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                (if (firstYearHod) listOf(1, 2) else (3..8).toList()).forEach { s -> Chip("Sem $s", semester == s) { semester = s; subject = null } }
            }
            if (semester > 0) {
                Label("Subject")
                when {
                    subjects.data == null && subjects.error != null -> ErrorState(subjects.error) { subjects.refetch() }
                    subjects.data == null -> Loading()
                    subjects.data.list.isEmpty() -> Small("No subjects for this semester.")
                    else -> subjects.data.list.forEach { x ->
                        Chip("${x["name"].str ?: ""} — ${x["code"].str ?: ""}${x["department"].text?.let { " · $it" } ?: ""}", subject.id == x.id) { subject = x }
                    }
                }
                Label("Section (optional)")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("Whole class", section.isEmpty()) { section = "" }
                    com.vexon.campus.ui.SECTIONS.forEach { s -> Chip(s, section == s) { section = s } }
                }
            }
        }
        Input(title, { title = it }, label = "Title", maxLength = 150)
        Input(description, { description = it }, label = "Description (optional)", multiline = true, maxLength = 1000)
        Label("Category")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            MATERIAL_CATEGORIES.forEach { (v, l) -> Chip(l, category == v) { category = v } }
        }
        AttachDocument("File (PDF or image)", file, { file = it }, required = true)
    }
}

/* ── Event participants & per-day attendance ────────────────────── */

/** Every calendar day the event runs (at most 30), in the phone's time zone. */
fun eventDays(start: String?, end: String?): List<LocalDate> {
    val s = Fmt.parse(start)?.withZoneSameInstant(java.time.ZoneId.systemDefault())?.toLocalDate() ?: return emptyList()
    val e = Fmt.parse(end)?.withZoneSameInstant(java.time.ZoneId.systemDefault())?.toLocalDate() ?: s
    return generateSequence(s) { it.plusDays(1) }.takeWhile { !it.isAfter(e) }.take(30).toList().ifEmpty { listOf(s) }
}

/** A participant's state on one event day: attended / absent / pending / waitlisted. */
fun statusOnDay(reg: JsonElement?, day: String): String {
    if (reg["status"].str == "waitlisted") return "waitlisted"
    val rec = reg["attendanceDays"].list.firstOrNull { it["date"].str == day }
    if (rec != null) return if (rec["attended"].bool) "attended" else "absent"
    return if (reg["status"].str == "attended") "attended" else "pending"
}

private val DAY_TONE = mapOf("attended" to Tone.Success, "absent" to Tone.Danger, "pending" to Tone.Neutral, "waitlisted" to Tone.Warning)

/**
 * Same endpoints as the web. Present gives On Duty credit for that day's
 * classes; Absent marks them absent and alerts the class in-charge. The
 * server decides who may view and who may mark.
 */
@Composable
fun EventParticipants(event: JsonElement) {
    val id = event.id.orEmpty()
    val days = remember(event["startDate"].str, event["endDate"].str) { eventDays(event["startDate"].str, event["endDate"].str).map { it.toString() } }
    val todayKey = LocalDate.now().toString()
    var day by rememberSaveable(id) { mutableStateOf(if (todayKey in days) todayKey else days.firstOrNull() ?: todayKey) }
    var search by rememberSaveable { mutableStateOf("") }
    val q = Api.eventParticipants(id)
    val mark = rememberMutation()
    val canMark = event["canMarkAttendance"].bool
    val all = q.data.list
    val needle = search.trim().lowercase()
    val rows = all.filter { needle.isEmpty() || it["user"]["name"].str.orEmpty().lowercase().contains(needle) || it["user"]["rollNo"].str.orEmpty().lowercase().contains(needle) }
    val counts = all.groupingBy { statusOnDay(it, day) }.eachCount()

    fun set(r: JsonElement, attended: Boolean) {
        val go = { mark.launch(onError = { Dialogs.alert("Could not update", errMsg(it)) }) { Api.markEventAttendance(id, r["user"].id.orEmpty(), attended, day) } }
        if (attended) go()
        else Dialogs.confirm("Mark absent?", "${r["user"]["name"].str ?: "This student"} is marked absent for that day’s classes and their class in-charge is alerted.", "Mark absent", destructive = true) { go() }
    }

    Card(Wide, gap = 10.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Rounded.Groups, null, Modifier.size(18.dp), tint = C.primary)
            H3("Participants (${all.size})", Modifier.weight(1f))
        }
        if (days.size > 1) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            days.forEach { d -> Chip(Fmt.classDay(d, "EEE dd MMM"), day == d) { day = d } }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Badge("Present ${counts["attended"] ?: 0}", Tone.Success)
            Badge("Absent ${counts["absent"] ?: 0}", Tone.Danger)
            Badge("Pending ${counts["pending"] ?: 0}", Tone.Neutral)
            counts["waitlisted"]?.let { Badge("Waitlist $it", Tone.Warning) }
        }
        Input(search, { search = it }, placeholder = "Search name or roll no.")
        when {
            q.data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            q.data == null -> Loading()
            rows.isEmpty() -> EmptyState(Icons.Rounded.Groups, if (needle.isNotEmpty()) "No participants match" else "No registrations yet")
            else -> rows.forEach { r ->
                val u = r["user"]
                val s = statusOnDay(r, day)
                Column(Modifier.fillMaxWidth().padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Avatar(u, size = 32.dp)
                        Column(Modifier.weight(1f)) {
                            Strong(u["name"].str, maxLines = 1)
                            Small(
                                "${u["rollNo"].str ?: "—"} · ${u["department"].str ?: ""}" + (u["year"].text?.let { " · Y$it" } ?: "") + (u["section"].text?.let { " · Sec $it" } ?: ""),
                                maxLines = 1,
                            )
                        }
                        Badge(s, DAY_TONE[s] ?: Tone.Neutral)
                    }
                    if (canMark && s != "waitlisted") Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button("Present", { set(r, true) }, Modifier.weight(1f), variant = if (s == "attended") Variant.Success else Variant.Outline, small = true, loading = mark.isLoading)
                        Button("Absent", { set(r, false) }, Modifier.weight(1f), variant = if (s == "absent") Variant.Danger else Variant.Outline, small = true, enabled = !mark.isLoading)
                    }
                }
            }
        }
    }
}
