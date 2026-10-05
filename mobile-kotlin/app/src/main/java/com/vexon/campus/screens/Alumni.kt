package com.vexon.campus.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.automirrored.rounded.TrendingUp
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.HowToReg
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Work
import androidx.compose.material3.Icon
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vexon.campus.core.Api
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.Omit
import com.vexon.campus.core.Query
import com.vexon.campus.core.bool
import com.vexon.campus.core.errMsg
import com.vexon.campus.core.get
import com.vexon.campus.core.id
import com.vexon.campus.core.int
import com.vexon.campus.core.jsonOf
import com.vexon.campus.core.list
import com.vexon.campus.core.rememberMutation
import com.vexon.campus.core.str
import com.vexon.campus.core.strings
import com.vexon.campus.core.text
import com.vexon.campus.nav.Nav
import com.vexon.campus.nav.Route
import com.vexon.campus.ui.Avatar
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.Body
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.ChipRow
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.H3
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.Opt
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.Segmented
import com.vexon.campus.ui.Sheet
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.StatusBadge
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.T
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Type
import com.vexon.campus.ui.Variant
import kotlinx.serialization.json.JsonElement
import java.time.Instant

/* ── Shared ─────────────────────────────────────────────────────── */

val ALUMNI_DOMAINS = listOf(
    "software_engineering" to "Software Eng", "data_science" to "Data & AI", "core_engineering" to "Core Eng",
    "cybersecurity" to "Cybersecurity", "higher_studies" to "Higher Studies", "entrepreneurship" to "Startups",
)
private val ALUMNI_STAFF = setOf("admin", "hod", "principal", "dean", "chairman")

/** Divider line + row used as a card footer. */
@Composable
fun CardFooter(content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Column {
        Box(Wide.height(1.dp).background(C.border))
        Row(Wide.padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically, content = content)
    }
}

@Composable
fun MiniTag(text: String) {
    Box(Modifier.clip(RoundedCornerShape(6.dp)).background(C.primarySoft).padding(horizontal = 8.dp, vertical = 3.dp)) {
        T(text, Type.small.copy(fontSize = 11.sp), color = C.primary600)
    }
}

/** List body for a tab: loading / error / pull-to-refresh lazy list. */
@Composable
private fun TabList(q: Query, items: (JsonElement) -> List<JsonElement>, loading: String, empty: @Composable () -> Unit, row: @Composable (JsonElement) -> Unit) {
    val data = q.data
    when {
        data == null && q.error != null -> Box(Modifier.padding(16.dp)) { ErrorState(q.error) { q.refetch() } }
        data == null -> Loading(loading)
        else -> PullToRefreshBox(isRefreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }, modifier = Modifier.fillMaxSize()) {
            val list = items(data)
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (list.isEmpty()) item { empty() }
                items(list, key = { it.id ?: it["slug"].str ?: it.hashCode() }) { row(it) }
            }
        }
    }
}

/** "Request mentorship" bottom sheet used by the directory and the alumni profile. */
@Composable
fun MentorshipRequestSheet(mentorName: String?, alumniUserId: String, initialDomain: String, onClose: () -> Unit, onSent: () -> Unit = {}) {
    var domain by remember { mutableStateOf(initialDomain) }
    var message by remember { mutableStateOf("") }
    val create = rememberMutation()
    Sheet("Request Mentorship", onClose) {
        Small("Request guidance from ${mentorName ?: ""}")
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Label("Focus Domain")
            ChipRow { ALUMNI_DOMAINS.forEach { (k, l) -> Chip(l, domain == k) { domain = k } } }
        }
        Input(message, { message = it }, label = "Note to mentor", placeholder = "Explain your goals, questions, and what guidance you are seeking...", multiline = true, minLines = 4)
        Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button("Cancel", onClose, Modifier.weight(1f), variant = Variant.Outline)
            Button("Send Request", {
                create.launch(onError = { Dialogs.alert("Could not send request", errMsg(it, "Could not send request")) }) {
                    Api.createMentorshipRequest(jsonOf("alumni" to alumniUserId, "domain" to domain, "message" to message.trim()))
                    onClose()
                    onSent()
                }
            }, Modifier.weight(1f), loading = create.isLoading, enabled = message.trim().length >= 5)
        }
    }
}

