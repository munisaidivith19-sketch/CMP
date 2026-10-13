package com.vexon.campus.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.HowToReg
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material.icons.rounded.Work
import androidx.compose.material3.Icon
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
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
import com.vexon.campus.core.isArray
import com.vexon.campus.core.jsonOf
import com.vexon.campus.core.list
import com.vexon.campus.core.num
import com.vexon.campus.core.rememberMutation
import com.vexon.campus.core.sameId
import com.vexon.campus.core.str
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
import com.vexon.campus.ui.Grad
import com.vexon.campus.ui.Grid2
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.H3
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.IconTile
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.Opt
import com.vexon.campus.ui.ProgressBar
import com.vexon.campus.ui.RowCard
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
import java.time.ZonedDateTime

private val ALUMNI_MANAGERS = setOf("admin", "hod", "principal")
private val Soft03 = Color(0x08000000)

@Composable
private fun PersonChip(person: JsonElement?, fallbackName: String, subtitle: String) {
    Row(
        Wide.clip(RoundedCornerShape(12.dp)).background(Soft03).clickable { person.id?.let { Nav.push("/alumni/$it") } }.padding(10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Avatar(person, size = 36.dp)
        Column(Modifier.weight(1f)) {
            Strong(person["name"].text ?: fallbackName)
            Small(subtitle, color = C.muted)
        }
    }
}

/* ── Job detail ─────────────────────────────────────────────────── */

private val APP_STATUSES = listOf("pending", "referred", "shortlisted", "rejected", "hired")

@Composable
fun AlumniJobDetailScreen(id: String) {
    val me = me()
    val context = LocalContext.current
    val q = Api.alumniJob(id)
    val job = q.data
    val apply = rememberMutation()
    val withdraw = rememberMutation()
    val toggle = rememberMutation()
    val status = rememberMutation()
    val isStudent = me.role in setOf("student", "club_admin")
    val isPoster = job != null && sameId(job["postedBy"], me)
    val canManage = isPoster || me.role in ALUMNI_MANAGERS
    val myApps = Api.myApplications(skip = !isStudent)
    val myApp = myApps.data.list.firstOrNull { (it["job"].id) == id }
    val apps = Api.jobApplications(id, skip = !canManage)
    var showApply by remember { mutableStateOf(false) }
    var coverNote by remember { mutableStateOf("") }
    var askReferral by remember { mutableStateOf(false) }

    DetailScreen(q, "Job Opportunity") { j ->
        Header(j["company"].str, back = true)
        Card(Wide, gap = 12.dp) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f).padding(end = 8.dp)) {
                    H2(j["title"].str)
                    Strong(j["company"].str, color = C.ink)
                }
                val st = j["status"].text ?: "open"
                Badge(st, if (st == "open") Tone.Success else Tone.Neutral)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                IconText(Icons.Rounded.Work, j["type"].str.orEmpty().replaceFirst("_", " "))
                IconText(Icons.Rounded.Place, "${j["location"].str ?: ""} (${j["workMode"].str ?: ""})")
                j["deadline"].text?.let { IconText(Icons.Rounded.CalendarMonth, "Deadline: ${Fmt.date(it, "MMM d, yyyy")}") }
            }
            PersonChip(j["postedBy"], "Alumnus", "${j["postedBy"]["designation"].text ?: "Verified Alumnus"} · Tap to view profile")
        }
        Card(Wide, gap = 8.dp) {
            Strong("Job Description")
            T(j["description"].str, Type.body.copy(lineHeight = 22.sp))
        }
        if (isStudent) Card(Wide, gap = 10.dp) {
            Strong("Application Status")
            when {
                myApp != null -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(Wide, horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Body("Current Status:")
                        StatusBadge(myApp["status"].str)
                    }
                    if (myApp["referralRequested"].bool) Badge("Referral Requested", Tone.Primary)
                    if (myApp["status"].str == "pending") Button("Withdraw Application", {
                        withdraw.launch(onError = { Dialogs.alert("Could not withdraw application", errMsg(it, "Could not withdraw application")) }) {
                            Api.withdrawApplication(myApp.id.orEmpty())
                            Dialogs.alert("Application withdrawn")
                        }
                    }, Wide, variant = Variant.Outline, loading = withdraw.isLoading)
                }
                j["applyMode"].str == "external" && j["externalUrl"].text != null ->
                    Button("Apply on Company Website", { openUrl(context, j["externalUrl"].str) }, Wide, icon = Icons.AutoMirrored.Rounded.OpenInNew)
                else -> Button("Apply for this Role", { showApply = true }, Wide)
            }
        }
        if (canManage) {
            val list = apps.data.list
            Card(Wide, gap = 14.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    H3("Manage Job (${j["applicantCount"].int ?: list.size} Applicants)", Modifier.weight(1f))
                    if (j["status"].str == "open") Button("Close", { toggle.launch { Api.closeAlumniJob(id) } }, variant = Variant.Outline, small = true, loading = toggle.isLoading)
                    else Button("Reopen", { toggle.launch { Api.reopenAlumniJob(id) } }, variant = Variant.Soft, small = true, loading = toggle.isLoading)
                }
                if (list.isEmpty()) Small("No candidate applications yet.", color = C.muted)
                list.forEach { app ->
                    val cand = app["student"]
                    Column(Wide.clip(RoundedCornerShape(14.dp)).background(Soft03).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Avatar(cand, size = 40.dp)
                                Column(Modifier.weight(1f)) {
                                    Strong(cand["name"].text ?: "Student", maxLines = 1)
                                    Small("${cand["department"].str ?: ""} · ${cand["rollNo"].text ?: cand["email"].str ?: ""}", color = C.muted)
                                }
                            }
                            StatusBadge(app["status"].str)
                        }
                        app["note"].text?.let { Small("\"$it\"", Wide.clip(RoundedCornerShape(8.dp)).background(C.surface).padding(8.dp), C.ink) }
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Label("Update Status")
                            ChipRow {
                                APP_STATUSES.forEach { st ->
                                    Chip(st, app["status"].str == st) {
                                        status.launch(onError = { Dialogs.alert("Could not update status", errMsg(it, "Could not update status")) }) {
                                            Api.updateApplication(app.id.orEmpty(), jsonOf("status" to st))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if (showApply) Sheet("Apply for ${j["title"].str ?: ""}", { showApply = false }) {
            Input(coverNote, { coverNote = it }, label = "Cover Note / Why you're a fit", placeholder = "Introduce yourself, your relevant coursework or projects, and why you're interested...", multiline = true, minLines = 4)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Body("Request Alumnus Referral", Modifier.weight(1f))
                Chip(if (askReferral) "Yes" else "No", askReferral) { askReferral = !askReferral }
            }
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button("Cancel", { showApply = false }, Modifier.weight(1f), variant = Variant.Outline)
                Button("Submit Application", {
                    apply.launch(onError = { Dialogs.alert("Could not submit application", errMsg(it, "Could not submit application")) }) {
                        Api.applyToJob(id, jsonOf("note" to coverNote.trim(), "referralRequested" to askReferral))
                        showApply = false
                        coverNote = ""
                        Dialogs.alert("Application submitted successfully!")
                    }
                }, Modifier.weight(1f), loading = apply.isLoading)
            }
        }
    }
}

/* ── Host an alumni event ───────────────────────────────────────── */

private val EVENT_TYPES = listOf("webinar" to "Webinar", "workshop" to "Workshop", "reunion" to "Reunion", "networking" to "Networking", "talk" to "Guest Talk")
private val EVENT_MODES = listOf("virtual" to "Online Virtual", "in_person" to "On Campus", "hybrid" to "Hybrid")

@Composable
fun HostAlumniEventScreen() {
    val create = rememberMutation()
    var title by rememberSaveable { mutableStateOf("") }
    var type by rememberSaveable { mutableStateOf("webinar") }
    var mode by rememberSaveable { mutableStateOf("virtual") }
    var venue by rememberSaveable { mutableStateOf("") }
    var link by rememberSaveable { mutableStateOf("") }
    var daysAhead by rememberSaveable { mutableStateOf("7") }
    var duration by rememberSaveable { mutableStateOf("1") }
    var capacity by rememberSaveable { mutableStateOf("50") }
    var description by rememberSaveable { mutableStateOf("") }

    fun submit() {
        if (title.isBlank() || description.trim().length < 20) {
            Dialogs.alert("Please fill in a title and a detailed description (at least 20 characters).")
            return
        }
        if (mode == "virtual" && link.isNotBlank() && !link.trim().startsWith("http")) {
            Dialogs.alert("Please enter a valid video meeting URL starting with http:// or https://")
            return
        }
        // Default to 6:00 PM on the chosen day.
        val start = ZonedDateTime.now().plusDays((daysAhead.toLongOrNull()?.takeIf { it > 0 } ?: 7)).withHour(18).withMinute(0).withSecond(0).withNano(0)
        val end = start.plusMinutes(((duration.toDoubleOrNull()?.takeIf { it > 0 } ?: 1.0) * 60).toLong())
        create.launch(onError = { Dialogs.alert("Could not schedule event", errMsg(it, "Could not schedule event")) }) {
            Api.createAlumniEvent(jsonOf(
                "title" to title.trim(), "type" to type, "mode" to mode,
                "venue" to (if (mode != "virtual") venue.trim().ifEmpty { "College Auditorium" } else Omit),
                "meetingLink" to (if (mode != "in_person" && link.isNotBlank()) link.trim() else Omit),
                "startsAt" to Fmt.isoInstant(start), "endsAt" to Fmt.isoInstant(end),
                "capacity" to (capacity.toIntOrNull() ?: Omit), "description" to description.trim(),
            ))
            Dialogs.alert("Event scheduled successfully!")
            Nav.back()
        }
    }

    Screen {
        Header("Host Alumni Event", "Organize a reunion, guest lecture, or workshop", back = true)
        Card(Wide, gap = 14.dp) {
            Input(title, { title = it }, label = "Event Title *", placeholder = "e.g. Masterclass on System Design & Microservices")
            ChoiceChips("Event Category", EVENT_TYPES, type) { type = it }
            ChoiceChips("Session Format", EVENT_MODES, mode) { mode = it }
            if (mode != "virtual") Input(venue, { venue = it }, label = "Campus Venue *", placeholder = "e.g. Mechanical Seminar Hall, Campus Audi")
            if (mode != "in_person") Input(link, { link = it }, label = "Virtual Video Link", placeholder = "https://meet.google.com/xyz or Zoom link", keyboardType = KeyboardType.Uri)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Input(daysAhead, { daysAhead = it.filter(Char::isDigit) }, Modifier.weight(1f), label = "Days from today", placeholder = "7", keyboardType = KeyboardType.Number, maxLength = 3)
                Input(duration, { duration = it.filter { c -> c.isDigit() || c == '.' } }, Modifier.weight(1f), label = "Duration (Hours)", placeholder = "1", keyboardType = KeyboardType.Decimal, maxLength = 4)
            }
            Input(capacity, { capacity = it.filter(Char::isDigit) }, label = "Maximum Capacity (Seats)", placeholder = "50", keyboardType = KeyboardType.Number, maxLength = 5)
            Input(description, { description = it }, label = "Event Agenda & Description *", placeholder = "Describe topics covered, guest speakers, prerequisites, and who should attend...", multiline = true, minLines = 5)
            Button("Create Event", ::submit, Wide.padding(top = 6.dp), loading = create.isLoading)
        }
    }
}

