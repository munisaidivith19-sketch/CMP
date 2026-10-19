package com.vexon.campus.screens

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.Uri
import android.os.SystemClock
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Login
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.Cancel
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.DoorFront
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.LocationOff
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.QrCode
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import coil3.compose.AsyncImage
import com.vexon.campus.core.Api
import com.vexon.campus.core.ApiException
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.GateLeave
import com.vexon.campus.core.GateQr
import com.vexon.campus.core.LocationRead
import com.vexon.campus.core.ReturnLocation
import com.vexon.campus.core.merge
import com.vexon.campus.core.Omit
import com.vexon.campus.core.ParentMobile
import com.vexon.campus.core.QueryClient
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
import com.vexon.campus.core.strings
import com.vexon.campus.core.text
import com.vexon.campus.core.with
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
import com.vexon.campus.ui.GATE_PASS_REGARDING
import com.vexon.campus.ui.Grid2
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.H3
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.INDIAN_STATES
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.Opt
import com.vexon.campus.ui.PickerField
import com.vexon.campus.ui.QrImage
import com.vexon.campus.ui.QrScanner
import com.vexon.campus.ui.RowCard
import com.vexon.campus.ui.STUDENT_ROLES
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.SectionTitle
import com.vexon.campus.ui.Segmented
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.StatusBadge
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.T
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Type
import com.vexon.campus.ui.Variant
import com.vexon.campus.ui.YEAR_LABELS
import com.vexon.campus.ui.hasAnyLocation
import com.vexon.campus.ui.hasPreciseLocation
import com.vexon.campus.ui.isLocationOn
import com.vexon.campus.ui.locationSettingsResolution
import com.vexon.campus.ui.openLocationSettings
import com.vexon.campus.ui.readFreshLocation
import com.vexon.campus.ui.findActivity
import com.vexon.campus.ui.openAppSettings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import java.time.Instant
import java.time.LocalDate
import java.time.ZonedDateTime

/* ── Shared helpers ─────────────────────────────────────────────── */

private val OPEN = setOf("pending_faculty", "parent_verified", "pending_hod", "pending_principal", "pending_authority", "approved", "active")
private val PENDING = listOf("pending_faculty", "parent_verified", "pending_hod", "pending_principal", "pending_authority")

val AUTHORITY_LABELS = linkedMapOf("principal" to "PRINCIPAL", "ao" to "AO", "dean" to "DEAN", "chairman" to "CHAIRMAN")
fun isEmergency(p: JsonElement?) = p["passType"].str == "emergency"
fun emergencyStatusLabel(p: JsonElement?, status: String? = p["status"].str): String? =
    if (status == "pending_authority") "Pending — ${AUTHORITY_LABELS[p["emergencyAuthority"].str] ?: ""} approval" else null

private fun statusLabel(s: String?, pass: JsonElement?): String =
    emergencyStatusLabel(pass, s) ?: if (s == "parent_verified") "parent verified" else s.orEmpty().replace("pending_", "waiting: ")

private fun regardingLabel(r: String?) = GATE_PASS_REGARDING[r] ?: Fmt.titleCase(r)
/** A day scholar's same-day Outing (no destination, no return step). */
fun isOuting(p: JsonElement?) = p["dayScholarOuting"].bool
private fun passTitle(p: JsonElement?) = when {
    isEmergency(p) -> "Emergency gate pass"
    isOuting(p) -> "Outing · ${p["subject"].str ?: ""}"
    else -> regardingLabel(p["regarding"].str)
}
private fun destinationLine(d: JsonElement?, empty: String = "") =
    if (d == null) empty else listOfNotNull(d["area"].text, d["district"].text, d["state"].text).joinToString(", ")

/** Seconds left until [iso], ticking once a second while > 0. */
@Composable
private fun countdown(iso: String?): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val target = remember(iso) { iso?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } }
    LaunchedEffect(target) {
        while (target != null && target > System.currentTimeMillis()) {
            now = System.currentTimeMillis()
            delay(1000)
        }
        now = System.currentTimeMillis()
    }
    return if (target == null) 0 else maxOf(0, Math.ceil((target - now) / 1000.0).toLong())
}

private fun mmss(s: Long) = "${s / 60}:${(s % 60).toString().padStart(2, '0')}"

@Composable
private fun Facts(rows: List<Pair<String, String?>>) {
    Grid2(rows, gap = 8.dp) { (label, value), mod ->
        Column(mod.padding(end = 8.dp)) {
            Small(label, color = C.muted)
            Strong(value?.takeIf { it.isNotBlank() } ?: "—")
        }
    }
}

@Composable
private fun StudentLine(student: JsonElement?, extra: String = "") {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Avatar(student, size = 40.dp)
        Column(Modifier.weight(1f)) {
            Strong(student["name"].str, maxLines = 1)
            Small("${student["rollNo"].text ?: "—"} · ${student["department"].str ?: ""}${student["section"].text?.let { " · Sec $it" } ?: ""}$extra", maxLines = 1)
        }
    }
}

@Composable
fun EmergencyBadge() = Badge("Emergency", Tone.Danger)

/** Emergency facts for reviewers, the pass holder and the detail screen. */
@Composable
fun EmergencyDetails(pass: JsonElement, showReason: Boolean = true) {
    val context = LocalContext.current
    val s = pass["student"]
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (showReason) Small("Reason: ${pass["description"].str ?: ""}")
        Facts(listOf(
            "Roll number" to s["rollNo"].str,
            "Department" to (s["department"].text ?: pass["department"].str),
            "Year" to (YEAR_LABELS[s["year"].int] ?: s["year"].str),
            "Section" to (s["section"].text ?: pass["section"].str),
            "Destination" to pass["destination"]["area"].str,
            "Sent to" to AUTHORITY_LABELS[pass["emergencyAuthority"].str],
            "Leaving" to Fmt.dateTime(pass["leaveAt"]),
            "Expected return" to Fmt.dateTime(pass["expectedReturnAt"]),
            "Requested" to Fmt.timeAgo(pass["createdAt"]),
        ))
        pass["supportingDocument"]["url"].text?.let { url ->
            Row(Modifier.clickable { openUrl(context, ServerConfig.assetUrl(url)) }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Rounded.Description, null, Modifier.size(14.dp), tint = C.primary)
                Small(pass["supportingDocument"]["name"].text ?: "Supporting document", Modifier.weight(1f), C.primary600, maxLines = 1)
            }
        }
    }
}

/** Owner-only code for an approved/active pass — read it aloud to security at the gate. */
@Composable
fun PassQr(pass: JsonElement) {
    val usable = pass["status"].str in setOf("approved", "active")
    val q = Api.gatePassQr(pass.id.orEmpty(), skip = !usable)
    if (!usable) return
    val data = q.data
    when {
        data == null && q.error != null -> Small(errMsg(q.error), Wide, C.danger, TextAlign.Center)
        data == null -> Loading()
        else -> Column(Wide, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            QrImage(data["qr"].str, "Gate pass code")
            T(data["code"].str, Type.code)
            Small("Tell this code to security at the gate · valid until ${Fmt.dateTime(data["expiresAt"])}", align = TextAlign.Center)
        }
    }
}

/** Approved emergency pass: its one code, with the QR on request. */
@Composable
fun EmergencyApprovedCode(pass: JsonElement) {
    val q = Api.gatePassQr(pass.id.orEmpty())
    var showQr by remember { mutableStateOf(false) }
    val data = q.data
    when {
        data == null && q.error != null -> Small(errMsg(q.error), Wide, C.danger, TextAlign.Center)
        data == null -> Loading()
        else -> Column(
            Wide.clip(RoundedCornerShape(18.dp)).background(C.successSoft).padding(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Rounded.CheckCircle, null, Modifier.size(18.dp), tint = C.success)
                Strong("EMERGENCY GATE PASS APPROVED", color = C.emeraldText)
            }
            Small("Approved by: ${AUTHORITY_LABELS[pass["emergencyAuthority"].str] ?: ""}")
            Label("Gate pass code")
            val code = data["code"].str.orEmpty()
            T(code, Type.code, Modifier.semantics { contentDescription = "Gate pass code ${code.toList().joinToString(" ")}" })
            if (showQr) QrImage(data["qr"].str, "Gate pass QR code")
            Button(if (showQr) "Hide QR" else "Show QR", { showQr = !showQr }, Wide, variant = Variant.Outline, icon = Icons.Rounded.QrCode)
            Small("Present this code or QR to Security.", align = TextAlign.Center)
        }
    }
}