/* ── Alumni hub ─────────────────────────────────────────────────── */

private val ALUMNI_TABS = listOf(
    Opt("directory", "Directory"), Opt("jobs", "Jobs"), Opt("events", "Events"),
    Opt("chapters", "Chapters"), Opt("mentorship", "Mentorship"), Opt("profile", "My Profile"),
)

@Composable
fun AlumniScreen(route: Route) {
    val user = me()
    // Notification links use the web's tab names (e.g. /alumni?tab=my_profile).
    val initial = when (val t = route.q("tab")) {
        "my_profile" -> "profile"
        in ALUMNI_TABS.map { it.value } -> t!!
        else -> "directory"
    }
    var tab by rememberSaveable { mutableStateOf(initial) }
    val isStaff = user.role in ALUMNI_STAFF
    val isAlumni = user.role == "alumni"
    val isStudent = user.role in setOf("student", "club_admin")

    Screen(scroll = false) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Header("Alumni Network", "Connect with mentors, careers, and chapters.", back = true, right = if (isStaff) ({
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AdminAction(Icons.Rounded.HowToReg, "Verification queue") { Nav.push("/alumni/admin/verification") }
                    AdminAction(Icons.AutoMirrored.Rounded.TrendingUp, "Analytics") { Nav.push("/alumni/admin/analytics") }
                }
            }) else null)
            Segmented(ALUMNI_TABS, tab, { tab = it })
        }
        Box(Modifier.weight(1f).padding(top = 8.dp)) {
            when (tab) {
                "directory" -> DirectoryTab(isStudent)
                "jobs" -> JobsTab(isAlumni || isStaff)
                "events" -> EventsTab(isAlumni || isStaff)
                "chapters" -> ChaptersTab()
                "mentorship" -> MentorshipTab(isStudent, isAlumni)
                "profile" -> MyProfileTab(user)
            }
        }
    }
}

@Composable
private fun AdminAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Box(
        Modifier.size(36.dp).clip(RoundedCornerShape(14.dp)).background(C.primarySoft).clickable(onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, Modifier.size(18.dp), tint = C.primary600) }
}

private fun careerLine(profile: JsonElement?, user: JsonElement?): String {
    val d = profile["designation"].text
    val c = profile["company"].text
    return (d ?: "") + (if (d != null && c != null) " at " else "") + (c ?: if (d == null) user["designation"].text ?: "Alumnus" else "")
}

@Composable
private fun DirectoryTab(isStudent: Boolean) {
    var search by rememberSaveable { mutableStateOf("") }
    var dept by rememberSaveable { mutableStateOf("") }
    var mentorshipOnly by rememberSaveable { mutableStateOf(false) }
    var referralsOnly by rememberSaveable { mutableStateOf(false) }
    var requestFor by remember { mutableStateOf<JsonElement?>(null) }
    val filters = Api.alumniFilters()
    val q = Api.alumni(mapOf(
        "search" to search.trim().ifEmpty { null }, "department" to dept.ifEmpty { null },
        "mentorshipAvailable" to (if (mentorshipOnly) "true" else null), "openToReferrals" to (if (referralsOnly) "true" else null), "limit" to 30,
    ))

    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Input(search, { search = it }, placeholder = "Search name, company, skills...")
            ChipRow {
                Chip("All Depts", dept.isEmpty()) { dept = "" }
                filters.data["departments"].strings.forEach { d -> Chip(d, dept == d) { dept = if (dept == d) "" else d } }
                Chip("Mentors Only", mentorshipOnly) { mentorshipOnly = !mentorshipOnly }
                Chip("Referrals Only", referralsOnly) { referralsOnly = !referralsOnly }
            }
        }
        TabList(q, { it["items"].list }, "Loading directory...", { EmptyState(Icons.Rounded.School, "No Alumni Found", "Try adjusting search or filters to see more alumni.") }) { item ->
            val u = item["user"]
            val userId = u.id.orEmpty()
            Card(Wide, onClick = { Nav.push("/alumni/$userId") }, gap = 12.dp) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Avatar(u, size = 48.dp)
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Strong(u["name"].text ?: "Alumnus", Modifier.weight(1f, fill = false), maxLines = 1)
                            if (item["isVerified"].bool) Badge("Verified", Tone.Success)
                        }
                        Small(careerLine(item, u), color = C.ink, maxLines = 1)
                        Small("${u["department"].str ?: ""} ${item["gradYear"].text?.let { "· Class of '${it.takeLast(2)}" } ?: ""}", color = C.muted)
                    }
                }
                val skills = item["skills"].strings
                if (skills.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    skills.take(3).forEach { MiniTag(it) }
                    if (skills.size > 3) T("+${skills.size - 3} more", Type.small.copy(fontSize = 11.sp), color = C.soft)
                }
                CardFooter {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (item["mentorshipAvailable"].bool) Badge("Mentoring", Tone.Primary)
                        if (item["openToReferrals"].bool) Badge("Referrals", Tone.Info)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (isStudent && item["mentorshipAvailable"].bool) Button("Request", { requestFor = item }, variant = Variant.Soft, small = true)
                        Button("Profile", { Nav.push("/alumni/$userId") }, variant = Variant.Outline, small = true)
                    }
                }
            }
        }
    }
    requestFor?.let { m ->
        MentorshipRequestSheet(m["user"]["name"].str, m["user"].id.orEmpty(), m["domains"].strings.firstOrNull() ?: "software_engineering", onClose = { requestFor = null })
    }
}

