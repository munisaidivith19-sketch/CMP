package com.vexon.campus.screens

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.Cancel
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.ReportProblem
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.TrendingUp
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vexon.campus.core.Api
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.Omit
import com.vexon.campus.core.Query
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
import com.vexon.campus.ui.COMPLAINT_CATEGORY_LABELS
import com.vexon.campus.ui.COMPLAINT_ESCALATE_TO_OPTIONS
import com.vexon.campus.ui.COMPLAINT_STATUSES
import com.vexon.campus.ui.COMPLAINT_SUBCATEGORY_OPTIONS
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.DEPARTMENTS
import com.vexon.campus.ui.DialogButton
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.Grad
import com.vexon.campus.ui.Grid2
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.H3
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.IconTile
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.ROLE_LABELS
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.SectionTitle
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.StatusBadge
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.T
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Type
import com.vexon.campus.ui.Variant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import java.time.Instant

private fun categoryLabel(c: String?) = COMPLAINT_CATEGORY_LABELS[c] ?: Fmt.titleCase(c)

@Composable
private fun ComplaintCard(c: JsonElement, showDepartment: Boolean) {
    Card(Wide, onClick = { Nav.push("/complaints/${c.id}") }, gap = 6.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Rounded.ReportProblem, null, Modifier.size(16.dp), tint = C.primary)
            Strong(categoryLabel(c["category"].str) + (c["subCategory"].text?.let { " · ${Fmt.titleCase(it)}" } ?: ""), Modifier.weight(1f), maxLines = 1)
            StatusBadge(c["status"].str)
        }
        if (c["anonymous"].bool) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(Icons.Rounded.VisibilityOff, null, Modifier.size(12.dp), tint = C.soft)
            Small("Anonymous")
        }
        Small(
            (c["complaintCode"].str ?: "") + (if (showDepartment) " · ${c["department"].text ?: "College-wide"}" else "") +
                " · Assigned to ${ROLE_LABELS[c["currentAuthorityRole"].str] ?: Fmt.titleCase(c["currentAuthorityRole"].str)} · Updated ${Fmt.timeAgo(c["updatedAt"])}",
            color = C.muted,
        )
    }
}

@Composable
private fun Pager(pagination: JsonElement?, onChange: (Int) -> Unit) {
    val pages = pagination["pages"].int ?: 0
    if (pages <= 1) return
    val page = pagination["page"].int ?: 1
    Row(Wide, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Button("Previous", { onChange(page - 1) }, variant = Variant.Soft, small = true, enabled = page > 1)
        Small("Page $page of $pages")
        Button("Next", { onChange(page + 1) }, variant = Variant.Soft, small = true, enabled = page < pages)
    }
}

@Composable
private fun ComplaintList(q: Query, onPage: (Int) -> Unit, showDepartment: Boolean = false, empty: @Composable () -> Unit) {
    val data = q.data
    when {
        data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
        data == null -> Loading()
        data["complaints"].list.isEmpty() -> Card(Wide) { empty() }
        else -> {
            data["complaints"].list.forEach { ComplaintCard(it, showDepartment) }
            Pager(data["pagination"], onPage)
        }
    }
}

@Composable
fun ComplaintsScreen() {
    when (me().role) {
        "student" -> StudentComplaints()
        "admin", "chairman" -> ComplaintDashboard()
        else -> AuthorityComplaints()
    }
}

@Composable
private fun StudentComplaints() {
    var page by rememberSaveable { mutableStateOf(1) }
    val q = Api.complaints(mapOf("page" to page, "limit" to 12))
    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header("Complaints", "Register and track complaints — academics, ragging & harassment, infrastructure or hostel.", back = true)
        Button("Register complaint", { Nav.push("/complaints/new") }, Wide, icon = Icons.Rounded.Add)
        ComplaintList(q, { page = it }) {
            EmptyState(Icons.Rounded.ReportProblem, "No complaints yet", "Raised a concern? Register it here and we'll route it to the right authority.")
        }
    }
}

@Composable
private fun AuthorityComplaints() {
    var page by rememberSaveable { mutableStateOf(1) }
    val q = Api.complaints(mapOf("page" to page, "limit" to 12))
    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header("Complaints assigned to you", "Complaints currently waiting on your review.", back = true)
        ComplaintList(q, { page = it }) {
            EmptyState(Icons.Rounded.CheckCircle, "Nothing assigned to you", "New complaints appear here the moment they're routed to you.")
        }
    }
}

