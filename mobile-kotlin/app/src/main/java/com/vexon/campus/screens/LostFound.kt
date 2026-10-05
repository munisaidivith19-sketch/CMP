package com.vexon.campus.screens

import android.net.Uri
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.vexon.campus.core.Api
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.Omit
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
import com.vexon.campus.ui.Avatar
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.Body
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.DateTimeField
import com.vexon.campus.ui.DialogButton
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.Opt
import com.vexon.campus.ui.RemoteImage
import com.vexon.campus.ui.RowCard
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.SectionTitle
import com.vexon.campus.ui.Segmented
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.StatusBadge
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Variant
import com.vexon.campus.ui.nowMinute
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.ZonedDateTime

@Composable
private fun ItemIcon(type: String?, size: Int, iconSize: Int, radius: Int = 18, modifier: Modifier = Modifier) {
    val lost = type == "lost"
    Box(modifier.size(size.dp).clip(RoundedCornerShape(radius.dp)).background(if (lost) C.dangerSoft else C.infoSoft), contentAlignment = Alignment.Center) {
        Icon(Icons.Rounded.Inventory2, null, Modifier.size(iconSize.dp), tint = if (lost) C.danger else C.info)
    }
}

@Composable
fun LostFoundScreen() {
    var tab by rememberSaveable { mutableStateOf("all") }
    var search by rememberSaveable { mutableStateOf("") }
    val params = buildMap<String, Any?> {
        put("limit", 30)
        put("status", "open")
        put("search", search.ifEmpty { null })
        if (tab == "lost" || tab == "found") put("type", tab)
        if (tab == "mine") { put("mine", "true"); put("status", null) }
    }
    val q = Api.lostFound(params)
    ListScreen(
        q, { it["items"].list },
        header = {
            Header("Lost & found", "Matches are suggestions — staff verify ownership.", back = true, right = {
                Button("Report", { Nav.push("/lost-found/new") }, icon = Icons.Rounded.Add, small = true)
            })
            Segmented(
                listOf(
                    Opt("all", "All"),
                    Opt("lost", "Lost", q.data["summary"]["lostOpen"].int),
                    Opt("found", "Found", q.data["summary"]["foundOpen"].int),
                    Opt("mine", "Mine"),
                ), tab, { tab = it },
            )
            Input(search, { search = it }, placeholder = "Search items or places")
        },
        empty = { EmptyState(Icons.Rounded.Inventory2, "Nothing here", "Lost something? Report it and we’ll look for possible matches.") },
    ) { item ->
        val lost = item["type"].str == "lost"
        RowCard(Wide, onClick = { Nav.push("/lost-found/${item.id}") }, verticalAlignment = Alignment.Top) {
            if (item["photo"].text != null) RemoteImage(item["photo"].str, Modifier.size(72.dp).clip(RoundedCornerShape(18.dp)))
            else ItemIcon(item["type"].str, 72, 28)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Label(item["type"].str, color = if (lost) C.danger else C.info)
                    StatusBadge(item["status"].str)
                }
                Strong(item["itemName"].str, maxLines = 1)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Rounded.Place, null, Modifier.size(12.dp), tint = C.soft)
                    Small("${item["location"].str ?: ""} · ${Fmt.dateTime(item["dateTime"])}", Modifier.weight(1f), maxLines = 1)
                }
                Small("${Fmt.titleCase(item["category"].str)} · ${if (item["isMine"].bool) "you" else item["reporter"]["name"].str ?: ""} · ${Fmt.timeAgo(item["createdAt"])}", color = C.muted)
            }
        }
    }
}

@Composable
private fun Matches(id: String) {
    val q = Api.lostFoundMatches(id)
    if (q.isLoading) {
        Loading()
        return
    }
    RowCard(Wide, background = C.infoSoft, gap = 8.dp, verticalAlignment = Alignment.Top) {
        Icon(Icons.Rounded.Info, null, Modifier.size(16.dp), tint = C.info)
        Small("Possible matches are automatic suggestions, not proof of ownership. Staff verify before any handover.", Modifier.weight(1f), Color(0xFF0369A1))
    }
    val matches = q.data.list
    if (matches.isEmpty()) Small("No similar reports yet.", Wide.padding(12.dp), align = TextAlign.Center)
    matches.forEach { m ->
        Card(Wide, onClick = { Nav.push("/lost-found/${m.id}") }, gap = 4.dp) {
            Strong(m["itemName"].str)
            Small("${m["location"].str ?: ""} · ${Fmt.dateTime(m["dateTime"])}")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                m["matchReasons"].strings.forEach { Badge(it, Tone.Neutral) }
            }
        }
    }
}