@Composable
private fun JobsTab(canPost: Boolean) {
    var mine by rememberSaveable { mutableStateOf(false) }
    val q = Api.alumniJobs(if (mine) mapOf("mine" to true) else emptyMap())
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (canPost) Box(Modifier.weight(1f)) {
                ChipRow {
                    Chip("All Open Roles", !mine) { mine = false }
                    Chip("Posted by Me", mine) { mine = true }
                }
            } else Small("Verified job postings and campus referrals", Modifier.weight(1f))
            if (canPost) Button("Post Job", { Nav.push("/alumni/jobs/new") }, icon = Icons.Rounded.Add, small = true)
        }
        TabList(q, { it["items"].list }, "Loading opportunities...", { EmptyState(Icons.Rounded.Work, "No Jobs Found", "No open job listings right now. Check back soon!") }) { j ->
            Card(Wide, onClick = { Nav.push("/alumni/jobs/${j.id}") }, gap = 10.dp) {
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f).padding(end = 8.dp)) {
                        Strong(j["title"].str, maxLines = 1)
                        Small(j["company"].str, color = C.ink)
                    }
                    Badge(j["type"].str.orEmpty().replaceFirst("_", " "), Tone.Primary)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    IconText(Icons.Rounded.Place, "${j["location"].str ?: ""} (${j["workMode"].str ?: ""})")
                    j["deadline"].text?.let { IconText(Icons.Rounded.CalendarMonth, "Closes ${Fmt.date(it, "MMM d")}") }
                }
                CardFooter {
                    Small("Posted by ${j["postedBy"]["name"].text ?: "Alumnus"}", color = C.muted)
                    T("View details →", Type.small.copy(fontWeight = FontWeight.Bold), color = C.primary600)
                }
            }
        }
    }
}

@Composable
fun IconText(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, tint: Color = C.soft) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(icon, null, Modifier.size(13.dp), tint = tint)
        Small(text)
    }
}

