package com.vexon.campus.screens

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.Category
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.PushPin
import androidx.compose.material.icons.rounded.ThumbUp
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.vexon.campus.core.Api
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.Omit
import com.vexon.campus.core.QueryClient
import com.vexon.campus.core.SocketEvent
import com.vexon.campus.core.SocketRoom
import com.vexon.campus.core.bool
import com.vexon.campus.core.dbl
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
import com.vexon.campus.ui.Avatar
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.Body
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.DialogButton
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.Grad
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.H3
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Opt
import com.vexon.campus.ui.ProgressBar
import com.vexon.campus.ui.RemoteImage
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
import kotlinx.serialization.json.JsonElement

/* ── Announcements ──────────────────────────────────────────────── */

@Composable
fun AnnouncementsScreen() {
    val q = Api.announcements(mapOf("limit" to 40))
    ListScreen(
        q, { it["items"].list },
        header = { Header("Announcements", "Only what’s addressed to you.", back = true) },
        empty = { EmptyState(Icons.Rounded.Campaign, "No announcements yet") },
    ) { a ->
        Card(Wide, gap = 8.dp) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (a["isPinned"].bool) Icon(Icons.Rounded.PushPin, null, Modifier.size(14.dp), tint = C.primary)
                H3(a["title"].str, Modifier.weight(1f))
                PriorityBadge(a["priority"].str)
            }
            Body(a["content"].str)
            a["deadline"].text?.let { Small("Deadline: ${Fmt.dateTime(it)}", color = C.danger) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Avatar(a["author"], size = 26.dp)
                Small("${a["author"]["name"].str ?: ""} · ${Fmt.timeAgo(a["createdAt"])}")
            }
        }
    }
}

@Composable
fun PriorityBadge(priority: String?) {
    if (priority != null && priority != "normal") Badge(priority, if (priority == "urgent") Tone.Danger else Tone.Warning)
}

/* ── Clubs ──────────────────────────────────────────────────────── */

@Composable
fun ClubsScreen() {
    var search by rememberSaveable { mutableStateOf("") }
    val q = Api.clubs(mapOf("q" to search.ifEmpty { null }, "limit" to 40))
    ListScreen(
        q, { it["items"].list },
        header = {
            Header("Clubs", "Find your people.", back = true)
            Input(search, { search = it }, placeholder = "Search clubs")
        },
        empty = { EmptyState(Icons.Rounded.Category, "No clubs found") },
    ) { c ->
        RowCard(Wide, onClick = { Nav.push("/clubs/${c["slug"].str}") }) {
            Avatar(name = c["name"].str, uri = c["logo"].str, size = 50.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Strong(c["name"].str, maxLines = 1)
                Small(c["tagline"].text ?: Fmt.titleCase(c["category"].str), maxLines = 1)
                Small("${c["memberCount"].int ?: 0} members")
            }
            when {
                c["isMember"].bool -> Badge("Member", Tone.Success)
                c["hasRequested"].bool -> Badge("Requested", Tone.Warning)
            }
        }
    }
}