/* ── Gate pass entry: student / staff / security ────────────────── */

@Composable
fun GatePassScreen() {
    val role = me().role
    when {
        role == "security" -> SecurityConsole()
        role in STUDENT_ROLES -> StudentGatePasses()
        else -> StaffGatePasses()
    }
}

@Composable
private fun StudentGatePasses() {
    val requestLabel = if (me()["stayType"].str == "day_scholar") "Request outing" else "Request gate pass"
    val q = Api.gatePasses(mapOf("limit" to 20))
    val cancel = rememberMutation()
    val passes = q.data["passes"].list
    val current = passes.firstOrNull { it["status"].str in OPEN }

    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header("Gate pass", "Leave campus with an approved pass.", back = true, right = if (current == null) ({
            Button("Request", { Nav.push("/gate-pass/new") }, icon = Icons.Rounded.Add, small = true)
        }) else null)
        when {
            q.data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            q.data == null -> Loading()
            else -> {
                if (current != null) {
                    val status = current["status"].str
                    Card(Wide, gap = 12.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            H2(passTitle(current), Modifier.weight(1f))
                            StatusBadge(status, statusLabel(status, current))
                            if (current["overdue"].bool) StatusBadge("rejected", "overdue")
                        }
                        if (isEmergency(current)) {
                            EmergencyBadge()
                            EmergencyDetails(current)
                        } else if (isOuting(current)) {
                            Body(current["description"].str)
                            Small("Today, ${Fmt.classDay(current["fromDate"])} · Parent: ${current["parentPhone"].str ?: ""}")
                        } else {
                            Body(current["description"].str)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                Icon(Icons.Rounded.Place, null, Modifier.size(12.dp), tint = C.muted)
                                Small(destinationLine(current["destination"]))
                            }
                            Small("${Fmt.classDay(current["fromDate"])} → ${Fmt.classDay(current["toDate"])} · Parent: ${current["parentPhone"].str ?: ""}")
                        }
                        when {
                            status in PENDING -> EmptyState(Icons.Rounded.Schedule, "Waiting for approval", "You’ll get a notification the moment it moves to the next stage.")
                            status == "active" -> ReturnToCampus(current)
                            isEmergency(current) && status == "approved" -> EmergencyApprovedCode(current)
                            else -> PassQr(current)
                        }
                        if (status in PENDING + "approved") Button("Cancel pass", {
                            Dialogs.alert("Cancel this gate pass?", "The request is withdrawn immediately.", listOf(
                                DialogButton("Keep", cancel = true),
                                DialogButton("Cancel pass", destructive = true) {
                                    cancel.launch(onError = { Dialogs.alert("Could not cancel", errMsg(it)) }) { Api.cancelGatePass(current.id.orEmpty()) }
                                },
                            ))
                        }, Wide, variant = Variant.Danger, loading = cancel.isLoading)
                    }
                } else {
                    Card(Wide) {
                        EmptyState(Icons.Rounded.DoorFront, "No active gate pass", "Request one and tell your code to security once approved.",
                            action = { Button(requestLabel, { Nav.push("/gate-pass/new") }, icon = Icons.Rounded.Add) })
                    }
                }
                val history = passes.filter { it !== current }
                if (history.isNotEmpty()) SectionTitle("History")
                history.forEach { p ->
                    Card(Wide, onClick = { Nav.push("/gate-pass/${p.id}") }, gap = 4.dp) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Strong(passTitle(p), Modifier.weight(1f))
                            StatusBadge(p["status"].str, statusLabel(p["status"].str, p))
                        }
                        Small(p["description"].str, maxLines = 1)
                        Small("${Fmt.classDay(p["fromDate"])} → ${Fmt.classDay(p["toDate"])}", color = C.muted)
                    }
                }
            }
        }
    }
}

private data class Stage(val hook: String, val needsParentOtp: Boolean = false, val forwardLabel: String = "", val action: String = "")

private val STAGE_BY_STATUS = mapOf(
    "pending_faculty" to Stage("faculty", needsParentOtp = true),
    "parent_verified" to Stage("faculty", forwardLabel = "Forward to HOD", action = "forward"),
    "pending_hod" to Stage("hod", forwardLabel = "Forward to Principal", action = "forward"),
    "pending_principal" to Stage("principal", forwardLabel = "Approve", action = "approve"),
    "pending_authority" to Stage("authority", forwardLabel = "Approve", action = "approve"),
)

@Composable
private fun ReviewCard(pass: JsonElement, onDone: () -> Unit) {
    val me = me()
    val review = rememberMutation()
    val stage = STAGE_BY_STATUS[pass["status"].str] ?: return
    // Only the authority the student chose may decide an emergency pass (the API enforces it too).
    val canDecide = stage.hook != "authority" || me.role == pass["emergencyAuthority"].str
    val id = pass.id.orEmpty()

    fun act(action: String, reason: String? = null) = review.launch(onError = { Dialogs.alert("Could not update", errMsg(it)) }) {
        val body = jsonOf("action" to action, "reason" to (reason?.takeIf { it.isNotBlank() } ?: Omit))
        when (stage.hook) {
            "faculty" -> Api.facultyReviewGatePass(id, body)
            "hod" -> Api.hodReviewGatePass(id, body)
            "principal" -> Api.principalReviewGatePass(id, body)
            else -> Api.emergencyReviewGatePass(id, body)
        }
        onDone()
    }

    Card(Wide, gap = 10.dp) {
        StudentLine(pass["student"], " · ${Fmt.timeAgo(pass["createdAt"])}")
        if (isEmergency(pass)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                EmergencyBadge()
                StatusBadge(pass["status"].str, statusLabel(pass["status"].str, pass))
            }
            EmergencyDetails(pass)
        } else if (isOuting(pass)) {
            Badge("Day scholar outing", Tone.Info)
            Small("${pass["subject"].str ?: ""}: ${pass["description"].str ?: ""}")
            Small("Today, ${Fmt.classDay(pass["fromDate"])} · Parent (entered by student): ${pass["parentPhone"].str ?: ""}", color = C.muted)
            if (pass["parentPhoneDiffers"].bool) Row(
                Wide.clip(RoundedCornerShape(12.dp)).background(C.warningSoft).padding(8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(Icons.Rounded.Warning, null, Modifier.size(14.dp), tint = C.amberText)
                Small("This is not the parent number registered on the student’s account. Confirm it is really the parent.", Modifier.weight(1f), color = C.amberText)
            }
        } else {
            Small("${regardingLabel(pass["regarding"].str)}: ${pass["description"].str ?: ""}")
            Small(destinationLine(pass["destination"]))
            Small("${Fmt.classDay(pass["fromDate"])} → ${Fmt.classDay(pass["toDate"])} · Parent: ${pass["parentPhone"].str ?: ""}", color = C.muted)
        }
        if (pass["status"].str == "parent_verified") Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Icon(Icons.Rounded.Shield, null, Modifier.size(13.dp), tint = C.success)
            Small("Parent verified by OTP${pass["parentVerifiedBy"]["name"].text?.let { " · $it" } ?: ""}", color = C.emeraldText)
        }
        if (stage.needsParentOtp) ParentVerification(pass, onDone)
        if (canDecide && pass["status"].str == "parent_verified" && me.role in setOf("faculty", "admin")) BindButton(pass, onDone)
        // A bound request moves with its group, so it has no Forward of its own.
        val bound = pass["bindGroup"].id != null
        if (canDecide) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!stage.needsParentOtp && !bound) Button(stage.forwardLabel, { act(stage.action) }, Modifier.weight(1f),
                variant = if (stage.action == "approve") Variant.Success else Variant.Primary, small = true, loading = review.isLoading)
            Button("Reject", {
                Dialogs.prompt("Reject gate pass", "Reason (shared with the student)", "Optional", "Reject") { act("reject", it) }
            }, Modifier.weight(1f), variant = Variant.Danger, small = true, loading = review.isLoading)
        }
    }
}