@Composable
private fun EventsTab(canPropose: Boolean) {
    var whenTab by rememberSaveable { mutableStateOf("upcoming") }
    val q = Api.alumniEvents(mapOf("when" to whenTab))
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Segmented(listOf(Opt("upcoming", "Upcoming"), Opt("mine", "My RSVPs"), Opt("past", "Past")), whenTab, { whenTab = it }, Modifier.weight(1f))
            if (canPropose) Button("Host", { Nav.push("/alumni/events/new") }, icon = Icons.Rounded.Add, variant = Variant.Soft, small = true)
        }
        TabList(q, { it["items"].list }, "Loading events...", { EmptyState(Icons.Rounded.CalendarMonth, "No Events Found", "No alumni reunions or sessions in this category.") }) { e ->
            Card(Wide, onClick = { Nav.push("/alumni/events/${e.id}") }, gap = 10.dp) {
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f).padding(end = 8.dp)) {
                        Strong(e["title"].str, maxLines = 1)
                        Small(Fmt.date(e["startsAt"], "EEE, MMM d, yyyy · h:mm a"), color = C.muted)
                    }
                    Badge(e["type"].str, Tone.Info)
                }
                IconText(Icons.Rounded.Place, if (e["mode"].str == "virtual") "Virtual (Meeting link upon RSVP)" else e["venue"].text ?: "Campus")
                CardFooter {
                    Small("${e["attendeeCount"].int ?: 0} attending ${e["capacity"].text?.let { "/ $it max" } ?: ""}", color = C.muted)
                    T(if (e["userRsvp"].truthy()) "Registered ✓" else "RSVP →", Type.small.copy(fontWeight = FontWeight.Bold), color = C.primary600)
                }
            }
        }
    }
}

/** JS truthiness of a JSON value that may be an object, string or boolean. */
fun JsonElement?.isFalse(): Boolean = this == null || (this as? kotlinx.serialization.json.JsonPrimitive)?.content.let { it == "false" || it == "" || it == "0" || it == "null" }
fun JsonElement?.truthy(): Boolean = !isFalse()

@Composable
private fun ChaptersTab() {
    val q = Api.chapters()
    TabList(q, { it.list }, "Loading chapters...", { EmptyState(Icons.Rounded.Group, "No Chapters Yet", "Regional and departmental chapters will appear here.") }) { c ->
        Card(Wide, onClick = { Nav.push("/alumni/chapters/${c["slug"].str}") }, gap = 10.dp) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).padding(end = 8.dp)) {
                    Strong(c["name"].str)
                    Small("${c["type"].str.orEmpty().uppercase()} CHAPTER", color = C.muted)
                }
                Badge("${c["memberCount"].int ?: 0} members", Tone.Primary)
            }
            c["description"].text?.let { Body(it, color = C.soft, maxLines = 2) }
            CardFooter {
                val member = c["isMember"].bool
                T(if (member) "Joined Community ✓" else "View Community Wall", Type.small.copy(fontWeight = FontWeight.Bold), color = if (member) C.success else C.soft)
                T("Open →", Type.small.copy(fontWeight = FontWeight.Bold), color = C.primary600)
            }
        }
    }
}

@Composable
private fun MentorshipTab(isStudent: Boolean, isAlumni: Boolean) {
    val q = Api.mentorshipRequests()
    val respond = rememberMutation()
    val requests = q.data["items"].list
    PullToRefreshBox(isRefreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Card(Modifier.weight(1f), onClick = { Nav.push("/alumni/sessions") }, horizontalAlignment = Alignment.CenterHorizontally, gap = 6.dp) {
                    Icon(Icons.Rounded.CalendarMonth, null, Modifier.size(24.dp), tint = C.primary)
                    Strong("Sessions")
                    Small("Scheduled 1-on-1s", align = TextAlign.Center)
                }
                if (isStudent) Card(Modifier.weight(1f), onClick = { Nav.push("/alumni/sessions/book") }, horizontalAlignment = Alignment.CenterHorizontally, gap = 6.dp) {
                    Icon(Icons.Rounded.AutoAwesome, null, Modifier.size(24.dp), tint = C.primary)
                    Strong("Book Slot")
                    Small("Choose a mentor slot", align = TextAlign.Center)
                }
            }
            H3("Mentorship Connections")
            when {
                q.data == null && q.error == null -> Loading("Loading mentorships...")
                requests.isEmpty() -> EmptyState(
                    Icons.Rounded.Group, "No Mentorship Requests",
                    if (isStudent) "Find an alumnus in the Directory and request 1-on-1 mentorship." else "Students will reach out to you for mentorship guidance.",
                )
                else -> requests.forEach { r ->
                    val counterpart = if (isStudent) r["alumni"] else r["student"]
                    Card(Wide, gap = 10.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Avatar(counterpart, size = 40.dp)
                                Column(Modifier.weight(1f)) {
                                    Strong(counterpart["name"].text ?: "User", maxLines = 1)
                                    Small(r["domain"].text?.replaceFirst("_", " ") ?: "General", color = C.muted)
                                }
                            }
                            StatusBadge(r["status"].str)
                        }
                        r["message"].text?.let {
                            Box(Wide.clip(RoundedCornerShape(10.dp)).background(Color(0x08000000)).padding(10.dp)) { Small("\"$it\"", color = C.ink) }
                        }
                        if (isAlumni && r["status"].str == "pending") Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button("Accept", { respond.launch { Api.respondMentorshipRequest(r.id.orEmpty(), jsonOf("status" to "accepted")) } }, Modifier.weight(1f), variant = Variant.Success, small = true, loading = respond.isLoading)
                            Button("Decline", { respond.launch { Api.respondMentorshipRequest(r.id.orEmpty(), jsonOf("status" to "declined")) } }, Modifier.weight(1f), variant = Variant.Outline, small = true, loading = respond.isLoading)
                        }
                        if (r["status"].str == "accepted" && isStudent) Button("Book 1-on-1 Session", { Nav.push("/alumni/sessions/book?mentor=${r["alumni"].id}") }, Wide, small = true)
                    }
                }
            }
        }
    }
}

