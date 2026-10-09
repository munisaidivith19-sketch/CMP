package com.vexon.campus.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.Login
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.Bed
import androidx.compose.material.icons.rounded.EventBusy
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Badge
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.Category
import androidx.compose.material.icons.rounded.ChatBubble
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material.icons.rounded.DoorFront
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.EmojiEvents
import androidx.compose.material.icons.rounded.EventAvailable
import androidx.compose.material.icons.rounded.EventNote
import androidx.compose.material.icons.rounded.Explore
import androidx.compose.material.icons.rounded.FactCheck
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.ReportProblem
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.Timer
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material.icons.rounded.Work
import androidx.compose.material.icons.rounded.Cancel
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import com.vexon.campus.VexonApp
import com.vexon.campus.core.Api
import com.vexon.campus.core.Auth
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.Http
import com.vexon.campus.core.QueryClient
import com.vexon.campus.core.Realtime
import com.vexon.campus.core.SocketEvent
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
import com.vexon.campus.core.sameId
import com.vexon.campus.core.str
import com.vexon.campus.core.strings
import com.vexon.campus.core.text
import com.vexon.campus.core.describeConversation
import com.vexon.campus.nav.Nav
import com.vexon.campus.push.Push
import com.vexon.campus.ui.Avatar
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.Body
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.COLLEGE_WIDE
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.CountBubble
import com.vexon.campus.ui.DialogButton
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.GlassRow
import com.vexon.campus.ui.Grad
import com.vexon.campus.ui.Grid2
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.IconButton
import com.vexon.campus.ui.IconTile
import com.vexon.campus.ui.InfoRow
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Jakarta
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.ROLE_LABELS
import com.vexon.campus.ui.RemoteImage
import com.vexon.campus.ui.RowCard
import com.vexon.campus.ui.STUDENT_ROLES
import com.vexon.campus.ui.SUMMARY_VIEW
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.SectionTitle
import com.vexon.campus.ui.Sheet
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.pressable
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.T
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Type
import com.vexon.campus.ui.Variant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import java.time.LocalTime

/* ── Tab bar ────────────────────────────────────────────────────── */

private data class TabSpec(val name: String, val title: String, val icon: ImageVector)

private val TAB_SPECS = listOf(
    TabSpec("index", "Home", Icons.Rounded.Home),
    TabSpec("chat", "Chat", Icons.Rounded.ChatBubble),
    TabSpec("campus", "Campus", Icons.Rounded.GridView),
    TabSpec("notifications", "Alerts", Icons.Rounded.Notifications),
    TabSpec("profile", "Profile", Icons.Rounded.Person),
)

@Composable
fun TabsScreen() {
    val chat = Api.chatUnread()
    val notes = Api.notifications(mapOf("limit" to 1))
    val holder = rememberSaveableStateHolder()
    fun badge(n: Int?): String? = n?.takeIf { it > 0 }?.let { if (it > 99) "99+" else "$it" }

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            holder.SaveableStateProvider(Nav.tab) {
                when (Nav.tab) {
                    "chat" -> ChatListScreen()
                    "campus" -> CampusScreen()
                    "notifications" -> NotificationsScreen()
                    "profile" -> ProfileScreen()
                    else -> HomeScreen()
                }
            }
        }
        NavigationBar(containerColor = Color(0xF5FFFFFF), tonalElevation = 0.dp) {
            TAB_SPECS.forEach { t ->
                val count = when (t.name) {
                    "chat" -> badge(chat.data["total"].int)
                    "notifications" -> badge(notes.data["unread"].int)
                    else -> null
                }
                NavigationBarItem(
                    selected = Nav.tab == t.name,
                    onClick = { Nav.tab = t.name },
                    icon = {
                        androidx.compose.material3.BadgedBox(badge = {
                            if (count != null) androidx.compose.material3.Badge(containerColor = C.danger) {
                                Text(count, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 10.sp)
                            }
                        }) { Icon(t.icon, t.title, Modifier.size(22.dp)) }
                    },
                    label = { Text(t.title, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 11.sp) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = C.primary, selectedTextColor = C.primary,
                        unselectedIconColor = C.muted, unselectedTextColor = C.muted, indicatorColor = C.primarySoft,
                    ),
                )
            }
        }
    }
}

/* ── Home ───────────────────────────────────────────────────────── */

/** "Dr. Suresh Kumar" → "Suresh" — skip honorifics in the greeting. */
private fun firstName(name: String?): String {
    val n = name.orEmpty()
    return n.split(" ").firstOrNull { it.isNotEmpty() && !Regex("^(dr|prof|mr|mrs|ms|miss)[.]?$", RegexOption.IGNORE_CASE).matches(it) } ?: n
}

private fun greeting(): String {
    val h = LocalTime.now().hour
    return if (h < 12) "Good morning" else if (h < 17) "Good afternoon" else "Good evening"
}

private data class TileSpec(val icon: ImageVector, val gradient: List<Color>, val label: String, val value: String, val hint: String? = null, val onClick: (() -> Unit)? = null)

