package com.vexon.campus.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.vexon.campus.core.ServerConfig
import com.vexon.campus.core.get
import com.vexon.campus.core.num
import com.vexon.campus.core.str
import com.vexon.campus.nav.Nav
import kotlinx.serialization.json.JsonElement

/* ── Typography ─────────────────────────────────────────────────── */

@Composable
fun T(
    text: String?,
    style: TextStyle = Type.body,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    align: TextAlign? = null,
    maxLines: Int = Int.MAX_VALUE,
    weight: FontWeight? = null,
    size: Int? = null,
) {
    Text(
        text = text ?: "",
        style = style.let { s -> if (size != null) s.copy(fontSize = size.sp) else s },
        modifier = modifier,
        color = color,
        textAlign = align,
        maxLines = maxLines,
        overflow = if (maxLines == Int.MAX_VALUE) TextOverflow.Clip else TextOverflow.Ellipsis,
        fontWeight = weight,
    )
}

@Composable fun H1(text: String?, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) = T(text, Type.h1, modifier, maxLines = maxLines)
@Composable fun H2(text: String?, modifier: Modifier = Modifier, color: Color = Color.Unspecified, align: TextAlign? = null, maxLines: Int = Int.MAX_VALUE) = T(text, Type.h2, modifier, color, align, maxLines)
@Composable fun H3(text: String?, modifier: Modifier = Modifier, color: Color = Color.Unspecified, align: TextAlign? = null, maxLines: Int = Int.MAX_VALUE) = T(text, Type.h3, modifier, color, align, maxLines)
@Composable fun Strong(text: String?, modifier: Modifier = Modifier, color: Color = Color.Unspecified, align: TextAlign? = null, maxLines: Int = Int.MAX_VALUE) = T(text, Type.strong, modifier, color, align, maxLines)
@Composable fun Small(text: String?, modifier: Modifier = Modifier, color: Color = Color.Unspecified, align: TextAlign? = null, maxLines: Int = Int.MAX_VALUE) = T(text, Type.small, modifier, color, align, maxLines)
@Composable fun Body(text: String?, modifier: Modifier = Modifier, color: Color = Color.Unspecified, align: TextAlign? = null, maxLines: Int = Int.MAX_VALUE) = T(text, Type.body, modifier, color, align, maxLines)
@Composable fun Label(text: String?, modifier: Modifier = Modifier, color: Color = Color.Unspecified) = T(text?.uppercase(), Type.label, modifier, color)

/* ── Layout ─────────────────────────────────────────────────────── */

/** Soft blue blobs behind every screen. */
@Composable
fun BoxScope.Backdrop() {
    Box(Modifier.offset((-100).dp, (-120).dp).size(340.dp).clip(CircleShape).background(Color(0x294396EF)))
    Box(Modifier.align(Alignment.TopEnd).offset(140.dp, 180.dp).size(340.dp).clip(CircleShape).background(Color(0x1A1D6FEB)))
}

/**
 * A screen: background, top safe area, optional pull-to-refresh, and (when
 * [scroll]) a vertically scrolling column with 16dp padding and 14dp gaps.
 */
@Composable
fun Screen(
    scroll: Boolean = true,
    refreshing: Boolean = false,
    onRefresh: (() -> Unit)? = null,
    padding: PaddingValues = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 40.dp),
    gap: Dp = 14.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(Modifier.fillMaxSize().background(C.bg)) {
        Backdrop()
        val body: @Composable () -> Unit = {
            if (scroll) {
                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).imePadding(),
                    verticalArrangement = Arrangement.spacedBy(gap),
                    content = content,
                )
            } else {
                Column(Modifier.fillMaxSize().imePadding(), content = content)
            }
        }
        Box(Modifier.fillMaxSize().statusBarsPadding()) {
            if (onRefresh != null) {
                PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) { body() }
            } else body()
        }
    }
}