@Composable
fun ClubDetailScreen(slug: String) {
    val me = me()
    val q = Api.club(slug)
    val join = rememberMutation()
    val cancel = rememberMutation()
    val leave = rememberMutation()
    DetailScreen(q, "Club") { c ->
        val id = c.id.orEmpty()
        Header(c["name"].str, Fmt.titleCase(c["category"].str), back = true)
        Card(Wide, horizontalAlignment = Alignment.CenterHorizontally, gap = 8.dp) {
            Avatar(name = c["name"].str, uri = c["logo"].str, size = 72.dp)
            c["tagline"].text?.let { Strong(it, align = TextAlign.Center) }
            Small("${c["memberCount"].int ?: 0} members")
            if (me.role in STUDENT_ROLES) {
                when {
                    c["isMember"].bool -> Button("Leave club", {
                        Dialogs.alert("Leave this club?", null, listOf(
                            DialogButton("Stay", cancel = true),
                            DialogButton("Leave", destructive = true) { leave.launch { Api.leaveClub(id) } },
                        ))
                    }, variant = Variant.Danger, small = true, loading = leave.isLoading)
                    c["hasRequested"].bool -> Button("Cancel join request", {
                        cancel.launch { Api.cancelJoin(id); Dialogs.alert("Request withdrawn") }
                    }, variant = Variant.Soft, small = true, loading = cancel.isLoading)
                    else -> Button("Request to join", {
                        join.launch { Api.joinClub(id, ""); Dialogs.alert("Request sent — club admins will review it") }
                    }, small = true, loading = join.isLoading)
                }
            }
        }
        Card(Wide) { Body(c["description"].str) }

        val events = c["upcomingEvents"].list
        if (events.isNotEmpty()) {
            SectionTitle("Upcoming events")
            events.forEach { e ->
                Card(Wide, onClick = { Nav.push("/events/${e.id}") }, gap = 2.dp) {
                    Strong(e["title"].str)
                    Small("${Fmt.dateTime(e["startDate"])} · ${e["venue"].str ?: ""}")
                }
            }
        }
        val anns = c["announcements"].list
        if (anns.isNotEmpty()) {
            SectionTitle("Club announcements")
            anns.forEach { a ->
                Card(Wide, gap = 4.dp) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Strong(a["title"].str, Modifier.weight(1f))
                        if (a["priority"].str != "normal") Badge(a["priority"].str, Tone.Warning)
                    }
                    Small(a["content"].str, maxLines = 3)
                }
            }
        }
        SectionTitle("Admins")
        Card(Wide, gap = 10.dp) {
            c["admins"].list.forEach { m ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Avatar(m, size = 34.dp)
                    Strong(m["name"].str, Modifier.weight(1f))
                    Small(m["department"].str, color = C.muted)
                }
            }
        }
    }
}

/* ── Events ─────────────────────────────────────────────────────── */

/** Poster thumbnail, or a gradient month/day tile when there is none. */
@Composable
fun EventThumb(e: JsonElement, size: Int = 54, radius: Int = 18) {
    val poster = e["poster"].text
    if (poster != null) {
        RemoteImage(poster, Modifier.size(size.dp).clip(RoundedCornerShape(radius.dp)))
    } else {
        val start = Fmt.parse(e["startDate"])
        Column(
            Modifier.size(size.dp).clip(RoundedCornerShape(radius.dp)).background(Brush.linearGradient(Grad.sky)),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
        ) {
            T(Fmt.format(start, "MMM").uppercase(), Type.small, color = Color.White, size = if (size > 48) 10 else 9, weight = FontWeight.Bold)
            T(Fmt.format(start, "dd"), if (size > 48) Type.h2 else Type.h3, color = Color.White)
        }
    }
}

@Composable
fun EventsScreen() {
    var whenTab by rememberSaveable { mutableStateOf("upcoming") }
    val params = if (whenTab == "mine") mapOf("mine" to "true", "when" to "all", "limit" to 30) else mapOf("when" to whenTab, "limit" to 30)
    val q = Api.events(params)
    ListScreen(
        q, { it["items"].list },
        header = {
            Header("Events", "Workshops, fests, talks and more.", back = true)
            Segmented(listOf(Opt("upcoming", "Upcoming"), Opt("mine", "Registered"), Opt("past", "Past")), whenTab, { whenTab = it })
        },
        empty = { EmptyState(Icons.Rounded.CalendarMonth, "No events here") },
    ) { e ->
        RowCard(Wide, onClick = { Nav.push("/events/${e.id}") }) {
            EventThumb(e)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Strong(e["title"].str, maxLines = 1)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Rounded.Place, null, Modifier.size(12.dp), tint = C.soft)
                    Small("${e["venue"].str ?: ""} · ${Fmt.time(e["startDate"])}", Modifier.weight(1f), maxLines = 1)
                }
                Small(
                    (e["club"]["name"].text ?: e["category"].str ?: "") + (if ((e["capacity"].int ?: 0) > 0) " · ${e["spotsLeft"].int ?: 0} spots left" else ""),
                    color = C.muted,
                )
            }
            e["myStatus"].text?.let { StatusBadge(it) }
        }
    }
}