/* ── Alumni event detail ────────────────────────────────────────── */

@Composable
fun AlumniEventDetailScreen(id: String) {
    val me = me()
    val context = LocalContext.current
    val q = Api.alumniEvent(id)
    val event = q.data
    val rsvp = rememberMutation()
    val checkIn = rememberMutation()
    val canManage = (event != null && sameId(event["organizer"], me)) || me.role in ALUMNI_MANAGERS
    val attendees = Api.attendees(id, skip = !canManage)

    DetailScreen(q, "Alumni Event") { e ->
        val userRsvp = e["userRsvp"]
        val registered = userRsvp.truthy()
        val capacity = e["capacity"].int ?: 0
        val count = e["attendeeCount"].int ?: 0
        val full = capacity > 0 && count >= capacity
        Header(e["type"].str.orEmpty().uppercase(), back = true)
        Card(Wide, gap = 12.dp) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f).padding(end = 8.dp)) {
                    H2(e["title"].str)
                    Small(Fmt.date(e["startsAt"], "EEEE, MMMM d, yyyy"), color = C.muted)
                }
                Badge(e["type"].str, Tone.Primary)
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Rounded.CalendarMonth, null, Modifier.size(15.dp), tint = C.primary)
                    T("${Fmt.time(e["startsAt"])} – ${Fmt.time(e["endsAt"])}", Type.body.copy(fontWeight = FontWeight.SemiBold))
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(if (e["mode"].str == "virtual") Icons.Rounded.Videocam else Icons.Rounded.Place, null, Modifier.size(15.dp), tint = C.primary)
                    Body(if (e["mode"].str == "virtual") "Online Video Session" else e["venue"].text ?: "Campus Venue")
                }
            }
            // The meeting link is only for registered attendees and the organizers.
            e["meetingLink"].text?.let { link ->
                if (registered || canManage) Button("Join Video Meeting", { openUrl(context, link) }, Wide, variant = Variant.Soft, icon = Icons.AutoMirrored.Rounded.OpenInNew)
            }
            if (capacity > 0) Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Wide, horizontalArrangement = Arrangement.SpaceBetween) {
                    Small("Attendance Capacity")
                    T("$count / $capacity seats taken", Type.small.copy(fontWeight = FontWeight.Bold))
                }
                ProgressBar(count.toDouble() / capacity * 100)
            }
            if (e["organizer"] != null) PersonChip(e["organizer"], "Organizer", "${e["organizer"]["designation"].text ?: "Host"} · Tap for profile")
        }
        Card(Wide, gap = 8.dp) {
            Strong("About this Event")
            T(e["description"].str, Type.body.copy(lineHeight = 22.sp))
        }
        Card(Wide, gap = 12.dp) {
            Strong("RSVP & Participation")
            if (registered) Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Wide, horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Body("Your Status:")
                    StatusBadge(userRsvp["status"].text ?: "registered")
                }
                Button("Cancel RSVP", {
                    rsvp.launch(onError = { Dialogs.alert("Could not cancel RSVP", errMsg(it, "Could not cancel RSVP")) }) { Api.cancelRsvp(id) }
                }, Wide, variant = Variant.Outline, loading = rsvp.isLoading)
            } else Button(if (full) "Join Waitlist" else "RSVP for Event", {
                rsvp.launch(onError = { Dialogs.alert("Could not RSVP for event", errMsg(it, "Could not RSVP for event")) }) { Api.rsvpEvent(id) }
            }, Wide, loading = rsvp.isLoading)
        }
        if (canManage) {
            val list = attendees.data.list
            Card(Wide, gap = 12.dp) {
                H3("Attendee Roster (${list.size})")
                if (list.isEmpty()) Small("No RSVPs yet.", color = C.muted)
                list.forEach { att ->
                    val u = att["user"]
                    Row(
                        Wide.clip(RoundedCornerShape(12.dp)).background(Soft03).padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Avatar(u, size = 38.dp)
                        Column(Modifier.weight(1f)) {
                            Strong(u["name"].text ?: "Attendee", maxLines = 1)
                            Small("${u["department"].str ?: ""} · ${att["status"].str ?: ""}", color = C.muted)
                        }
                        if (att["status"].str == "attended") Badge("Attended ✓", Tone.Success)
                        else Button("Check In", {
                            checkIn.launch(onError = { Dialogs.alert("Could not check in attendee", errMsg(it, "Could not check in attendee")) }) {
                                Api.checkInAttendee(id, u.id.orEmpty())
                            }
                        }, variant = Variant.Soft, small = true, loading = checkIn.isLoading)
                    }
                }
            }
        }
    }
}