@Composable
fun Header(title: String?, subtitle: String? = null, back: Boolean = false, right: (@Composable () -> Unit)? = null, titleMaxLines: Int = 1) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(bottom = 2.dp)) {
        if (back) IconButton(Icons.AutoMirrored.Rounded.ArrowBack, "Back", onClick = { Nav.back() })
        Column(Modifier.weight(1f)) {
            H1(title, maxLines = titleMaxLines)
            if (!subtitle.isNullOrEmpty()) Small(subtitle, maxLines = 2)
        }
        right?.invoke()
        ThemeToggle()
    }
}

/** Top-right light/dark switch, shown in every screen header. */
@Composable
fun ThemeToggle() {
    val dark = ThemeState.dark
    IconButton(
        if (dark) Icons.Rounded.LightMode else Icons.Rounded.DarkMode,
        if (dark) "Switch to light mode" else "Switch to dark mode",
        color = if (dark) C.warning else C.ink,
    ) { ThemeState.toggle() }
}

/** Press feedback: scale down slightly while pressed. */
@Composable
fun Modifier.pressable(onClick: (() -> Unit)?, pressedScale: Float = 0.985f, enabled: Boolean = true, role: Role = Role.Button): Modifier {
    if (onClick == null) return this
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) pressedScale else 1f, label = "press")
    return this.scale(scale).clickable(interactionSource = source, indication = null, enabled = enabled, role = role, onClick = onClick)
}

@Composable
fun Card(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    padded: Boolean = true,
    background: Color = C.card,
    border: Color = C.border,
    gap: Dp = 0.dp,
    horizontalAlignment: Alignment.Horizontal = Alignment.Start,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .pressable(onClick)
            .clip(RoundedCornerShape(Radius.xl))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(Radius.xl))
            .then(if (padded) Modifier.padding(16.dp) else Modifier),
        verticalArrangement = Arrangement.spacedBy(gap),
        horizontalAlignment = horizontalAlignment,
        content = content,
    )
}

/** Card whose content is laid out in a row (the common `flexDirection: 'row'` card). */
@Composable
fun RowCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    background: Color = C.card,
    border: Color = C.border,
    gap: Dp = 12.dp,
    verticalAlignment: Alignment.Vertical = Alignment.CenterVertically,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier
            .pressable(onClick)
            .clip(RoundedCornerShape(Radius.xl))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(Radius.xl))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(gap),
        verticalAlignment = verticalAlignment,
        content = content,
    )
}

@Composable
fun SectionTitle(title: String, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        H3(title, Modifier.weight(1f, fill = false))
        if (action != null) T(action, Type.small, Modifier.clickable { onAction?.invoke() }.padding(4.dp), C.primary, weight = FontWeight.Bold)
    }
}

/** Two equal columns of cards (the "width: 47.8%" grids). */
@Composable
fun <T> Grid2(items: List<T>, gap: Dp = 12.dp, cell: @Composable (T, Modifier) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(gap)) {
        items.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(gap)) {
                row.forEach { cell(it, Modifier.weight(1f).fillMaxHeight()) }
                if (row.size == 1) Box(Modifier.weight(1f))
            }
        }
    }
}

/* ── Buttons ────────────────────────────────────────────────────── */

/** [Map]: opaque, outlined, high-contrast — for buttons floating on a map. */
enum class Variant { Primary, Soft, Ghost, Outline, Danger, Success, Map }

