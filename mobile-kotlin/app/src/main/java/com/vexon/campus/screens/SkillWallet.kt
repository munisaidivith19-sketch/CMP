package com.vexon.campus.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DesktopWindows
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.MailOutline
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.vexon.campus.core.Api
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.bool
import com.vexon.campus.core.boolOrNull
import com.vexon.campus.core.errMsg
import com.vexon.campus.core.get
import com.vexon.campus.core.id
import com.vexon.campus.core.int
import com.vexon.campus.core.jsonOf
import com.vexon.campus.core.list
import com.vexon.campus.core.rememberMutation
import com.vexon.campus.core.str
import com.vexon.campus.core.text
import com.vexon.campus.nav.Nav
import com.vexon.campus.nav.Route
import com.vexon.campus.ui.Avatar
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.Body
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.ChipRow
import com.vexon.campus.ui.DateField
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.InfoRow
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.RemoteImage
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.SectionTitle
import com.vexon.campus.ui.STUDENT_ROLES
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Variant
import kotlinx.serialization.json.JsonElement
import java.net.URI
import java.time.LocalDate

/**
 * Skill Wallet on Android: a student's projects (view and create) and team
 * invitations (accept / decline). Editing, NPTEL uploads, publication and the
 * faculty workspaces are on the web. Every rule — ownership, membership, the
 * developing / implemented end-date rule — is enforced by the server; the
 * checks here only explain problems before sending.
 */

private val REVIEW_LABELS = mapOf(
    "draft" to ("Draft" to Tone.Neutral),
    "submitted" to ("Under review" to Tone.Info),
    "changes_requested" to ("Changes requested" to Tone.Warning),
    "approved" to ("Approved" to Tone.Success),
    "rejected" to ("Not approved" to Tone.Danger),
)
private val VIS_LABELS = mapOf("private" to "Private", "college" to "College-only", "public" to "Public")
private val INVITE_TONES = mapOf("pending" to Tone.Info, "accepted" to Tone.Success, "declined" to Tone.Neutral, "cancelled" to Tone.Neutral, "expired" to Tone.Warning)

@Composable
private fun ReviewBadge(status: String?) {
    val (label, tone) = REVIEW_LABELS[status] ?: ((status ?: "Draft") to Tone.Neutral)
    Badge(label, tone)
}

/** Only https links to a public host may be opened (the server validated them on save). */
internal fun safeHttps(url: String?): String? = runCatching {
    val u = URI(url!!.trim())
    if (u.scheme.equals("https", true) && !u.host.isNullOrBlank() && u.userInfo == null) u.toString() else null
}.getOrNull()

@Composable
fun SkillWalletScreen(route: Route) {
    if (me().role !in STUDENT_ROLES) {
        Screen {
            Header("Skill Wallet", back = true)
            Card(Wide) { EmptyState(Icons.Rounded.DesktopWindows, "Open on the web", "The review workspace and Innovation Gallery are on the JNN web console.") }
        }
        return
    }
    var tab by rememberSaveable { mutableStateOf(if (route.q("tab") == "invitations") "invitations" else "projects") }
    val projects = Api.swProjects(mapOf("page" to 1))
    val invitations = Api.swInvitations(mapOf("box" to "received"))
    val q = if (tab == "projects") projects else invitations
    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header("Skill Wallet", "Your projects and team invitations", back = true)
        ChipRow {
            Chip("My projects", tab == "projects") { tab = "projects" }
            val pending = invitations.data["pendingCount"].int ?: 0
            Chip(if (pending > 0) "Invitations ($pending)" else "Invitations", tab == "invitations") { tab = "invitations" }
        }
        if (tab == "projects") ProjectList(projects) else InvitationList(invitations)
        Small("NPTEL certificates, profile links, editing and publication are available on the web.")
    }
}

@Composable
private fun ProjectList(q: com.vexon.campus.core.Query) {
    Button("New project", { Nav.push("/skill-wallet/new") }, Wide, icon = Icons.Rounded.Add)
    val data = q.data
    when {
        data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
        data == null -> Loading()
        data["items"].list.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.Lightbulb, "No projects yet", "New projects stay private until you publish them on the web.") }
        else -> data["items"].list.forEach { p ->
            Card(Wide, onClick = { Nav.push("/skill-wallet/projects/${p.id}") }, gap = 6.dp) {
                Strong(p["title"].str, maxLines = 2)
                Small("${p["domain"]["label"].text ?: ""} · ${if (p["stage"].str == "implemented") "Implemented" else "Developing"} · ${if (p["mode"].str == "team") "Team of ${p["memberCount"].int ?: 1}" else "Solo"}")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    ReviewBadge(p["review"]["status"].str)
                    Badge(if (p["hidden"].bool) "Hidden" else VIS_LABELS[p["visibility"].str] ?: "Private", if (p["hidden"].bool) Tone.Danger else Tone.Neutral)
                    if (!p["isOwner"].bool) Badge("Member", Tone.Primary)
                }
            }
        }
    }
}