@Composable
private fun FilterRow(label: String, options: List<Pair<String, String>>, value: String, onChange: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Label(label)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            options.forEach { (v, l) -> Chip(l, value == v) { onChange(v) } }
        }
    }
}

private data class StatSpec(val icon: ImageVector, val gradient: List<Color>, val label: String, val value: String, val hint: String? = null)

/** Admin / Chairman: the web's college-wide Complaints dashboard (stats + filters + list). */
@Composable
private fun ComplaintDashboard() {
    var department by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("") }
    var status by rememberSaveable { mutableStateOf("") }
    var anonymous by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableStateOf(1) }
    val dash = Api.complaintDashboard(mapOf("department" to department.ifEmpty { null }, "category" to category.ifEmpty { null }))
    val q = Api.complaints(mapOf(
        "page" to page, "limit" to 15, "department" to department.ifEmpty { null }, "category" to category.ifEmpty { null },
        "status" to status.ifEmpty { null }, "anonymous" to anonymous.ifEmpty { null },
    ))
    val d = dash.data

    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { dash.refetch(); q.refetch() }) {
        Header("Complaints", "College-wide complaint monitoring, filters and statistics.", back = true)
        when {
            d == null && dash.error != null -> ErrorState(dash.error) { dash.refetch() }
            d == null -> Loading()
            else -> Grid2(listOf(
                StatSpec(Icons.Rounded.ReportProblem, Grad.primary, "Total", num(d["total"])),
                StatSpec(Icons.Rounded.Schedule, Grad.amber, "Open", num(d["open"]), "${num(d["pending"])} pending"),
                StatSpec(Icons.Rounded.CheckCircle, Grad.emerald, "Resolved", num(d["resolved"])),
                StatSpec(Icons.Rounded.TrendingUp, Grad.violet, "Escalated", num(d["escalated"]), "${num(d["cancelled"])} cancelled"),
            )) { s, mod ->
                Card(mod, gap = 8.dp) {
                    IconTile(s.icon, s.gradient, 36.dp)
                    Column {
                        Label(s.label)
                        H2(s.value)
                        if (s.hint != null) Small(s.hint)
                    }
                }
            }
        }
        Card(Wide, gap = 12.dp) {
            H3("Filters")
            FilterRow("Department", listOf("" to "All") + DEPARTMENTS.map { it to it }, department) { department = it; page = 1 }
            FilterRow("Category", listOf("" to "All") + COMPLAINT_CATEGORY_LABELS.toList(), category) { category = it; page = 1 }
            FilterRow("Status", listOf("" to "Any") + COMPLAINT_STATUSES.map { it to Fmt.titleCase(it.lowercase()) }, status) { status = it; page = 1 }
            FilterRow("Identity", listOf("" to "Anonymous & visible", "true" to "Anonymous only", "false" to "Visible only"), anonymous) { anonymous = it; page = 1 }
        }
        ComplaintList(q, { page = it }, showDepartment = true) { EmptyState(Icons.Rounded.Cancel, "No complaints match these filters") }
    }
}

/* ── Register a complaint ───────────────────────────────────────── */

private const val MAX_BYTES = 5L * 1024 * 1024
private const val MAX_FILES = 5

@Composable
private fun ChoiceGroup(label: String, options: List<Pair<String, String>>, value: String, error: String? = null, onChange: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Label(label)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            options.forEach { (v, l) -> Chip(l, value == v) { onChange(v) } }
        }
        if (error != null) Small(error, color = C.danger)
    }
}

@Composable
private fun IdentityOption(icon: ImageVector, label: String, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Row(
        modifier.clip(RoundedCornerShape(18.dp)).background(if (active) C.primary50 else C.glass(0.8f))
            .border(2.dp, if (active) C.primary else C.border, RoundedCornerShape(18.dp)).clickable(onClick = onClick).padding(vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, Modifier.size(16.dp), tint = if (active) C.primary600 else C.soft)
        Strong(label, color = if (active) C.primary600 else C.soft)
    }
}

