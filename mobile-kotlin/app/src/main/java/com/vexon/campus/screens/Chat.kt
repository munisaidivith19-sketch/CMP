package com.vexon.campus.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Reply
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vexon.campus.core.Api
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.Omit
import com.vexon.campus.core.Realtime
import com.vexon.campus.core.SocketEvent
import com.vexon.campus.core.SocketRoom
import com.vexon.campus.core.bool
import com.vexon.campus.core.describeConversation
import com.vexon.campus.core.errMsg
import com.vexon.campus.core.get
import com.vexon.campus.core.id
import com.vexon.campus.core.int
import com.vexon.campus.core.jsonOf
import com.vexon.campus.core.list
import com.vexon.campus.core.rememberMutation
import com.vexon.campus.core.rememberQuery
import com.vexon.campus.core.sameId
import com.vexon.campus.core.str
import com.vexon.campus.core.text
import com.vexon.campus.core.with
import com.vexon.campus.nav.Nav
import com.vexon.campus.ui.Avatar
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.DialogButton
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.GROUP_CREATORS
import com.vexon.campus.ui.Grad
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.IconTile
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.ROLE_LABELS
import com.vexon.campus.ui.STUDENT_ROLES
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.T
import com.vexon.campus.ui.Type
import com.vexon.campus.ui.Variant
import com.vexon.campus.ui.YEAR_LABELS
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import java.time.LocalDate

/* ── New chat / group ───────────────────────────────────────────── */

private val GROUP_SCOPE = mapOf(
    "admin" to "Add anyone on campus.",
    "hod" to "Sent to the principal for approval, with your reason.",
    "faculty" to "Add students of your sections. An admin approves the group before it goes live.",
)
/** Who a private chat can reach — the server enforces exactly this. */
private val PRIVATE_SCOPE = mapOf(
    "student" to "Your classmates, and faculty, HODs, principal, chairman, dean and AO.",
    "club_admin" to "Your classmates, and faculty, HODs, principal, chairman, dean and AO.",
    "faculty" to "Students of your classes, and campus staff.",
    "hod" to "Your department’s students, classes you handle, and campus staff.",
)
// CUSTOM: own-department students from several classes; ACADEMICS: one class;
// FACULTY: faculty from anywhere on campus. The server enforces the same rules.
private val GROUP_CATEGORIES = listOf("custom" to "CUSTOM", "academic" to "ACADEMICS", "faculty" to "FACULTY")
private val CHAT_STAFF = setOf("faculty", "hod")

