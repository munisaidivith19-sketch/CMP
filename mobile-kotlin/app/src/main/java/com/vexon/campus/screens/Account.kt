package com.vexon.campus.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Cancel
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.LaptopChromebook
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.Smartphone
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.vexon.campus.core.Api
import com.vexon.campus.core.ApiException
import com.vexon.campus.core.Auth
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.bool
import com.vexon.campus.core.errMsg
import com.vexon.campus.core.get
import com.vexon.campus.core.id
import com.vexon.campus.core.jsonOf
import com.vexon.campus.core.list
import com.vexon.campus.core.rememberMutation
import com.vexon.campus.core.sameId
import com.vexon.campus.core.str
import com.vexon.campus.core.text
import com.vexon.campus.ui.ACADEMIC_YEARS
import com.vexon.campus.ui.Avatar
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.DEPARTMENTS
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.ROLE_LABELS
import com.vexon.campus.ui.SECTIONS
import com.vexon.campus.ui.STUDENT_ROLES
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.SectionTitle
import com.vexon.campus.ui.Sheet
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.T
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Variant
import com.vexon.campus.ui.YEAR_LABELS
import com.vexon.campus.ui.semestersOfYear
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement

/* ── Account security ───────────────────────────────────────────── */

@Composable
private fun ChangePassword() {
    val change = rememberMutation()
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    Card(Wide, gap = 12.dp) {
        Input(current, { current = it }, label = "Current password", password = true, keyboardType = KeyboardType.Password)
        Input(next, { next = it }, label = "New password", password = true, keyboardType = KeyboardType.Password, hint = "8–72 characters, a letter and a number")
        Input(confirm, { confirm = it }, label = "Confirm new password", password = true, keyboardType = KeyboardType.Password)
        Button("Update password", {
            when {
                next.length < 8 || !next.any { it.isLetter() } || !next.any { it.isDigit() } -> Dialogs.alert("Weak password", "Use 8+ characters with a letter and a number.")
                next != confirm -> Dialogs.alert("Passwords do not match")
                else -> change.launch(onError = { Dialogs.alert("Could not change password", errMsg(it)) }) {
                    val session = Api.changePassword(jsonOf("currentPassword" to current, "newPassword" to next))
                    withContext(Dispatchers.IO) { Auth.saveRefreshToken(session["refreshToken"].str) }
                    Auth.setCredentials(session)
                    current = ""; next = ""; confirm = ""
                    Dialogs.alert("Password changed", "Your other devices were signed out.")
                }
            }
        }, Wide, loading = change.isLoading, enabled = current.isNotEmpty() && next.isNotEmpty())
    }
}

@Composable
fun SecuritySettingsScreen() {
    val sessions = Api.sessions()
    val history = Api.loginHistory(mapOf("limit" to 15))
    val revoke = rememberMutation()
    val revokeOthers = rememberMutation()
    val others = sessions.data.list.filter { !it["current"].bool }

    Screen(refreshing = sessions.isFetching, onRefresh = { sessions.refetch(); history.refetch() }) {
        Header("Account security", "Devices, password and sign-in history.", back = true)
        SectionTitle("Signed-in devices")
        val list = sessions.data
        when {
            list == null && sessions.error != null -> ErrorState(sessions.error) { sessions.refetch() }
            list == null -> Loading()
            else -> Card(Wide, gap = 12.dp) {
                list.list.forEach { s ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(if (s["client"].str == "mobile") Icons.Rounded.Smartphone else Icons.Rounded.LaptopChromebook, null, Modifier.size(20.dp), tint = C.primary)
                        Column(Modifier.weight(1f)) {
                            Strong(s["device"].text ?: "Unknown device", maxLines = 1)
                            Small("Active ${Fmt.timeAgo(s["lastUsedAt"])}")
                        }
                        if (s["current"].bool) Badge("This device", Tone.Success)
                        else Button("Sign out", { revoke.launch(onError = { Dialogs.alert("Error", errMsg(it)) }) { Api.revokeSession(s.id.orEmpty()) } }, variant = Variant.Ghost, small = true)
                    }
                }
                if (others.isNotEmpty()) Button("Sign out all other devices", {
                    Dialogs.confirm("Sign out other devices?", "Every other browser and phone will need to sign in again.", "Sign out", destructive = true) {
                        revokeOthers.launch(onError = { Dialogs.alert("Error", errMsg(it)) }) { Api.revokeOtherSessions() }
                    }
                }, Wide, variant = Variant.Danger, loading = revokeOthers.isLoading)
            }
        }

        SectionTitle("Change password")
        ChangePassword()

        SectionTitle("Sign-in history")
        Card(Wide, gap = 10.dp) {
            if (history.isLoading) Loading()
            history.data["records"].list.forEach { r ->
                val ok = r["success"].bool
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(if (ok) Icons.Rounded.CheckCircle else Icons.Rounded.Cancel, null, Modifier.size(18.dp), tint = if (ok) C.success else C.danger)
                    Column(Modifier.weight(1f)) {
                        Strong("${if (ok) "Signed in" else "Failed sign-in"} · ${r["device"].text ?: "Unknown"}", maxLines = 1)
                        Small(Fmt.dateTime(r["createdAt"]))
                    }
                }
            }
        }
    }
}