@Composable
private fun Tiles(tiles: List<TileSpec>) {
    Grid2(tiles) { t, mod ->
        Card(mod, onClick = t.onClick, gap = 10.dp) {
            IconTile(t.icon, t.gradient, 38.dp)
            Column {
                Label(t.label)
                Strong(t.value, maxLines = 1)
                if (t.hint != null) Small(t.hint, maxLines = 1)
            }
        }
    }
}

@Composable
private fun Greeting(user: JsonElement, emoji: String, actions: @Composable () -> Unit = {}) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Avatar(user, size = 46.dp)
        Column(Modifier.weight(1f)) {
            Small("${greeting()},")
            H2("${firstName(user["name"].str)} $emoji", maxLines = 1)
        }
        actions()
    }
}

@Composable
private fun HeroCard(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(Brush.linearGradient(Grad.hero)).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp), content = content,
    )
}

@Composable
fun HomeScreen() {
    val user = me()
    when (user.role) {
        "security" -> SecurityHome(user)
        "alumni" -> AlumniHome(user)
        else -> GeneralHome(user)
    }
}

/** The gate guard's home: campus in/out counts and the two actions they actually do. */
@Composable
private fun SecurityHome(user: JsonElement) {
    val q = Api.securityDashboard(pollMs = 30_000)
    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }) {
        Greeting(user, "👋")
        val data = q.data
        when {
            data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            data == null -> Loading()
            else -> {
                Tiles(listOf(
                    TileSpec(Icons.Rounded.Group, Grad.violet, "Total students", num(data["total"])),
                    TileSpec(Icons.AutoMirrored.Rounded.Login, Grad.emerald, "Students in", num(data["inside"])),
                    TileSpec(Icons.AutoMirrored.Rounded.Logout, Grad.amber, "Students out", num(data["outside"])),
                    TileSpec(Icons.Rounded.DoorFront, Grad.sky, "Left today", num(data["leftToday"])),
                ))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    GateAction(Modifier.weight(1f), Grad.emerald, Icons.AutoMirrored.Rounded.Login, "IN", "Return verification · scan Return QR or code") { Nav.push("/gate-pass/in") }
                    GateAction(Modifier.weight(1f), Grad.rose, Icons.AutoMirrored.Rounded.Logout, "OUT", "Verify a student leaving") { Nav.push("/gate-pass/out") }
                }
                val outside = data["outsideStudents"].list
                SectionTitle("Students outside (${outside.size})")
                if (outside.isEmpty()) Card(Wide) { EmptyState(Icons.Rounded.Group, "Everyone is on campus") }
                outside.forEach { p ->
                    val s = p["student"]
                    RowCard(Wide) {
                        Avatar(s, size = 40.dp)
                        Column(Modifier.weight(1f)) {
                            Strong(s["name"].str, maxLines = 1)
                            Small("${s["rollNo"].text ?: "—"} · Year ${s["year"].text ?: "—"} · ${s["department"].text ?: "—"}", maxLines = 1)
                        }
                        if (p["overdue"].bool) Badge("overdue", Tone.Danger)
                    }
                }
            }
        }
    }
}

@Composable
private fun GateAction(modifier: Modifier, gradient: List<Color>, icon: ImageVector, title: String, text: String, onClick: () -> Unit) {
    Column(
        modifier.clip(RoundedCornerShape(24.dp)).background(Brush.linearGradient(gradient)).clickable(onClick = onClick).padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, null, Modifier.size(30.dp), tint = Color.White)
        H2(title, color = Color.White)
        Small(text, color = Color(0xD9FFFFFF), align = TextAlign.Center)
    }
}

private val OPEN_PASS = setOf("pending_faculty", "parent_verified", "pending_hod", "pending_principal", "pending_authority", "approved", "active")