private val STAGE_STATUS = mapOf(
    "faculty" to listOf("pending_faculty", "parent_verified"),
    "hod" to listOf("pending_hod"),
    "principal" to listOf("pending_principal", "pending_authority"),
    "ao" to listOf("pending_authority"),
    "dean" to listOf("pending_authority"),
    "chairman" to listOf("pending_authority"),
)
private val AUTHORITY_ONLY = setOf("ao", "dean", "chairman")

@Composable
private fun ReviewQueue(role: String) {
    val isAdmin = role == "admin"
    val bind = if (role == "faculty") null else "none"
    val q = Api.gatePasses(if (isAdmin) mapOf("status" to PENDING.joinToString(","), "bind" to bind) else mapOf("bind" to bind))
    val passes = q.data["passes"].list
    val mine = if (isAdmin) passes else passes.filter { it["status"].str in STAGE_STATUS[role].orEmpty() }
    when {
        q.data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
        q.data == null -> Loading()
        mine.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.CheckCircle, "No pending requests", "New requests appear here instantly.") }
        else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { mine.forEach { p -> ReviewCard(p) { q.refetch() } } }
    }
}

@Composable
private fun OutsideNow(dash: JsonElement) {
    val outside = dash["outsideStudents"].list
    if (outside.isEmpty()) {
        Card(Wide) { EmptyState(Icons.Rounded.Group, "Everyone is on campus") }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        outside.forEach { p ->
            Card(Wide, gap = 6.dp) {
                StudentLine(p["student"], " · left ${Fmt.timeAgo(p["actualExit"])}")
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Small("due back ${Fmt.classDay(p["toDate"])}")
                    if (p["overdue"].bool) Badge("overdue", Tone.Danger)
                }
            }
        }
    }
}

@Composable
private fun StaffGatePasses() {
    val me = me()
    var tab by rememberSaveable { mutableStateOf("review") }
    val authorityOnly = me.role in AUTHORITY_ONLY
    val q = Api.gateDashboard(skip = authorityOnly)
    val dash = q.data
    Screen {
        Header("Gate passes", when (me.role) {
            "faculty" -> "Requests from your class"
            "hod" -> "Forwarded by your faculty"
            "principal" -> "Final approval + emergency requests"
            else -> if (authorityOnly) "Emergency requests sent to you" else "All stages"
        }, back = true)
        if (authorityOnly) {
            ReviewQueue(me.role)
            return@Screen
        }
        when {
            dash == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            dash == null -> Loading()
            else -> Grid2(listOf("Pending" to num(dash["pending"]), "Outside now" to num(dash["studentsOutside"])), gap = 10.dp) { (l, v), mod ->
                Card(mod, gap = 2.dp) { Label(l); H2(v) }
            }
        }
        if (me.role == "principal") Button("Institutional mass outpass", { Nav.push("/gate-pass/mass") }, Wide, variant = Variant.Soft, icon = Icons.Rounded.DoorFront)
        Segmented(
            buildList {
                add(Opt("review", "Review"))
                if (me.role in BIND_ROLES) add(Opt("bind", if (me.role == "faculty") "Bind" else "Bind groups"))
                if (me.role in REVOKE_ROLES) add(Opt("approved", "Approved"))
                add(Opt("outside", "Outside"))
            },
            tab, { tab = it },
        )
        if (tab == "review") ReviewQueue(me.role)
        if (tab == "bind") BindPanel()
        if (tab == "approved") ApprovedNotLeft()
        if (tab == "outside" && dash != null) OutsideNow(dash)
    }
}

// Who may reject a pass after approval (server: PATCH /gate-pass/:id/revoke).
private val REVOKE_ROLES = setOf("principal", "admin")

/**
 * Approved passes the student has not used yet. The principal can still reject
 * them here until security records OUT — after that the server refuses.
 */
@Composable
private fun ApprovedNotLeft() {
    val q = Api.gatePasses(mapOf("status" to "approved", "limit" to 50))
    val passes = q.data["passes"].list
    when {
        q.data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
        q.data == null -> Loading()
        passes.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.CheckCircle, "No approved passes waiting", "Approved passes appear here until the student leaves campus.") }
        else -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Small("These students are approved but have not left yet. You can reject a pass until they exit.", color = C.muted)
            passes.forEach { p ->
                Card(Wide, onClick = { Nav.push("/gate-pass/${p.id}") }, gap = 8.dp) {
                    StudentLine(p["student"])
                    Small("${passTitle(p)} · ${GateLeave.period(p) ?: ""}", maxLines = 2)
                    RejectApprovedButton(p) { q.refetch() }
                }
            }
        }
    }
}

/** Principal / admin: reject an approved pass before the student exits. */
@Composable
private fun RejectApprovedButton(pass: JsonElement, onDone: () -> Unit) {
    val reject = rememberMutation()
    Button("Reject pass", {
        Dialogs.prompt(
            "Reject approved gate pass",
            "${pass["student"]["name"].str ?: "The student"} will not be able to leave with this pass. Reason (shared with the student)",
            "e.g. Campus lockdown", "Reject", required = true,
        ) { reason ->
            reject.launch(onError = { Dialogs.alert("Could not reject", errMsg(it)); onDone() }) {
                Api.revokeGatePass(pass.id.orEmpty(), reason.trim())
                Dialogs.alert("Gate pass rejected", "The student has been notified and the exit code no longer works.")
                onDone()
            }
        }
    }, Wide, variant = Variant.Danger, small = true, icon = Icons.Rounded.Cancel, loading = reject.isLoading)
}

/* ── Security console ───────────────────────────────────────────── */

@Composable
private fun OrDivider() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.weight(1f).height(1.dp).background(C.border))
        Small("or enter code manually", color = C.muted)
        Box(Modifier.weight(1f).height(1.dp).background(C.border))
    }
}

@Composable
private fun ResultBanner(valid: Boolean, text: String) {
    Row(
        Wide.clip(RoundedCornerShape(16.dp)).background(if (valid) C.successSoft else C.dangerSoft).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(if (valid) Icons.Rounded.CheckCircle else Icons.Rounded.Cancel, null, Modifier.size(22.dp), tint = if (valid) C.success else C.danger)
        Strong(text, Modifier.weight(1f), if (valid) C.emeraldText else C.roseText)
    }
}

@Composable
private fun Problems(problems: List<String>) {
    problems.forEach { p ->
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Rounded.Warning, null, Modifier.size(14.dp), tint = C.danger)
            Small(p, Modifier.weight(1f), C.danger)
        }
    }
}

/** Verification result held by the security screens. */
private data class Verify(val data: JsonElement?, val credential: String? = null, val problems: List<String> = emptyList(), val done: Boolean = false) {
    val valid get() = data["valid"].bool
    val pass get() = data["pass"]
    val allProblems get() = problems + data["problems"].strings
}