@Composable
fun NewChatScreen() {
    val me = me()
    val isHod = me.role == "hod"
    val canGroup = me.role in GROUP_CREATORS
    var group by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("custom") }
    var year by rememberSaveable { mutableStateOf("") }
    var section by rememberSaveable { mutableStateOf("") }
    val picked = remember { mutableStateListOf<JsonElement>() }
    var q by rememberSaveable { mutableStateOf("") }
    val create = rememberMutation()

    // 'picker' is scoped by the server's chat rules: a student only ever finds
    // their classmates and the academic staff.
    val hodBuilder = group && isHod
    val params = buildMap<String, Any?> {
        put("q", q.ifEmpty { null }); put("limit", 30); put("context", "picker")
        // Faculty group members come from their own department (admins: anyone).
        if (group && me.role == "faculty") me["department"].text?.let { put("department", it) }
        // HOD builder: Custom searches students, Faculty searches faculty.
        if (hodBuilder && category == "custom") put("role", "student")
    }
    val users = Api.users(params)
    val filters = Api.peopleFilters(skip = !hodBuilder)
    val cls = Api.groupClass(mapOf("year" to year, "section" to section), skip = !hodBuilder || category == "faculty" || year.isEmpty() || section.isEmpty())

    val classList = cls.data["students"].list
    val all = users.data["items"].list.filter { !sameId(it, me) }
    val people = when {
        !hodBuilder -> all
        category == "faculty" -> all.filter { it.role in CHAT_STAFF }
        category == "academic" -> classList
        // Custom: the chosen class's students, or a student search across the department.
        q.isNotBlank() -> all.filter { it.role in STUDENT_ROLES }
        else -> classList
    }

    fun isPicked(u: JsonElement) = picked.any { sameId(it, u) }
    fun toggle(u: JsonElement) { if (isPicked(u)) picked.removeAll { sameId(it, u) } else picked += u }
    val allOfClass = classList.isNotEmpty() && classList.all(::isPicked)
    fun toggleClass() {
        if (allOfClass) picked.removeAll { u -> classList.any { sameId(it, u) } }
        else picked += classList.filter { s -> picked.none { sameId(it, s) } }
    }
    fun pickClass(y: String, s: String) {
        year = y; section = s
        // An academic group is one class: another class replaces the students.
        if (category == "academic") picked.clear()
    }
    fun pickCategory(c: String) {
        category = c; q = ""
        when (c) {
            "faculty" -> picked.removeAll { it.role !in CHAT_STAFF }
            "custom" -> picked.removeAll { it.role !in STUDENT_ROLES }
            else -> picked.clear()
        }
    }

    fun start(u: JsonElement) = create.launch(onError = { Dialogs.alert("Could not start chat", errMsg(it)) }) {
        val conv = Api.createConversation(jsonOf("type" to "private", "participantIds" to listOf(u.id)))
        Nav.replace("/chat/${conv.id}")
    }

    fun createGroup() = create.launch(onError = { Dialogs.alert("Could not create group", errMsg(it)) }) {
        val conv = Api.createConversation(jsonOf(
            "type" to "group", "name" to name.trim(), "participantIds" to picked.map { it.id },
            "category" to (if (isHod) category else Omit), "reason" to (if (isHod) reason.trim() else Omit),
        ))
        if (conv["pending"].bool) {
            Dialogs.alert("Request sent", "Your group goes live as soon as ${if (isHod) "the principal" else "an admin"} approves it. You’ll get a notification.")
            Nav.back()
        } else Nav.replace("/chat/${conv.id}")
    }

    val ready = picked.isNotEmpty() && name.trim().length >= 2 && (!isHod || reason.trim().length >= 5)

    Screen(scroll = false) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Header(
                if (group) "New group" else "New message",
                if (group) GROUP_SCOPE[me.role] else PRIVATE_SCOPE[me.role] ?: "Start a private chat with anyone on campus.",
                back = true,
            )
            if (canGroup) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("Private", !group) { group = false }
                Chip("Group", group) { group = true }
            }
            if (group) {
                Input(name, { name = it }, placeholder = "Group name", maxLength = 100)
                if (hodBuilder) {
                    Label("Group type")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        GROUP_CATEGORIES.forEach { (v, l) -> Chip(l, category == v) { pickCategory(v) } }
                    }
                    Input(reason, { reason = it }, placeholder = "Reason for the principal", maxLength = 500, multiline = true, minLines = 2)
                    if (category != "faculty") {
                        val years = filters.data["years"].list.mapNotNull { it.int }.ifEmpty { listOf(1, 2, 3, 4) }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            years.forEach { y -> Chip(YEAR_LABELS[y] ?: "Year $y", year == "$y") { pickClass("$y", section) } }
                        }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            filters.data["sections"].list.mapNotNull { it.str }.forEach { s -> Chip("Sec $s", section == s) { pickClass(year, s) } }
                        }
                        if (classList.isNotEmpty()) Button(
                            if (allOfClass) "Unselect this section" else "Select all ${classList.size} students", ::toggleClass,
                            variant = Variant.Soft, small = true, icon = Icons.Rounded.Check,
                        )
                    }
                }
                if (picked.isNotEmpty()) Small(
                    "${picked.size} selected member${if (picked.size == 1) "" else "s"}: ${picked.joinToString(", ") { it["name"].str.orEmpty().split(" ").first() }}",
                    maxLines = 2,
                )
                Button(
                    if (isHod) "Send request to Principal" else if (me.role == "faculty") "Request group" else "Create group", ::createGroup, Wide,
                    icon = if (isHod) Icons.AutoMirrored.Rounded.Send else Icons.Rounded.Groups, loading = create.isLoading, enabled = ready,
                )
            }
            if (!(hodBuilder && category == "academic")) {
                Input(
                    q, { q = it },
                    placeholder = if (hodBuilder) (if (category == "faculty") "Search faculty on campus" else "Search students of your department") else "Search by name, department or skill",
                )
            }
        }
        if (users.isFetching && people.isEmpty()) Loading()
        else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 30.dp)) {
            if (people.isEmpty()) item { EmptyState(title = "No people found") }
            items(people, key = { it.id ?: it.hashCode() }) { u ->
                val on = isPicked(u)
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(if (on) C.primarySoft else Color.Transparent)
                        .clickable(enabled = !create.isLoading) { if (group) toggle(u) else start(u) }.padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Avatar(u, size = 44.dp)
                    Column(Modifier.weight(1f)) {
                        Strong(u["name"].str)
                        Small((ROLE_LABELS[u.role] ?: "") + (u["department"].text?.let { " · $it" } ?: "") + (u["section"].text?.let { " · Sec $it" } ?: ""))
                    }
                    if (group && on) Icon(Icons.Rounded.Check, null, Modifier.size(20.dp), tint = C.primary)
                }
            }
        }
    }
}