@Composable
fun Button(
    title: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: Variant = Variant.Primary,
    loading: Boolean = false,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    small: Boolean = false,
) {
    val primary = variant == Variant.Primary
    val (bg, fg) = when (variant) {
        Variant.Primary -> Color.Transparent to Color.White
        Variant.Soft -> C.primarySoft to C.primary600
        Variant.Ghost -> Color.Transparent to C.soft
        Variant.Outline -> C.glass(0.6f) to C.ink
        Variant.Danger -> C.dangerSoft to C.roseText
        Variant.Success -> C.successSoft to C.emeraldText
        Variant.Map -> C.surface to C.ink
    }
    val shape = RoundedCornerShape(if (small) Radius.sm else Radius.md)
    val active = enabled && !loading
    Row(
        modifier
            .alpha(if (!enabled) 0.5f else 1f)
            .pressable(if (active) onClick else null, 0.97f)
            .clip(shape)
            .then(if (primary) Modifier.background(Brush.linearGradient(Grad.primary)) else Modifier.background(bg))
            .then(if (variant == Variant.Outline) Modifier.border(1.dp, C.border, shape) else Modifier)
            .then(if (variant == Variant.Map) Modifier.border(1.5.dp, C.controlBorder, shape) else Modifier)
            .padding(horizontal = if (small) 12.dp else 18.dp, vertical = if (small) 8.dp else 13.dp)
            .semantics { if (title == null && icon != null) contentDescription = "button" },
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (loading) CircularProgressIndicator(Modifier.size(if (small) 14.dp else 16.dp), color = fg, strokeWidth = 2.dp)
        else if (icon != null) Icon(icon, null, Modifier.size(if (small) 14.dp else 16.dp), tint = fg)
        if (title != null) Text(title, color = fg, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = if (small) 12.sp else 14.sp, maxLines = 1)
    }
}

@Composable
fun IconButton(icon: ImageVector, label: String, color: Color = C.ink, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .size(40.dp)
            .pressable(onClick, 0.92f)
            .clip(RoundedCornerShape(16.dp))
            .background(C.glass(0.88f))
            .border(1.dp, C.border, RoundedCornerShape(16.dp))
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, label, Modifier.size(20.dp), tint = color) }
}

/* ── Inputs ─────────────────────────────────────────────────────── */

@Composable
fun Input(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    error: String? = null,
    hint: String? = null,
    multiline: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    password: Boolean = false,
    maxLength: Int? = null,
    enabled: Boolean = true,
    trailing: (@Composable () -> Unit)? = null,
    imeAction: ImeAction = if (multiline) ImeAction.Default else ImeAction.Done,
    onSubmit: (() -> Unit)? = null,
    minLines: Int = if (multiline) 3 else 1,
) {
    Column(modifier) {
        if (label != null) Label(label, Modifier.padding(bottom = 6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = { v -> onValueChange(if (maxLength != null) v.take(maxLength) else v) },
            modifier = Modifier.fillMaxWidth().then(if (multiline) Modifier.heightIn(min = 90.dp) else Modifier),
            placeholder = placeholder?.let { { Text(it, color = C.muted, fontFamily = Jakarta, fontSize = 14.sp) } },
            textStyle = TextStyle(fontFamily = Jakarta, fontSize = 14.sp, color = C.ink),
            singleLine = !multiline,
            minLines = minLines,
            enabled = enabled,
            isError = error != null,
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
            keyboardActions = KeyboardActions(onDone = { onSubmit?.invoke() }, onGo = { onSubmit?.invoke() }, onSend = { onSubmit?.invoke() }),
            trailingIcon = trailing,
            shape = RoundedCornerShape(Radius.md),
            colors = OutlinedTextFieldDefaults.colors(
                // Explicit text colours: typed text must never take the card's colour
                // (some phones' system dark mode recoloured it until it was invisible).
                focusedTextColor = C.ink,
                unfocusedTextColor = C.ink,
                disabledTextColor = C.soft,
                errorTextColor = C.ink,
                focusedContainerColor = C.glass(0.92f),
                unfocusedContainerColor = C.glass(0.92f),
                disabledContainerColor = C.glass(0.6f),
                errorContainerColor = C.glass(0.92f),
                focusedPlaceholderColor = C.muted,
                unfocusedPlaceholderColor = C.muted,
                focusedTrailingIconColor = C.soft,
                unfocusedTrailingIconColor = C.soft,
                selectionColors = TextSelectionColors(handleColor = C.primary, backgroundColor = C.primary.copy(alpha = 0.3f)),
                focusedBorderColor = C.primary400,
                unfocusedBorderColor = C.border,
                errorBorderColor = C.danger,
                cursorColor = C.primary,
            ),
        )
        when {
            error != null -> Small(error, Modifier.padding(top = 4.dp), C.danger)
            hint != null -> Small(hint, Modifier.padding(top = 4.dp))
        }
    }
}

data class Opt<V>(val value: V, val label: String, val count: Int? = null)

/** Pill segmented control (the web's <Tabs>). */
@Composable
fun <V> Segmented(options: List<Opt<V>>, value: V, onChange: (V) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .horizontalScroll(rememberScrollState())
            .clip(RoundedCornerShape(18.dp))
            .background(C.glass(0.75f))
            .border(1.dp, C.border, RoundedCornerShape(18.dp))
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEach { o ->
            val active = o.value == value
            Box(
                Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (active) C.surface else Color.Transparent)
                    .clickable(role = Role.Tab) { onChange(o.value) }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Text(
                    o.label + (o.count?.takeIf { it > 0 }?.let { " · $it" } ?: ""),
                    fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 13.sp,
                    color = if (active) C.primary600 else C.soft, maxLines = 1,
                )
            }
        }
    }
}