@Composable
private fun GeneralHome(user: JsonElement) {
    val role = user.role
    val isStudent = role in STUDENT_ROLES
    val seesSummary = role in SUMMARY_VIEW
    val isHod = role == "hod"
    val noTimetable = role in setOf("warden", "security")
    var sheet by remember { mutableStateOf<String?>(null) }

    val dash = Api.dashboard()
    val now = Api.currentClass(skip = noTimetable, pollMs = 120_000)
    val att = Api.myAttendance(mapOf("range" to "semester"), skip = !isStudent)
    val summary = Api.attendanceSummary(skip = !seesSummary, pollMs = 120_000)
    val passes = Api.gatePasses(mapOf("limit" to 5), skip = !isStudent)
    val unread = Api.chatUnread()

    val cls = now.data["current"] ?: now.data["next"]
    val open = passes.data["passes"].list.firstOrNull { it["status"].str in OPEN_PASS }
    val o = att.data["overall"]
    val threshold = att.data["threshold"].dbl ?: 75.0
    val low = o != null && (o["totalPeriods"].int ?: 0) > 0 && (o["percentage"].dbl ?: 0.0) < threshold
    val s = summary.data["students"]
    val f = summary.data["faculty"]

    val (attValue, attHint) = when {
        isStudent -> (if (o != null) "${num(o["percentage"])}%" else "—") to
            (if (o != null) (if (low) "Below ${num(threshold)}%" else "${num(o["presentPeriods"])}/${num(o["totalPeriods"])} periods") else null)
        seesSummary -> (if (s != null) (if (isHod) "${num(s["absent"])} absent" else "${num(s["percentage"])}% present") else if (summary.isLoading) "…" else "—") to
            (if (s != null) (if (isHod) "of ${num(s["total"])} students today" else "${num(s["present"])}/${num(s["total"])} students") else "Tap for today")
        else -> "Mark classes" to "Your sections"
    }

    Screen(refreshing = dash.isFetching && !dash.isLoading, onRefresh = { listOf(dash, now, att, summary, passes, unread).forEach { it.refetch() } }) {
        Greeting(user, "👋") {
            IconButton(Icons.Rounded.CalendarMonth, "Calendar") { Nav.push("/calendar") }
            IconButton(Icons.Rounded.Search, "Search") { Nav.push("/search") }
        }
        HeroCard {
            Small(Fmt.format(java.time.ZonedDateTime.now(), "EEEE, dd MMMM"), color = Color(0xD9FFFFFF))
            H2(
                when {
                    noTimetable -> "Welcome back"
                    cls != null -> "${if (now.data["current"] != null) "Now" else "Next"}: ${cls["subject"]["name"].str ?: ""}"
                    now.data["today"].list.isNotEmpty() -> "Classes are done for today"
                    else -> "No classes today"
                },
                color = Color.White,
            )
            if (!noTimetable && cls != null) {
                Small(
                    "${Fmt.to12h(cls["startTime"])} – ${Fmt.to12h(cls["endTime"])}" +
                        (cls["room"].text?.let { " · $it" } ?: "") +
                        (if (isStudent) cls["faculty"]["name"].text?.let { " · $it" } ?: "" else "") +
                        (if (!isStudent) cls["section"].text?.let { " · Section $it" } ?: "" else ""),
                    color = Color(0xD9FFFFFF),
                )
            }
        }

        val d = dash.data
        when {
            d == null && dash.error != null -> ErrorState(dash.error) { dash.refetch() }
            d == null -> Loading()
            else -> {
                val stats = d["stats"]
                val myClubs = stats["myClubs"].int ?: 0
                val regs = stats["upcomingRegistrations"].int ?: 0
                val tiles = buildList {
                    add(TileSpec(Icons.Rounded.Category, Grad.violet, "My clubs", "$myClubs club${if (myClubs == 1) "" else "s"}", "Tap to preview") { sheet = "clubs" })
                    add(TileSpec(Icons.Rounded.EventAvailable, Grad.sky, "Upcoming", "$regs registered", "Tap to preview") { sheet = "upcoming" })
                    add(TileSpec(Icons.Rounded.FactCheck, if (low) Grad.rose else Grad.emerald, if (isHod) "Dept attendance" else "Attendance", attValue, attHint) {
                        if (seesSummary) sheet = "attendance" else Nav.push("/attendance")
                    })
                    val total = unread.data["total"].int ?: 0
                    add(TileSpec(Icons.Rounded.ChatBubble, Grad.primary, "Messages", if (total > 0) "$total unread" else "All caught up") { Nav.push("/chat") })
                    if (!noTimetable) {
                        val classes = now.data["today"].list.count { !it["isBreak"].bool }
                        add(TileSpec(Icons.Rounded.EventNote, Grad.amber, "Timetable", "$classes classes today") { Nav.push("/timetable") })
                    }
                    add(TileSpec(
                        Icons.Rounded.DoorFront, Grad.cyan, "Gate pass",
                        if (isStudent) open?.let { it["status"].str.orEmpty().replace(Regex("^pending_"), "waiting: ") } ?: "No active pass"
                        else if (role == "security") "Verify codes" else "Review passes",
                        open?.let { "Return by ${Fmt.classDay(it["toDate"])}" },
                    ) { Nav.push("/gate-pass") })
                }
                Tiles(tiles)

                if (role !in ACHIEVEMENT_BLOCKED_ROLES) AchievementsSpotlight(isStudent)

                SectionTitle("Notice board", "See all") { Nav.push("/announcements") }
                val anns = d["announcements"].list
                if (anns.isEmpty()) Card(Wide) { Small("No announcements yet.") }
                anns.take(3).forEach { a ->
                    Card(Wide, onClick = { Nav.push("/announcements") }, gap = 6.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Rounded.Campaign, null, Modifier.size(16.dp), tint = C.primary)
                            Strong(a["title"].str, Modifier.weight(1f), maxLines = 1)
                            PriorityBadge(a["priority"].str)
                        }
                        Small(a["content"].str, maxLines = 2)
                        Small("${a["author"]["name"].str ?: ""} · ${Fmt.timeAgo(a["createdAt"])}", color = C.muted)
                    }
                }

                val rec = d["recommended"].list
                if (rec.isNotEmpty()) {
                    SectionTitle("Recommended for you", "All events") { Nav.push("/events") }
                    rec.take(3).forEach { e ->
                        RowCard(Wide, onClick = { Nav.push("/events/${e.id}") }) {
                            if (e["poster"].text != null) RemoteImage(e["poster"].str, Modifier.size(42.dp).clip(RoundedCornerShape(14.dp)))
                            else IconTile(Icons.Rounded.AutoAwesome, Grad.hero, 42.dp)
                            Column(Modifier.weight(1f)) {
                                Strong(e["title"].str, maxLines = 1)
                                Small("${Fmt.date(e["startDate"], "EEE, dd MMM · h:mm a")} · ${e["venue"].str ?: ""}", maxLines = 1)
                            }
                        }
                    }
                }

                when (sheet) {
                    "clubs" -> PreviewSheet("My clubs", "/clubs", { sheet = null }) {
                        val clubs = d["myClubs"].list
                        if (clubs.isEmpty()) Small("You haven’t joined a club yet.")
                        clubs.take(3).forEach { c ->
                            GlassRow(onClick = { sheet = null; Nav.push("/clubs/${c["slug"].str}") }) {
                                Avatar(name = c["name"].str, uri = c["logo"].str, size = 40.dp)
                                Column(Modifier.weight(1f)) {
                                    Strong(c["name"].str, maxLines = 1)
                                    Small("${num(c["memberCount"])} members")
                                }
                            }
                        }
                    }
                    "upcoming" -> {
                        val upcoming = (if (regs > 0) d["myUpcoming"] else d["upcomingEvents"]).list
                        PreviewSheet(if (regs > 0) "Your upcoming events" else "Upcoming on campus", "/events", { sheet = null }) {
                            if (upcoming.isEmpty()) Small("No upcoming events.")
                            upcoming.take(3).forEach { e ->
                                GlassRow(onClick = { sheet = null; Nav.push("/events/${e.id}") }) {
                                    EventThumb(e, 44, 14)
                                    Column(Modifier.weight(1f)) {
                                        Strong(e["title"].str, maxLines = 1)
                                        Small("${e["venue"].str ?: ""} · ${Fmt.time(e["startDate"])}", maxLines = 1)
                                    }
                                    e["myStatus"].text?.let { Badge(it, if (it == "waitlisted") Tone.Warning else Tone.Success) }
                                }
                            }
                        }
                    }
                    "attendance" -> PreviewSheet(if (isHod) "Today · ${summary.data["department"].text ?: "Your department"}" else "Today · whole college", "/attendance", { sheet = null }) {
                        when {
                            summary.data == null && summary.error != null -> ErrorState(summary.error) { summary.refetch() }
                            s == null -> Loading()
                            isHod -> {
                                SheetRow("Total students", num(s["total"]))
                                SheetRow("Absent students", num(s["absent"]), C.danger)
                                if ((s["unmarked"].int ?: 0) > 0) Small("${num(s["unmarked"])} not marked yet")
                            }
                            else -> {
                                SheetRow("Total students", num(s["total"]))
                                SheetRow("Students present", num(s["present"]), C.success)
                                SheetRow("Students absent", num(s["absent"]), C.danger)
                                SheetRow("Total faculty", num(f["total"]))
                                SheetRow("Faculty present", "${num(f["percentage"])}%", C.success)
                                SheetRow("Faculty absent", num((f["absent"].dbl ?: 0.0) + (f["leave"].dbl ?: 0.0)), C.danger)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Small card that slides up from the bottom with a 2–3 item preview and "View all". */
@Composable
private fun PreviewSheet(title: String, viewAll: String?, onClose: () -> Unit, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Sheet(title, onClose = onClose, footer = viewAll?.let {
        {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.primarySoft)
                    .clickable { onClose(); Nav.push(it) }.padding(vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
            ) {
                Strong("View all", color = C.primary600)
                Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, Modifier.size(16.dp), tint = C.primary600)
            }
        }
    }, content = content)
}

@Composable
private fun SheetRow(label: String, value: String?, tone: Color = Color.Unspecified) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.whiteGlass).padding(horizontal = 14.dp, vertical = 11.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Small(label)
        Strong(value ?: "—", color = tone)
    }
}

@Composable
private fun AlumniHome(user: JsonElement) {
    val dash = Api.alumniDashboard()
    val data = dash.data
    if (data == null) {
        Screen(refreshing = dash.isFetching, onRefresh = { dash.refetch() }) {
            if (dash.error != null) ErrorState(dash.error) { dash.refetch() } else Loading("Loading alumni dashboard...")
        }
        return
    }
    val profile = data["profile"]
    val stats = data["stats"]
    val verified = profile["isVerified"].bool
    val completeness = profile["completeness"].int ?: 0
    Screen(refreshing = dash.isFetching && !dash.isLoading, onRefresh = { dash.refetch() }) {
        Greeting(user, "🎓") {
            IconButton(Icons.Rounded.Explore, "Alumni Network") { Nav.push("/alumni") }
            IconButton(Icons.Rounded.Search, "Search") { Nav.push("/search") }
        }
        HeroCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Small(Fmt.format(java.time.ZonedDateTime.now(), "EEEE, dd MMMM"), color = Color(0xD9FFFFFF))
                Badge(if (verified) "Verified Alumnus" else "Pending Review", if (verified) Tone.Success else Tone.Warning)
            }
            H2("Alumni Career & Mentorship Portal", color = Color.White)
            Small("Profile Strength: $completeness% • Mentoring: ${if (profile["mentorshipAvailable"].bool) "Accepting Mentees" else "Paused"}", color = Color(0xD9FFFFFF))
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.clip(RoundedCornerShape(14.dp)).background(Color.White).clickable { Nav.push("/alumni/sessions") }.padding(horizontal = 14.dp, vertical = 9.dp)) {
                    T("Manage Sessions", Type.strong, color = C.primary600, size = 13)
                }
                Box(Modifier.clip(RoundedCornerShape(14.dp)).background(Color(0x2EFFFFFF)).clickable { Nav.push("/alumni") }.padding(horizontal = 14.dp, vertical = 9.dp)) {
                    T("Open Hub →", Type.strong, color = Color.White, size = 13)
                }
            }
        }
        data["attention"].list.forEach { att ->
            val danger = att["level"].str == "danger"
            Card(Wide, onClick = { Nav.push("/alumni") }, border = if (danger) C.danger else C.warning, gap = 4.dp) {
                Label("Action Needed", color = if (danger) C.danger else C.warning)
                Small(att["message"].str, color = C.ink)
            }
        }
        val rating = stats["ratingAvg"].dbl ?: 0.0
        Tiles(listOf(
            TileSpec(Icons.Rounded.VerifiedUser, if (verified) Grad.emerald else Grad.amber, "Status", if (verified) "Verified" else "Pending", "Directory verification") { Nav.push("/alumni") },
            TileSpec(Icons.Rounded.AutoAwesome, Grad.violet, "Profile", "$completeness%", "Completeness") { Nav.push("/alumni") },
            TileSpec(Icons.Rounded.Group, Grad.sky, "Mentees", "${stats["activeMentees"].int ?: 0} / ${stats["menteeCapacity"].int ?: 3}", "Active mentees") { Nav.push("/alumni") },
            TileSpec(Icons.Rounded.Timer, Grad.rose, "Requests", "${stats["pendingRequests"].int ?: 0}", "Awaiting response") { Nav.push("/alumni") },
            TileSpec(Icons.Rounded.CalendarMonth, Grad.violet, "Sessions", "${stats["upcomingSessions"].int ?: 0}", "Upcoming 1-on-1s") { Nav.push("/alumni/sessions") },
            TileSpec(Icons.Rounded.Star, Grad.amber, "Rating", if (rating > 0) "%.1f ★".format(rating) else "—", "${stats["ratingCount"].int ?: 0} reviews") { Nav.push("/alumni") },
            TileSpec(Icons.Rounded.Work, Grad.emerald, "Jobs", "${stats["jobsPosted"].int ?: 0}", "${stats["applicants"].int ?: 0} applicants") { Nav.push("/alumni") },
            TileSpec(Icons.Rounded.Explore, Grad.rose, "Chapters", "${stats["chapters"].int ?: 0}", "Enrolled hubs") { Nav.push("/alumni") },
        ))
        val pending = data["pendingRequests"].list
        if (pending.isNotEmpty()) {
            SectionTitle("Pending Requests (${pending.size})")
            pending.take(3).forEach { req ->
                Card(Wide, onClick = { Nav.push("/alumni") }, gap = 6.dp) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Strong(req["student"]["name"].str)
                        Badge("Pending", Tone.Warning)
                    }
                    Small("${req["student"]["department"].str ?: ""} • Year ${req["student"]["year"].text ?: "—"}", color = C.muted)
                    T("\"${req["message"].str ?: ""}\"", Type.small.copy(fontStyle = FontStyle.Italic), color = C.ink, maxLines = 2)
                }
            }
        }
        val upcoming = data["upcomingSessions"].list
        if (upcoming.isNotEmpty()) {
            SectionTitle("Upcoming Sessions (${upcoming.size})")
            upcoming.take(3).forEach { sess ->
                Card(Wide, onClick = { Nav.push("/alumni/sessions") }, gap = 6.dp) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Strong(sess["student"]["name"].str)
                        Badge("Confirmed", Tone.Success)
                    }
                    Small(Fmt.date(sess["scheduledAt"], "EEE, MMM d · h:mm a"), color = C.muted)
                }
            }
        }
    }
}