@Composable
fun EventDetailScreen(id: String) {
    val me = me()
    val q = Api.event(id)
    val act = rememberMutation()
    DetailScreen(q, "Event") { e ->
        val capacity = e["capacity"].int ?: 0
        val full = capacity > 0 && e["spotsLeft"].int == 0
        val myStatus = e["myStatus"].text
        Header(e["title"].str, Fmt.titleCase(e["category"].str), back = true)
        e["poster"].text?.let { RemoteImage(it, Wide.height(190.dp).clip(RoundedCornerShape(28.dp))) }
        Card(Wide, gap = 10.dp) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Rounded.CalendarMonth, null, Modifier.size(16.dp), tint = C.primary)
                Small("${Fmt.dateTime(e["startDate"])} → ${Fmt.dateTime(e["endDate"])}", Modifier.weight(1f))
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Rounded.Place, null, Modifier.size(16.dp), tint = C.primary)
                Small(e["venue"].str)
            }
            e["club"].takeIf { it != null }?.let { club ->
                Small("Hosted by ${club["name"].str}", Modifier.clickable { Nav.push("/clubs/${club["slug"].str}") }, C.primary)
            }
            if (capacity > 0) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(Icons.Rounded.Group, null, Modifier.size(14.dp), tint = C.soft)
                        val wait = e["waitlistCount"].int ?: 0
                        Small("${e["registeredCount"].int ?: 0}/$capacity registered${if (wait > 0) " · $wait waitlisted" else ""}")
                    }
                    ProgressBar((e["registeredCount"].dbl ?: 0.0) / capacity * 100, threshold = 0.0)
                }
            }
            Body(e["description"].str)
        }
        if (myStatus != null) StatusBadge(myStatus, "You are $myStatus")
        if (me.role in STUDENT_ROLES) {
            if (e["isPast"].bool) Small("This event has ended.", Wide, align = TextAlign.Center)
            else Button(
                if (myStatus != null) "Cancel registration" else if (full) "Join waitlist" else "Register",
                {
                    act.launch {
                        if (myStatus != null) {
                            Api.cancelRegistration(id)
                            Dialogs.alert("Registration cancelled")
                        } else {
                            val res = Api.registerEvent(id)
                            Dialogs.alert(if (res["status"].str == "waitlisted") "You’re on the waitlist" else "You’re registered! 🎉")
                        }
                    }
                },
                Wide, variant = if (myStatus != null) Variant.Danger else Variant.Primary, loading = act.isLoading,
            )
        }
    }
}

/* ── Discussions ────────────────────────────────────────────────── */

@Composable
fun DiscussionsScreen() {
    var search by rememberSaveable { mutableStateOf("") }
    val q = Api.discussions(mapOf("q" to search.ifEmpty { null }, "limit" to 30))
    ListScreen(
        q, { it["items"].list },
        header = {
            Header("Discussions", "Ask, answer and share.", back = true, right = { Button("New", { Nav.push("/discussions/new") }, icon = Icons.Rounded.Add, small = true) })
            Input(search, { search = it }, placeholder = "Search discussions")
        },
        empty = { EmptyState(Icons.Rounded.Forum, "No discussions yet") },
    ) { d ->
        Card(Wide, onClick = { Nav.push("/discussions/${d.id}") }, gap = 6.dp) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Badge(d["category"].str, Tone.Neutral)
                if (d["isPinned"].bool) Badge("Pinned")
            }
            Strong(d["title"].str)
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.ThumbUp, null, Modifier.size(13.dp), tint = C.soft)
                    Small("${d["upvoteCount"].int ?: 0}")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.ChatBubbleOutline, null, Modifier.size(13.dp), tint = C.soft)
                    Small("${d["replyCount"].int ?: 0}")
                }
                Small("${d["author"]["name"].str ?: ""} · ${Fmt.timeAgo(d["lastActivityAt"] ?: d["createdAt"])}", color = C.muted, maxLines = 1)
            }
        }
    }
}