/* ── Conversation thread ────────────────────────────────────────── */

private fun dayLabel(v: JsonElement?): String {
    val d = Fmt.parse(v)?.toLocalDate() ?: return ""
    val today = LocalDate.now()
    return when (d) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> Fmt.format(d, "EEE, dd MMM yyyy")
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ThreadScreen(id: String) {
    val me = me()
    val convQ = Api.conversation(id)
    // Always fresh on open (RTK `refetchOnMountOrArgChange`).
    val first = rememberQuery("thread:$id", keep = false) { Api.messages(id, mapOf("limit" to 40)) }
    val messages = remember { mutableStateListOf<JsonElement>() }
    var hasMore by remember { mutableStateOf(false) }
    var loadingOlder by remember { mutableStateOf(false) }
    var text by rememberSaveable { mutableStateOf("") }
    var replyTo by remember { mutableStateOf<JsonElement?>(null) }
    val typingIds = remember { mutableStateListOf<String>() }
    var online by remember { mutableStateOf<Boolean?>(null) }
    var typingSent by remember { mutableStateOf(false) }
    var typingJob by remember { mutableStateOf<Job?>(null) }
    val send = rememberMutation()
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val conv = convQ.data

    SocketRoom("chat:join", "chat:leave", id)

    fun markRead() = scope.launch { Realtime.emitWithAck("chat:read", jsonOf("conversationId" to id)) }

    LaunchedEffect(first.data) {
        first.data?.let { f ->
            messages.clear()
            messages += f["messages"].list
            hasMore = (f["pagination"]["total"].int ?: 0) > messages.size
            markRead()
        }
    }

    SocketEvent("chat:message") { a ->
        val p = a.firstOrNull()
        if (p["conversationId"].str != id) return@SocketEvent
        val message = p["message"] ?: return@SocketEvent
        if (messages.none { it.id == message.id }) messages += message
        typingIds.removeAll { sameId(message["sender"], it) }
        if (!sameId(message["sender"], me)) markRead()
    }
    SocketEvent("chat:messageDeleted") { a ->
        val p = a.firstOrNull()
        if (p["conversationId"].str != id) return@SocketEvent
        val mid = p["messageId"].str
        val i = messages.indexOfFirst { it.id == mid }
        if (i >= 0) messages[i] = messages[i].with("body" to "This message was deleted", "deletedAt" to java.time.Instant.now().toString(), "replyTo" to null)
    }
    SocketEvent("chat:read") { a ->
        val p = a.firstOrNull()
        val userId = p["userId"].str
        if (p["conversationId"].str != id || userId == null || userId == me.id) return@SocketEvent
        messages.indices.forEach { i ->
            val m = messages[i]
            if (sameId(m["sender"], me) && m["readBy"].list.none { sameId(it, userId) }) {
                messages[i] = m.with("readBy" to (m["readBy"].list + JsonPrimitive(userId)))
            }
        }
    }
    SocketEvent("chat:typing") { a ->
        val p = a.firstOrNull()
        if (p["conversationId"].str != id) return@SocketEvent
        val userId = p["userId"].str ?: return@SocketEvent
        if (p["isTyping"].bool) { if (userId !in typingIds) typingIds += userId } else typingIds.remove(userId)
    }
    SocketEvent("presence:update") { a ->
        val p = a.firstOrNull()
        val d = describeConversation(conv, me)
        if (d.other != null && sameId(d.other, p["userId"].str)) online = p["online"].bool
    }

    fun stopTyping() {
        typingJob?.cancel()
        if (typingSent) Realtime.emit("chat:typing", jsonOf("conversationId" to id, "isTyping" to false))
        typingSent = false
    }
    DisposableEffect(id) { onDispose { stopTyping() } }

    fun onType(v: String) {
        text = v
        if (!typingSent && v.isNotBlank()) {
            Realtime.emit("chat:typing", jsonOf("conversationId" to id, "isTyping" to true))
            typingSent = true
        }
        typingJob?.cancel()
        typingJob = scope.launch { delay(2500); stopTyping() }
    }

    fun submit() {
        val body = text.trim()
        if (body.isEmpty()) return
        stopTyping()
        send.launch(onError = { Dialogs.alert("Message not sent", errMsg(it)) }) {
            val msg = Api.sendMessage(id, jsonOf("body" to body, "replyTo" to (replyTo?.id ?: Omit)))
            if (messages.none { it.id == msg.id }) messages += msg
            text = ""
            replyTo = null
        }
    }

    fun older() {
        val oldest = messages.firstOrNull() ?: return
        if (loadingOlder) return
        loadingOlder = true
        scope.launch {
            runCatching { Api.messages(id, mapOf("before" to oldest["createdAt"].str, "limit" to 40)) }.getOrNull()?.let { res ->
                val older = res["messages"].list.filter { m -> messages.none { it.id == m.id } }
                messages.addAll(0, older)
                hasMore = (res["pagination"]["total"].int ?: 0) > res["messages"].list.size
            }
            loadingOlder = false
        }
    }

    fun onLongPress(m: JsonElement) {
        if (m["deletedAt"] != null) return
        val mine = sameId(m["sender"], me)
        Dialogs.alert("Message", m["body"].str.orEmpty().take(80), buildList {
            add(DialogButton("Reply") { replyTo = m })
            if (mine) add(DialogButton("Delete", destructive = true) {
                scope.launch { runCatching { Api.deleteMessage(id, m.id.orEmpty()) }.onFailure { Dialogs.alert("Could not delete", errMsg(it)) } }
            })
            add(DialogButton("Cancel", cancel = true))
        })
    }

    if (convQ.error != null && conv == null) {
        Screen {
            Header("Chat", back = true)
            ErrorState(convQ.error) { convQ.refetch() }
        }
        return
    }

    val d = describeConversation(conv, me)
    val participants = conv["participants"].list
    val others = participants.filter { !sameId(it, me) }
    val isOnline = online ?: d.other["online"].bool
    val typingNames = typingIds.mapNotNull { u -> participants.firstOrNull { sameId(it, u) }?.get("name").str?.split(" ")?.first() }
    val status = when {
        typingNames.isNotEmpty() -> "${typingNames.joinToString(", ")} typing…"
        d.group -> "${participants.size} members"
        isOnline -> "Online"
        d.other["lastSeenAt"] != null -> "Last seen ${Fmt.timeAgo(d.other["lastSeenAt"])}"
        else -> ""
    }
    val reversed = messages.asReversed()

    // Inverted list: reaching the far end (oldest) loads more history.
    val nearEnd by remember { derivedStateOf { (listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= listState.layoutInfo.totalItemsCount - 3 } }
    LaunchedEffect(nearEnd, hasMore) { if (nearEnd && hasMore && messages.isNotEmpty()) older() }

    Screen(scroll = false) {
        Box(Modifier.fillMaxWidth().padding(12.dp)) {
            Header(d.title ?: "Chat", status, back = true, right = {
                if (d.group) IconTile(Icons.Rounded.Groups, Grad.hero, 40.dp) else Avatar(d.other, size = 40.dp, online = isOnline)
            })
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0x1A1D6FEB)))

        Box(Modifier.weight(1f)) {
            if (first.isLoading) Loading()
            else LazyColumn(Modifier.fillMaxSize(), state = listState, reverseLayout = true, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (reversed.isEmpty()) item { Small("Say hello 👋", Wide.padding(30.dp), align = TextAlign.Center) }
                itemsIndexed(reversed, key = { _, m -> m.id ?: m.hashCode() }) { index, m ->
                    val mine = sameId(m["sender"], me)
                    val prev = reversed.getOrNull(index + 1)
                    val newDay = prev == null || Fmt.parse(prev["createdAt"])?.toLocalDate() != Fmt.parse(m["createdAt"])?.toLocalDate()
                    val read = mine && others.isNotEmpty() && others.all { o -> m["readBy"].list.any { sameId(it, o) } }
                    val deleted = m["deletedAt"] != null
                    Column {
                        if (newDay) Small(dayLabel(m["createdAt"]), Wide.padding(vertical = 8.dp), C.muted, TextAlign.Center)
                        BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
                            val bubbleMax = maxWidth * 0.82f
                            Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                                if (!mine && d.group && (prev == null || !sameId(prev["sender"], m["sender"]) || newDay)) {
                                    Small(m["sender"]["name"].str, Modifier.padding(start = 10.dp, bottom = 2.dp), C.primary)
                                }
                                Column(
                                    Modifier.widthIn(max = bubbleMax).alpha(if (deleted) 0.6f else 1f)
                                        .clip(RoundedCornerShape(22.dp, 22.dp, if (mine) 6.dp else 22.dp, if (mine) 22.dp else 6.dp))
                                        .background(if (mine) C.primary else Color.White)
                                        .combinedClickable(onClick = {}, onLongClick = { onLongPress(m) })
                                        .padding(horizontal = 14.dp, vertical = 9.dp),
                                ) {
                                    val reply = m["replyTo"]
                                    if (reply != null && !deleted) {
                                        Row(Modifier.padding(bottom = 4.dp).height(androidx.compose.foundation.layout.IntrinsicSize.Min)) {
                                            Box(Modifier.width(3.dp).fillMaxHeight().background(if (mine) Color(0xB3FFFFFF) else C.primary400))
                                            Column(Modifier.padding(start = 8.dp)) {
                                                T(reply["sender"]["name"].text ?: "Message", Type.small.copy(fontWeight = FontWeight.Bold), color = if (mine) Color.White else C.primary)
                                                Small(reply["body"].str, color = if (mine) Color(0xD9FFFFFF) else C.soft, maxLines = 2)
                                            }
                                        }
                                    }
                                    T(m["body"].str, Type.body.copy(fontStyle = if (deleted) FontStyle.Italic else FontStyle.Normal), color = if (mine) Color.White else C.ink)
                                    Row(Modifier.align(Alignment.End).padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        T(Fmt.time(m["createdAt"]), Type.small.copy(fontSize = 10.sp), color = if (mine) Color(0xBFFFFFFF) else C.muted)
                                        if (mine && !deleted) Icon(
                                            if (read) Icons.Rounded.DoneAll else Icons.Rounded.Check, if (read) "Read" else "Sent",
                                            Modifier.size(13.dp), tint = if (read) Color.White else Color(0xBFFFFFFF),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                if (loadingOlder) item { Loading() }
            }
        }

        Column(Modifier.fillMaxWidth().background(Color(0xB3FFFFFF)).navigationBarsPadding().padding(10.dp)) {
            replyTo?.let { r ->
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 8.dp).clip(RoundedCornerShape(14.dp)).background(C.primarySoft).padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.AutoMirrored.Rounded.Reply, null, Modifier.size(14.dp), tint = C.primary)
                    Small("Replying to ${if (sameId(r["sender"], me)) "yourself" else r["sender"]["name"].str}: ${r["body"].str}", Modifier.weight(1f), maxLines = 1)
                    Icon(Icons.Rounded.Close, "Cancel reply", Modifier.size(16.dp).clickable { replyTo = null }, tint = C.soft)
                }
            }
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Input(text, ::onType, Modifier.weight(1f).heightIn(max = 140.dp), placeholder = "Type a message…", multiline = true, minLines = 1, maxLength = 5000)
                val canSend = text.isNotBlank() && !send.isLoading
                Box(
                    Modifier.padding(bottom = 4.dp).size(44.dp).clip(CircleShape).background(if (text.isNotBlank()) C.primary else C.primary300)
                        .clickable(enabled = canSend) { submit() }.semantics { contentDescription = "Send" },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.AutoMirrored.Rounded.Send, null, Modifier.size(18.dp), tint = Color.White) }
            }
        }
    }
}