private val PRIVACY_LEVELS = listOf("public", "mentees", "hidden")

@Composable
private fun MyProfileTab(user: JsonElement) {
    val q = Api.myAlumniProfile()
    val upsert = rememberMutation()
    val profile = q.data
    var company by rememberSaveable { mutableStateOf("") }
    var designation by rememberSaveable { mutableStateOf("") }
    var location by rememberSaveable { mutableStateOf("") }
    var gradYear by rememberSaveable { mutableStateOf("") }
    var skills by rememberSaveable { mutableStateOf("") }
    var mentorship by rememberSaveable { mutableStateOf(false) }
    var maxMentees by rememberSaveable { mutableStateOf("3") }
    var referrals by rememberSaveable { mutableStateOf(false) }
    var emailPrivacy by rememberSaveable { mutableStateOf("mentees") }
    var phonePrivacy by rememberSaveable { mutableStateOf("hidden") }
    var loaded by rememberSaveable { mutableStateOf(false) }

    // Populate from the server once loaded.
    LaunchedEffect(profile) {
        if (profile == null || loaded) return@LaunchedEffect
        company = profile["company"].str.orEmpty()
        designation = profile["designation"].str.orEmpty()
        location = profile["location"].text ?: profile["currentLocation"].str.orEmpty()
        gradYear = profile["gradYear"].str.orEmpty()
        skills = profile["skills"].strings.joinToString(", ")
        mentorship = profile["mentorshipAvailable"].bool
        maxMentees = profile["maxActiveMentees"].text ?: "3"
        referrals = profile["openToReferrals"].bool
        emailPrivacy = profile["privacy"]["email"].text ?: "mentees"
        phonePrivacy = profile["privacy"]["phone"].text ?: "hidden"
        loaded = true
    }

    if (q.isLoading) { Loading("Loading profile..."); return }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 60.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Card(Wide, horizontalAlignment = Alignment.CenterHorizontally, gap = 10.dp) {
            Avatar(user, size = 64.dp)
            H3(user["name"].str)
            Small("${user["email"].str ?: ""} · ${user["department"].str ?: ""}")
            if (profile["isVerified"].bool) Badge("Verified Alumnus", Tone.Success) else Badge("Verification Pending", Tone.Warning)
        }
        Card(Wide, gap = 12.dp) {
            Strong("Career Details")
            Input(company, { company = it }, label = "Current Company", placeholder = "e.g. Google, Qualcomm")
            Input(designation, { designation = it }, label = "Job Title / Designation", placeholder = "e.g. Senior Software Engineer")
            Input(location, { location = it }, label = "Location", placeholder = "e.g. Bengaluru, India")
            Input(gradYear, { gradYear = it.filter(Char::isDigit) }, label = "Graduation Year", keyboardType = KeyboardType.Number, placeholder = "e.g. 2022", maxLength = 4)
            Input(skills, { skills = it }, label = "Skills (comma-separated)", placeholder = "React, Node.js, Python, System Design")
        }
        Card(Wide, gap = 12.dp) {
            Strong("Mentorship & Referrals")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Body("Available for 1-on-1 Mentorship", Modifier.weight(1f))
                Chip(if (mentorship) "Enabled" else "Disabled", mentorship) { mentorship = !mentorship }
            }
            if (mentorship) Input(maxMentees, { maxMentees = it.filter(Char::isDigit) }, label = "Maximum Active Mentees", keyboardType = KeyboardType.Number, placeholder = "3")
            CardFooter {
                Body("Open to Job Referrals", Modifier.weight(1f))
                Chip(if (referrals) "Yes" else "No", referrals) { referrals = !referrals }
            }
        }
        Card(Wide, gap = 12.dp) {
            Strong("Privacy Settings")
            Small("Control who can see your contact info on your public profile")
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Label("Email Visibility")
                ChipRow { PRIVACY_LEVELS.forEach { l -> Chip(if (l == "mentees") "Accepted Mentees Only" else l, emailPrivacy == l) { emailPrivacy = l } } }
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Label("Phone Visibility")
                ChipRow { PRIVACY_LEVELS.forEach { l -> Chip(if (l == "mentees") "Accepted Mentees Only" else l, phonePrivacy == l) { phonePrivacy = l } } }
            }
        }
        Button("Save Profile", {
            upsert.launch(onError = { Dialogs.alert("Could not update profile", errMsg(it, "Could not update profile")) }) {
                Api.upsertAlumniProfile(jsonOf(
                    "company" to company.trim(), "designation" to designation.trim(), "currentLocation" to location.trim(),
                    "gradYear" to (gradYear.toIntOrNull() ?: Omit), "skills" to skills.split(",").map { it.trim() }.filter { it.isNotEmpty() },
                    "mentorshipAvailable" to mentorship, "maxActiveMentees" to (maxMentees.toIntOrNull() ?: 3), "openToReferrals" to referrals,
                    "privacy" to mapOf("email" to emailPrivacy, "phone" to phonePrivacy),
                ))
                Dialogs.alert("Profile updated successfully!")
            }
        }, Wide, loading = upsert.isLoading)
    }
}