@Composable
fun RegisterComplaintScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var anonymous by rememberSaveable { mutableStateOf(false) }
    var category by rememberSaveable { mutableStateOf("academics") }
    var subCategory by rememberSaveable { mutableStateOf("") }
    var escalateTo by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    val attachments = remember { mutableStateListOf<Map<String, String?>>() }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }
    var uploading by remember { mutableStateOf(false) }
    val create = rememberMutation()

    val subOptions = COMPLAINT_SUBCATEGORY_OPTIONS[category].orEmpty()
    val escalateOptions = COMPLAINT_ESCALATE_TO_OPTIONS[category].orEmpty().map { it to (ROLE_LABELS[it] ?: it) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val (size, name) = withContext(Dispatchers.IO) {
                context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE, OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                    if (c.moveToFirst()) c.getLong(0) to c.getString(1) else null to null
                } ?: (null to null)
            }
            if (size != null && size > MAX_BYTES) { Dialogs.alert("File too large", "Please choose a file under 5 MB."); return@launch }
            uploading = true
            try {
                val file = Api.uploadImage(uri)
                attachments += mapOf(
                    "url" to file["url"].str, "name" to (file["name"].text ?: name ?: "Photo"),
                    "mimeType" to (file["mimeType"].text ?: context.contentResolver.getType(uri)),
                )
            } catch (e: Exception) {
                Dialogs.alert("Upload failed", errMsg(e))
            } finally {
                uploading = false
            }
        }
    }

    fun submit() {
        val e = mutableMapOf<String, String>()
        if (subOptions.isNotEmpty() && subCategory.isEmpty()) e["subCategory"] = "Required"
        if (escalateTo.isEmpty()) e["escalateTo"] = "Required"
        if (description.isBlank()) e["description"] = "Please describe the complaint"
        else if (description.trim().length < 10) e["description"] = "At least 10 characters"
        errors = e
        if (e.isNotEmpty()) return
        create.launch(onError = { Dialogs.alert("Could not submit", errMsg(it)) }) {
            val complaint = Api.createComplaint(jsonOf(
                "anonymous" to anonymous, "category" to category, "subCategory" to (subCategory.ifEmpty { null } ?: Omit),
                "escalateTo" to escalateTo, "description" to description.trim(), "attachments" to attachments.toList(),
            ))
            Dialogs.alert("Complaint registered", "The responsible authority has been notified.")
            Nav.replace(complaint.id?.let { "/complaints/$it" } ?: "/complaints")
        }
    }

    Screen {
        Header("Register a complaint", "Tell us what happened — we'll route it to the right authority.", back = true)
        Card(Wide, gap = 16.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Label("Choose how your complaint will be submitted")
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    IdentityOption(Icons.Rounded.VisibilityOff, "Anonymous", anonymous, Modifier.weight(1f)) { anonymous = true }
                    IdentityOption(Icons.Rounded.Group, "Visible", !anonymous, Modifier.weight(1f)) { anonymous = false }
                }
                Small(
                    if (anonymous) "Your identity will be hidden from the authorities handling the complaint. Your identity can only be accessed by authorized Chairman/Admin accounts according to the system’s privacy rules."
                    else "The responsible authority will be able to see your identity.",
                )
            }
            // Dependent choices reset whenever the category changes (same as the web form).
            ChoiceGroup("Complaint category", COMPLAINT_CATEGORY_LABELS.toList(), category) { category = it; subCategory = ""; escalateTo = "" }
            if (subOptions.isNotEmpty()) ChoiceGroup(if (category == "academics") "Academic category" else "Select category", subOptions, subCategory, errors["subCategory"]) { subCategory = it }
            ChoiceGroup("Escalate to", escalateOptions, escalateTo, errors["escalateTo"]) { escalateTo = it }
            Input(description, { description = it }, label = "Complaint description", multiline = true, maxLength = 2000, placeholder = "Describe what happened in detail…", error = errors["description"])
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Label("Upload supporting files")
                attachments.toList().forEach { a ->
                    Row(
                        Wide.clip(RoundedCornerShape(14.dp)).background(C.primarySoft).padding(horizontal = 12.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(Icons.Rounded.Description, null, Modifier.size(14.dp), tint = C.primary600)
                        Small(a["name"], Modifier.weight(1f), C.primary600, maxLines = 1)
                        Icon(Icons.Rounded.Close, "Remove attachment", Modifier.size(16.dp).clickable { attachments.remove(a) }, tint = C.primary600)
                    }
                }
                if (attachments.size < MAX_FILES) Button("Add file", {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }, variant = Variant.Outline, icon = Icons.Rounded.AddPhotoAlternate, small = true, loading = uploading)
                Small("Images · max 5 MB each · up to $MAX_FILES files", color = C.muted)
            }
            Button("Submit complaint", ::submit, Wide, loading = create.isLoading, enabled = !uploading)
        }
    }
}