/* ── Admin: create login ────────────────────────────────────────── */

/** Fields per account type — mirrors the server's CREATE_FIELDS and the web form. */
private val FORMS = linkedMapOf(
    "student" to listOf("name", "rollNo", "department", "year", "section", "stayType", "email", "phone", "parentPhone", "password"),
    // Class In Charge = section + in-charge year + in-charge semester ("Our Class").
    "faculty" to listOf("name", "employeeId", "department", "teachingYears", "section", "inChargeYear", "inChargeSemester", "email", "phone", "password"),
    "hod" to listOf("name", "employeeId", "department", "email", "phone", "password"),
    "principal" to listOf("name", "employeeId", "email", "phone", "password"),
    "security" to listOf("name", "employeeId", "email", "phone", "password"),
)
private val REQUIRED = setOf(
    "name", "email", "password", "rollNo", "year", "section", "department", "stayType", "parentPhone", "employeeId", "teachingYears",
    "inChargeYear", "inChargeSemester",
)
private val FIELD_LABELS = mapOf(
    "department" to "Department", "year" to "Year", "stayType" to "Stay", "teachingYears" to "Year(s) handling",
    "inChargeYear" to "In-charge year", "inChargeSemester" to "In-charge semester",
)

private data class TextSpec(val label: String, val keyboard: KeyboardType = KeyboardType.Text, val placeholder: String? = null, val maxLength: Int? = null, val hint: String? = null)

private val TEXT_FIELDS = mapOf(
    "name" to TextSpec("Full name"),
    "rollNo" to TextSpec("Roll number"),
    "employeeId" to TextSpec("Employee ID"),
    "email" to TextSpec("College email (username)", KeyboardType.Email, "name@jnn.edu.in"),
    "phone" to TextSpec("Mobile", KeyboardType.Phone, maxLength = 20),
    "parentPhone" to TextSpec("Parent mobile", KeyboardType.Phone, maxLength = 20),
    "password" to TextSpec("Set password", hint = "At least 8 characters with a letter and a number"),
)