@Composable
fun DiscussionDetailScreen(id: String) {
    val q = Api.discussion(id)
    val reply = rememberMutation()
    val upvote = rememberMutation()
    var text by rememberSaveable { mutableStateOf("") }

    // Live replies from web or other phones (the server checks access on join).
    SocketRoom("discussion:join", "discussion:leave", id)
    SocketEvent("discussion:reply") { args -> if (args.firstOrNull()["discussionId"].str == id) QueryClient.invalidate("Discussion") }

    DetailScreen(q, "Discussion") { d ->
        Header("Discussion", back = true)
        Card(Wide, gap = 10.dp) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Badge(d["category"].str, Tone.Neutral)
                if (d["isLocked"].bool) Badge("Locked", Tone.Warning)
            }
            H2(d["title"].str)
            Body(d["body"].str)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Avatar(d["author"], size = 28.dp)
                Small("${d["author"]["name"].str ?: ""} · ${Fmt.timeAgo(d["createdAt"])}", Modifier.weight(1f))
                val up = d["hasUpvoted"].bool
                Row(
                    Modifier.clip(CircleShape).background(if (up) C.primary else C.primarySoft).clickable { upvote.launch { Api.upvoteDiscussion(id) } }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(Icons.Rounded.ThumbUp, "Upvote", Modifier.size(14.dp), tint = if (up) Color.White else C.primary)
                    Small("${d["upvoteCount"].int ?: 0}", color = if (up) Color.White else C.primary)
                }
            }
        }
        val replies = d["replies"].list
        SectionTitle("${replies.size} replies")
        replies.forEach { r ->
            Card(Wide, gap = 6.dp) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Avatar(r["author"], size = 26.dp)
                    Strong(r["author"]["name"].str, Modifier.weight(1f))
                    Small(Fmt.timeAgo(r["createdAt"]), color = C.muted)
                }
                Body(r["body"].str)
            }
        }
        if (d["isLocked"].bool) {
            RowCard(Wide, gap = 8.dp) {
                Icon(Icons.Rounded.Lock, null, Modifier.size(16.dp), tint = C.soft)
                Small("This discussion is locked.")
            }
        } else {
            Card(Wide, gap = 10.dp) {
                Input(text, { text = it }, placeholder = "Write a reply…", multiline = true, maxLength = 3000)
                Button("Reply", {
                    val body = text.trim()
                    if (body.isNotEmpty()) reply.launch(onError = { Dialogs.alert("Reply not posted", errMsg(it)) }) {
                        Api.addReply(id, body)
                        text = ""
                    }
                }, Wide, icon = Icons.AutoMirrored.Rounded.Send, loading = reply.isLoading, enabled = text.isNotBlank())
            }
        }
    }
}

private val DISCUSSION_CATEGORIES = listOf("general", "academics", "placements", "events", "clubs", "help", "other")

@Composable
fun NewDiscussionScreen() {
    var title by rememberSaveable { mutableStateOf("") }
    var body by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("general") }
    val create = rememberMutation()
    Screen {
        Header("Start a discussion", back = true)
        Card(Wide, gap = 14.dp) {
            Input(title, { title = it }, label = "Title", maxLength = 160)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Label("Category")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    DISCUSSION_CATEGORIES.forEach { c -> Chip(Fmt.titleCase(c), category == c) { category = c } }
                }
            }
            Input(body, { body = it }, label = "Details", multiline = true, maxLength = 5000)
            Button("Post", {
                when {
                    title.trim().length < 5 -> Dialogs.alert("Title must be at least 5 characters")
                    body.trim().length < 10 -> Dialogs.alert("Please add a bit more detail (10+ characters)")
                    else -> create.launch(onError = { Dialogs.alert("Could not post", errMsg(it)) }) {
                        val d = Api.createDiscussion(jsonOf("title" to title.trim(), "body" to body.trim(), "category" to category))
                        Nav.replace("/discussions/${d.id}")
                    }
                }
            }, Wide, loading = create.isLoading)
        }
    }
}