/* ── Complaint detail ───────────────────────────────────────────── */

private val CANCELLABLE = setOf("SUBMITTED", "IN_REVIEW", "IN_PROGRESS")
private val ESCALATABLE = setOf("SUBMITTED", "IN_REVIEW", "IN_PROGRESS", "ESCALATED", "RESOLVED")
private val CONFIRMABLE = setOf("IN_REVIEW", "IN_PROGRESS", "RESOLVED", "ESCALATED")
private val AUTHORITY_STATUSES = listOf("IN_REVIEW" to "In review", "IN_PROGRESS" to "In progress", "RESOLVED" to "Resolved")

private fun epoch(v: JsonElement?): Long? = v.str?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

@Composable
private fun Countdown(target: JsonElement?) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = System.currentTimeMillis() } }
    val ms = (epoch(target) ?: return) - now
    if (ms <= 0) return
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Icon(Icons.Rounded.Schedule, null, Modifier.size(13.dp), tint = C.soft)
        Small("Escalation available in ${ms / 3_600_000}h ${(ms % 3_600_000) / 60_000}m")
    }
}

private fun roleName(role: String?) = ROLE_LABELS[role] ?: Fmt.titleCase(role)

private fun historyLabel(h: JsonElement): String = when (h["action"].str) {
    "submitted" -> "Complaint submitted · assigned to ${roleName(h["newAuthority"].str)}"
    "authority_update" -> "${roleName(h["actorRole"].str)} updated status to ${Fmt.titleCase(h["newStatus"].str.orEmpty().lowercase())}" +
        (h["comment"].text?.let { " — “$it”" } ?: "")
    "not_resolved" -> "Marked not resolved — no further escalation available"
    "escalated" -> "Escalated from ${roleName(h["previousAuthority"].str)} to ${roleName(h["newAuthority"].str)}"
    "resolved" -> "Marked resolved"
    "closed" -> "Student confirmed resolution — complaint closed"
    "cancelled" -> "Complaint cancelled by the student"
    "identity_accessed" -> "Identity accessed by ${roleName(h["actorRole"].str)}"
    else -> Fmt.titleCase(h["action"].str)
}

@Composable
private fun Timeline(history: List<JsonElement>) {
    if (history.isEmpty()) { Small("No history yet."); return }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        history.forEach { h ->
            val action = h["action"].str
            val done = action in setOf("resolved", "closed")
            val bad = action in setOf("not_resolved", "cancelled")
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(28.dp).clip(CircleShape).background(C.primarySoft), contentAlignment = Alignment.Center) {
                    Icon(
                        if (done) Icons.Rounded.CheckCircle else if (bad) Icons.Rounded.Cancel else Icons.Rounded.Schedule, null, Modifier.size(15.dp),
                        tint = if (done) C.success else if (bad) C.danger else C.primary,
                    )
                }
                Column(Modifier.weight(1f)) {
                    T(historyLabel(h), Type.strong.copy(fontSize = 13.sp))
                    Small(Fmt.timeAgo(h["timestamp"]))
                }
            }
        }
    }
}

