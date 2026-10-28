package com.vexon.campus.screens

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.EmojiEvents
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.MilitaryTech
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.Restore
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.vexon.campus.core.num
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
import com.vexon.campus.ui.DEPARTMENTS
import com.vexon.campus.ui.DateField
import com.vexon.campus.ui.DialogButton
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
import com.vexon.campus.ui.RemoteImage
import com.vexon.campus.ui.RowCard
import com.vexon.campus.ui.STUDENT_ROLES
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.SectionTitle
import com.vexon.campus.ui.Segmented
import com.vexon.campus.ui.SelectField
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.T
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Type
import com.vexon.campus.ui.Variant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import java.time.LocalDate

/* ── Constants (same values as the web's utils/constants.js) ─────── */

/** Principal and HOD post achievements; admin moderates; warden / security never see them. */
val ACHIEVEMENT_POST_ROLES = setOf("principal", "hod")
val ACHIEVEMENT_STATS_ROLES = setOf("principal", "hod", "admin")
val ACHIEVEMENT_BLOCKED_ROLES = setOf("warden", "security")

val ACHIEVEMENT_CATEGORIES = listOf(
    "academic" to "Academic", "sports" to "Sports", "technical" to "Hackathon / Technical", "cultural" to "Cultural / Arts",
    "research" to "Research / Publication", "placement" to "Internship / Placement", "competition" to "Competition",
    "certification" to "Certification", "other" to "Other",
)
val ACHIEVEMENT_LEVELS = listOf("college" to "College", "state" to "State", "national" to "National", "international" to "International")
val ACHIEVEMENT_POSITIONS = listOf(
    "winner" to "Winner", "first" to "1st place", "second" to "2nd place", "third" to "3rd place", "runner_up" to "Runner-up",
    "finalist" to "Finalist", "participant" to "Participant", "selected" to "Selected", "published" to "Published", "other" to "Other",
)
private val CATEGORY_LABELS = ACHIEVEMENT_CATEGORIES.toMap()
private val LEVEL_LABELS = ACHIEVEMENT_LEVELS.toMap()
private val POSITION_LABELS = ACHIEVEMENT_POSITIONS.toMap()
private val LEVEL_TONES = mapOf("college" to Tone.Neutral, "state" to Tone.Info, "national" to Tone.Primary, "international" to Tone.Warning)

/** Banner gradient when an achievement has no photo. */
private val ACHIEVEMENT_GRADIENTS = mapOf(
    "academic" to listOf(Color(0xFF4338CA), Color(0xFF4C1D95)),
    "sports" to listOf(Color(0xFF047857), Color(0xFF134E4A)),
    "technical" to listOf(Color(0xFF0369A1), Color(0xFF1E3A8A)),
    "cultural" to listOf(Color(0xFFBE185D), Color(0xFF881337)),
    "research" to listOf(Color(0xFF7E22CE), Color(0xFF701A75)),
    "placement" to listOf(Color(0xFFB45309), Color(0xFF7C2D12)),
    "competition" to listOf(Color(0xFFBE123C), Color(0xFF7F1D1D)),
    "certification" to listOf(Color(0xFF0E7490), Color(0xFF134E4A)),
    "other" to listOf(Color(0xFF475569), Color(0xFF1E293B)),
)

fun achievementCategoryLabel(c: String?) = CATEGORY_LABELS[c] ?: Fmt.titleCase(c)
fun achievementLevelLabel(l: String?) = LEVEL_LABELS[l] ?: Fmt.titleCase(l)
fun achievementPositionLabel(p: String?) = POSITION_LABELS[p] ?: Fmt.titleCase(p)

/* ── Card ───────────────────────────────────────────────────────── */

@Composable
private fun WhitePill(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector? = null, tint: Color = Color(0xFFF59E0B)) {
    Row(
        Modifier.clip(CircleShape).background(C.glass(0.9f)).padding(horizontal = 10.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(12.dp), tint = tint)
        T(text, Type.small.copy(fontSize = 11.sp, fontWeight = FontWeight.Bold), color = C.ink)
    }
}

/** Badge readable on the dark photo banner: solid white with the tone's text colour. */
@Composable
private fun BannerBadge(text: String, tone: Tone) {
    Box(Modifier.clip(CircleShape).background(C.glass(0.95f)).padding(horizontal = 10.dp, vertical = 3.dp)) {
        T(text, Type.small.copy(fontSize = 11.sp, fontWeight = FontWeight.Bold), color = tone.fg)
    }
}