/* ── Mentorship sessions ────────────────────────────────────────── */

@Composable
fun MentorshipSessionsScreen() {
    val me = me()
    var scope by rememberSaveable { mutableStateOf("upcoming") }
    val isStudent = me.role in setOf("student", "club_admin")
    val isAlumni = me.role == "alumni"
    val context = LocalContext.current
    val q = Api.mentorshipSessions(mapOf("scope" to scope))
    val cancel = rememberMutation()
    val complete = rememberMutation()
    val notes = rememberMutation()
    var editing by remember { mutableStateOf<JsonElement?>(null) }
    var shared by remember { mutableStateOf("") }
    var private by remember { mutableStateOf("") }

    val data = q.data
    val sessions = if (data.isArray) data.list else (data["sessions"] ?: data["items"]).list

    Screen(scroll = false) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Header("Mentorship Sessions", "1-on-1 Guidance, reviews and career advice", back = true, right = if (isStudent) ({
                Button("Book", { Nav.push("/alumni/sessions/book") }, icon = Icons.Rounded.Add, small = true)
            }) else null)
            Segmented(listOf(Opt("upcoming", "Upcoming"), Opt("past", "Past Sessions")), scope, { scope = it })
        }
        Box(Modifier.weight(1f).padding(top = 8.dp)) {
            when {
                data == null && q.error != null -> Box(Modifier.padding(16.dp)) { ErrorState(q.error) { q.refetch() } }
                data == null -> Loading("Loading sessions...")
                else -> PullToRefreshBox(isRefreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }, modifier = Modifier.fillMaxSize()) {
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (sessions.isEmpty()) item {
                            EmptyState(Icons.Rounded.CalendarMonth, "No Sessions Found", if (scope == "upcoming") "No upcoming mentorship appointments scheduled." else "No past mentorship records found.")
                        }
                        items(sessions, key = { it.id ?: it.hashCode() }) { s ->
                            val counterpart = if (isStudent) s["mentor"] else s["student"]
                            val scheduled = s["status"].str == "scheduled"
                            Card(Wide, gap = 10.dp) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                        Avatar(counterpart, size = 42.dp)
                                        Column(Modifier.weight(1f)) {
                                            Strong(counterpart["name"].text ?: "Counterpart", maxLines = 1)
                                            Small(if (isStudent) counterpart["designation"].text ?: "Alumnus Mentor" else counterpart["department"].text ?: "Student Mentee", color = C.muted)
                                        }
                                    }
                                    StatusBadge(s["status"].str)
                                }
                                Column(Wide.clip(RoundedCornerShape(10.dp)).background(Soft03).padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Icon(Icons.Rounded.Schedule, null, Modifier.size(14.dp), tint = C.primary)
                                        Strong(Fmt.date(s["slot"]["startsAt"] ?: s["createdAt"], "EEEE, MMM d · h:mm a"))
                                    }
                                    Small("Duration: ${s["slot"]["durationMin"].int ?: 30} minutes · Mode: ${s["slot"]["mode"].text ?: "virtual"}", color = C.soft)
                                }
                                s["agenda"].text?.let { Small("Agenda: $it", color = C.ink) }
                                val link = s["slot"]["meetingLink"].text
                                if (link != null && scheduled) Button("Join Video Meeting", { openUrl(context, link) }, variant = Variant.Soft, icon = Icons.AutoMirrored.Rounded.OpenInNew, small = true)
                                s["sharedNotes"].text?.let {
                                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Label("Session Notes")
                                        Small(it, color = C.soft, maxLines = 3)
                                    }
                                }
                                CardFooter {
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Button("Notes", {
                                            editing = s
                                            shared = s["sharedNotes"].str.orEmpty()
                                            private = s["alumniPrivateNotes"].str.orEmpty()
                                        }, Modifier.weight(1f), variant = Variant.Outline, icon = Icons.Rounded.Description, small = true)
                                        if (scheduled) Button("Cancel", {
                                            Dialogs.confirm(
                                                "Cancel this session?",
                                                "Cancellations less than 2 hours before the start time may affect scheduling limits.",
                                                "Cancel session", destructive = true,
                                            ) {
                                                cancel.launch(onError = { Dialogs.alert("Could not cancel session", errMsg(it, "Could not cancel session")) }) {
                                                    Api.cancelSession(s.id.orEmpty(), "Cancelled by user")
                                                }
                                            }
                                        }, Modifier.weight(1f), variant = Variant.Outline, small = true, loading = cancel.isLoading)
                                        if (scheduled && isAlumni) Button("Mark Complete", {
                                            complete.launch(onError = { Dialogs.alert("Could not complete session", errMsg(it, "Could not complete session")) }) {
                                                Api.completeSession(s.id.orEmpty(), "completed")
                                            }
                                        }, Modifier.weight(1f), variant = Variant.Success, small = true, loading = complete.isLoading)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    editing?.let { s ->
        Sheet("Session Notes", { editing = null }) {
            Input(shared, { shared = it }, label = "Shared Meeting Notes (Visible to Mentor & Mentee)", placeholder = "Action items, advice, recommended learning resources...", multiline = true, minLines = 4)
            if (isAlumni) Input(private, { private = it }, label = "Private Mentor Notes (Only visible to you)", placeholder = "Candidate strengths, private evaluation notes...", multiline = true)
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button("Close", { editing = null }, Modifier.weight(1f), variant = Variant.Outline)
                Button("Save Notes", {
                    notes.launch(onError = { Dialogs.alert("Could not update notes", errMsg(it, "Could not update notes")) }) {
                        Api.updateSessionNotes(s.id.orEmpty(), jsonOf("sharedNotes" to shared.trim(), "alumniPrivateNotes" to (if (isAlumni) private.trim() else Omit)))
                        editing = null
                    }
                }, Modifier.weight(1f), loading = notes.isLoading)
            }
        }
    }
}