@Composable
fun ComplaintDetailScreen(id: String) {
    val me = me()
    val context = LocalContext.current
    val q = Api.complaint(id)
    val cancel = rememberMutation()
    val escalate = rememberMutation()
    val close = rememberMutation()
    val update = rememberMutation()
    var editing by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("IN_REVIEW") }
    var comment by remember { mutableStateOf("") }

    DetailScreen(q, "Complaint") { c ->
        val st = c["status"].str
        val isOwner = sameId(c["student"], me)
        val isAuthority = sameId(c["currentAuthorityUserId"], me) || me.role == "admin"
        val canEscalate = epoch(c["notResolvedAvailableAt"])?.let { System.currentTimeMillis() >= it } ?: false

        Header(categoryLabel(c["category"].str), c["complaintCode"].str, back = true, right = { StatusBadge(st) })
        Card(Wide, gap = 12.dp) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                c["subCategory"].text?.let { Badge(Fmt.titleCase(it), Tone.Neutral) }
                Badge("Assigned to ${ROLE_LABELS[c["currentAuthorityRole"].str] ?: Fmt.titleCase(c["currentAuthorityRole"].str)}", Tone.Primary)
                Badge("Escalation level ${c["escalationLevel"].str ?: ""}", Tone.Info)
                if (c["anonymous"].bool) Row(
                    Modifier.clip(CircleShape).background(C.neutralSoft).padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(Icons.Rounded.VisibilityOff, null, Modifier.size(12.dp), tint = C.slateText)
                    T("Anonymous", Type.small.copy(fontSize = 11.sp), color = C.slateText)
                }
            }
            // The server decides whether the identity is visible to this viewer.
            val student = c["student"]
            if (c["identityHidden"].isExplicitFalse() && student != null && !isOwner) {
                Row(
                    Wide.clip(RoundedCornerShape(16.dp)).background(C.whiteGlass).padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Avatar(student, size = 36.dp)
                    Column {
                        Strong(student["name"].str)
                        Small("${student["rollNo"].str ?: ""} · ${student["department"].str ?: ""}")
                    }
                }
            }
            Body(c["description"].str)
            val files = c["attachments"].list
            if (files.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Label("Supporting files")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    files.forEach { a ->
                        Row(
                            Modifier.clip(CircleShape).background(C.primarySoft).clickable { openUrl(context, ServerConfig.assetUrl(a["url"].str)) }
                                .padding(horizontal = 12.dp, vertical = 7.dp).semantics { contentDescription = "Open ${a["name"].str ?: "file"}" },
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Icon(Icons.Rounded.Description, null, Modifier.size(13.dp), tint = C.primary600)
                            Small(a["name"].text ?: "File", Modifier.widthIn(max = 180.dp), C.primary600, maxLines = 1)
                        }
                    }
                }
            }
            Small("Submitted ${Fmt.dateTime(c["createdAt"])} · Last updated ${Fmt.timeAgo(c["updatedAt"])}", color = C.muted)

            if (isOwner) {
                Box(Wide.height(1.dp).background(C.border))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (st in CANCELLABLE) Button("Cancel", {
                        Dialogs.alert("Cancel this complaint?", "This withdraws the complaint immediately.", listOf(
                            DialogButton("Keep", cancel = true),
                            DialogButton("Cancel complaint", destructive = true) {
                                cancel.launch { Api.cancelComplaint(id); Dialogs.alert("Complaint cancelled"); Nav.back() }
                            },
                        ))
                    }, variant = Variant.Danger, small = true, loading = cancel.isLoading)
                    if (st in ESCALATABLE) Button("Not resolved", {
                        escalate.launch { Api.markComplaintNotResolved(id); Dialogs.alert("Escalated to the next authority") }
                    }, variant = Variant.Outline, small = true, enabled = canEscalate, loading = escalate.isLoading)
                    if (st in CONFIRMABLE) Button("Resolved", {
                        close.launch { Api.markComplaintResolved(id); Dialogs.alert("Marked as resolved — thanks for confirming") }
                    }, variant = Variant.Success, small = true, loading = close.isLoading)
                }
                if (st in ESCALATABLE && !canEscalate) Countdown(c["notResolvedAvailableAt"])
            }

            if (isAuthority && !isOwner && st !in setOf("CANCELLED", "CLOSED")) {
                Box(Wide.height(1.dp).background(C.border))
                if (editing) {
                    H3("Update complaint status")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        AUTHORITY_STATUSES.forEach { (v, l) -> Chip(l, status == v) { status = v } }
                    }
                    Input(comment, { comment = it }, label = "Comment (shared with the student)", multiline = true, maxLength = 500)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button("Cancel", { editing = false }, variant = Variant.Ghost, small = true)
                        Button("Save", {
                            update.launch {
                                Api.authorityUpdateComplaint(id, jsonOf("status" to status, "comment" to (comment.trim().ifEmpty { null } ?: Omit)))
                                Dialogs.alert("Status updated — the student has been notified")
                                editing = false
                            }
                        }, small = true, loading = update.isLoading)
                    }
                } else Button("Update status", { status = "IN_REVIEW"; comment = ""; editing = true }, small = true)
            }
        }
        SectionTitle("Timeline")
        Card(Wide) { Timeline(c["history"].list) }
    }
}

/** `identityHidden === false` — only an explicit false reveals the identity. */
private fun JsonElement?.isExplicitFalse(): Boolean = (this as? kotlinx.serialization.json.JsonPrimitive)?.content == "false"