@Composable
fun Chip(label: String, active: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(CircleShape)
            .background(if (active) C.primary else C.glass(0.8f))
            .border(1.dp, if (active) C.primary else C.border, CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 7.dp),
    ) { Text(label, fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = if (active) Color.White else C.soft, maxLines = 1) }
}

/** Horizontal scrolling row of chips. */
@Composable
fun ChipRow(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), content = content)
}

/* ── Status + identity ──────────────────────────────────────────── */

// Colours are read on use (not captured once), so badges follow light/dark mode.
enum class Tone(private val bgOf: () -> Color, private val fgOf: () -> Color) {
    Primary({ C.primarySoft }, { C.primary600 }),
    Success({ C.successSoft }, { C.emeraldText }),
    Warning({ C.warningSoft }, { C.amberText }),
    Danger({ C.dangerSoft }, { C.roseText }),
    Info({ C.infoSoft }, { C.skyText }),
    Neutral({ C.neutralSoft }, { C.slateText }),
    ;

    val bg: Color get() = bgOf()
    val fg: Color get() = fgOf()
}

@Composable
fun Badge(label: String?, tone: Tone = Tone.Primary, modifier: Modifier = Modifier) {
    Box(modifier.clip(CircleShape).background(tone.bg).padding(horizontal = 10.dp, vertical = 4.dp)) {
        Text(
            // CSS `textTransform: capitalize`: first letter of every word.
            (label ?: "").split(" ").joinToString(" ") { w -> w.replaceFirstChar { it.uppercase() } },
            color = tone.fg, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 11.sp, maxLines = 1,
        )
    }
}

private val STATUS_TONE = mapOf(
    "pending" to Tone.Warning, "pending_authority" to Tone.Warning, "parent_verified" to Tone.Primary, "approved" to Tone.Success,
    "active" to Tone.Info, "completed" to Tone.Neutral, "rejected" to Tone.Danger, "revoked" to Tone.Danger,
    "expired" to Tone.Neutral, "cancelled" to Tone.Neutral, "lost" to Tone.Danger, "found" to Tone.Info, "possible_match" to Tone.Warning,
    "under_verification" to Tone.Primary, "returned" to Tone.Success, "closed" to Tone.Neutral, "present" to Tone.Success, "absent" to Tone.Danger,
    "registered" to Tone.Success, "waitlisted" to Tone.Warning, "attended" to Tone.Primary,
    "SUBMITTED" to Tone.Warning, "IN_REVIEW" to Tone.Primary, "IN_PROGRESS" to Tone.Info, "RESOLVED" to Tone.Success, "NOT_RESOLVED" to Tone.Danger,
    "ESCALATED" to Tone.Warning, "CANCELLED" to Tone.Neutral, "CLOSED" to Tone.Neutral,
)