/* ── Book a mentorship session ──────────────────────────────────── */

@Composable
fun BookSessionScreen(route: Route) {
    val mentorParam = route.q("mentor")
    val requests = Api.mentorshipRequests()
    val accepted = requests.data["items"].list.filter { it["status"].str == "accepted" }
    var selectedReqId by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedSlot by remember { mutableStateOf<JsonElement?>(null) }
    var agenda by rememberSaveable { mutableStateOf("") }
    val book = rememberMutation()

    // Auto-select the mentor from the link, or the first accepted connection.
    val activeReq = accepted.firstOrNull { it.id == selectedReqId }
        ?: if (mentorParam != null) accepted.firstOrNull { it["alumni"].id == mentorParam } else accepted.firstOrNull()
    val mentorId = activeReq?.get("alumni").id
    val slots = Api.slots(mapOf("alumni" to mentorId), skip = mentorId == null)
    val open = slots.data["slots"].list.filter { !it["isBooked"].bool }

    if (requests.isLoading) {
        Screen { Header("Book Session", back = true); Loading("Checking mentorship connections...") }
        return
    }
    if (accepted.isEmpty()) {
        Screen {
            Header("Book Session", back = true)
            Card(Wide, horizontalAlignment = Alignment.CenterHorizontally, gap = 12.dp) {
                Box(Modifier.padding(top = 16.dp)) { Icon(Icons.Rounded.Group, null, Modifier.size(36.dp), tint = C.primary) }
                H3("No Active Mentors Yet", align = TextAlign.Center)
                Body("You need an accepted mentorship request from an alumnus before you can schedule 1-on-1 sessions.", color = C.soft, align = TextAlign.Center)
                Box(Modifier.padding(top = 8.dp, bottom = 16.dp)) { Button("Explore Alumni Directory", { Nav.replace("/alumni") }) }
            }
        }
        return
    }

    Screen {
        Header("Schedule 1-on-1", "Select an available slot with your mentor", back = true)
        if (accepted.size > 1) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Label("Choose Mentor")
            ChipRow { accepted.forEach { r -> Chip(r["alumni"]["name"].text ?: "Mentor", activeReq?.id == r.id) { selectedReqId = r.id; selectedSlot = null } } }
        }
        if (activeReq != null) RowCard(Wide) {
            Avatar(activeReq["alumni"], size = 48.dp)
            Column(Modifier.weight(1f)) {
                Strong(activeReq["alumni"]["name"].str)
                Small("${activeReq["alumni"]["designation"].text ?: "Alumnus Mentor"} · ${activeReq["domain"].str.orEmpty().replaceFirst("_", " ")}", color = C.muted)
            }
            Badge("Accepted", Tone.Success)
        }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Strong("Available Open Slots")
            when {
                slots.isLoading -> Loading("Loading mentor's availability...")
                open.isEmpty() -> Card(Wide, horizontalAlignment = Alignment.CenterHorizontally, gap = 6.dp) {
                    Icon(Icons.Rounded.CalendarMonth, null, Modifier.size(28.dp), tint = C.soft)
                    Strong("No Open Slots", align = TextAlign.Center)
                    Small("This mentor does not have open slots right now. Check back soon or message them in Campus Chat.", align = TextAlign.Center, color = C.muted)
                }
                else -> open.forEach { slot ->
                    val selected = selectedSlot?.id == slot.id
                    Card(
                        Wide.then(if (selected) Modifier.border(2.dp, C.primary, RoundedCornerShape(28.dp)) else Modifier),
                        onClick = { selectedSlot = slot }, background = if (selected) Color(0x0D4396EF) else C.card, gap = 8.dp,
                    ) {
                        Row(Wide, horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(Icons.Rounded.Schedule, null, Modifier.size(16.dp), tint = if (selected) C.primary600 else C.soft)
                                Strong(Fmt.date(slot["startsAt"], "EEE, MMM d · h:mm a"), color = if (selected) C.primary600 else Color.Unspecified)
                            }
                            Badge("${slot["durationMin"].int ?: 30} mins", if (selected) Tone.Primary else Tone.Neutral)
                        }
                        Small("Format: ${if (slot["mode"].str == "virtual") "Online Video Call" else "In-Person Meeting"}", color = C.muted)
                    }
                }
            }
        }
        val slot = selectedSlot
        if (slot != null) Card(Wide, gap = 12.dp) {
            Strong("Session Agenda")
            Input(agenda, { agenda = it }, label = "What would you like to discuss?", placeholder = "e.g. Resume review for frontend roles, interview prep tips...", multiline = true)
            Button("Confirm Booking", {
                val req = activeReq ?: return@Button Dialogs.alert("Please choose an active mentor connection and an open slot.")
                book.launch(onError = { Dialogs.alert("Could not book session", errMsg(it, "Could not book session")) }) {
                    Api.bookSession(jsonOf("request" to req.id, "slot" to slot.id, "agenda" to agenda.trim().ifEmpty { "General career guidance and mentorship" }))
                    Dialogs.alert("1-on-1 mentorship session booked successfully!")
                    Nav.replace("/alumni/sessions")
                }
            }, Wide, loading = book.isLoading)
        }
    }
}