@Composable
fun CreateUserScreen() {
    val me = me()
    var role by rememberSaveable { mutableStateOf("student") }
    val v = remember { mutableStateMapOf<String, String>() }
    var teachingYears by remember { mutableStateOf(listOf<Int>()) }
    val errors = remember { mutableStateMapOf<String, String>() }
    val create = rememberMutation()

    if (me.role != "admin") {
        Screen {
            Header("Create login", back = true)
            Card(Wide) { EmptyState(title = "Admins only") }
        }
        return
    }

    val fields = FORMS.getValue(role)
    fun value(k: String) = v[k].orEmpty()
    fun set(k: String, value: String) {
        v[k] = value
        // The in-charge semester must belong to the in-charge year (year 3 → 5 or 6).
        if (k == "inChargeYear" && value("inChargeSemester").toIntOrNull() !in semestersOfYear(value.toIntOrNull())) v["inChargeSemester"] = ""
    }
    val missing = fields.filter { k -> k in REQUIRED && if (k == "teachingYears") teachingYears.isEmpty() else value(k).isBlank() }

    fun submit() {
        val body = linkedMapOf<String, Any?>("role" to role)
        fields.forEach { k ->
            if (k == "teachingYears") {
                if (teachingYears.isNotEmpty()) body[k] = teachingYears
                return@forEach
            }
            val raw = value(k).trim()
            if (raw.isNotEmpty()) body[k] = when (k) {
                "year", "inChargeYear", "inChargeSemester" -> raw.toInt()
                "section", "rollNo", "employeeId" -> raw.uppercase()
                else -> raw
            }
        }
        // Faculty's class in charge is also their (sole) section handled.
        if (role == "faculty" && body["section"] != null) body["teachingSections"] = listOf(body["section"])
        create.launch(onError = { e ->
            errors.clear()
            (e as? ApiException)?.data["errors"].list.forEach { x -> x["field"].str?.let { errors[it] = x["message"].str.orEmpty() } }
            Dialogs.alert("Could not create login", errMsg(e))
        }) {
            val user = Api.createAdminUser(com.vexon.campus.core.toJson(body))
            Dialogs.alert("Login created", "${ROLE_LABELS[role]} ${user["name"].str}\nUsername: ${user["email"].str}")
            // Keep class details so the next student of the same class is quick to add.
            val keep = if (role == "student") listOf("department", "year", "section").associateWith { value(it) } else emptyMap()
            v.clear()
            v.putAll(keep)
            teachingYears = emptyList()
            errors.clear()
        }
    }

    @Composable
    fun chips(k: String, options: List<Pair<String, String>>, label: String = FIELD_LABELS[k] ?: k) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Label(label + if (k in REQUIRED) " *" else "")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (options.isEmpty()) Small("Select a year first")
                options.forEach { (value, text) ->
                    if (k == "teachingYears") {
                        val y = value.toInt()
                        Chip(text, y in teachingYears) {
                            val list = if (y in teachingYears) teachingYears - y else teachingYears + y
                            teachingYears = ACADEMIC_YEARS.filter { it in list }
                        }
                    } else {
                        Chip(text, value(k) == value) { set(k, if (value(k) == value && k !in REQUIRED) "" else value) }
                    }
                }
            }
            errors[k]?.let { Small(it, color = C.roseText) }
        }
    }

    Screen {
        Header("Create login", "The college email is the username.", back = true)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FORMS.keys.forEach { r -> Chip(ROLE_LABELS[r] ?: r, role == r) { role = r; errors.clear() } }
        }
        Card(Wide, gap = 12.dp) {
            fields.forEach { k ->
                when (k) {
                    "year", "inChargeYear" -> chips(k, ACADEMIC_YEARS.map { "$it" to YEAR_LABELS.getValue(it) })
                    "section" -> chips(k, SECTIONS.map { it to it }, if (role == "faculty") "Class in charge" else "Section")
                    "teachingYears" -> chips(k, ACADEMIC_YEARS.map { "$it" to YEAR_LABELS.getValue(it) })
                    "inChargeSemester" -> chips(k, semestersOfYear(value("inChargeYear").toIntOrNull()).map { "$it" to "Semester $it" })
                    "department" -> chips(k, DEPARTMENTS.map { it to it })
                    "stayType" -> chips(k, listOf("hosteler" to "Hosteler", "day_scholar" to "Day Scholar"))
                    else -> {
                        val spec = TEXT_FIELDS.getValue(k)
                        val label = if (k == "phone" && role == "student") "Student mobile" else spec.label
                        Input(
                            value(k), { set(k, it) }, label = label + if (k in REQUIRED) " *" else "", error = errors[k],
                            keyboardType = spec.keyboard, placeholder = spec.placeholder, maxLength = spec.maxLength, hint = spec.hint,
                        )
                    }
                }
            }
        }
        Button("Create ${ROLE_LABELS[role]} login", ::submit, Wide, icon = Icons.Rounded.PersonAdd, loading = create.isLoading, enabled = missing.isEmpty())
    }
}

/* ── Admin / principal: group requests ──────────────────────────── */

private val CATEGORY_LABEL = mapOf("custom" to "Custom", "academic" to "Academics", "faculty" to "Faculty")
private val REVIEWERS = setOf("admin", "principal")