@Composable
private fun FeaturedPill() {
    Row(
        Modifier.clip(CircleShape).background(Color(0xFFF59E0B)).padding(horizontal = 10.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(Icons.Rounded.Star, null, Modifier.size(12.dp), tint = Color.White)
        T("Featured", Type.small.copy(fontSize = 10.sp, fontWeight = FontWeight.ExtraBold), color = Color.White)
    }
}

/** Photo, or a category gradient with a trophy, darkened at the bottom for the text on top. */
@Composable
private fun AchievementBanner(a: JsonElement, height: Int, imageUrl: String? = a["images"][0]["url"].str, content: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit) {
    val grad = ACHIEVEMENT_GRADIENTS[a["category"].str] ?: listOf(C.primary600, Color(0xFF312E81))
    Box(Modifier.fillMaxWidth().height(height.dp).background(Brush.linearGradient(grad))) {
        if (imageUrl != null) RemoteImage(imageUrl, Modifier.fillMaxSize(), a["title"].str)
        else Icon(Icons.Rounded.EmojiEvents, null, Modifier.align(Alignment.Center).size((height * 0.5).dp).alpha(0.25f), tint = Color.White)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0x33000000), Color(0xB3000000)))))
        content()
    }
}

@Composable
private fun CongratulateButton(a: JsonElement, large: Boolean = false) {
    val id = a.id.orEmpty()
    // Optimistic, like the web card; reverted if the server refuses.
    var state by remember(a) { mutableStateOf(a["congratulated"].bool to (a["congratulationCount"].int ?: 0)) }
    val scope = rememberCoroutineScope()
    val (on, count) = state
    Row(
        Modifier.clip(CircleShape).background(if (on) (if (large) C.danger else C.dangerSoft) else if (large) C.surface else Color.Transparent)
            .clickable {
                val before = state
                state = !on to (count + if (on) -1 else 1)
                scope.launch {
                    try {
                        val res = Api.congratulateAchievement(id)
                        state = res["congratulated"].bool to (res["congratulationCount"].int ?: state.second)
                    } catch (e: Exception) {
                        state = before
                        Dialogs.alert("Could not congratulate", errMsg(e))
                    }
                }
            }
            .padding(horizontal = if (large) 14.dp else 12.dp, vertical = if (large) 8.dp else 5.dp)
            .semantics { contentDescription = "Congratulate" },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(if (on) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder, null, Modifier.size(if (large) 16.dp else 14.dp),
            tint = if (on) (if (large) Color.White else C.danger) else C.soft)
        T(
            if (count > 0) "$count Congratulations" else "Congratulate", Type.small.copy(fontWeight = FontWeight.Bold),
            color = if (on) (if (large) Color.White else C.roseText) else C.soft,
        )
    }
}

private fun studentsLine(students: List<JsonElement>): String = when {
    students.size == 1 -> students[0]["name"].str.orEmpty()
    students.size > 1 -> "${students[0]["name"].str.orEmpty()} +${students.size - 1}"
    else -> "Student"
}

@Composable
fun AchievementCard(a: JsonElement, compact: Boolean = false, modifier: Modifier = Wide) {
    val open = { Nav.push("/achievements/${a.id}") }
    Card(modifier, padded = false) {
        Box(Modifier.clickable(onClick = open)) {
            AchievementBanner(a, if (compact) 112 else 160) {
                Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    WhitePill(achievementPositionLabel(a["position"].str), Icons.Rounded.MilitaryTech)
                    BannerBadge(achievementLevelLabel(a["level"].str), LEVEL_TONES[a["level"].str] ?: Tone.Primary)
                }
                if (a["isFeatured"].bool) Box(Modifier.align(Alignment.TopEnd).padding(12.dp)) { FeaturedPill() }
                Row(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.CalendarMonth, null, Modifier.size(12.dp), tint = Color(0xE6FFFFFF))
                    T(" " + Fmt.date(a["achievedOn"]), Type.small.copy(fontSize = 11.sp), color = Color(0xE6FFFFFF))
                    val depts = a["departments"].strings
                    if (depts.isNotEmpty()) T(
                        depts.joinToString(", ").uppercase(), Type.label.copy(fontSize = 10.sp), Modifier.weight(1f), Color(0xCCFFFFFF),
                        align = TextAlign.End, maxLines = 1,
                    )
                }
            }
        }
        Column(Modifier.fillMaxWidth().clickable(onClick = open).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Badge(achievementCategoryLabel(a["category"].str), Tone.Info)
                a["eventName"].text?.let { Small(it, Modifier.weight(1f), C.muted, maxLines = 1) }
            }
            H3(a["title"].str, maxLines = 2)
            Small(a["description"].str, maxLines = if (compact) 1 else 2)
            Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val students = a["students"].list
                students.take(3).forEachIndexed { i, s -> Box(Modifier.padding(start = if (i == 0) 0.dp else 0.dp)) { Avatar(s, size = 22.dp) } }
                Small(studentsLine(students), Modifier.weight(1f), C.ink, maxLines = 1)
                if (a["isMine"].bool) Badge("You", Tone.Primary)
            }
        }
        Box(Wide.height(1.dp).background(C.border))
        Row(Wide.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            CongratulateButton(a)
            T("View details", Type.small.copy(fontWeight = FontWeight.Bold), Modifier.clickable(onClick = open).padding(6.dp), C.primary600)
        }
    }
}