@Composable
private fun InvitationList(q: com.vexon.campus.core.Query) {
    val act = rememberMutation()
    val data = q.data
    when {
        data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
        data == null -> Loading()
        data["items"].list.isEmpty() -> Card(Wide) { EmptyState(Icons.Rounded.MailOutline, "No invitations", "When a classmate invites you to a team project by roll number, it appears here.") }
        else -> data["items"].list.forEach { inv ->
            val status = if (inv["expired"].bool) "expired" else inv["status"].str ?: "pending"
            val open = status == "pending"
            Card(Wide, gap = 8.dp) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Strong(if (inv["project"]["deleted"].bool) "A deleted project" else inv["project"]["title"].str ?: "Project", Modifier.weight(1f), maxLines = 2)
                    Badge(status, INVITE_TONES[status] ?: Tone.Neutral)
                }
                Small("From ${inv["inviter"]["name"].text ?: "a classmate"} · ${Fmt.timeAgo(inv["createdAt"])}")
                inv["message"].text?.let { Body("“$it”") }
                if (open) {
                    Small("Expires ${Fmt.dateTime(inv["expiresAt"])}")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button("Accept", {
                            act.launch(onError = { Dialogs.alert("Could not accept", errMsg(it)); q.refetch() }) {
                                Api.acceptSwInvitation(inv.id!!)
                                Dialogs.alert("You joined the team", "The project now appears under My projects.")
                            }
                        }, Modifier.weight(1f), variant = Variant.Success, icon = Icons.Rounded.Check, loading = act.isLoading, small = true)
                        Button("Decline", {
                            Dialogs.confirm("Decline invitation?", "The project owner will be told.", "Decline", destructive = true) {
                                act.launch(onError = { Dialogs.alert("Could not decline", errMsg(it)); q.refetch() }) { Api.declineSwInvitation(inv.id!!) }
                            }
                        }, Modifier.weight(1f), variant = Variant.Outline, icon = Icons.Rounded.Close, loading = act.isLoading, small = true)
                    }
                } else if (status == "accepted" && inv["project"].id != null && !inv["project"]["deleted"].bool) {
                    Button("Open project", { Nav.push("/skill-wallet/projects/${inv["project"].id}") }, variant = Variant.Soft, small = true)
                }
            }
        }
    }
}

@Composable
fun SwProjectScreen(id: String) {
    val q = Api.swProject(id)
    val context = LocalContext.current
    val p = q.data
    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Header(p?.get("title")?.str ?: "Project", p?.let { "${it["domain"]["label"].text ?: ""} · revision ${it["revision"].int ?: 1}" }, back = true)
        when {
            p == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            p == null -> Loading()
            else -> {
                p["imageUrl"].text?.let { RemoteImage(it, Wide.height(200.dp).clip(RoundedCornerShape(20.dp)), "Project image") }
                Card(Wide, gap = 8.dp) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        ReviewBadge(p["review"]["status"].str)
                        Badge(VIS_LABELS[p["visibility"].str] ?: "Private", Tone.Neutral)
                        if (p["hidden"].bool) Badge("Hidden by a moderator", Tone.Danger)
                    }
                    Body(p["description"].str)
                    if (p["skills"].list.isNotEmpty()) Small("Skills: " + p["skills"].list.mapNotNull { it.str }.joinToString(", "))
                }
                Card(Wide, gap = 4.dp) {
                    InfoRow("Stage", if (p["stage"].str == "implemented") "Implemented" else "Developing")
                    InfoRow("Started", Fmt.classDay(p["startedAt"], "dd MMM yyyy"))
                    if (p["stage"].str == "implemented") InfoRow("Ended", Fmt.classDay(p["endedAt"], "dd MMM yyyy"))
                    InfoRow("Mode", if (p["mode"].str == "team") "Team" else "Solo")
                }
                val links = listOfNotNull(safeHttps(p["githubUrl"].text)?.let { "GitHub repository" to it }, safeHttps(p["driveUrl"].text)?.let { "Google Drive" to it })
                if (links.isNotEmpty()) Card(Wide, gap = 8.dp) {
                    links.forEach { (label, url) -> Button(label, { openUrl(context, url) }, Wide, variant = Variant.Soft, small = true) }
                    if (p["driveUrl"].text != null) Small("Drive access depends on the link’s sharing settings.")
                }
                SectionTitle("Team")
                p["team"].list.forEach { m ->
                    Card(Wide) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Avatar(m["user"], size = 36.dp)
                            Column(Modifier.weight(1f)) {
                                Strong(m["user"]["name"].str)
                                Small(m["user"]["department"].text ?: "")
                            }
                            if (m["role"].str == "owner") Badge("Owner", Tone.Warning)
                        }
                    }
                }
                val reviews = p["reviews"].list
                if (reviews.isNotEmpty()) {
                    SectionTitle("Faculty feedback")
                    reviews.forEach { r ->
                        Card(Wide, gap = 4.dp) {
                            Strong("${r["reviewer"]["name"].text ?: "Reviewer"} · ${Fmt.titleCase(r["decision"].str)}")
                            Small("Revision ${r["revision"].int ?: 1} · ${Fmt.date(r["createdAt"])}")
                            r["feedback"].text?.let { Body(it) }
                            r["reason"].text?.let { Body("Reason: $it") }
                        }
                    }
                }
                Small("Edit the project, invite teammates, submit for review and choose who can see it on the web.")
            }
        }
    }
}