/* ── Chapter wall ───────────────────────────────────────────────── */

@Composable
fun ChapterWallScreen(slug: String) {
    val me = me()
    val chapterQ = Api.chapter(slug)
    val posts = Api.chapterPosts(slug)
    val membership = rememberMutation()
    val post = rememberMutation()
    val like = rememberMutation()
    var text by rememberSaveable { mutableStateOf("") }
    var commentsFor by remember { mutableStateOf<JsonElement?>(null) }
    val isStaff = me.role in ALUMNI_MANAGERS
    val isStudent = me.role in setOf("student", "club_admin")

    val chapter = chapterQ.data
    if (chapter == null) {
        Screen {
            Header("Chapter Wall", back = true)
            if (chapterQ.error != null) ErrorState(chapterQ.error) { chapterQ.refetch() } else Loading("Loading community...")
        }
        return
    }
    val member = chapter["isMember"].bool
    val canPost = !isStudent && (member || isStaff)

    Screen(scroll = false) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Header(chapter["name"].str, "${chapter["type"].str.orEmpty().uppercase()} CHAPTER · ${chapter["memberCount"].int ?: 0} Members", back = true)
            if (chapter["description"].text != null || !isStudent) Card(Wide, gap = 8.dp) {
                chapter["description"].text?.let { Body(it, color = C.soft) }
                if (!isStudent) Row(Wide, horizontalArrangement = Arrangement.End) {
                    Button(if (member) "Leave Chapter" else "Join Chapter", {
                        membership.launch(onError = { Dialogs.alert("Could not update membership", errMsg(it, "Could not update membership")) }) {
                            if (member) Api.leaveChapter(slug) else Api.joinChapter(slug)
                        }
                    }, variant = if (member) Variant.Outline else Variant.Primary, small = true, loading = membership.isLoading)
                }
            }
            if (canPost) Card(Wide, gap = 8.dp) {
                Input(text, { text = it }, placeholder = "Share an update or question with the chapter...", multiline = true, minLines = 2)
                Row(Wide, horizontalArrangement = Arrangement.End) {
                    Button("Post", {
                        post.launch(onError = { Dialogs.alert("Could not create post", errMsg(it, "Could not create post")) }) {
                            Api.createChapterPost(slug, jsonOf("body" to text.trim()))
                            text = ""
                        }
                    }, small = true, enabled = text.isNotBlank(), loading = post.isLoading)
                }
            }
        }
        Box(Modifier.weight(1f).padding(top = 8.dp)) {
            val data = posts.data
            if (data == null) Loading("Loading posts...")
            else PullToRefreshBox(isRefreshing = posts.isFetching && !posts.isLoading, onRefresh = { posts.refetch() }, modifier = Modifier.fillMaxSize()) {
                val list = data["items"].list
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (list.isEmpty()) item { EmptyState(Icons.Rounded.ChatBubbleOutline, "No Posts Yet", "Be the first to share an update or question in this chapter.") }
                    items(list, key = { it.id ?: it.hashCode() }) { p ->
                        val author = p["author"]
                        val liked = p["hasLiked"].bool
                        Card(Wide, gap = 10.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Avatar(author, size = 38.dp)
                                    Column(Modifier.weight(1f)) {
                                        Strong(author["name"].text ?: "Alumnus", maxLines = 1)
                                        Small("${author["department"].text ?: author["role"].str ?: ""} · ${Fmt.timeAgo(p["createdAt"])}", color = C.muted)
                                    }
                                }
                                if (p["pinned"].bool) Badge("Pinned", Tone.Primary)
                            }
                            T(p["body"].str, Type.body.copy(lineHeight = 22.sp))
                            CardFooter {
                                Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Row(Modifier.clickable { like.launch(onError = {}) { Api.likePost(p.id.orEmpty()) } }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Icon(if (liked) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder, if (liked) "Unlike" else "Like", Modifier.size(18.dp), tint = if (liked) C.roseText else C.soft)
                                        Small("${p["likesCount"].int ?: 0}", color = if (liked) C.roseText else C.soft)
                                    }
                                    Row(Modifier.clickable { commentsFor = p }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Icon(Icons.Rounded.ChatBubbleOutline, null, Modifier.size(18.dp), tint = C.soft)
                                        Small("${p["commentsCount"].int ?: 0} Comments", color = C.soft)
                                    }
                                }
                                Box(Modifier.width(0.dp))
                            }
                        }
                    }
                }
            }
        }
    }
    commentsFor?.let { CommentsSheet(it) { commentsFor = null } }
}