/* ── Achievements feed ──────────────────────────────────────────── */

@Composable
fun AchievementsScreen(route: Route) {
    val me = me()
    val canPost = me.role in ACHIEVEMENT_POST_ROLES
    val canStats = me.role in ACHIEVEMENT_STATS_ROLES
    val isStudent = me.role in STUDENT_ROLES
    var search by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("") }
    var level by rememberSaveable { mutableStateOf("") }
    var dept by rememberSaveable { mutableStateOf("") }
    var featured by rememberSaveable { mutableStateOf(route.q("featured") == "true") }
    var mine by rememberSaveable { mutableStateOf(route.q("mine") == "true") }
    var tab by rememberSaveable { mutableStateOf("feed") }
    var page by rememberSaveable { mutableStateOf(1) }
    val resolve = rememberMutation()

    val q = Api.achievements(mapOf(
        "page" to page, "limit" to 12, "q" to search.trim().ifEmpty { null }, "category" to category.ifEmpty { null },
        "level" to level.ifEmpty { null }, "department" to dept.ifEmpty { null },
        "featured" to (if (featured) "true" else null), "mine" to (if (mine) "true" else null),
    ))
    val stats = Api.achievementStats(skip = !canStats)
    val items = q.data["items"].list
    val total = q.data["total"].int ?: 0
    val pages = q.data["pages"].int ?: 1
    // Students tagged in a post can ask to be removed; its poster decides.
    val pending = items.filter { it["canEdit"].bool }.flatMap { a -> a["hideRequests"].list.map { a to it } }
    val filtered = search.isNotBlank() || category.isNotEmpty() || level.isNotEmpty() || dept.isNotEmpty() || featured || mine
    fun resetPage(block: () -> Unit) { block(); page = 1 }

    Screen(refreshing = q.isFetching && !q.isLoading, onRefresh = { q.refetch(); stats.refetch() }) {
        Header("Student Achievements", "Official recognitions, competition victories, hackathons and academic honors.", back = true, right = if (canPost) ({
            Button("Post", { Nav.push("/achievements/new") }, icon = Icons.Rounded.Add, small = true)
        }) else null)

        stats.data?.let { s ->
            Grid2(listOf(
                Triple(Icons.Rounded.EmojiEvents, Grad.amber, num(s["thisYear"]) to "Honors this year"),
                Triple(Icons.Rounded.AutoAwesome, Grad.violet, num(s["total"]) to "All-time recognitions"),
                Triple(Icons.Rounded.MilitaryTech, Grad.emerald, Fmt.titleCase(s["byLevel"][0]["key"].text ?: "national") to "Top level (${s["byLevel"][0]["count"].int ?: 0} awards)"),
                Triple(Icons.Rounded.School, Grad.rose, (s["byDepartment"][0]["key"].text ?: "Active") to "Leading department"),
            )) { (icon, grad, pair), mod ->
                Card(mod, gap = 8.dp) {
                    IconTile(icon, grad, 36.dp)
                    Column {
                        H3(pair.first, maxLines = 1)
                        Small(pair.second)
                    }
                }
            }
        }

        if (canPost && pending.isNotEmpty()) {
            Segmented(listOf(Opt("feed", "All Achievements"), Opt("requests", "Opt-out Requests", pending.size)), tab, { tab = it })
        }

        if (tab == "requests" && pending.isNotEmpty()) {
            Card(Wide, gap = 12.dp) {
                H3("Pending opt-out requests")
                Small("Students tagged in an achievement who asked to be removed from the post.")
                pending.forEach { (a, r) ->
                    Column(Wide.clip(RoundedCornerShape(16.dp)).background(C.whiteGlass).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Strong("${r["student"]["name"].text ?: "A student"} on “${a["title"].str ?: ""}”")
                        Small("Reason: ${r["reason"].text ?: "No specific reason provided."}")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button("Approve removal", {
                                resolve.launch { Api.resolveAchievementHide(a.id.orEmpty(), r.id.orEmpty(), "approve"); Dialogs.alert("Student removed from achievement") }
                            }, Modifier.weight(1f), variant = Variant.Success, icon = Icons.Rounded.Check, small = true, loading = resolve.isLoading)
                            Button("Decline", {
                                resolve.launch { Api.resolveAchievementHide(a.id.orEmpty(), r.id.orEmpty(), "reject"); Dialogs.alert("Request rejected") }
                            }, Modifier.weight(1f), variant = Variant.Danger, icon = Icons.Rounded.Close, small = true, loading = resolve.isLoading)
                        }
                    }
                }
            }
            return@Screen
        }

        Card(Wide, gap = 10.dp) {
            Input(search, { resetPage { search = it } }, placeholder = "Search achievements, competitions or students…")
            ChipRow {
                if (isStudent) Chip("🏆 My Achievements", mine) { resetPage { mine = !mine } }
                Chip("⭐ Featured Only", featured) { resetPage { featured = !featured } }
                if (filtered) Chip("✕ Reset", false) { resetPage { search = ""; category = ""; level = ""; dept = ""; featured = false; mine = false } }
            }
            SelectField(null, category, listOf(Opt("", "All Categories")) + ACHIEVEMENT_CATEGORIES.map { Opt(it.first, it.second) }, { resetPage { category = it } })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SelectField(null, level, listOf(Opt("", "All Levels")) + ACHIEVEMENT_LEVELS.map { Opt(it.first, it.second) }, { resetPage { level = it } }, modifier = Modifier.weight(1f))
                SelectField(null, dept, listOf(Opt("", "All Departments")) + DEPARTMENTS.map { Opt(it, it) }, { resetPage { dept = it } }, modifier = Modifier.weight(1f))
            }
            Small("Showing ${items.size} of $total", color = C.muted)
        }

        val data = q.data
        when {
            data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            data == null -> Loading()
            items.isEmpty() -> Card(Wide) {
                EmptyState(
                    Icons.Rounded.EmojiEvents, "No achievements found",
                    if (mine) "You haven't been tagged in any posted achievements yet." else "Try broadening your search or filter options.",
                    action = if (canPost && !mine) ({ Button("Post the first achievement", { Nav.push("/achievements/new") }, icon = Icons.Rounded.Add) }) else null,
                )
            }
            else -> {
                items.forEach { AchievementCard(it) }
                if (pages > 1) Row(Wide, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Button("Previous", { page-- }, variant = Variant.Soft, small = true, enabled = page > 1)
                    Small("Page $page of $pages")
                    Button("Next", { page++ }, variant = Variant.Soft, small = true, enabled = page < pages)
                }
            }
        }
    }
}

