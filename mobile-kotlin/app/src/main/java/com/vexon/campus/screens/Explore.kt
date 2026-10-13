package com.vexon.campus.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.ChatBubble
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.EventBusy
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vexon.campus.core.Api
import com.vexon.campus.core.ApiException
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.ServerConfig
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
import com.vexon.campus.nav.Nav
import com.vexon.campus.ui.Avatar
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.Body
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.Grad
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.H3
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.IconButton
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Jakarta
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.MarkdownText
import com.vexon.campus.ui.Opt
import com.vexon.campus.ui.ROLE_LABELS
import com.vexon.campus.ui.RowCard
import com.vexon.campus.ui.STUDENT_ROLES
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.SectionTitle
import com.vexon.campus.ui.Segmented
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.T
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Type
import com.vexon.campus.ui.Variant
import com.vexon.campus.ui.fmtHolidayDates
import com.vexon.campus.ui.hiddenIf
import com.vexon.campus.ui.holidaysOn
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

fun openUrl(context: Context, url: String?) {
    if (url.isNullOrBlank()) return
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

/* ── Person ─────────────────────────────────────────────────────── */

@Composable
fun PersonScreen(id: String) {
    val me = me()
    val q = Api.user(id)
    val create = rememberMutation()
    DetailScreen(q, "Profile") { u ->
        Header(u["name"].str, ROLE_LABELS[u.role], back = true)
        Card(Wide, horizontalAlignment = Alignment.CenterHorizontally, gap = 8.dp) {
            Avatar(u, size = 84.dp)
            H2(u["name"].str)
            Small(
                (u["department"].str ?: "") + (u["year"].text?.let { " · Year $it" } ?: "") + (u["designation"].text?.let { " · $it" } ?: ""),
                align = TextAlign.Center,
            )
            if (!sameId(u, me)) Button("Message", {
                create.launch(onError = { Dialogs.alert("Could not start chat", errMsg(it)) }) {
                    val conv = Api.createConversation(jsonOf("type" to "private", "participantIds" to listOf(u.id)))
                    Nav.push("/chat/${conv.id}")
                }
            }, icon = Icons.Rounded.ChatBubble, small = true, loading = create.isLoading)
        }
        if (me.role !in ACHIEVEMENT_BLOCKED_ROLES) u.id?.let { StudentHonors(it) }
        u["bio"].text?.let { Card(Wide) { Body(it) } }
        val skills = u["skills"].strings
        if (skills.isNotEmpty()) Card(Wide, gap = 8.dp) {
            Label("Skills")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { skills.forEach { Badge(it, Tone.Neutral) } }
        }
        val st = u["stats"]
        RowCard(Wide, gap = 0.dp) {
            listOf("Events" to st["eventsJoined"], "Attended" to st["eventsAttended"], "Clubs" to st["clubs"], "Posts" to st["discussions"]).forEach { (l, v) ->
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    H2(num(v))
                    Small(l)
                }
            }
        }
    }
}

/* ── Search ─────────────────────────────────────────────────────── */