/**
 * Approve or reject group requests: the admin reviews faculty class groups,
 * the principal reviews the groups HODs ask to create (with their reason).
 */
@Composable
fun ChatRequestsScreen() {
    val me = me()
    val isReviewer = me.role in REVIEWERS
    val q = Api.groupRequests(skip = !isReviewer)
    val review = rememberMutation()
    var rejecting by remember { mutableStateOf<JsonElement?>(null) }
    var reason by remember { mutableStateOf("") }

    if (!isReviewer) {
        Screen {
            Header("Group requests", back = true)
            Card(Wide) { EmptyState(Icons.Rounded.Groups, "For the admin and principal", "Your group requests are listed on the Messages tab.") }
        }
        return
    }

    fun act(id: String, action: String, why: String? = null) = review.launch(onError = { Dialogs.alert("Could not update", errMsg(it)) }) {
        Api.reviewGroupRequest(id, jsonOf("action" to action, "reason" to (why?.takeIf { it.isNotEmpty() } ?: com.vexon.campus.core.Omit)))
        rejecting = null
        reason = ""
        Dialogs.alert(if (action == "approve") "Group approved" else "Request rejected", if (action == "approve") "Members have been notified." else "The requester has been told.")
    }

    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header(
            "Group requests",
            if (me.role == "principal") "Groups HODs want to create — check who is in them and why." else "Faculty class groups go live after you approve them.",
            back = true,
        )
        val data = q.data
        when {
            data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            data == null -> Loading()
            data.list.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.Groups, "No pending requests", "New requests appear here and in your notifications.") }
            else -> data.list.forEach { r ->
                val members = r["participants"].list.filter { !sameId(it, r["createdBy"]) }
                val students = members.filter { it.role in STUDENT_ROLES }
                val sections = students.mapNotNull { it["section"].text }.distinct()
                Card(Wide, gap = 10.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Avatar(r["createdBy"], size = 40.dp)
                        Column(Modifier.weight(1f)) {
                            Strong(r["name"].str, maxLines = 1)
                            Small("${r["createdBy"]["name"].str ?: ""} · ${ROLE_LABELS[r["createdBy"].role] ?: ""} · ${Fmt.timeAgo(r["createdAt"])}", maxLines = 1)
                        }
                        Badge("pending", Tone.Warning)
                    }
                    r["category"].text?.let { cat ->
                        Small("${CATEGORY_LABEL[cat] ?: cat} group${r["linkedYear"].text?.let { " · Year $it Sec ${r["linkedSection"].str ?: ""}" } ?: ""}", color = C.primary)
                    }
                    r["reason"].text?.let { T("Reason: $it") }
                    Small(
                        "${members.size} member${if (members.size == 1) "" else "s"}" +
                            (if (students.isNotEmpty()) " · ${students.size} students" else "") +
                            (if (sections.isNotEmpty()) " · Sec ${sections.joinToString(", ")}" else ""),
                    )
                    Small(members.joinToString("\n") { m ->
                        listOfNotNull(m["name"].text, ROLE_LABELS[m.role], m["rollNo"].text, m["section"].text?.let { "Sec $it" }).joinToString(" · ")
                    })
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button("Reject", { rejecting = r }, Modifier.weight(1f), variant = Variant.Danger, icon = Icons.Rounded.Close, small = true, enabled = !review.isLoading)
                        Button("Approve", { act(r.id.orEmpty(), "approve") }, Modifier.weight(1f), variant = Variant.Success, icon = Icons.Rounded.Check, small = true, loading = review.isLoading && rejecting == null)
                    }
                }
            }
        }
    }

    rejecting?.let { r ->
        Sheet(null, onClose = { rejecting = null }) {
            H2("Reject “${r["name"].str ?: ""}”?")
            Input(reason, { reason = it }, label = "Reason (optional)", multiline = true, maxLength = 300)
            Button("Reject request", { act(r.id.orEmpty(), "reject", reason.trim()) }, Wide, variant = Variant.Danger, loading = review.isLoading)
            Button("Cancel", { rejecting = null }, Wide, variant = Variant.Ghost)
        }
    }
}