/* ── Achievement detail ─────────────────────────────────────────── */

@Composable
fun AchievementDetailScreen(id: String) {
    val context = LocalContext.current
    val q = Api.achievement(id)
    val feature = rememberMutation()
    val remove = rememberMutation()
    val restore = rememberMutation()
    val hide = rememberMutation()
    var photo by remember { mutableStateOf(0) }

    DetailScreen(q, "Achievement") { a ->
        val images = a["images"].list
        Header("Achievement", back = true)
        if (a["canFeature"].bool || a["canEdit"].bool || (a["canDelete"].bool && !a["isDeleted"].bool) || a["canRestore"].bool) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (a["canFeature"].bool) Button(if (a["isFeatured"].bool) "Unfeature" else "Feature on top", {
                    feature.launch(onError = { Dialogs.alert("Could not update", errMsg(it, "Failed to update feature state")) }) {
                        val res = Api.toggleFeaturedAchievement(id)
                        Dialogs.alert(if (res["isFeatured"].bool) "Achievement marked as Featured! ⭐" else "Unfeatured")
                    }
                }, variant = Variant.Outline, icon = Icons.Rounded.Star, small = true, loading = feature.isLoading)
                if (a["canEdit"].bool) Button("Edit", { Nav.push("/achievements/$id/edit") }, variant = Variant.Outline, icon = Icons.Rounded.Edit, small = true)
                if (a["canDelete"].bool && !a["isDeleted"].bool) Button("Delete", {
                    Dialogs.confirm(
                        "Delete achievement?", "This removes the achievement from the public feed. Administrators can restore it if needed.",
                        "Delete", destructive = true,
                    ) {
                        remove.launch(onError = { Dialogs.alert("Could not delete", errMsg(it, "Failed to delete")) }) {
                            Api.deleteAchievement(id)
                            Dialogs.alert("Achievement deleted")
                            Nav.back()
                        }
                    }
                }, variant = Variant.Danger, icon = Icons.Rounded.Delete, small = true, loading = remove.isLoading)
                if (a["canRestore"].bool) Button("Restore", {
                    restore.launch(onError = { Dialogs.alert("Could not restore", errMsg(it, "Failed to restore")) }) {
                        Api.restoreAchievement(id)
                        Dialogs.alert("Achievement restored")
                    }
                }, icon = Icons.Rounded.Restore, small = true, loading = restore.isLoading)
            }
        }

        Card(Wide, padded = false) {
            AchievementBanner(a, 260, images.getOrNull(photo)?.get("url").str ?: images.firstOrNull()?.get("url").str) {
                Column(Modifier.align(Alignment.BottomStart).padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        BannerBadge(achievementCategoryLabel(a["category"].str), Tone.Info)
                        BannerBadge("${achievementLevelLabel(a["level"].str)} Level", LEVEL_TONES[a["level"].str] ?: Tone.Primary)
                        WhitePill(achievementPositionLabel(a["position"].str), Icons.Rounded.MilitaryTech)
                        if (a["isFeatured"].bool) FeaturedPill()
                        if (a["isDeleted"].bool) BannerBadge("Deleted (archive)", Tone.Danger)
                    }
                    H2(a["title"].str, color = Color.White)
                    Small(
                        listOfNotNull(Fmt.date(a["achievedOn"]), a["eventName"].text, a["organizer"].text?.let { "Organized by $it" }).joinToString(" • "),
                        color = Color(0xE6FFFFFF),
                    )
                    val depts = a["departments"].strings
                    if (depts.isNotEmpty()) Small(depts.joinToString(", "), color = Color(0xCCFFFFFF))
                }
            }
            if (images.size > 1) Row(Wide.horizontalScroll(rememberScrollState()).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                images.forEachIndexed { i, img ->
                    RemoteImage(
                        img["url"].str,
                        Modifier.width(96.dp).height(64.dp).clip(RoundedCornerShape(12.dp))
                            .border(2.dp, if (i == photo) C.primary else Color.Transparent, RoundedCornerShape(12.dp))
                            .alpha(if (i == photo) 1f else 0.7f).clickable { photo = i },
                        "Photo ${i + 1}",
                    )
                }
            }
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    H3("About the achievement")
                    Body(a["description"].str, color = C.soft)
                }
                a["externalLink"].text?.let { link ->
                    Button("View external proof / coverage", { openUrl(context, link) }, Wide, variant = Variant.Soft, icon = Icons.AutoMirrored.Rounded.OpenInNew)
                }
                val students = a["students"].list
                Box(Wide.height(1.dp).background(C.border))
                H3("Honored Students (${students.size})")
                students.forEach { s ->
                    RowCard(Wide, onClick = { Nav.push("/people/${s.id}") }, gap = 10.dp) {
                        Avatar(s, size = 40.dp)
                        Column(Modifier.weight(1f)) {
                            Strong(s["name"].str, maxLines = 1)
                            Small(listOfNotNull(s["rollNo"].text, s["department"].text, s["year"].text?.let { "Year $it" }).joinToString(" • "), maxLines = 1)
                        }
                    }
                }
                Column(Wide.clip(RoundedCornerShape(16.dp)).background(C.whiteGlass).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        val by = a["postedBy"]
                        Avatar(by, size = 32.dp)
                        Column(Modifier.weight(1f)) {
                            T("Posted by ${by["name"].text ?: "Department Head"}", Type.small.copy(fontWeight = FontWeight.Bold), color = C.ink)
                            Small(
                                (by["designation"].text ?: if (by["role"].str == "principal") "Principal" else "Head of Department") +
                                    (by["department"].text?.let { " • $it" } ?: ""),
                                color = C.muted,
                            )
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CongratulateButton(a, large = true)
                        if (a["isMine"].bool) {
                            if (a["myHideRequest"].str == "pending") Badge("Opt-out request pending", Tone.Warning)
                            else Small("Request removal", Modifier.clickable {
                                Dialogs.prompt(
                                    "Request privacy removal",
                                    "Ask the poster or the Principal to remove your name from this achievement post.",
                                    "Reason (optional)", "Submit request",
                                ) { reason ->
                                    hide.launch(onError = { Dialogs.alert("Could not submit", errMsg(it, "Failed to submit request")) }) {
                                        Api.requestAchievementHide(id, reason)
                                        Dialogs.alert("Request submitted", "Your privacy removal request was sent to the department head.")
                                    }
                                }
                            }.padding(6.dp), C.roseText)
                        }
                    }
                }
            }
        }
    }
}