@Composable
fun SearchScreen() {
    var text by rememberSaveable { mutableStateOf("") }
    var q by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(text) {
        delay(350)
        q = text.trim()
    }
    val res = Api.search(q, skip = q.length < 2)
    val data = res.data
    val users = data["users"].list
    val clubs = data["clubs"].list
    val events = data["events"].list
    val discussions = data["discussions"].list
    val announcements = data["announcements"].list
    val achievements = data["achievements"].list
    val total = users.size + clubs.size + events.size + discussions.size + announcements.size + achievements.size

    Screen {
        Header("Search", back = true)
        Input(text, { text = it }, placeholder = "People, clubs, events, discussions…")
        when {
            q.length < 2 -> EmptyState(Icons.Rounded.Search, "Search JNN", "Type at least 2 characters.")
            data == null -> Loading()
            total == 0 -> EmptyState(Icons.Rounded.Search, "Nothing found for “$q”")
            else -> {
                if (users.isNotEmpty()) SectionTitle("People")
                users.forEach { u ->
                    RowCard(Wide, onClick = { Nav.push("/people/${u.id}") }, gap = 10.dp) {
                        Avatar(u, size = 38.dp)
                        Column(Modifier.weight(1f)) {
                            Strong(u["name"].str)
                            Small((ROLE_LABELS[u.role] ?: "") + (u["department"].text?.let { " · $it" } ?: ""))
                        }
                    }
                }
                if (clubs.isNotEmpty()) SectionTitle("Clubs")
                clubs.forEach { c ->
                    RowCard(Wide, onClick = { Nav.push("/clubs/${c["slug"].str}") }, gap = 10.dp) {
                        Avatar(name = c["name"].str, uri = c["logo"].str, size = 38.dp)
                        Strong(c["name"].str, Modifier.weight(1f))
                        Small("${num(c["memberCount"])} members")
                    }
                }
                if (events.isNotEmpty()) SectionTitle("Events")
                events.forEach { e ->
                    Card(Wide, onClick = { Nav.push("/events/${e.id}") }) {
                        Strong(e["title"].str)
                        Small(Fmt.dateTime(e["startDate"]))
                    }
                }
                if (discussions.isNotEmpty()) SectionTitle("Discussions")
                discussions.forEach { d ->
                    Card(Wide, onClick = { Nav.push("/discussions/${d.id}") }) {
                        Strong(d["title"].str)
                        Small("${num(d["replyCount"])} replies")
                    }
                }
                if (announcements.isNotEmpty()) SectionTitle("Announcements")
                announcements.forEach { a ->
                    Card(Wide, onClick = { Nav.push("/announcements") }) {
                        Strong(a["title"].str)
                        Small(a["content"].str, maxLines = 2)
                    }
                }
                if (achievements.isNotEmpty()) SectionTitle("Achievements")
                achievements.forEach { AchievementRow(it) }
            }
        }
    }
}

/* ── Calendar ───────────────────────────────────────────────────── */

private val DOT = mapOf(
    "technical" to Color(0xFF7C6CF0), "hackathon" to Color(0xFFC05CF0), "workshop" to Color(0xFF38A9F0), "seminar" to Color(0xFF22B8C9),
    "cultural" to Color(0xFFF0609E), "sports" to Color(0xFFF5A524), "career" to Color(0xFF4F7BF0),
)