/* ── Alumni profile ─────────────────────────────────────────────── */

@Composable
fun AlumniProfileScreen(id: String) {
    val me = me()
    val context = LocalContext.current
    val q = Api.alumniProfile(id)
    val verify = rememberMutation()
    val reject = rememberMutation()
    var showRequest by remember { mutableStateOf(false) }
    var showReject by remember { mutableStateOf(false) }
    var rejectReason by remember { mutableStateOf("") }
    val isStaff = me.role in setOf("admin", "hod", "principal")
    val isStudent = me.role in setOf("student", "club_admin")

    DetailScreen(q, "Profile") { data ->
        val profile = data["profile"] ?: data
        val user = data["user"] ?: profile["user"]
        val verified = profile["isVerified"].bool
        val mentorshipStatus = data["mentorshipStatus"].str
        val userId = user.id ?: id

        Header("Alumnus Profile", back = true)
        Card(Wide, horizontalAlignment = Alignment.CenterHorizontally, gap = 12.dp) {
            Avatar(user, size = 72.dp)
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                    H2(user["name"].str)
                    if (verified) Badge("Verified", Tone.Success) else Badge("Unverified", Tone.Warning)
                }
                Strong(careerLine(profile, user), color = C.ink, align = TextAlign.Center)
                Small("${user["department"].str ?: ""} ${profile["gradYear"].text?.let { "· Class of $it" } ?: ""}", color = C.muted)
                (profile["location"].text ?: profile["currentLocation"].text)?.let { IconText(Icons.Rounded.Place, it) }
            }
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (profile["mentorshipAvailable"].bool) Badge("Mentorship Available", Tone.Primary)
                if (profile["openToReferrals"].bool) Badge("Open to Referrals", Tone.Info)
            }
        }
        if (isStaff && !verified) {
            Card(Wide, background = Color(0x14F59E0B), border = Color(0x4DF59E0B), gap = 10.dp) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Rounded.Shield, null, Modifier.size(18.dp), tint = C.amberText)
                    Strong("Verification Required", color = C.amberText)
                }
                Small("This alumnus profile is pending verification. Confirm their degree and credentials before approving.")
                Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button("Verify Profile", {
                        verify.launch(onError = { Dialogs.alert("Could not verify profile", errMsg(it, "Could not verify profile")) }) {
                            Api.verifyAlumniProfile(profile.id.orEmpty())
                            Dialogs.alert("Alumni profile verified successfully!")
                        }
                    }, Modifier.weight(1f), variant = Variant.Success, small = true, loading = verify.isLoading)
                    Button("Reject", { showReject = true }, Modifier.weight(1f), variant = Variant.Danger, small = true)
                }
            }
        }
        if (profile["mentorshipAvailable"].bool) Card(Wide, gap = 12.dp) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Rounded.AutoAwesome, null, Modifier.size(18.dp), tint = C.primary)
                    H3("Mentorship Offering")
                }
                Small("${profile["activeMenteeCount"].int ?: 0} / ${profile["maxActiveMentees"].int ?: 3} mentees", color = C.muted)
            }
            val domains = profile["domains"].strings
            if (domains.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Label("Domains of Guidance")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { domains.forEach { Badge(it.replaceFirst("_", " "), Tone.Primary) } }
            }
            if (isStudent) Box(Modifier.padding(top = 4.dp)) {
                when (mentorshipStatus) {
                    "accepted" -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Badge("You are actively mentoring with this alumnus ✓", Tone.Success)
                        Button("Book 1-on-1 Session", { Nav.push("/alumni/sessions/book?mentor=$userId") }, Wide)
                    }
                    "pending" -> Badge("Mentorship Request Pending Review ⏳", Tone.Warning)
                    else -> Button("Request 1-on-1 Mentorship", { showRequest = true }, Wide)
                }
            }
        }
        val skills = profile["skills"].strings
        if (skills.isNotEmpty()) Card(Wide, gap = 10.dp) {
            Strong("Expertise & Skills")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { skills.forEach { Chip(it, false) {} } }
        }
        Card(Wide, gap = 12.dp) {
            Strong("Contact & Social")
            ContactRow(Icons.Rounded.Email, "Email", user["email"].text) { context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$it"))) }
            ContactRow(Icons.Rounded.Phone, "Phone", user["phone"].text) { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$it"))) }
            profile["linkedin"].text?.let { url ->
                Row(Modifier.padding(top = 6.dp).clickable { openUrl(context, url) }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.AutoMirrored.Rounded.OpenInNew, null, Modifier.size(16.dp), tint = C.primary600)
                    Strong("LinkedIn Profile", color = C.primary600)
                }
            }
        }

        if (showRequest) MentorshipRequestSheet(user["name"].str, userId, profile["domains"].strings.firstOrNull() ?: "software_engineering", { showRequest = false }) { q.refetch() }
        if (showReject) Sheet("Reject Alumni Profile", { showReject = false }) {
            Input(rejectReason, { rejectReason = it }, label = "Reason for rejection", placeholder = "Please explain why this profile cannot be verified (min 5 chars)...", multiline = true)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button("Cancel", { showReject = false }, Modifier.weight(1f), variant = Variant.Outline)
                Button("Confirm Reject", {
                    reject.launch(onError = { Dialogs.alert("Could not reject profile", errMsg(it, "Could not reject profile")) }) {
                        Api.rejectAlumniProfile(profile.id.orEmpty(), rejectReason.trim())
                        showReject = false
                        Dialogs.alert("Alumni profile rejected")
                        Nav.back()
                    }
                }, Modifier.weight(1f), variant = Variant.Danger, loading = reject.isLoading, enabled = rejectReason.trim().length >= 5)
            }
        }
    }
}