/* ── Post / edit an achievement ─────────────────────────────────── */

private const val MAX_STUDENTS = 20
private const val MAX_IMAGES = 5
private const val MAX_IMAGE_BYTES = 5L * 1024 * 1024

@Composable
fun AchievementFormScreen(editId: String?) {
    val me = me()
    if (me.role !in ACHIEVEMENT_POST_ROLES) {
        Screen {
            Header("Post achievement", back = true)
            Card(Wide) { EmptyState(Icons.Rounded.EmojiEvents, "Only the Principal and HODs can post achievements") }
        }
        return
    }
    if (editId != null) {
        val q = Api.achievement(editId)
        val a = q.data
        if (a == null) {
            Screen {
                Header("Edit achievement", back = true)
                if (q.error != null) ErrorState(q.error) { q.refetch() } else Loading()
            }
            return
        }
        AchievementForm(me, a)
    } else AchievementForm(me, null)
}

@Composable
private fun AchievementForm(me: JsonElement, existing: JsonElement?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val isPrincipal = me.role == "principal"
    var title by rememberSaveable { mutableStateOf(existing["title"].str.orEmpty()) }
    var description by rememberSaveable { mutableStateOf(existing["description"].str.orEmpty()) }
    var category by rememberSaveable { mutableStateOf(existing["category"].text ?: "academic") }
    var level by rememberSaveable { mutableStateOf(existing["level"].text ?: "college") }
    var position by rememberSaveable { mutableStateOf(existing["position"].text ?: "winner") }
    var eventName by rememberSaveable { mutableStateOf(existing["eventName"].str.orEmpty()) }
    var organizer by rememberSaveable { mutableStateOf(existing["organizer"].str.orEmpty()) }
    var achievedOn by rememberSaveable {
        mutableStateOf(existing["achievedOn"].str?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now())
    }
    var link by rememberSaveable { mutableStateOf(existing["externalLink"].str.orEmpty()) }
    val students = remember { mutableStateListOf<JsonElement>().apply { addAll(existing["students"].list) } }
    val images = remember { mutableStateListOf<JsonElement>().apply { addAll(existing["images"].list) } }
    var studentSearch by remember { mutableStateOf("") }
    var uploading by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }
    val save = rememberMutation()
    val results = Api.achievementStudents(studentSearch.trim(), skip = studentSearch.isBlank())

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val (size, name) = withContext(Dispatchers.IO) {
                context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE, OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                    if (c.moveToFirst()) c.getLong(0) to c.getString(1) else null to null
                } ?: (null to null)
            }
            if (size != null && size > MAX_IMAGE_BYTES) {
                Dialogs.alert("Image too large", "Image must be under 5 MB.")
                return@launch
            }
            uploading = true
            try {
                val res = Api.uploadImage(uri)
                images += jsonOf("url" to res["url"].str, "name" to (res["name"].text ?: name ?: "Photo"), "mimeType" to (context.contentResolver.getType(uri) ?: "image/jpeg"))
            } catch (e: Exception) {
                Dialogs.alert("Upload failed", errMsg(e, "Failed to upload photo"))
            } finally {
                uploading = false
            }
        }
    }

    fun submit() {
        val e = mutableMapOf<String, String>()
        if (students.isEmpty()) e["students"] = "Please tag at least one student"
        if (title.trim().length < 3) e["title"] = "Title must be at least 3 characters"
        if (description.trim().length < 10) e["description"] = "Description must be at least 10 characters"
        if (link.isNotBlank() && !Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(link.trim())) e["link"] = "Enter a full link starting with https://"
        errors = e
        if (e.isNotEmpty()) {
            Dialogs.alert("Please check the form", e.values.first())
            return
        }
        save.launch(onError = { Dialogs.alert("Could not save", errMsg(it, "Failed to save achievement")) }) {
            val body = jsonOf(
                "title" to title.trim(), "description" to description.trim(), "category" to category, "level" to level, "position" to position,
                "eventName" to eventName.trim(), "organizer" to organizer.trim(), "achievedOn" to achievedOn.toString(),
                "externalLink" to (link.trim().ifEmpty { null } ?: Omit),
                "students" to students.map { it.id }, "images" to images.toList(),
            )
            if (existing != null) {
                Api.updateAchievement(existing.id.orEmpty(), body)
                Dialogs.alert("Achievement updated")
            } else {
                Api.createAchievement(body)
                Dialogs.alert("Achievement posted 🏆", "The campus feed has been updated and the students were notified.")
            }
            Nav.back()
        }
    }

    Screen {
        Header(
            if (existing != null) "Edit achievement" else "Post achievement",
            if (isPrincipal) "Post achievements for any student in the college." else "Post achievements for students in ${me["department"].text ?: "your department"}.",
            back = true,
        )
        Card(Wide, gap = 14.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Label("Featured student(s) *")
                if (students.isEmpty()) Small("At least one student must be selected.", color = errors["students"]?.let { C.danger } ?: C.muted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    students.toList().forEach { s ->
                        Row(
                            Modifier.clip(CircleShape).background(C.primarySoft).padding(start = 4.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Avatar(s, size = 22.dp)
                            T(s["name"].str, Type.small.copy(fontWeight = FontWeight.Bold), color = C.primary600, maxLines = 1)
                            Icon(Icons.Rounded.Close, "Remove ${s["name"].str}", Modifier.size(16.dp).clickable { students.remove(s) }, tint = C.primary600)
                        }
                    }
                }
                Input(studentSearch, { studentSearch = it }, placeholder = "Search student by name or roll number…",
                    hint = if (isPrincipal) "Any active student in the college (up to $MAX_STUDENTS)" else "Students of ${me["department"].text ?: "your department"}")
                if (studentSearch.isNotBlank()) {
                    val found = results.data["items"].list
                    Column(Wide.clip(RoundedCornerShape(16.dp)).background(C.surface).border(1.dp, C.border, RoundedCornerShape(16.dp)).padding(4.dp)) {
                        when {
                            results.data == null -> Loading()
                            found.isEmpty() -> Small("No matching students found.", Wide.padding(12.dp), align = TextAlign.Center)
                            else -> found.forEach { s ->
                                val added = students.any { it.id == s.id }
                                Row(
                                    Wide.clip(RoundedCornerShape(12.dp)).clickable(enabled = !added) {
                                        if (students.size >= MAX_STUDENTS) Dialogs.alert("Maximum $MAX_STUDENTS students per achievement")
                                        else { students += s; studentSearch = "" }
                                    }.alpha(if (added) 0.5f else 1f).padding(8.dp),
                                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Avatar(s, size = 32.dp)
                                    Column(Modifier.weight(1f)) {
                                        Strong(s["name"].str, maxLines = 1)
                                        Small(listOfNotNull(s["rollNo"].text, s["department"].text, s["year"].text?.let { "Year $it" }).joinToString(" • "), maxLines = 1)
                                    }
                                    if (added) Icon(Icons.Rounded.Check, "Added", Modifier.size(16.dp), tint = C.success)
                                    else Icon(Icons.Rounded.PersonAdd, "Tag", Modifier.size(16.dp), tint = C.primary)
                                }
                            }
                        }
                    }
                }
            }
            Input(title, { title = it }, label = "Achievement title *", placeholder = "e.g. 1st Prize in Smart India Hackathon 2026", maxLength = 160, error = errors["title"])
            SelectField("Category *", category, ACHIEVEMENT_CATEGORIES.map { Opt(it.first, it.second) }, { category = it })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SelectField("Level *", level, ACHIEVEMENT_LEVELS.map { Opt(it.first, it.second) }, { level = it }, modifier = Modifier.weight(1f))
                SelectField("Position *", position, ACHIEVEMENT_POSITIONS.map { Opt(it.first, it.second) }, { position = it }, modifier = Modifier.weight(1f))
            }
            Input(eventName, { eventName = it }, label = "Event / competition name", placeholder = "e.g. Smart India Hackathon Grand Finale", maxLength = 160)
            Input(organizer, { organizer = it }, label = "Organized by", placeholder = "e.g. Ministry of Education & AICTE", maxLength = 160)
            DateField("Date of achievement *", achievedOn, { achievedOn = it }, max = LocalDate.now())
            Input(link, { link = it }, label = "External link (optional)", placeholder = "https://…", keyboardType = KeyboardType.Uri, error = errors["link"])
            Input(description, { description = it }, label = "Description & highlights *", multiline = true, minLines = 4, maxLength = 3000,
                placeholder = "Describe the achievement, project, rounds, prize or special mentions…", error = errors["description"])
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Label("Photos (optional, max $MAX_IMAGES)")
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    images.toList().forEach { img ->
                        Box {
                            RemoteImage(img["url"].str, Modifier.width(96.dp).height(80.dp).clip(RoundedCornerShape(14.dp)), img["name"].str)
                            Box(
                                Modifier.align(Alignment.TopEnd).padding(4.dp).size(24.dp).clip(CircleShape).background(Color(0x99000000))
                                    .clickable { images.remove(img) }.semantics { contentDescription = "Remove image" },
                                contentAlignment = Alignment.Center,
                            ) { Icon(Icons.Rounded.Close, null, Modifier.size(14.dp), tint = Color.White) }
                        }
                    }
                }
                if (images.size < MAX_IMAGES) Button("Add photo", {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }, variant = Variant.Outline, icon = Icons.Rounded.AddPhotoAlternate, small = true, loading = uploading)
                Small("JPG, PNG or WebP · up to 5 MB each", color = C.muted)
            }
            Button(if (existing != null) "Save changes" else "Post achievement", ::submit, Wide, icon = Icons.Rounded.EmojiEvents, loading = save.isLoading, enabled = !uploading)
        }
    }
}