/** Full campus calendar (opened from the calendar icon on Home). Loads one month at a time. */
@Composable
fun CalendarScreen() {
    val zone = ZoneId.systemDefault()
    var month by rememberSaveable { mutableStateOf(LocalDate.now().withDayOfMonth(1)) }
    var selected by rememberSaveable { mutableStateOf(LocalDate.now()) }
    val from = month.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    val to = month.with(TemporalAdjusters.lastDayOfMonth()).with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY))
    val days = generateSequence(from) { it.plusDays(1) }.takeWhile { !it.isAfter(to) }.toList()

    val q = Api.events(mapOf(
        "when" to "all",
        "from" to from.atStartOfDay(zone).toInstant().toString(),
        "to" to to.atStartOfDay(zone).toInstant().toString(),
        "limit" to 50,
    ))
    val events = q.data["items"].list
    // Holidays that apply to this account (filtered by the server); no academic
    // calendar for warden / security / alumni.
    val academic = me().role !in setOf("warden", "security", "alumni")
    val hol = Api.holidays(mapOf("from" to from.toString(), "to" to to.toString()), skip = !academic)
    val holidays = hol.data["holidays"].list
    fun on(day: LocalDate) = events.filter { Fmt.parse(it["startDate"])?.toLocalDate() == day }
    val pickedHolidays = holidaysOn(holidays, selected.toString())
    val picked = on(selected)

    Screen(refreshing = false, onRefresh = { q.refetch(); hol.refetch() }) {
        Header("Calendar", "Events and holidays", back = true, right = if (q.isFetching) ({ CircularProgressIndicator(Modifier.size(24.dp), color = C.primary, strokeWidth = 2.dp) }) else null)
        Card(Wide, gap = 10.dp) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                H3(Fmt.format(month, "MMMM yyyy"), Modifier.weight(1f))
                IconButton(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "Previous month") { month = month.minusMonths(1) }
                Box(Modifier.width(8.dp))
                IconButton(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "Next month") { month = month.plusMonths(1) }
            }
            Row {
                listOf("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su").forEach { Label(it, Modifier.weight(1f)) }
            }
            days.chunked(7).forEach { week ->
                Row {
                    week.forEach { day ->
                        val evs = on(day)
                        val off = holidaysOn(holidays, day.toString()).isNotEmpty()
                        val active = day == selected
                        val today = day == LocalDate.now()
                        Box(
                            Modifier.weight(1f).aspectRatio(1f).padding(2.dp)
                                .semantics { contentDescription = "${Fmt.format(day, "d MMMM")}, ${if (off) "holiday, " else ""}${evs.size} events" }
                                .clip(RoundedCornerShape(12.dp))
                                .background(if (active) C.primary else if (off) C.dangerSoft else if (today) C.primarySoft else Color.Transparent)
                                .clickable { selected = day },
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                T(
                                    day.dayOfMonth.toString(), Type.small.copy(fontWeight = FontWeight.Bold),
                                    color = when {
                                        active -> Color.White
                                        off -> C.danger
                                        day.month != month.month -> Color(0x809295B3)
                                        else -> C.ink
                                    },
                                )
                                if (evs.isNotEmpty()) Row(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                    evs.take(3).forEach { e ->
                                        Box(Modifier.size(4.dp).clip(CircleShape).background(if (active) Color.White else DOT[e["category"].str] ?: C.primary))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if (q.error != null) ErrorState(q.error) { q.refetch() }
        Label(Fmt.format(selected, "EEEE, dd MMM"))
        pickedHolidays.forEach { h ->
            RowCard(Wide, background = C.dangerSoft, border = C.dangerBorder, gap = 10.dp, verticalAlignment = Alignment.Top) {
                Icon(Icons.Rounded.EventBusy, null, Modifier.size(20.dp), tint = C.danger)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Label("HOLIDAY", color = C.dangerText)
                    Strong("Reason: ${h["reason"].str ?: ""}")
                    Small("Scope: ${h["scope"].str ?: ""}")
                    Small(fmtHolidayDates(h))
                }
            }
        }
        if (picked.isNotEmpty()) {
            picked.forEach { e ->
                RowCard(Wide, onClick = { Nav.push("/events/${e.id}") }) {
                    Box(Modifier.width(6.dp).height(36.dp).clip(RoundedCornerShape(3.dp)).background(DOT[e["category"].str] ?: C.primary))
                    Column(Modifier.weight(1f)) {
                        Strong(e["title"].str, maxLines = 1)
                        Small("${Fmt.time(e["startDate"])} · ${e["venue"].str ?: ""}", maxLines = 1)
                    }
                }
            }
        } else if (pickedHolidays.isEmpty()) Small("No events on this day.")
    }
}

/* ── Study materials + JNN Study Assistant ──────────────────────── */

private val CATEGORY_LABELS = mapOf("notes" to "Notes", "question_bank" to "Question bank", "lab_manual" to "Lab manual", "syllabus" to "Syllabus", "assignment" to "Assignment", "other" to "Other")

@Composable
private fun Materials(modifier: Modifier) {
    val context = LocalContext.current
    val me = me()
    val remove = rememberMutation()
    val q = Api.studyMaterials(mapOf("limit" to 50))
    val data = q.data
    Box(modifier) {
        when {
            data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            data == null -> Loading()
            else -> PullToRefreshBox(isRefreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch() }, modifier = Modifier.fillMaxSize()) {
                val items = data["items"].list
                LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp)) {
                    if (items.isEmpty()) item { Card(Wide) { EmptyState(Icons.Rounded.MenuBook, "No study materials yet", "Materials for your class will appear here once uploaded.") } }
                    items(items, key = { it.id ?: it.hashCode() }) { m ->
                        Card(Wide, gap = 6.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Icon(Icons.Rounded.Description, null, Modifier.size(16.dp), tint = C.primary)
                                Strong(m["title"].str, Modifier.weight(1f), maxLines = 2)
                                Badge(CATEGORY_LABELS[m["category"].str] ?: m["category"].str)
                            }
                            Small(
                                "${m["subjectName"].str ?: ""} — ${m["subjectCode"].str ?: ""} · ${m["department"].str ?: ""}" +
                                    (m["section"].text?.let { " · Sec $it" } ?: "") + " · Sem ${m["semester"].str ?: ""}",
                            )
                            m["description"].text?.let { Body(it, maxLines = 3) }
                            Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                m["file"]["url"].text?.let { url ->
                                    Button(m["file"]["name"].text ?: "Open", { openUrl(context, ServerConfig.assetUrl(url)) }, Modifier.weight(1f, fill = false), variant = Variant.Outline, icon = Icons.Rounded.Download, small = true)
                                }
                                // The uploader (or admin) may remove it; the server re-checks.
                                if (me.role == "admin" || sameId(m["uploadedBy"], me)) IconButton(Icons.Rounded.Delete, "Delete material", C.danger) {
                                    Dialogs.confirm("Delete this material?", m["title"].str, "Delete", destructive = true) {
                                        remove.launch(onError = { Dialogs.alert("Could not delete", errMsg(it)) }) { Api.deleteStudyMaterial(m.id.orEmpty()) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Study Materials + the JNN Study Assistant (same backend as the web app). */
@Composable
fun StudyMaterialsScreen() {
    val me = me()
    var tab by rememberSaveable { mutableStateOf("assistant") }
    var uploading by remember { mutableStateOf(false) }
    if (uploading) MaterialUploadSheet { uploading = false }
    Screen(scroll = false) {
        Column(Modifier.fillMaxSize().navigationBarsPadding().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Header(
                "Study Materials",
                if (me.role in STUDENT_ROLES) "Notes, question banks and resources for your class." else "Class notes, question banks and other resources.",
                back = true,
                right = if (tab == "materials" && me.role in MATERIAL_UPLOAD_ROLES) ({ Button("Upload", { uploading = true }, icon = Icons.Rounded.Add, small = true) }) else null,
            )
            Segmented(listOf(Opt("assistant", "🤖 Study Assistant"), Opt("materials", "Materials")), tab, { tab = it })
            // Both stay composed so switching tabs never loses the conversation.
            Box(Modifier.weight(1f)) {
                StudyAssistant(Modifier.fillMaxSize().hiddenIf(tab != "assistant"))
                if (tab == "materials") Materials(Modifier.fillMaxSize())
            }
        }
    }
}

private data class AssistantMsg(
    val id: String,
    val role: String,
    val content: String? = null,
    val pending: Boolean = false,
    val error: String? = null,
    val retry: String? = null,
    val notices: List<String> = emptyList(),
    val sources: List<JsonElement> = emptyList(),
)

private val SUGGESTIONS = listOf("Explain a difficult topic", "Summarize a concept", "Analyze my study material", "Find additional resources", "Research a technical topic")
private val SOURCE_GROUPS = listOf("study_material" to "📚 JNN Study Materials", "web" to "🌐 Web Research", "dataset" to "📊 Datasets")

// Our own uploads resolve against the server; anything else must be http(s).
private fun hrefFor(url: String?): String? = when {
    url == null -> null
    url.startsWith("/uploads/") -> ServerConfig.assetUrl(url)
    Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url) -> url
    else -> null
}

@Composable
private fun Sources(sources: List<JsonElement>) {
    if (sources.isEmpty()) return
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth().padding(top = 4.dp).clip(RoundedCornerShape(14.dp)).background(C.primary50).padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        T("SOURCES", Type.label.copy(fontSize = 10.sp, letterSpacing = 1.sp))
        SOURCE_GROUPS.forEach { (type, label) ->
            val items = sources.filter { it["type"].str == type }
            if (items.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                T(label, Type.strong.copy(fontSize = 12.sp))
                items.forEach { src ->
                    val href = hrefFor(src["url"].str)
                    Row(
                        Modifier.fillMaxWidth().then(if (href != null) Modifier.clickable { openUrl(context, href) } else Modifier).padding(start = 6.dp, top = 3.dp, bottom = 3.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Column(Modifier.weight(1f)) {
                            T((src["title"].str ?: "") + (src["page"].text?.let { " — Page $it" } ?: ""), Type.small, color = C.primary600, maxLines = 2)
                            val pub = src["publisher"].text
                            if (pub != null && pub != src["title"].str) T(pub, Type.body.copy(fontSize = 11.sp), color = C.muted, maxLines = 1)
                        }
                        if (href != null) Icon(Icons.AutoMirrored.Rounded.OpenInNew, null, Modifier.size(13.dp), tint = C.muted)
                    }
                }
            }
        }
    }
}

@Composable
private fun Bubble(msg: AssistantMsg, onRetry: (() -> Unit)?) {
    when {
        msg.role == "user" -> androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
            // At most 86% wide, hugging its text, aligned right.
            Box(
                Modifier.widthIn(max = maxWidth * 0.86f).clip(RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)).background(Brush.linearGradient(Grad.primary))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) { T(msg.content, Type.body, color = Color.White) }
        }
        msg.error != null -> Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.dangerSoft).padding(10.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Rounded.Warning, null, Modifier.size(15.dp), tint = C.roseText)
            Small(msg.error, Modifier.weight(1f), C.roseText)
            if (onRetry != null) T("Retry", Type.small.copy(fontWeight = FontWeight.Bold), Modifier.clickable(onClick = onRetry), C.roseText)
        }
        else -> Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp, 20.dp, 20.dp, 20.dp)).background(C.glass(0.97f))
                .border(1.dp, C.border, RoundedCornerShape(6.dp, 20.dp, 20.dp, 20.dp)).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (msg.pending) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CircularProgressIndicator(Modifier.size(16.dp), color = C.primary, strokeWidth = 2.dp)
                T("Thinking…", Type.small.copy(fontSize = 13.sp))
            } else {
                MarkdownText(msg.content)
                msg.notices.forEach { n ->
                    T(n, Type.small.copy(fontSize = 11.5.sp), Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(C.warningSoft).padding(8.dp), C.amberText)
                }
                Sources(msg.sources)
            }
        }
    }
}