@Composable
private fun ContactRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String?, open: (String) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(icon, null, Modifier.size(16.dp), tint = C.soft)
        Column(Modifier.weight(1f)) {
            Label(label)
            if (value != null) T(value, Type.body.copy(fontWeight = FontWeight.SemiBold), Modifier.clickable { runCatching { open(value) } }, C.primary600)
            else Small("Hidden by user privacy", color = C.muted)
        }
    }
}

/* ── Post a job ─────────────────────────────────────────────────── */

private val JOB_TYPES = listOf("full_time" to "Full Time", "internship" to "Internship", "part_time" to "Part Time", "contract" to "Contract")
private val WORK_MODES = listOf("in_office" to "In-Office", "hybrid" to "Hybrid", "remote" to "Remote")
private val APPLY_MODES = listOf(Opt("internal", "Campus Application"), Opt("external", "External Website"))

@Composable
fun PostJobScreen() {
    val create = rememberMutation()
    var title by rememberSaveable { mutableStateOf("") }
    var company by rememberSaveable { mutableStateOf("") }
    var location by rememberSaveable { mutableStateOf("") }
    var type by rememberSaveable { mutableStateOf("full_time") }
    var workMode by rememberSaveable { mutableStateOf("in_office") }
    var applyMode by rememberSaveable { mutableStateOf("internal") }
    var externalUrl by rememberSaveable { mutableStateOf("") }
    var daysValid by rememberSaveable { mutableStateOf("30") }
    var description by rememberSaveable { mutableStateOf("") }

    fun submit() {
        if (title.isBlank() || company.isBlank() || location.isBlank() || description.trim().length < 20) {
            Dialogs.alert("Please fill all required fields (description must be at least 20 characters).")
            return
        }
        if (applyMode == "external" && !externalUrl.trim().startsWith("http")) {
            Dialogs.alert("Please provide a valid URL starting with http:// or https://")
            return
        }
        val deadline = Instant.now().plusSeconds((daysValid.toIntOrNull()?.takeIf { it > 0 } ?: 30) * 86_400L).toString()
        create.launch(onError = { Dialogs.alert("Could not post job", errMsg(it, "Could not post job")) }) {
            Api.createAlumniJob(jsonOf(
                "title" to title.trim(), "company" to company.trim(), "location" to location.trim(), "type" to type, "workMode" to workMode,
                "applyMode" to applyMode, "externalUrl" to (if (applyMode == "external") externalUrl.trim() else Omit),
                "deadline" to deadline, "description" to description.trim(),
            ))
            Dialogs.alert("Job posted successfully!")
            Nav.back()
        }
    }

    Screen {
        Header("Post a Job", "Share opportunities with your college community", back = true)
        Card(Wide, gap = 14.dp) {
            Input(title, { title = it }, label = "Job Title *", placeholder = "e.g. Software Engineer, Product Analyst")
            Input(company, { company = it }, label = "Company Name *", placeholder = "e.g. Microsoft, Razorpay")
            Input(location, { location = it }, label = "Location *", placeholder = "e.g. Bengaluru, Hyderabad")
            ChoiceChips("Employment Type", JOB_TYPES, type) { type = it }
            ChoiceChips("Work Mode", WORK_MODES, workMode) { workMode = it }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Label("How Should Students Apply?")
                Segmented(APPLY_MODES, applyMode, { applyMode = it })
            }
            if (applyMode == "external") Input(externalUrl, { externalUrl = it }, label = "Application Link (URL) *", placeholder = "https://company.com/careers/job-123", keyboardType = KeyboardType.Uri)
            Input(daysValid, { daysValid = it.filter(Char::isDigit) }, label = "Deadline (Days from today)", placeholder = "30", keyboardType = KeyboardType.Number, maxLength = 3)
            Input(description, { description = it }, label = "Job Description & Requirements *", placeholder = "Describe the role, responsibilities, team, and required qualifications...", multiline = true, minLines = 6)
            Button("Publish Job", ::submit, Wide.padding(top = 6.dp), loading = create.isLoading)
        }
    }
}

@Composable
fun ChoiceChips(label: String, options: List<Pair<String, String>>, value: String, onChange: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Label(label)
        ChipRow { options.forEach { (v, l) -> Chip(l, value == v) { onChange(v) } } }
    }
}