@Composable
private fun SecurityConsole() {
    val q = Api.securityDashboard(pollMs = 30_000)
    val dash = q.data
    var code by rememberSaveable { mutableStateOf("") }
    var scanOpen by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<Verify?>(null) }
    val verify = rememberMutation()
    val out = rememberMutation()

    // Accepts the typed code or a scanned QR value — same verification either way.
    fun check(raw: String = code) {
        val value = raw.trim()
        if (value.isEmpty()) return
        verify.launch(onError = { result = Verify(null, problems = listOf(errMsg(it, "Invalid code"))) }) {
            result = Verify(Api.verifyGatePass(value), value)
        }
    }

    Screen {
        Header("Security console", "Verify a student's exit code, or use Return verification when they come back.", back = true)
        when {
            dash == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            dash == null -> Loading()
            else -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf("Inside" to dash["inside"], "Outside" to dash["outside"], "Left today" to dash["leftToday"]).forEach { (l, v) ->
                    Card(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, gap = 2.dp) { Label(l); H2(num(v)) }
                }
            }
        }
        Card(Wide, gap = 10.dp) {
            H3("Verify a gate pass")
            Small("Scan the student’s QR code, or enter their 4-character code.")
            Button("Scan QR code", { scanOpen = true }, Wide, icon = Icons.Rounded.QrCodeScanner)
            OrDivider()
            Input(code, { code = it.uppercase() }, placeholder = "A4G5", maxLength = 4, onSubmit = { check() })
            Button("Verify", { check() }, Wide, icon = Icons.Rounded.Shield, loading = verify.isLoading)
        }
        QrScanner(scanOpen, { scanOpen = false }, { value ->
            scanOpen = false
            val problem = GateQr.scanProblem(value, "exit")
            if (problem != null) result = Verify(null, problems = listOf(problem)) else check(value)
        })
        result?.let { r ->
            Card(Wide, gap = 12.dp) {
                ResultBanner(r.valid || r.done, if (r.done) "Recorded" else if (r.valid) "Valid pass" else "Not valid")
                Problems(r.allProblems)
                if (!r.valid && !r.done) Button("Scan again", { scanOpen = true }, Wide, variant = Variant.Outline, icon = Icons.Rounded.QrCodeScanner)
                val pass = r.pass
                if (pass != null) {
                    StudentLine(pass["student"])
                    Small("${passTitle(pass)} · ${Fmt.classDay(pass["fromDate"])} → ${Fmt.classDay(pass["toDate"])}")
                    if (!r.done && r.data["nextAction"].str == "out") Button("OUT — record exit", {
                        out.launch(onError = { Dialogs.alert("Could not record", errMsg(it)) }) {
                            val updated = Api.recordGateOut(pass.id.orEmpty(), r.credential.orEmpty())
                            Dialogs.alert("OUT recorded", "Have a safe trip.")
                            result = r.copy(data = r.data.with("pass" to pass.merge(updated), "nextAction" to null), done = true)
                            code = ""
                            q.refetch()
                        }
                    }, Wide, icon = Icons.AutoMirrored.Rounded.Logout, loading = out.isLoading)
                    if (r.data["returnRequired"].bool) {
                        Small("This student is outside. To record their return, scan their Return QR or enter their Return Code.", color = C.amberText)
                        Button("Return verification", { Nav.push("/gate-pass/in") }, Wide, variant = Variant.Success, icon = Icons.AutoMirrored.Rounded.Login)
                    }
                }
            }
        }
    }
}

/** Gate guard's dedicated OUT page (exit code) and Return verification page (return QR/code). */
@Composable
fun GateVerifyScreen(direction: String) {
    val isReturn = direction == "in"
    var code by rememberSaveable { mutableStateOf("") }
    var scanOpen by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<Verify?>(null) }
    val verify = rememberMutation()
    val record = rememberMutation()

    fun check(raw: String = code) {
        val value = raw.trim()
        if (value.isEmpty()) return
        verify.launch(onError = { result = Verify(null, problems = listOf(errMsg(it, "Invalid code"))) }) {
            result = Verify(if (isReturn) Api.verifyReturnCredential(value) else Api.verifyGatePass(value), value)
        }
    }

    fun confirm(r: Verify) = record.launch(onError = { Dialogs.alert("Could not record", errMsg(it)) }) {
        val id = r.pass.id.orEmpty()
        if (isReturn) Api.recordGateIn(id, r.credential.orEmpty()) else Api.recordGateOut(id, r.credential.orEmpty())
        if (isReturn) Dialogs.alert("Return recorded", "The parent and class faculty have been notified.")
        else Dialogs.alert("OUT recorded", "Have a safe trip.")
        result = null
        code = ""
        QueryClient.invalidate("GatePass")
        Nav.back()
    }

    Screen {
        Header(
            if (isReturn) "Return verification" else "Student OUT",
            if (isReturn) "Scan the student's Return QR or enter their Return Code." else "Ask the student for their code, then confirm they’re leaving.",
            back = true,
        )
        Card(Wide, gap = 10.dp) {
            Button("Scan QR code", { scanOpen = true }, Wide, icon = Icons.Rounded.QrCodeScanner)
            OrDivider()
            Input(
                code, { v -> code = if (isReturn && v.startsWith("ccrt:", ignoreCase = true)) v else v.uppercase() },
                placeholder = if (isReturn) "Return code" else "A4G5", maxLength = if (isReturn) 80 else 4, onSubmit = { check() },
            )
            Button("Verify", { check() }, Wide, icon = Icons.Rounded.Shield, loading = verify.isLoading)
        }
        QrScanner(scanOpen, { scanOpen = false }, { value ->
            scanOpen = false
            val problem = GateQr.scanProblem(value, if (isReturn) "return" else "exit")
            if (problem != null) result = Verify(null, problems = listOf(problem)) else check(value)
        }, if (isReturn) "Scan return QR" else "Scan gate pass QR")

        result?.let { r ->
            val matches = if (isReturn) r.data["nextAction"].str == "inside" else r.data["nextAction"].str == "out"
            val student = r.pass["student"]
            Card(Wide, gap = 12.dp) {
                ResultBanner(r.valid, if (r.valid) (if (isReturn) "Return verification ready" else "Valid pass") else "Not valid")
                Problems(r.allProblems)
                if (!r.valid) Button("Scan again", { scanOpen = true }, Wide, variant = Variant.Outline, icon = Icons.Rounded.QrCodeScanner)
                val pass = r.pass
                if (pass != null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Avatar(student, size = 40.dp)
                        Column(Modifier.weight(1f)) {
                            Strong(student["name"].str, maxLines = 2)
                            Small(student["rollNo"].text ?: "—", maxLines = 1)
                        }
                        if (!isReturn) StatusBadge(pass["status"].str)
                    }
                    if (isReturn) Facts(listOf(
                        "Department" to student["department"].str,
                        "Year" to (YEAR_LABELS[student["year"].int] ?: student["year"].str),
                        "Section" to student["section"].str,
                        "Gate pass" to r.data["passRef"].str,
                        "Status" to "Return verification ready",
                    )) else Small("${if (isEmergency(pass)) "Emergency gate pass" else regardingLabel(pass["regarding"].str)} · ${Fmt.classDay(pass["fromDate"])} → ${Fmt.classDay(pass["toDate"])}")
                    if (r.valid && !matches && !isReturn) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(Icons.Rounded.Warning, null, Modifier.size(14.dp), tint = C.warning)
                        Small("This student is already outside — use Return verification when they come back.", Modifier.weight(1f), C.amberText)
                    }
                    if (matches) Button(
                        if (isReturn) "Student is inside" else "Confirm OUT", { confirm(r) }, Wide,
                        variant = if (isReturn) Variant.Success else Variant.Primary,
                        icon = if (isReturn) Icons.AutoMirrored.Rounded.Login else Icons.AutoMirrored.Rounded.Logout, loading = record.isLoading,
                    )
                }
            }
        }
    }
}

/* ── New gate pass ──────────────────────────────────────────────── */