/* ── Chat list ──────────────────────────────────────────────────── */

@Composable
fun ChatListScreen() {
    val me = me()
    var search by rememberSaveable { mutableStateOf("") }
    val presence = remember { mutableStateMapOf<String, Boolean>() }
    val typing = remember { mutableStateMapOf<String, Boolean>() }
    val q = Api.conversations(if (search.isNotEmpty()) mapOf("search" to search) else null)
    // Faculty / HOD see their own pending or rejected group requests; the admin
    // and the principal see what waits for their approval.
    val reviewer = me.role in setOf("admin", "principal")
    val requests = Api.groupRequests(skip = me.role !in setOf("admin", "principal", "hod", "faculty")).data.list

    SocketEvent("presence:update") { a -> a.firstOrNull()?.let { p -> p["userId"].str?.let { presence[it] = p["online"].bool } } }
    SocketEvent("chat:typing") { a -> a.firstOrNull()?.let { p -> p["conversationId"].str?.let { typing[it] = p["isTyping"].bool } } }
    SocketEvent("chat:message") { a -> a.firstOrNull()["conversationId"].str?.let { typing[it] = false } }

    ListScreen(
        q, { it.list },
        header = {
            Header("Messages", right = { IconButton(Icons.Rounded.Add, "New message", C.primary) { Nav.push("/chat/new") } })
            Input(search, { search = it }, placeholder = "Search chats")
        },
        empty = {
            EmptyState(Icons.Rounded.ChatBubble, if (search.isNotEmpty()) "No chats found" else "No conversations yet", "Message a classmate or faculty member — chats sync live with the web app.",
                action = if (search.isEmpty()) ({ Button("New message", { Nav.push("/chat/new") }, icon = Icons.Rounded.Add) }) else null)
        },
        gap = 0.dp,
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 30.dp),
        listHeader = {
            if (search.isEmpty() && requests.isNotEmpty()) item {
                if (reviewer) {
                    Row(
                        Modifier.fillMaxWidth().padding(bottom = 6.dp).clip(RoundedCornerShape(20.dp)).background(C.warningSoft)
                            .clickable { Nav.push("/admin/chat-requests") }.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(Icons.Rounded.Shield, null, Modifier.size(22.dp), tint = C.amberText)
                        Strong("${requests.size} group request${if (requests.size == 1) "" else "s"} to review", Modifier.weight(1f), C.amberText)
                    }
                } else {
                    Column(Modifier.padding(bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        requests.forEach { r ->
                            val pending = r["status"].str == "pending"
                            Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Box(Modifier.size(48.dp).clip(RoundedCornerShape(17.dp)).background(Color(0xB3FFFFFF)), contentAlignment = Alignment.Center) {
                                    Icon(if (pending) Icons.Rounded.HourglassTop else Icons.Rounded.Cancel, null, Modifier.size(22.dp), tint = if (pending) C.warning else C.danger)
                                }
                                Column(Modifier.weight(1f)) {
                                    Strong(r["name"].str, maxLines = 1)
                                    Small(
                                        if (pending) "Waiting for ${if (me.role == "hod") "principal" else "admin"} approval"
                                        else "Not approved${r["rejectReason"].text?.let { " — $it" } ?: ""}",
                                        color = if (pending) C.amberText else C.danger, maxLines = 1,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        },
    ) { c ->
        val d = describeConversation(c, me)
        val online = d.other?.let { other -> presence[other.id] ?: other["online"].bool } ?: false
        val unreadCount = c["unreadCount"].int ?: 0
        val isTyping = typing[c.id] == true
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).clickable { Nav.push("/chat/${c.id}") }.padding(10.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (d.group) IconTile(Icons.Rounded.Groups, Grad.hero, 48.dp) else Avatar(d.other, size = 48.dp, online = online)
            Column(Modifier.weight(1f)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    T(d.title, Type.strong.copy(fontWeight = if (unreadCount > 0) FontWeight.ExtraBold else FontWeight.Bold), Modifier.weight(1f), maxLines = 1)
                    Small(Fmt.listTime(c["lastMessage"]["sentAt"] ?: c["updatedAt"]), color = C.muted)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val last = c["lastMessage"]
                    Small(
                        when {
                            isTyping -> "typing…"
                            last["body"].text != null -> "${if (sameId(last["sender"], me)) "You: " else ""}${last["body"].str}"
                            else -> "No messages yet"
                        },
                        Modifier.weight(1f), if (isTyping) C.primary else C.soft, maxLines = 1,
                    )
                    if (unreadCount > 0) CountBubble(unreadCount)
                }
            }
        }
    }
}

/* ── Campus ─────────────────────────────────────────────────────── */

private data class CampusItem(val href: String, val label: String, val hint: String, val icon: ImageVector, val g: List<Color>)

private val CAMPUS_ITEMS = listOf(
    CampusItem("/sos", "Emergency SOS", "Instant alert", Icons.Rounded.Warning, Grad.rose),
    CampusItem("/timetable", "Timetable", "Today & this week", Icons.Rounded.EventNote, Grad.violet),
    CampusItem("/attendance", "Attendance", "Subject-wise %", Icons.Rounded.FactCheck, Grad.emerald),
    CampusItem("/od-leave", "OD & Leave", "Apply & track", Icons.Rounded.EventAvailable, Grad.sky),
    CampusItem("/holidays", "Holidays", "College holidays", Icons.Rounded.EventBusy, Grad.rose),
    CampusItem("/study-materials", "Study Materials", "Notes & AI assistant", Icons.Rounded.MenuBook, Grad.sky),
    CampusItem("/alumni", "Alumni Network", "Mentors, jobs & chapters", Icons.Rounded.School, Grad.primary),
    CampusItem("/gate-pass", "Gate pass", "Request & QR", Icons.Rounded.DoorFront, Grad.cyan),
    CampusItem("/hostel", "Hostel", "Inside & outside", Icons.Rounded.Bed, Grad.violet),
    CampusItem("/lost-found", "Lost & found", "Report or search", Icons.Rounded.Inventory2, Grad.amber),
    CampusItem("/complaints", "Complaints", "Register & track", Icons.Rounded.ReportProblem, Grad.rose),
    CampusItem("/achievements", "Achievements", "Student honors & awards", Icons.Rounded.EmojiEvents, Grad.amber),
    CampusItem("/people", "People", "Students & faculty", Icons.Rounded.Groups, Grad.violet),
    CampusItem("/events", "Events", "Register", Icons.Rounded.CalendarMonth, Grad.sky),
    CampusItem("/clubs", "Clubs", "Join & follow", Icons.Rounded.Category, Grad.rose),
    CampusItem("/announcements", "Announcements", "Campus news", Icons.Rounded.Campaign, Grad.amber),
    CampusItem("/discussions", "Discussions", "Ask & answer", Icons.Rounded.Forum, Grad.emerald),
    CampusItem("/search", "Search", "People, clubs, events", Icons.Rounded.Search, Grad.primary),
    CampusItem("/settings/security", "Security", "Devices & password", Icons.Rounded.Shield, Grad.violet),
)

private val ADMIN_ITEMS = listOf(
    CampusItem("/admin/create-user", "Create login", "Students, faculty, HOD", Icons.Rounded.PersonAdd, Grad.primary),
    CampusItem("/admin/chat-requests", "Group requests", "Approve class groups", Icons.Rounded.Groups, Grad.rose),
)

// Security only deals with gate passes and lost & found — the rest of campus life doesn't apply to them.
private val HIDDEN_FOR_SECURITY = setOf("/timetable", "/study-materials", "/attendance", "/events", "/clubs", "/announcements", "/discussions", "/search", "/complaints", "/alumni", "/holidays")
// Warden/Security have zero timetable or study-materials access anywhere in the app.
private val HIDDEN_FOR_NO_TIMETABLE = setOf("/timetable", "/study-materials", "/holidays")
// Alumni only access alumni network, events, clubs, announcements, discussions, search, and security.
private val HIDDEN_FOR_ALUMNI = setOf("/timetable", "/attendance", "/study-materials", "/gate-pass", "/lost-found", "/complaints", "/holidays")
// Students apply for OD / Leave; these staff roles review. The API enforces the same.
private val OD_LEAVE_ROLES = STUDENT_ROLES + setOf("faculty", "hod", "principal", "admin")
// Faculty Class In-Charge: manage their own class's student logins.
private val CLASS_ITEM = CampusItem("/class/students", "My class", "Student logins", Icons.Rounded.Groups, Grad.emerald)

@Composable
fun CampusScreen() {
    val me = me()
    val role = me.role
    val staff = role !in STUDENT_ROLES
    var items = (if (role == "admin") ADMIN_ITEMS else emptyList()) +
        // The principal approves the chat groups HODs ask to create.
        (if (role == "principal") ADMIN_ITEMS.filter { it.href == "/admin/chat-requests" } else emptyList()) +
        (if (isClassInCharge(me)) listOf(CLASS_ITEM) else emptyList()) + CAMPUS_ITEMS.filter {
        (role != "security" || it.href !in HIDDEN_FOR_SECURITY) &&
            (role !in setOf("warden", "security") || it.href !in HIDDEN_FOR_NO_TIMETABLE) &&
            (role != "alumni" || it.href !in HIDDEN_FOR_ALUMNI) &&
            (it.href != "/od-leave" || role in OD_LEAVE_ROLES) &&
            (it.href != "/hostel" || role in HOSTEL_ROLES) &&
            (role !in ACHIEVEMENT_BLOCKED_ROLES || it.href != "/achievements") &&
            // The People directory is for faculty, HODs and college-wide roles (server rule).
            (it.href != "/people" || role in setOf("faculty", "hod") + COLLEGE_WIDE)
    }.map { if (it.href == "/attendance" && staff) it.copy(hint = if (role == "principal") "College summary" else "Mark & review") else it }
    if (role == "alumni") items.firstOrNull { it.href == "/alumni" }?.let { a -> items = listOf(a) + items.filter { it.href != "/alumni" } }

    Screen {
        Header("Campus", "Everything on JNN, in one place.")
        Grid2(items) { i, mod ->
            Card(mod, onClick = { Nav.push(i.href) }, gap = 10.dp) {
                IconTile(i.icon, i.g, 42.dp)
                Column {
                    Strong(i.label)
                    Small(i.hint)
                }
            }
        }
    }
}

/* ── Notifications ──────────────────────────────────────────────── */

@Composable
fun NotificationsScreen() {
    val q = Api.notifications(mapOf("limit" to 50))
    val markAll = rememberMutation()
    val scope = rememberCoroutineScope()
    val unread = q.data["unread"].int ?: 0
    ListScreen(
        q, { it["items"].list },
        header = {
            Header("Notifications", if (unread > 0) "$unread unread" else "You’re all caught up", right = if (unread > 0) ({
                Button("Read all", { markAll.launch { Api.markAllNotificationsRead() } }, variant = Variant.Soft, icon = Icons.Rounded.DoneAll, small = true, loading = markAll.isLoading)
            }) else null)
        },
        empty = { EmptyState(Icons.Rounded.Notifications, "No notifications yet", "Announcements, events, gate pass updates and more show up here.") },
        gap = 10.dp,
    ) { n ->
        val read = n["read"].bool
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(if (read) Color(0x99FFFFFF) else Color(0xF2FFFFFF))
                .clickable {
                    if (!read) scope.launch { runCatching { Api.markNotificationRead(n.id.orEmpty()) } }
                    n["link"].text?.let { Nav.push(it) }
                }
                .padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.padding(top = 6.dp).size(8.dp).clip(RoundedCornerShape(8.dp)).background(if (read) Color.Transparent else C.primary))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Strong(n["title"].str)
                n["message"].text?.let { Small(it) }
                Small(Fmt.timeAgo(n["createdAt"]), color = C.muted)
            }
        }
    }
}

/* ── Profile ────────────────────────────────────────────────────── */

@Composable
fun ProfileScreen() {
    val user = me()
    var editing by remember { mutableStateOf(false) }
    var bio by remember(user, editing) { mutableStateOf(user["bio"].str.orEmpty()) }
    var phone by remember(user, editing) { mutableStateOf(user["phone"].str.orEmpty()) }
    var skills by remember(user, editing) { mutableStateOf(user["skills"].strings.joinToString(", ")) }
    val save = rememberMutation()
    var signingOut by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val photo = rememberMutation()
    val photoPicker = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) photo.launch(onError = { Dialogs.alert("Could not update photo", errMsg(it)) }) { Auth.setUser(Api.uploadAvatar(uri)) }
    }

    /** Sign out THIS device: the server revokes only this session and forgets its push token. */
    fun signOut() {
        signingOut = true
        scope.launch {
            try {
                val refreshToken = withContext(Dispatchers.IO) { Auth.readRefreshToken() }
                val pushToken = runCatching { Push.getPushToken(VexonApp.instance, askPermission = false) }.getOrNull()
                runCatching { Http.postPublic("/auth/logout", jsonOf("refreshToken" to refreshToken, "pushToken" to pushToken)) }
            } finally {
                withContext(Dispatchers.IO) { Auth.clearRefreshToken() }
                Realtime.disconnect()
                QueryClient.reset()
                Auth.loggedOut()
                signingOut = false
            }
        }
    }

    Screen {
        Header("Profile", right = { Button(if (editing) "Cancel" else "Edit", { editing = !editing }, variant = Variant.Soft, icon = Icons.Rounded.Edit, small = true) })
        Card(Wide, horizontalAlignment = Alignment.CenterHorizontally, gap = 8.dp) {
            Box(Modifier.pressable({
                photoPicker.launch(androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly))
            }).semantics { contentDescription = "Change profile photo" }) {
                Avatar(user, size = 84.dp)
                Box(
                    Modifier.align(Alignment.BottomEnd).size(30.dp).clip(androidx.compose.foundation.shape.CircleShape).background(C.primary),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Rounded.PhotoCamera, null, Modifier.size(15.dp), tint = Color.White) }
            }
            if (photo.isLoading) Small("Uploading photo…")
            H2(user["name"].str)
            Small(user["email"].str)
            Badge(ROLE_LABELS[user.role] ?: user.role)
        }
        if (editing) {
            Card(Wide, gap = 12.dp) {
                Input(bio, { bio = it }, label = "Bio", multiline = true, maxLength = 500)
                Input(phone, { phone = it }, label = "Phone", keyboardType = KeyboardType.Phone, maxLength = 20)
                Input(skills, { skills = it }, label = "Skills", hint = "Comma-separated")
                Button("Save profile", {
                    save.launch(onError = { Dialogs.alert("Could not save", errMsg(it)) }) {
                        val updated = Api.updateMe(jsonOf("bio" to bio, "phone" to phone, "skills" to skills.split(",").map { it.trim() }.filter { it.isNotEmpty() }))
                        Auth.setUser(updated)
                        editing = false
                    }
                }, Wide, loading = save.isLoading)
            }
        } else {
            Card(Wide) {
                InfoRow("Department", user["department"].str)
                InfoRow("Year", user["year"].str)
                InfoRow("Section", user["section"].str)
                InfoRow("Semester", user["semester"].str)
                InfoRow("Roll number", user["rollNo"].str)
                user["bio"].text?.let { Body(it, Modifier.padding(top = 8.dp)) }
                val sk = user["skills"].strings
                if (sk.isNotEmpty()) FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    sk.forEach { Badge(it, Tone.Neutral) }
                }
            }
        }
        if (user.role in STUDENT_ROLES) user.id?.let { StudentHonors(it) }
        Button("Account security", { Nav.push("/settings/security") }, Wide, variant = Variant.Outline, icon = Icons.Rounded.Shield)
        Button("Sign out", {
            Dialogs.alert("Sign out?", "You'll need your email and password to sign in again on this phone.", listOf(
                DialogButton("Cancel", cancel = true),
                DialogButton("Sign out", destructive = true) { signOut() },
            ))
        }, Wide, variant = Variant.Danger, icon = Icons.AutoMirrored.Rounded.Logout, loading = signingOut)
        Small("Class details (section, semester) are managed by your administrator.", Wide, C.muted, TextAlign.Center)
    }
}