@Composable
fun LostFoundItemScreen(id: String) {
    val q = Api.lostFoundItem(id)
    val close = rememberMutation()
    DetailScreen(q, "Item") { item ->
        val resolved = item["status"].str in setOf("returned", "closed")
        Header(item["itemName"].str, "${Fmt.titleCase(item["type"].str)} · ${Fmt.titleCase(item["category"].str)}", back = true)
        if (item["photo"].text != null) RemoteImage(item["photo"].str, Wide.height(220.dp).clip(RoundedCornerShape(28.dp)))
        else Box(Wide) { ItemIcon(item["type"].str, 0, 44, 28, Wide.height(140.dp)) }
        Card(Wide, gap = 8.dp) {
            StatusBadge(item["status"].str)
            item["description"].text?.let { Body(it) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Rounded.Place, null, Modifier.size(14.dp), tint = C.primary)
                Small(item["location"].str)
            }
            Small("When: ${Fmt.dateTime(item["dateTime"])}")
            item["additionalDetails"].text?.let { Small(it) }
            item["resolutionNote"].text?.let { Small("Resolution: $it") }
            val matched = item["matchedWith"]
            if (matched.id != null && matched["itemName"] != null) {
                Card(Wide, onClick = { Nav.push("/lost-found/${matched.id}") }, background = C.warningSoft) {
                    Small("Linked ${if (item["status"].str == "returned") "and returned" else "as a possible match"}: ${matched["itemName"].str}")
                }
            }
        }
        RowCard(Wide) {
            Avatar(item["reporter"], size = 42.dp)
            Column(Modifier.weight(1f)) {
                Strong(if (item["isMine"].bool) "You" else item["reporter"]["name"].str)
                Small("Reported ${Fmt.timeAgo(item["createdAt"])}")
                item["reporter"]["email"].text?.let { Small(it) }
            }
        }
        if (item["isMine"].bool && !resolved) {
            Button("Close my report", {
                Dialogs.alert("Close this report?", "Use this when you no longer need help.", listOf(
                    DialogButton("Keep open", cancel = true),
                    DialogButton("Close") { close.launch(onError = { Dialogs.alert("Could not close", errMsg(it)) }) { Api.closeLostFound(id) } },
                ))
            }, Wide, variant = Variant.Soft, loading = close.isLoading)
        }
        if ((item["isMine"].bool || item["canManage"].bool) && !resolved) {
            SectionTitle("Possible matches")
            Matches(id)
        }
    }
}

private val LF_CATEGORIES = listOf("electronics", "documents", "clothing", "accessories", "books", "keys", "wallet", "bag", "sports", "other")
private const val MAX_BYTES = 5L * 1024 * 1024

@Composable
fun ReportItemScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var type by rememberSaveable { mutableStateOf("lost") }
    var itemName by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("electronics") }
    var location by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var whenAt by remember { mutableStateOf(nowMinute()) }
    var contact by rememberSaveable { mutableStateOf("email") }
    var photoUrl by rememberSaveable { mutableStateOf<String?>(null) }
    var photoLocal by remember { mutableStateOf<Uri?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }
    val report = rememberMutation()

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val size = withContext(Dispatchers.IO) {
                context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst()) c.getLong(0) else null }
            }
            if (size != null && size > MAX_BYTES) {
                Dialogs.alert("Photo too large", "Please choose an image under 5 MB.")
                return@launch
            }
            uploading = true
            try {
                // The server checks the real file type from its bytes before storing it.
                val file = Api.uploadImage(uri)
                photoUrl = file["url"].str
                photoLocal = uri
            } catch (e: Exception) {
                Dialogs.alert("Upload failed", errMsg(e))
            } finally {
                uploading = false
            }
        }
    }

    fun submit() {
        val e = mutableMapOf<String, String>()
        if (itemName.trim().length < 2) e["itemName"] = "What is the item?"
        if (location.trim().length < 2) e["location"] = "Where was it lost or found?"
        if (whenAt.isAfter(ZonedDateTime.now().plusMinutes(5))) e["when"] = "Cannot be in the future"
        errors = e
        if (e.isNotEmpty()) return
        report.launch(onError = { Dialogs.alert("Could not submit", errMsg(it)) }) {
            val item = Api.reportLostFound(jsonOf(
                "type" to type,
                "itemName" to itemName.trim(),
                "category" to category,
                "location" to location.trim(),
                "description" to (description.trim().ifEmpty { null } ?: Omit),
                "dateTime" to Fmt.isoInstant(whenAt),
                "contactMethod" to contact,
                "photo" to (photoUrl ?: Omit),
            ))
            Nav.replace("/lost-found/${item.id}")
        }
    }

    Screen {
        Header("Report an item", "Your contact details are shared only with staff.", back = true)
        Card(Wide, gap = 14.dp) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("I lost something", type == "lost") { type = "lost" }
                Chip("I found something", type == "found") { type = "found" }
            }
            Input(itemName, { itemName = it }, label = "Item", maxLength = 120, placeholder = "e.g. Black HP laptop charger", error = errors["itemName"])
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Label("Category")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    LF_CATEGORIES.forEach { c -> Chip(Fmt.titleCase(c), category == c) { category = c } }
                }
            }
            Input(location, { location = it }, label = if (type == "lost") "Last seen at" else "Found at", maxLength = 200, placeholder = "e.g. Library, 2nd floor", error = errors["location"])
            DateTimeField("When", whenAt, { whenAt = it }, max = ZonedDateTime.now(), error = errors["when"])
            Input(description, { description = it }, label = "Description", multiline = true, maxLength = 1000, placeholder = "Colour, brand, marks…")
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Label("How staff can reach you")
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("email" to "Email", "phone" to "Phone", "in_person" to "In person").forEach { (v, l) -> Chip(l, contact == v) { contact = v } }
                }
            }
            val local = photoLocal
            if (photoUrl != null && local != null) {
                Box {
                    AsyncImage(local, null, Wide.height(180.dp).clip(RoundedCornerShape(22.dp)), contentScale = ContentScale.Crop)
                    Box(
                        Modifier.align(Alignment.TopEnd).padding(10.dp).clip(RoundedCornerShape(16.dp)).background(Color(0x80000000))
                            .clickable { photoUrl = null; photoLocal = null }.padding(6.dp).semantics { contentDescription = "Remove photo" },
                    ) { Icon(Icons.Rounded.Close, null, Modifier.size(16.dp), tint = Color.White) }
                }
            } else {
                Button("Add a photo (optional)", {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }, Wide, variant = Variant.Outline, icon = Icons.Rounded.AddPhotoAlternate, loading = uploading)
            }
            Small("JPG, PNG, WEBP or GIF · max 5 MB", color = C.muted)
            Button("Submit report", ::submit, Wide, loading = report.isLoading, enabled = !uploading)
        }
    }
}