@Composable
fun NewGatePassScreen() {
    // Re-read the profile so a number the administrator just added is picked up.
    val fresh = Api.me()
    val me = fresh.data?.takeIf { it["_id"].str != null } ?: me()
    val parentPhone = me["parentPhone"].text?.takeIf { it.isNotBlank() }
    val isDayScholar = me["stayType"].str == "day_scholar"
    var type by rememberSaveable { mutableStateOf(if (isDayScholar) "outing" else "normal") }
    var regarding by rememberSaveable { mutableStateOf("outing") }
    var description by rememberSaveable { mutableStateOf("") }
    var state by rememberSaveable { mutableStateOf("") }
    var district by rememberSaveable { mutableStateOf("") }
    var area by rememberSaveable { mutableStateOf("") }
    var fromDate by rememberSaveable { mutableStateOf(LocalDate.now()) }
    var toDate by rememberSaveable { mutableStateOf(LocalDate.now()) }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }
    val create = rememberMutation()

    fun submit() {
        val e = mutableMapOf<String, String>()
        if (description.trim().length < 5) e["description"] = "Please describe the reason (5+ characters)"
        if (state.isEmpty()) e["state"] = "Select a state"
        if (district.isBlank()) e["district"] = "Required"
        if (area.isBlank()) e["area"] = "Required"
        if (toDate.isBefore(fromDate)) e["toDate"] = "Cannot be before the departure date"
        errors = e
        if (e.isNotEmpty()) return
        if (parentPhone == null) {
            Dialogs.alert("Parent number missing", "Your parent's mobile number is not on file — ask the administrator to add it before requesting a gate pass.")
            return
        }
        create.launch(onError = { Dialogs.alert("Could not submit", errMsg(it)) }) {
            Api.createGatePass(jsonOf(
                "regarding" to regarding, "description" to description.trim(),
                "destination" to mapOf("state" to state, "district" to district.trim(), "area" to area.trim()),
                "fromDate" to fromDate.toString(), "toDate" to toDate.toString(),
            ))
            Dialogs.alert("Request sent", "Your class faculty has been notified.")
            Nav.back()
        }
    }

    Screen {
        Header(
            if (isDayScholar) "Request an outing" else "Request gate pass",
            when (type) {
                "emergency" -> "Goes straight to the authority you choose — no faculty, HOD or parent OTP."
                "outing" -> "For today only. Class faculty (parent OTP) → HOD → principal."
                else -> "Goes to your class faculty, then HOD, then the principal."
            },
            back = true,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (isDayScholar) Chip("Outing", type == "outing") { type = "outing" }
            else Chip("Normal gate pass", type == "normal") { type = "normal" }
            Chip("Emergency gate pass", type == "emergency") { type = "emergency" }
        }
        if (type == "emergency") Card(Wide) { EmergencyRequestForm { Nav.back() } }
        else if (type == "outing") Card(Wide) { OutingForm(parentPhone.orEmpty()) }
        else Card(Wide, gap = 14.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Label("Regarding")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GATE_PASS_REGARDING.forEach { (value, label) -> Chip(label, regarding == value) { regarding = value } }
                }
            }
            Input(description, { description = it }, label = "Description", multiline = true, maxLength = 500, placeholder = "Why do you need to leave campus?", error = errors["description"])
            // The parent OTP always goes to the number the administrator registered.
            Input(parentPhone ?: "Not on file", {}, label = "Parent's mobile number (registered)", enabled = false)
            if (parentPhone == null && fresh.data != null) Small(
                "Your parent's mobile number is not on file — ask the administrator to add it before requesting a gate pass.",
                color = C.danger,
            )
            DateField("From date", fromDate, { fromDate = it }, min = LocalDate.now(), error = errors["fromDate"])
            DateField("To date (return by)", toDate, { toDate = it }, min = fromDate, error = errors["toDate"])
            PickerField("State", state, { state = it }, INDIAN_STATES, "Select state", errors["state"])
            Input(district, { district = it }, label = "District", maxLength = 80, error = errors["district"])
            Input(area, { area = it }, label = "Village / area", maxLength = 120, error = errors["area"])
            Button("Submit request", ::submit, Wide, loading = create.isLoading)
        }
    }
}

private const val MAX_BYTES = 5L * 1024 * 1024

/**
 * Day scholar Outing: today only (the server sets the date), no destination
 * and no return check-in — it completes when security records the exit.
 */
@Composable
private fun OutingForm(registeredParentPhone: String) {
    var subject by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var parentPhone by rememberSaveable { mutableStateOf(registeredParentPhone) }
    var doc by remember { mutableStateOf<JsonElement?>(null) }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }
    val create = rememberMutation()
    fun submit() {
        val e = mutableMapOf<String, String>()
        if (subject.trim().length < 2) e["subject"] = "At least 2 characters"
        if (description.trim().length < 5) e["description"] = "At least 5 characters"
        val digits = parentPhone.count { it.isDigit() }
        if (!Regex("^[0-9+\\-\\s()]*$").matches(parentPhone) || digits < 6 || digits > 15) e["parentPhone"] = "Enter a valid mobile number"
        errors = e
        if (e.isNotEmpty()) return
        create.launch(onError = { Dialogs.alert("Could not submit", errMsg(it)) }) {
            Api.createDayScholarOuting(jsonOf(
                "subject" to subject.trim(), "description" to description.trim(), "parentPhone" to parentPhone.trim(),
                "supportingDocument" to docBody(doc),
            ))
            Dialogs.alert("Outing requested", "Your class faculty has been notified.")
            Nav.back()
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Input(subject, { subject = it }, label = "Subject", maxLength = 120, placeholder = "e.g. Doctor appointment", error = errors["subject"])
        Input(description, { description = it }, label = "Description", multiline = true, maxLength = 500, placeholder = "Why do you need to go out today?", error = errors["description"])
        Input(parentPhone, { parentPhone = it }, label = "Parent mobile", keyboardType = KeyboardType.Phone, maxLength = 20, hint = "The parent verification OTP is sent to this number.", error = errors["parentPhone"])
        AttachDocument("Attachment", doc, { doc = it })
        Small("For today only. No return check-in is needed — the pass is complete once security records your exit.")
        Button("Request outing", ::submit, Wide, loading = create.isLoading)
    }
}