@Composable
private fun CommentsSheet(post: JsonElement, onClose: () -> Unit) {
    val postId = post.id.orEmpty()
    val q = Api.comments(postId)
    val add = rememberMutation()
    var text by remember { mutableStateOf("") }
    Sheet("Comments", onClose, footer = {
        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Input(text, { text = it }, Modifier.weight(1f), placeholder = "Write a comment...")
            Button("Send", {
                add.launch(onError = { Dialogs.alert("Could not post comment", errMsg(it, "Could not post comment")) }) {
                    Api.addComment(postId, text.trim())
                    text = ""
                }
            }, small = true, enabled = text.isNotBlank(), loading = add.isLoading)
        }
    }) {
        val comments = q.data.list
        when {
            q.isLoading -> Loading()
            comments.isEmpty() -> Small("No comments yet. Start the conversation!", Wide.padding(vertical = 20.dp), C.muted, TextAlign.Center)
            else -> comments.forEach { c ->
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Avatar(c["author"], size = 32.dp)
                    Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(Soft03).padding(8.dp)) {
                        T(c["author"]["name"].text ?: "User", Type.strong.copy(fontSize = 13.sp))
                        T(c["body"].str, Type.body.copy(fontSize = 13.sp))
                    }
                }
            }
        }
    }
}