@Composable
fun NewSwProjectScreen() {
    val config = Api.swConfig()
    val create = rememberMutation()
    var title by rememberSaveable { mutableStateOf("") }
    var domain by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var skills by rememberSaveable { mutableStateOf("") }
    var stage by rememberSaveable { mutableStateOf("developing") }
    var mode by rememberSaveable { mutableStateOf("solo") }
    var startedAt by rememberSaveable { mutableStateOf<String?>(null) }
    var endedAt by rememberSaveable { mutableStateOf<String?>(null) }
    var github by rememberSaveable { mutableStateOf("") }
    var drive by rememberSaveable { mutableStateOf("") }
    var errors by rememberSaveable { mutableStateOf(mapOf<String, String>()) }
    val today = LocalDate.now()

    fun validate(): Map<String, String> {
        val e = mutableMapOf<String, String>()
        if (title.trim().length < 3) e["title"] = "Give the project a title (at least 3 characters)"
        if (domain.isBlank()) e["domain"] = "Choose a domain"
        if (description.trim().length < 10) e["description"] = "Describe the project in at least 10 characters"
        if (startedAt == null) e["startedAt"] = "Choose the start date"
        if (stage == "implemented") {
            when {
                endedAt == null -> e["endedAt"] = "An implemented project needs an end date"
                startedAt != null && endedAt!! < startedAt!! -> e["endedAt"] = "The end date cannot be earlier than the start date"
            }
        }
        if (github.isNotBlank() && safeHttps(github) == null) e["github"] = "Use a full https://github.com/owner/repository link"
        if (drive.isNotBlank() && safeHttps(drive) == null) e["drive"] = "Use a full https:// Google Drive link"
        return e
    }

    Screen {
        Header("New project", "Private until you publish it on the web", back = true)
        val data = config.data
        if (data == null) {
            if (config.error != null) ErrorState(config.error) { config.refetch() } else Loading()
            return@Screen
        }
        Input(title, { title = it }, Wide, label = "Project title *", error = errors["title"], maxLength = 140)
        Label("Project domain *")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            data["domains"].list.filter { it["active"].boolOrNull != false }.forEach { d ->
                Chip(d["label"].str ?: "", domain == d["key"].str) { domain = d["key"].str ?: "" }
            }
        }
        errors["domain"]?.let { Small(it, color = com.vexon.campus.ui.C.roseText) }
        Input(description, { description = it }, Wide, label = "Project description *", multiline = true, error = errors["description"], maxLength = 5000)
        Input(skills, { skills = it }, Wide, label = "Skills learned", placeholder = "e.g. react, esp32, mqtt", hint = "Separate skills with commas (up to 20)")
        Label("Project mode *")
        ChipRow {
            Chip("Solo", mode == "solo") { mode = "solo" }
            Chip("Team", mode == "team") { mode = "team" }
        }
        Label("Development stage *")
        ChipRow {
            Chip("Developing", stage == "developing") { stage = "developing"; endedAt = null }
            Chip("Implemented", stage == "implemented") { stage = "implemented" }
        }
        DateField("Started on *", startedAt?.let(LocalDate::parse), { startedAt = it.toString() }, max = today, error = errors["startedAt"])
        if (stage == "implemented") {
            DateField("Ended on *", endedAt?.let(LocalDate::parse), { endedAt = it.toString() }, min = startedAt?.let(LocalDate::parse), max = today, error = errors["endedAt"])
        } else {
            Small("No end date while the project is developing.")
        }
        Input(github, { github = it }, Wide, label = "GitHub repository (optional)", placeholder = "https://github.com/owner/repository", error = errors["github"])
        Input(drive, { drive = it }, Wide, label = "Google Drive link (optional)", placeholder = "https://drive.google.com/…", error = errors["drive"], hint = "Check the sharing settings — VEXON does not open Drive links.")
        Small("Add a project image from the web.")
        Button("Create project", {
            val e = validate()
            errors = e
            if (e.isNotEmpty()) return@Button
            create.launch(onError = { Dialogs.alert("Could not create the project", errMsg(it)) }) {
                val saved = Api.createSwProject(jsonOf(
                    "title" to title.trim(),
                    "domain" to domain,
                    "description" to description.trim(),
                    "skills" to skills.split(",").map { it.trim() }.filter { it.isNotEmpty() },
                    "stage" to stage,
                    "startedAt" to startedAt,
                    // Developing projects never carry an end date (the server rejects one).
                    "endedAt" to if (stage == "implemented") endedAt else null,
                    "mode" to mode,
                    "githubUrl" to github.trim(),
                    "driveUrl" to drive.trim(),
                ))
                Nav.replace(saved.id?.let { "/skill-wallet/projects/$it" } ?: "/skill-wallet")
            }
        }, Wide, loading = create.isLoading)
    }
}