fun statusTone(status: String?): Tone = STATUS_TONE[status] ?: Tone.Neutral

@Composable
fun StatusBadge(status: String?, label: String? = null, modifier: Modifier = Modifier) =
    Badge(label ?: status.orEmpty().replace("_", " "), statusTone(status), modifier)

private val AVATAR_GRADS = listOf(Grad.violet, Grad.rose, Grad.sky, Grad.amber, Grad.emerald, Grad.fuchsia)
private fun initials(n: String) = n.split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.first().toString() }.uppercase()

@Composable
fun Avatar(user: JsonElement? = null, name: String? = null, uri: String? = null, size: Dp = 40.dp, online: Boolean = false) {
    val n = name ?: user["name"].str ?: "?"
    val src = ServerConfig.assetUrl(uri ?: user["avatar"].str ?: user["logo"].str)
    val grad = AVATAR_GRADS[((n.firstOrNull()?.code ?: 63) + n.length) % AVATAR_GRADS.size]
    val shape = RoundedCornerShape(size * 0.36f)
    Box(Modifier.size(size)) {
        if (src != null) {
            AsyncImage(model = src, contentDescription = n, contentScale = ContentScale.Crop, modifier = Modifier.size(size).clip(shape).background(C.primarySoft))
        } else {
            Box(Modifier.size(size).clip(shape).background(Brush.linearGradient(grad)), contentAlignment = Alignment.Center) {
                Text(initials(n), color = Color.White, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.34f).sp)
            }
        }
        if (online) {
            Box(
                Modifier.align(Alignment.BottomEnd).offset(1.dp, 1.dp).size(size * 0.3f).clip(CircleShape)
                    .background(C.success).border(2.dp, C.surface, CircleShape).semantics { contentDescription = "online" },
            )
        }
    }
}

/** Rounded gradient tile with an icon (used for quick links and stats). */
@Composable
fun IconTile(icon: ImageVector, gradient: List<Color> = Grad.primary, size: Dp = 44.dp) {
    Box(Modifier.size(size).clip(RoundedCornerShape(size * 0.36f)).background(Brush.linearGradient(gradient)), contentAlignment = Alignment.Center) {
        Icon(icon, null, Modifier.size(size * 0.45f), tint = Color.White)
    }
}

/** Server image (uploads path or full URL). */
@Composable
fun RemoteImage(path: String?, modifier: Modifier, description: String? = null, scale: ContentScale = ContentScale.Crop) {
    AsyncImage(model = ServerConfig.assetUrl(path), contentDescription = description, contentScale = scale, modifier = modifier.background(C.primarySoft))
}

/* ── Feedback states ────────────────────────────────────────────── */