/** Emergency request form: identity is read-only, from the signed-in account. */
@Composable
private fun EmergencyRequestForm(onSubmitted: () -> Unit) {
    val me = me()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val create = rememberMutation()
    var authority by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var destination by rememberSaveable { mutableStateOf("") }
    var leaveAt by remember { mutableStateOf(ZonedDateTime.now().plusMinutes(15).withSecond(0).withNano(0)) }
    var returnAt by remember { mutableStateOf(ZonedDateTime.now().plusHours(4).withSecond(0).withNano(0)) }
    var doc by remember { mutableStateOf<JsonElement?>(null) }
    var docLocal by remember { mutableStateOf<Uri?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val size = withContext(Dispatchers.IO) { context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst()) c.getLong(0) else null } }
            if (size != null && size > MAX_BYTES) { Dialogs.alert("File too large", "Please choose an image under 5 MB."); return@launch }
            uploading = true
            try {
                doc = Api.uploadImage(uri)
                docLocal = uri
            } catch (e: Exception) {
                Dialogs.alert("Upload failed", errMsg(e))
            } finally {
                uploading = false
            }
        }
    }

    fun submit() {
        val e = mutableMapOf<String, String>()
        if (authority.isEmpty()) e["authority"] = "Choose who should approve it"
        if (reason.trim().length < 5) e["reason"] = "Please describe the emergency (5+ characters)"
        if (destination.trim().length < 2) e["destination"] = "Required"
        if (!returnAt.isAfter(leaveAt)) e["returnAt"] = "Must be after the leaving time"
        errors = e
        if (e.isNotEmpty()) return
        create.launch(onError = { Dialogs.alert("Could not submit", errMsg(it)) }) {
            val d = doc
            Api.createEmergencyGatePass(jsonOf(
                "authority" to authority, "reason" to reason.trim(), "destination" to destination.trim(),
                "leaveAt" to Fmt.isoInstant(leaveAt), "expectedReturnAt" to Fmt.isoInstant(returnAt),
                "supportingDocument" to (if (d != null) mapOf("url" to d["url"].str, "name" to d["name"].str, "mimeType" to d["mimeType"].str) else Omit),
            ))
            Dialogs.alert("Emergency request sent", "It went straight to the ${AUTHORITY_LABELS[authority]}.")
            onSubmitted()
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Wide.clip(RoundedCornerShape(18.dp)).background(C.primarySoft).padding(12.dp)) {
            Facts(listOf(
                "Student name" to me["name"].str, "Roll number" to me["rollNo"].str, "Department" to me["department"].str,
                "Year" to (YEAR_LABELS[me["year"].int] ?: me["year"].str), "Section" to me["section"].str,
            ))
        }
        PickerField("Authority to escalate to", AUTHORITY_LABELS[authority].orEmpty(), { label ->
            authority = AUTHORITY_LABELS.entries.first { it.value == label }.key
        }, AUTHORITY_LABELS.values.toList(), "Select authority", errors["authority"])
        Input(reason, { reason = it }, label = "Reason", multiline = true, maxLength = 500, placeholder = "What is the emergency?", error = errors["reason"])
        Input(destination, { destination = it }, label = "Destination", maxLength = 120, error = errors["destination"])
        DateTimeField("Date & requested leaving time", leaveAt, { leaveAt = it }, min = ZonedDateTime.now())
        DateTimeField("Expected return time", returnAt, { returnAt = it }, min = leaveAt, error = errors["returnAt"])
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Label("Supporting document (optional)")
            docLocal?.let { AsyncImage(it, "Attached document", Wide.height(140.dp).clip(RoundedCornerShape(18.dp)), contentScale = ContentScale.Crop) }
            Button(if (doc != null) "Replace photo" else "Attach a photo", {
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }, Wide, variant = Variant.Outline, icon = Icons.Rounded.AddPhotoAlternate, loading = uploading)
        }
        Button("Send emergency request", ::submit, Wide, variant = Variant.Danger, loading = create.isLoading, enabled = !uploading)
    }
}

/* ── Gate pass detail ───────────────────────────────────────────── */

@Composable
private fun Step(label: String, at: JsonElement? = null, done: Boolean, bad: Boolean = false, note: String? = null) {
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(
            if (!done) Icons.Rounded.Schedule else if (bad) Icons.Rounded.Cancel else Icons.Rounded.CheckCircle, null, Modifier.size(20.dp),
            tint = if (!done) C.muted else if (bad) C.danger else C.success,
        )
        Column {
            Strong(label, color = if (done) Color.Unspecified else C.muted)
            if (done && at != null) Small(Fmt.timeAgo(at))
            if (note != null) Small("“$note”", color = C.danger)
        }
    }
}

@Composable
fun GatePassDetailScreen(id: String) {
    val me = me()
    val q = Api.gatePass(id)
    val p = q.data
    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header("Gate pass", if (p != null) passTitle(p) else "", back = true, right = if (p != null) ({ StatusBadge(p["status"].str, emergencyStatusLabel(p)) }) else null)
        when {
            p == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            p == null -> Loading()
            else -> {
                Card(Wide, gap = 6.dp) {
                    if (isEmergency(p)) {
                        EmergencyBadge()
                        EmergencyDetails(p)
                    } else if (isOuting(p)) {
                        Body(p["description"].str)
                        Small("Today, ${Fmt.classDay(p["fromDate"])} · no return check-in needed")
                        Small("Parent: ${p["parentPhone"].str ?: ""}")
                    } else {
                        Body(p["description"].str)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Icon(Icons.Rounded.Place, null, Modifier.size(13.dp), tint = C.muted)
                            Small(destinationLine(p["destination"], "—"))
                        }
                        Small("${Fmt.classDay(p["fromDate"])} → ${Fmt.classDay(p["toDate"])}")
                        Small("Parent: ${p["parentPhone"].str ?: ""}")
                    }
                    p["rejectedReason"].text?.let { Small("Rejected (${p["rejectedStage"].str ?: ""}): $it", color = C.danger) }
                    p["revokeReason"].text?.let { Small("Revoked: $it", color = C.danger) }
                }
                Card(Wide, gap = 14.dp) {
                    Step("Requested", p["createdAt"], done = true)
                    fun review(key: String) = p[key]
                    @Composable
                    fun ReviewStep(label: String, key: String) {
                        val r = review(key)
                        val rejected = r["action"].str == "rejected"
                        Step(label, r["at"], r != null, rejected, if (rejected) r["reason"].str else null)
                    }
                    if (isEmergency(p)) ReviewStep("${AUTHORITY_LABELS[p["emergencyAuthority"].str] ?: ""} approval", "emergencyReview")
                    else {
                        if (p["parentVerifiedAt"] != null || p["status"].str in setOf("pending_faculty", "parent_verified")) {
                            val alt = p["parentVerifiedAlternate"]
                            Step(
                                alt["mobileMasked"].text?.let { "Parent verified (OTP to alternate number $it)" } ?: "Parent verified (OTP)",
                                p["parentVerifiedAt"], p["parentVerifiedAt"] != null, note = alt["reason"].text,
                            )
                        }
                        ReviewStep("Faculty review", "facultyReview")
                        ReviewStep("HOD review", "hodReview")
                        ReviewStep("Principal approval", "principalReview")
                    }
                    if (isOuting(p)) Step("Left campus · outing complete", p["actualExit"], p["actualExit"] != null)
                    else {
                        Step("Left campus", p["actualExit"], p["actualExit"] != null)
                        if (p["actualExit"] != null) Step("Return location verified", p["returnLocationVerifiedAt"], p["returnLocationVerifiedAt"] != null)
                        Step("Returned", p["actualReturn"], p["actualReturn"] != null)
                    }
                    if (p["status"].str in setOf("cancelled", "revoked", "expired")) Step(Fmt.titleCase(p["status"].str), done = true, bad = true)
                }
                val mine = sameId(p["student"], me)
                if (!mine && me.role in REVOKE_ROLES && p["status"].str == "approved" && p["actualExit"] == null) {
                    Card(Wide, gap = 8.dp) {
                        Small("Approved and not used yet — you can still reject this pass until the student exits.", color = C.muted)
                        RejectApprovedButton(p) { q.refetch() }
                    }
                }
                if (mine && p["status"].str == "approved") Card(Wide) { if (isEmergency(p)) EmergencyApprovedCode(p) else PassQr(p) }
                if (mine && p["status"].str == "active") Card(Wide) { ReturnToCampus(p) }
            }
        }
    }
}

/* ── Parent OTP verification (faculty step) ─────────────────────── */

private val NOT_LIVE_TEXT = mapOf(
    "expired" to "The OTP expired. Send a new one to the parent.",
    "locked" to "Too many incorrect attempts. Send a new OTP to the parent.",
    "failed" to "The last OTP could not be sent. Try again.",
)