/* ── Admin: analytics ───────────────────────────────────────────── */

@Composable
fun AlumniAnalyticsScreen() {
    val q = Api.alumniAnalytics()
    val data = q.data
    if (data == null) {
        Screen {
            Header("Alumni Analytics", back = true)
            if (q.error != null) ErrorState(q.error) { q.refetch() } else Loading("Computing alumni metrics...")
        }
        return
    }
    val totals = data["totals"]
    val mentorship = data["mentorship"]
    val jobs = data["jobs"]
    val events = data["events"]
    val chapters = data["chapters"]
    Screen(refreshing = q.isFetching, onRefresh = { q.refetch() }) {
        Header("Alumni Analytics", "Program engagement & community KPI dashboard", back = true)
        Grid2(listOf(
            Triple(Icons.Rounded.School, Grad.primary, totals["alumni"] to "Total Alumni"),
            Triple(Icons.Rounded.HowToReg, Grad.emerald, totals["verified"] to "Verified"),
            Triple(Icons.Rounded.AutoAwesome, Grad.violet, totals["mentors"] to "Active Mentors"),
            Triple(Icons.Rounded.Work, Grad.amber, jobs["openJobs"] to "Open Jobs"),
        )) { (icon, grad, pair), mod ->
            Card(mod, gap = 8.dp) {
                IconTile(icon, grad, 40.dp)
                Column {
                    H2(num(pair.first?.dbl ?: 0.0))
                    Small(pair.second)
                }
            }
        }
        Card(Wide, gap = 12.dp) {
            H3("Mentorship Program")
            Row(Wide, horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Strong("${mentorship["totalRequests"].int ?: 0} Total Requests")
                    Small("${mentorship["acceptedRequests"].int ?: 0} Accepted · ${mentorship["completedRequests"].int ?: 0} Completed", color = C.muted)
                }
                Column(horizontalAlignment = Alignment.End) {
                    H2(mentorship["avgRating"].text?.takeIf { it != "0" }?.let { "$it ★" } ?: "—", color = C.primary600)
                    Small("Avg Rating")
                }
            }
            val total = mentorship["totalRequests"].int ?: 0
            if (total > 0) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Small("Completion Rate")
                ProgressBar((mentorship["completedRequests"].dbl ?: 0.0) / total * 100)
            }
        }
        Card(Wide, gap = 12.dp) {
            H3("Career Opportunities")
            Row(Wide, horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column { H2(num(jobs["totalApplications"].dbl ?: 0.0)); Small("Student Applications") }
                Column(horizontalAlignment = Alignment.End) { H2("${num(jobs["referralConversion"].dbl ?: 0.0)}%", color = C.success); Small("Referral Rate") }
            }
        }
        Card(Wide, gap = 12.dp) {
            H3("Events & Chapters")
            Row(Wide, horizontalArrangement = Arrangement.SpaceAround, verticalAlignment = Alignment.CenterVertically) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) { H2(num(events["upcomingEvents"].dbl ?: 0.0)); Small("Upcoming Events") }
                Box(Modifier.width(1.dp).height(36.dp).background(C.border))
                Column(horizontalAlignment = Alignment.CenterHorizontally) { H2(num(chapters["chapterCount"].dbl ?: 0.0)); Small("Active Chapters") }
                Box(Modifier.width(1.dp).height(36.dp).background(C.border))
                Column(horizontalAlignment = Alignment.CenterHorizontally) { H2("${num(events["attendanceRate"].dbl ?: 0.0)}%"); Small("Check-in Rate") }
            }
        }
        val byDept = data["byDepartment"].list
        if (byDept.isNotEmpty()) Card(Wide, gap = 10.dp) {
            Strong("Alumni by Department")
            val all = (totals["alumni"].dbl ?: 0.0).takeIf { it > 0 } ?: 1.0
            byDept.forEach { item ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(Wide, horizontalArrangement = Arrangement.SpaceBetween) {
                        T(item["department"].text ?: item["_id"].str, Type.small)
                        Small("${item["count"].int ?: 0} alumni", color = C.muted)
                    }
                    ProgressBar((item["count"].dbl ?: 0.0) / all * 100)
                }
            }
        }
        val companies = data["topCompanies"].list
        if (companies.isNotEmpty()) Card(Wide, gap = 10.dp) {
            Strong("Top Alumni Employers")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                companies.take(10).forEach { c -> Badge("${c["name"].text ?: c["_id"].str ?: ""} (${c["count"].int ?: 0})", Tone.Primary) }
            }
        }
    }
}