@Composable
fun Loading(label: String? = null) {
    Column(Modifier.fillMaxWidth().padding(vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        CircularProgressIndicator(color = C.primary)
        if (label != null) Small(label)
    }
}

@Composable
fun EmptyState(icon: ImageVector? = null, title: String, text: String? = null, action: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(vertical = 36.dp, horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (icon != null) {
            Box(Modifier.padding(bottom = 4.dp).size(60.dp).clip(RoundedCornerShape(22.dp)).background(C.primarySoft), contentAlignment = Alignment.Center) {
                Icon(icon, null, Modifier.size(26.dp), tint = C.primary)
            }
        }
        H3(title, align = TextAlign.Center)
        if (text != null) Small(text, align = TextAlign.Center)
        if (action != null) Box(Modifier.padding(top = 8.dp)) { action() }
    }
}

@Composable
fun ErrorState(error: Throwable?, onRetry: (() -> Unit)? = null) {
    val e = error as? com.vexon.campus.core.ApiException
    val message = e?.data["message"].str
        ?: if (e?.isNetwork == true) "Cannot reach the JNN server. Check your connection." else "Could not load data"
    Card(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, gap = 10.dp) {
        Strong(message, color = C.roseText, align = TextAlign.Center)
        if (onRetry != null) Button("Try again", onRetry, variant = Variant.Soft, small = true)
    }
}

/** Standard loading / error / content switch for a query. */
@Composable
fun QueryContent(q: com.vexon.campus.core.Query, loading: @Composable () -> Unit = { Loading() }, content: @Composable (JsonElement) -> Unit) {
    val data = q.data
    when {
        data != null -> content(data)
        q.error != null -> ErrorState(q.error) { q.refetch() }
        else -> loading()
    }
}

/* ── Progress ───────────────────────────────────────────────────── */

fun pctColor(v: Double, threshold: Double = 75.0): Color = when {
    v >= threshold -> C.success
    v >= threshold - 10 -> C.warning
    else -> C.danger
}

@Composable
fun PercentRing(value: Double?, size: Dp = 120.dp, stroke: Dp = 11.dp, threshold: Double = 75.0, sub: String? = null) {
    val pct = (value ?: 0.0).coerceIn(0.0, 100.0)
    val color = pctColor(pct, threshold)
    Box(Modifier.size(size).semantics { contentDescription = "${num(pct)} percent" }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val s = stroke.toPx()
            val d = this.size.minDimension - s
            val tl = Offset(s / 2, s / 2)
            val sz = androidx.compose.ui.geometry.Size(d, d)
            drawArc(C.border, 0f, 360f, false, tl, sz, style = Stroke(s))
            drawArc(color, -90f, (pct / 100 * 360).toFloat(), false, tl, sz, style = Stroke(s, cap = StrokeCap.Round))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            H2("${num(pct)}%")
            if (sub != null) Small(sub)
        }
    }
}

@Composable
fun ProgressBar(value: Double?, threshold: Double = 75.0, modifier: Modifier = Modifier) {
    val pct = (value ?: 0.0).coerceIn(0.0, 100.0)
    Box(modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(8.dp)).background(C.primarySoft)) {
        Box(Modifier.fillMaxWidth((pct / 100).toFloat()).fillMaxHeight().clip(RoundedCornerShape(8.dp)).background(pctColor(pct, threshold)))
    }
}

/** Label/value line used on detail screens. */
@Composable
fun InfoRow(label: String, value: String?, valueColor: Color = Color.Unspecified) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Small(label)
        Strong(value?.takeIf { it.isNotBlank() } ?: "—", Modifier.weight(1f), valueColor, TextAlign.End)
    }
}

/** Translucent list row used inside sheets and cards. */
@Composable
fun GlassRow(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.whiteGlass)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** Small circular count bubble (unread counts). */
@Composable
fun CountBubble(n: Int) {
    Box(Modifier.heightIn(min = 20.dp).widthIn(min = 20.dp).clip(CircleShape).background(C.primary).padding(horizontal = 5.dp), contentAlignment = Alignment.Center) {
        Text(if (n > 99) "99+" else "$n", color = Color.White, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 10.sp)
    }
}

/** Keeps content composed (state survives) but neither laid out on screen nor touchable. */
fun Modifier.hiddenIf(hidden: Boolean): Modifier = if (!hidden) this else this.then(
    Modifier.layout { measurable, constraints ->
        measurable.measure(constraints)
        layout(0, 0) {}
    }
)

@Composable
fun Spacer(h: Dp) = androidx.compose.foundation.layout.Spacer(Modifier.height(h))

@Composable
fun BottomInset() = androidx.compose.foundation.layout.Spacer(Modifier.navigationBarsPadding())

val BorderThin get() = BorderStroke(1.dp, C.border)