/** Faculty step: confirm the parent with a backend-issued OTP before forwarding to the HOD. */
@Composable
private fun ParentVerification(pass: JsonElement, onVerified: () -> Unit) {
    val id = pass.id.orEmpty()
    val q = Api.parentOtp(id)
    val send = rememberMutation()
    val verify = rememberMutation()
    var sent by remember { mutableStateOf<JsonElement?>(null) }
    var otp by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf("") }
    // The number the OTP goes to: the registered parent mobile unless the faculty edits it.
    var mobile by remember { mutableStateOf<String?>(null) }
    var reason by remember { mutableStateOf("") }

    val state = sent ?: q.data
    val registered = q.data["parentMobile"].text ?: pass["parentPhone"].str.orEmpty()
    val typedMobile = mobile ?: registered
    val edited = ParentMobile.differs(typedMobile, registered)
    val expiresIn = countdown(if (state["status"].str == "active") state["expiresAt"].str else null)
    val live = expiresIn > 0
    val resendIn = countdown(state["resendAvailableAt"].str)
    val length = state["otpLength"].int ?: 0
    val status = if (state["status"].str == "active" && !live) "expired" else state["status"].str

    fun sendOtp() {
        if (edited && !ParentMobile.isValid(typedMobile)) { problem = "Enter a valid 10-digit mobile number"; return }
        if (edited && reason.trim().length < 3) { problem = "Say why the OTP is going to a different number (e.g. parent not reachable)"; return }
        send.launch(onError = { Dialogs.alert("Could not send OTP", errMsg(it)); q.refetch() }) {
            sent = if (edited) Api.requestParentOtp(id, typedMobile.trim(), reason.trim()) else Api.requestParentOtp(id)
            otp = ""
            problem = ""
        }
    }

    fun submit() {
        if (otp.length != length) { problem = "Enter the $length-digit OTP"; return }
        verify.launch(onError = { e ->
            problem = errMsg(e, "Could not verify the OTP")
            otp = ""
            sent = null
            q.refetch()
        }) {
            Api.verifyParentOtp(id, otp)
            Dialogs.alert("Parent verified", "You can now forward the request to the HOD.")
            onVerified()
        }
    }

    val student = pass["student"]
    Column(
        Wide.clip(RoundedCornerShape(18.dp)).background(C.primarySoft).padding(12.dp).semantics { contentDescription = "Parent verification" },
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Shield, null, Modifier.size(16.dp), tint = C.primary)
            Strong("Parent verification")
            if (state["devMode"].bool) Badge("Development OTP service", Tone.Warning)
        }
        Facts(listOf(
            "Student" to student["name"].str,
            "Department" to (student["department"].text ?: pass["department"].str),
            "Year" to (YEAR_LABELS[student["year"].int] ?: student["year"].text?.let { "Year $it" } ?: "—"),
            "Section" to (student["section"].text ?: pass["section"].str),
            "Registered parent mobile" to registered.ifEmpty { "—" },
        ))
        when {
            q.data == null && q.error != null && sent == null -> Small(errMsg(q.error), color = C.danger)
            q.data == null && sent == null -> Loading()
            live -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Small(
                    if (state["alternateMobile"].bool) "OTP sent to the alternate number ${state["maskedMobile"].str.orEmpty()}."
                    else "OTP sent to the registered parent mobile number.",
                )
                Input(
                    otp, { v -> otp = v.filter { it.isDigit() }.take(length); problem = "" }, label = "Enter $length-digit OTP",
                    keyboardType = KeyboardType.NumberPassword, maxLength = length, placeholder = "•".repeat(length),
                    onSubmit = ::submit, error = problem.ifEmpty { null },
                )
                Button("Verify OTP", ::submit, Wide, icon = Icons.Rounded.Shield, loading = verify.isLoading)
                Button(if (resendIn > 0) "Resend OTP in ${resendIn}s" else "Resend OTP", ::sendOtp, Wide, variant = Variant.Outline, icon = Icons.Rounded.Refresh, enabled = resendIn <= 0, loading = send.isLoading)
                val attempts = state["attemptsLeft"].int ?: 0
                Small("${mmss(expiresIn)} remaining · $attempts attempt${if (attempts == 1) "" else "s"} left", color = C.muted)
            }
            else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Input(
                    typedMobile, { v -> mobile = v.filter { it.isDigit() || it == '+' || it == ' ' || it == '-' }.take(16); problem = "" },
                    label = "Send OTP to", placeholder = "10-digit mobile number", keyboardType = KeyboardType.Phone, maxLength = 16,
                    hint = if (edited) null else "Registered parent number · edit it if the parent is not reachable",
                )
                if (edited) {
                    Input(
                        reason, { reason = it.take(200); problem = "" }, label = "Reason for a different number",
                        placeholder = "e.g. Father not reachable — mother’s number", maxLength = 200,
                        hint = "Recorded in the audit log and shown to the HOD and principal.",
                    )
                    Button("Use the registered number", { mobile = null; reason = ""; problem = "" }, Wide, variant = Variant.Ghost, small = true)
                }
                if (problem.isNotEmpty()) Small(problem, color = C.danger)
                Small(NOT_LIVE_TEXT[status] ?: "Send an OTP to the parent’s mobile number, then enter the code they read out.")
                Button(
                    if (resendIn > 0) "Send new OTP in ${resendIn}s" else if (status != null && status != "none") "Send new OTP" else "Send OTP",
                    ::sendOtp, Wide, icon = Icons.AutoMirrored.Rounded.Send, enabled = resendIn <= 0, loading = send.isLoading,
                )
            }
        }
    }
}

/* ── Return to campus (student, pass "active") ──────────────────── */

private val LOCATION_PERMISSIONS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

/** What the button under a failure does — each problem gets its own way out, not "turn on GPS". */
private enum class Recovery { Retry, LocationSettings, AllowPrecise, AppSettings }

/**
 * Student outside campus: one explicit location check → temporary return
 * QR/code for security. The phone sends only the raw reading; the server
 * decides. A failed check never marks the student as returned.
 */