/* ── Admin: verification queue ──────────────────────────────────── */

@Composable
fun AlumniVerificationScreen() {
    val context = LocalContext.current
    val q = Api.alumni(mapOf("unverified" to "true"))
    val verify = rememberMutation()
    val reject = rememberMutation()
    var rejecting by remember { mutableStateOf<JsonElement?>(null) }
    var reason by remember { mutableStateOf("") }
    val pending = q.data["items"].list

    ListScreen(
        q, { it["items"].list },
        header = { Header("Alumni Verification", "${pending.size} unverified alumni profiles pending review", back = true) },
        empty = { EmptyState(Icons.Rounded.CheckCircle, "Queue Is Clear", "All alumni profiles have been verified or resolved.") },
    ) { item ->
        val u = item["user"]
        Card(Wide, gap = 12.dp) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Avatar(u, size = 48.dp)
                Column(Modifier.weight(1f)) {
                    Strong(u["name"].text ?: "Alumnus", maxLines = 1)
                    val d = item["designation"].text
                    val c = item["company"].text
                    Small((d ?: "") + (if (d != null && c != null) " at " else "") + (c ?: u["email"].str ?: ""), color = C.ink)
                    Small("${u["department"].str ?: ""} · Class of ${item["gradYear"].text ?: "N/A"}", color = C.muted)
                }
                Badge("Pending", Tone.Warning)
            }
            Column(Wide.clip(RoundedCornerShape(10.dp)).background(Soft03).padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Small("Email: ${u["email"].str ?: ""}")
                item["location"].text?.let { Small("Location: $it") }
                item["linkedin"].text?.let { url ->
                    Row(Modifier.padding(top = 2.dp).clickable { openUrl(context, url) }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Icon(Icons.AutoMirrored.Rounded.OpenInNew, null, Modifier.size(13.dp), tint = C.primary600)
                        Small("View LinkedIn Profile", color = C.primary600)
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button("Verify", {
                    verify.launch(onError = { Dialogs.alert("Could not verify profile", errMsg(it, "Could not verify profile")) }) { Api.verifyAlumniProfile(item.id.orEmpty()) }
                }, Modifier.weight(1f), variant = Variant.Success, small = true, loading = verify.isLoading)
                Button("Reject", { rejecting = item; reason = "" }, Modifier.weight(1f), variant = Variant.Danger, small = true)
            }
        }
    }
    rejecting?.let { item ->
        Sheet("Reject Verification", { rejecting = null }) {
            Small("Rejecting profile for ${item["user"]["name"].str ?: ""}")
            Input(reason, { reason = it }, label = "Rejection Reason *", placeholder = "State why this profile is not eligible (min 5 chars)...", multiline = true)
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button("Cancel", { rejecting = null }, Modifier.weight(1f), variant = Variant.Outline)
                Button("Confirm Reject", {
                    reject.launch(onError = { Dialogs.alert("Could not reject profile", errMsg(it, "Could not reject profile")) }) {
                        Api.rejectAlumniProfile(item.id.orEmpty(), reason.trim())
                        rejecting = null
                        reason = ""
                    }
                }, Modifier.weight(1f), variant = Variant.Danger, loading = reject.isLoading, enabled = reason.trim().length >= 5)
            }
        }
    }
}