/**
 * JNN Study Assistant card. Calls the same backend endpoint as the web app
 * (JSON mode); the backend decides which sources may be used and holds the AI key.
 */
@Composable
private fun StudyAssistant(modifier: Modifier) {
    var conversationId by rememberSaveable { mutableStateOf<String?>(null) }
    val messages = remember { mutableStateListOf<AssistantMsg>() }
    var input by rememberSaveable { mutableStateOf("") }
    var webSearch by rememberSaveable { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size) { if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex) }

    fun send(text: String) {
        val question = text.trim()
        if (question.isEmpty() || busy) return
        input = ""
        val id = "p-${System.currentTimeMillis()}"
        messages.removeAll { it.error != null }
        messages += AssistantMsg("u-$id", "user", question)
        messages += AssistantMsg(id, "assistant", pending = true)
        busy = true
        scope.launch {
            try {
                val res = Api.askStudyAssistant(jsonOf(
                    "conversationId" to (conversationId ?: com.vexon.campus.core.Omit),
                    "message" to question, "useStudyMaterials" to true, "useWebSearch" to webSearch,
                ))
                conversationId = res["conversationId"].str
                val m = res["message"]
                val i = messages.indexOfFirst { it.id == id }
                val answer = AssistantMsg(m.id ?: id, "assistant", m["content"].str, notices = m["notices"].strings, sources = m["sources"].list)
                if (i >= 0) messages[i] = answer else messages += answer
            } catch (e: Exception) {
                if ((e as? ApiException)?.status == 404) conversationId = null
                messages.removeAll { it.id == id || it.id == "u-$id" }
                messages += AssistantMsg("e-$id", "assistant", error = errMsg(e, "The Study Assistant is unavailable right now."), retry = question)
            } finally {
                busy = false
            }
        }
    }

    fun clear() {
        val id = conversationId
        messages.clear()
        conversationId = null
        if (id != null) scope.launch { runCatching { Api.deleteAssistantConversation(id) } }
    }

    Column(modifier.clip(RoundedCornerShape(28.dp)).background(C.card).border(1.dp, C.border, RoundedCornerShape(28.dp))) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(40.dp).clip(RoundedCornerShape(14.dp)).background(Brush.linearGradient(listOf(Color(0xFF4396EF), Color(0xFFD946EF)))), contentAlignment = Alignment.Center) {
                Text("🤖", fontSize = 18.sp)
            }
            Column(Modifier.weight(1f)) {
                T("JNN Study Assistant", Type.h3.copy(fontWeight = FontWeight.ExtraBold, fontSize = 15.sp))
                T("Ask questions, explore study resources, and learn with AI.", Type.small.copy(fontSize = 11.5.sp), maxLines = 2)
            }
            Row(
                Modifier.clip(CircleShape).background(if (webSearch) C.primary else Color.Transparent).border(1.dp, if (webSearch) C.primary else C.border, CircleShape)
                    .clickable { webSearch = !webSearch }.padding(horizontal = 9.dp, vertical = 5.dp)
                    .semantics { contentDescription = "Web research ${if (webSearch) "on" else "off"}" },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(Icons.Rounded.Language, null, Modifier.size(12.dp), tint = if (webSearch) Color.White else C.soft)
                Text("Web", fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 11.sp, color = if (webSearch) Color.White else C.soft)
            }
            Icon(
                Icons.Rounded.Delete, "Clear conversation",
                Modifier.alpha(if (messages.isNotEmpty()) 1f else 0.35f).clickable(enabled = messages.isNotEmpty()) { clear() }.padding(4.dp).size(18.dp),
                tint = C.soft,
            )
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(C.border))
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (messages.isEmpty()) item {
                Column(Modifier.padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    T("👋 Hi! I'm JNN Study Assistant.", Type.h3.copy(fontWeight = FontWeight.ExtraBold))
                    T("Ask me to:", Type.small.copy(fontSize = 11.5.sp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SUGGESTIONS.forEach { s ->
                            Box(Modifier.clip(CircleShape).background(C.glass(0.97f)).border(1.dp, C.border, CircleShape).clickable { input = "$s: " }.padding(horizontal = 12.dp, vertical = 7.dp)) {
                                T("• $s", Type.small, color = C.ink)
                            }
                        }
                    }
                }
            }
            items(messages, key = { it.id }) { m -> Bubble(m, if (m.retry != null && !busy) ({ send(m.retry) }) else null) }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(C.border))
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Input(input, { input = it }, Modifier.weight(1f).heightIn(max = 140.dp), placeholder = "Ask JNN Study Assistant...", multiline = true, minLines = 1, maxLength = 4000)
            val disabled = busy || input.isBlank()
            Box(
                Modifier.padding(bottom = 4.dp).size(44.dp).alpha(if (disabled) 0.5f else 1f).clip(RoundedCornerShape(16.dp)).background(Brush.linearGradient(Grad.primary))
                    .clickable(enabled = !disabled) { send(input) }.semantics { contentDescription = "Send" },
                contentAlignment = Alignment.Center,
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                else Icon(Icons.AutoMirrored.Rounded.Send, null, Modifier.size(18.dp), tint = Color.White)
            }
        }
    }
}