/* ── Shared pieces for Home and profiles ───────────────────────── */

/** One-line achievement row (profile honors, "My achievements"). */
@Composable
fun AchievementRow(a: JsonElement) {
    RowCard(Wide, onClick = { Nav.push("/achievements/${a.id}") }, gap = 10.dp) {
        Box(Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(C.warningSoft), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.MilitaryTech, null, Modifier.size(20.dp), tint = C.amberText)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Strong(a["title"].str, maxLines = 2)
            Small(
                listOfNotNull(achievementLevelLabel(a["level"].str), achievementPositionLabel(a["position"].str), a["eventName"].text, Fmt.date(a["achievedOn"]).ifEmpty { null })
                    .joinToString(" • "),
                maxLines = 1,
            )
        }
    }
}

/** Home spotlight: "My achievements" (students) and the latest campus honors. */
@Composable
fun AchievementsSpotlight(isStudent: Boolean) {
    val q = Api.achievementsDashboard()
    val data = q.data ?: return
    val campus = data["campus"].list
    val mineCount = data["mine"]["count"].int ?: 0
    if (campus.isEmpty() && mineCount == 0) return
    if (isStudent && mineCount > 0) {
        SectionTitle("My achievements · $mineCount", "View all") { Nav.push("/achievements?mine=true") }
        data["mine"]["items"].list.forEach { AchievementRow(it) }
    }
    if (campus.isNotEmpty()) {
        SectionTitle("Campus achievements & honors", "View all") { Nav.push("/achievements") }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            campus.take(3).forEach { AchievementCard(it, compact = true, modifier = Modifier.width(280.dp)) }
        }
    }
}

/** "Verified college honors" on a student's profile. */
@Composable
fun StudentHonors(userId: String) {
    val list = Api.studentAchievements(userId).data["items"].list
    if (list.isEmpty()) return
    Card(Wide, gap = 10.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                H3("Verified College Honors")
                Small("Official achievements posted by college leadership")
            }
            Icon(Icons.Rounded.EmojiEvents, null, Modifier.size(22.dp), tint = C.warning)
        }
        list.forEach { AchievementRow(it) }
    }
}