@Composable
private fun ReturnToCampus(pass: JsonElement) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val id = pass.id.orEmpty()
    val existing = Api.returnCredential(id)
    var step by remember { mutableStateOf("idle") } // idle | intro | locating | denied | failed
    var failure by remember { mutableStateOf("") }
    var recovery by remember { mutableStateOf(Recovery.Retry) }
    var canAskAgain by remember { mutableStateOf(true) }
    var askedPrecise by remember { mutableStateOf(false) }
    var askedSettings by remember { mutableStateOf(false) }
    var fresh by remember { mutableStateOf<JsonElement?>(null) }
    var showQr by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }

    val credential = fresh ?: existing.data?.takeIf { it["code"] != null }
    val left = countdown(credential["expiresAt"].str)
    val live = credential != null && left > 0

    fun fail(message: String, how: Recovery = Recovery.Retry) {
        failure = message
        recovery = how
        step = "failed"
    }

    suspend fun locateAndVerify() {
        step = "locating"
        when (val read = readFreshLocation(context)) {
            LocationRead.PermissionDenied -> { canAskAgain = true; step = "denied" }
            LocationRead.ServicesOff -> fail(ReturnLocation.SERVICES_OFF, Recovery.LocationSettings)
            is LocationRead.Ok -> {
                val fix = read.fix
                if (fix.mocked) return fail(ReturnLocation.MOCKED)
                sending = true
                try {
                    val body = ReturnLocation.body(fix, SystemClock.elapsedRealtime(), System.currentTimeMillis())
                    fresh = Api.verifyReturnLocation(id, body)
                    step = "idle"
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val precise = hasPreciseLocation(context)
                    fail(ReturnLocation.verifyProblem(e, fix, precise), if (ReturnLocation.needsPrecise(e, fix, precise)) Recovery.AllowPrecise else Recovery.Retry)
                } finally {
                    sending = false
                }
            }
            else -> fail(ReturnLocation.problem(read))
        }
    }

    // Play services' "turn on location / improve accuracy" dialog.
    val settingsLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        when {
            result.resultCode == Activity.RESULT_OK || isLocationOn(context) -> scope.launch { locateAndVerify() }
            else -> fail(ReturnLocation.SERVICES_OFF, Recovery.LocationSettings)
        }
    }

    fun startLocating() {
        step = "locating"
        scope.launch {
            if (!askedSettings) {
                askedSettings = true
                val resolution = locationSettingsResolution(context)
                if (resolution != null) {
                    runCatching { settingsLauncher.launch(resolution) }.onFailure { locateAndVerify() }
                    return@launch
                }
            }
            locateAndVerify()
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result.values.any { it }) startLocating()
        else {
            val activity = context.findActivity()
            canAskAgain = activity?.shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION) ?: true
            step = "denied"
        }
    }

    // Upgrading approximate → precise (Android 12+ shows the "precise" choice again).
    val preciseLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (hasPreciseLocation(context)) startLocating()
        else fail(ReturnLocation.APPROXIMATE, Recovery.AppSettings)
    }

    fun checkLocation() {
        if (step == "locating") return // one check at a time
        failure = ""
        showQr = false
        when {
            !hasAnyLocation(context) -> permissionLauncher.launch(LOCATION_PERMISSIONS)
            // Approximate only: offer precise once; if declined, still try (the server may accept it).
            !hasPreciseLocation(context) && !askedPrecise -> { askedPrecise = true; permissionLauncher.launch(LOCATION_PERMISSIONS) }
            else -> startLocating()
        }
    }

    fun recover() {
        when (recovery) {
            Recovery.Retry -> checkLocation()
            Recovery.LocationSettings -> if (isLocationOn(context)) checkLocation() else scope.launch {
                // Play services' one-tap "turn on location" dialog first; the system Location page where it is unavailable.
                val resolution = locationSettingsResolution(context)
                if (resolution == null || runCatching { settingsLauncher.launch(resolution) }.isFailure) openLocationSettings(context)
            }
            // Always ask the system first: after "Keep approximate" the rationale flag is false although the
            // upgrade dialog can still be shown. Only if it is not granted is Settings offered (never opened unasked).
            Recovery.AllowPrecise -> { askedPrecise = true; preciseLauncher.launch(LOCATION_PERMISSIONS) }
            Recovery.AppSettings -> if (hasPreciseLocation(context)) checkLocation() else openAppSettings(context)
        }
    }

    if (existing.isLoading) { Loading(); return }

    if (live && step == "idle") {
        Column(
            Wide.clip(RoundedCornerShape(18.dp)).background(C.successSoft).padding(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Rounded.CheckCircle, null, Modifier.size(18.dp), tint = C.success)
                Strong("Location verified", color = C.emeraldText)
            }
            Small("You are within the campus verification area.", align = TextAlign.Center)
            Label("Return code")
            val code = credential["code"].str.orEmpty()
            T(code, Type.code, Modifier.semantics { contentDescription = "Return code ${code.toList().joinToString(" ")}" })
            if (showQr) QrImage(credential["qr"].str, "Return QR code")
            Button(if (showQr) "Hide return QR" else "Show return QR", { showQr = !showQr }, Wide, variant = Variant.Outline, icon = Icons.Rounded.QrCode)
            Small("Show this QR/code to Security. Expires in ${mmss(left)}", align = TextAlign.Center)
        }
        return
    }

    if (step == "idle") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Small(if (credential != null) "Your return code expired. Verify your location again to get a new one." else "Student is currently OUT.")
            Button("Return to campus", { step = "intro" }, Wide, icon = Icons.AutoMirrored.Rounded.Login)
        }
        return
    }

    Column(Wide.clip(RoundedCornerShape(18.dp)).background(C.primarySoft).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Strong("Verify return to campus")
        if (step == "denied") {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Rounded.LocationOff, null, Modifier.size(16.dp), tint = C.danger)
                Small(if (canAskAgain) ReturnLocation.PERMISSION else ReturnLocation.PERMISSION_BLOCKED, Modifier.weight(1f), C.danger)
            }
            Button(if (canAskAgain) "Allow location" else "Open settings", { if (canAskAgain) checkLocation() else openAppSettings(context) }, Wide, icon = Icons.Rounded.MyLocation)
        } else {
            Small("We need your current location to verify that you have returned to the college campus. It is read once, only now.")
            if (step == "failed" && failure.isNotEmpty()) Small(failure, color = C.danger)
            Button(
                when {
                    step == "locating" -> if (sending) "Verifying…" else "Finding your location…"
                    step != "failed" -> "Verify my location"
                    recovery == Recovery.LocationSettings -> "Turn on location"
                    recovery == Recovery.AllowPrecise -> "Allow precise location"
                    recovery == Recovery.AppSettings -> "Open settings"
                    else -> "Try again"
                },
                { if (step == "failed") recover() else checkLocation() }, Wide, icon = Icons.Rounded.MyLocation, loading = step == "locating",
            )
            if (step == "failed" && recovery != Recovery.Retry) Button("Try again", ::checkLocation, Wide, variant = Variant.Outline)
        }
        Button("Cancel", { step = "idle" }, Wide, variant = Variant.Ghost, enabled = step != "locating")
    }
}


/* ── Security home card lists ───────────────────────────────────── */

private data class GateListSpec(val title: String, val subtitle: String, val empty: String)

private fun gateListSpec(view: String) = when (view) {
    "in" -> GateListSpec("Students in", "On campus now · last leave period", "No students on campus")
    "out" -> GateListSpec("Students out", "Outside campus now · leave period", "Everyone is on campus")
    else -> GateListSpec("Left today", "Students who went out today", "No one has left today")
}

/** Opened from a Security home card: who it counts, with each student's leave period. */
@Composable
fun GateStudentsScreen(view: String) {
    if (view !in setOf("in", "out", "left")) return NotFoundScreen()
    val spec = gateListSpec(view)
    var search by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableStateOf(1) }
    val q = Api.securityStudents(
        mapOf("view" to view, "page" to page, "limit" to 30, "search" to search.trim().ifEmpty { null }),
        pollMs = 30_000,
    )
    val data = q.data
    val pages = data["pages"].int ?: 1
    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header(spec.title, spec.subtitle, back = true)
        Input(search, { search = it; page = 1 }, placeholder = "Search by name or roll no", maxLength = 64)
        when {
            data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            data == null -> Loading()
            else -> {
                val items = data["items"].list
                val total = data["total"].int ?: 0
                Small("$total student${if (total == 1) "" else "s"}", color = C.muted)
                if (items.isEmpty()) Card(Wide) { EmptyState(Icons.Rounded.Group, if (search.isBlank()) spec.empty else "No match for “${search.trim()}”") }
                items.forEach { GateStudentCard(it, view) }
                if (pages > 1) Row(Wide, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Button("Previous", { page-- }, variant = Variant.Soft, small = true, enabled = page > 1)
                    Small("Page $page of $pages")
                    Button("Next", { page++ }, variant = Variant.Soft, small = true, enabled = page < pages)
                }
            }
        }
    }
}

@Composable
private fun GateStudentCard(item: JsonElement, view: String) {
    val s = item["student"]
    val p = item["pass"]
    Card(Wide, gap = 10.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(s, size = 44.dp)
            Column(Modifier.weight(1f)) {
                Strong(s["name"].str, maxLines = 1)
                Small("${s["rollNo"].text ?: "—"} · Year ${s["year"].text ?: "—"} · ${s["department"].text ?: "—"}", maxLines = 1)
            }
            when {
                p["overdue"].bool -> Badge("Overdue", Tone.Danger)
                view != "in" && p["status"].str == "active" -> Badge("Outside", Tone.Warning)
                view == "left" && p["actualReturn"] != null -> Badge("Back", Tone.Success)
                isEmergency(p) -> EmergencyBadge()
            }
        }
        val period = GateLeave.period(p)
        Column(
            Wide.clip(RoundedCornerShape(14.dp)).background(C.primarySoft).padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Rounded.Schedule, null, Modifier.size(14.dp), tint = C.primary600)
                Label(if (view == "in") "Last leave" else "Leave period")
            }
            if (period == null) Small("No leave on record", color = C.muted)
            else {
                Strong(period, maxLines = 1)
                val times = listOfNotNull(
                    p["actualExit"]?.let { "Out ${Fmt.dateTime(it)}" },
                    p["actualReturn"]?.let { "In ${Fmt.dateTime(it)}" },
                )
                if (times.isNotEmpty()) Small(times.joinToString(" · "), maxLines = 1)
            }
        }
    }
}
