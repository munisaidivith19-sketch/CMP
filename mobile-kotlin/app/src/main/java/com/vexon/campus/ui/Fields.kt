package com.vexon.campus.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.EventBusy
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.get
import com.vexon.campus.core.str
import kotlinx.serialization.json.JsonElement
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime

/* ── Global dialogs (Alert.alert replacement) ─────────────────────── */

data class DialogButton(val text: String, val destructive: Boolean = false, val cancel: Boolean = false, val onClick: () -> Unit = {})

/** Prompt dialog: a text field, OK runs [onSubmit] with its value. */
data class PromptSpec(val title: String, val message: String?, val placeholder: String?, val confirm: String, val required: Boolean, val onSubmit: (String) -> Unit)

object Dialogs {
    data class Spec(val title: String, val message: String?, val buttons: List<DialogButton>)

    val queue = mutableStateListOf<Spec>()
    val prompts = mutableStateListOf<PromptSpec>()

    fun alert(title: String, message: String? = null, buttons: List<DialogButton> = listOf(DialogButton("OK"))) {
        queue += Spec(title, message, buttons)
    }

    /** Two-button confirmation (Cancel + action). */
    fun confirm(title: String, message: String? = null, action: String = "OK", destructive: Boolean = false, onConfirm: () -> Unit) =
        alert(title, message, listOf(DialogButton("Cancel", cancel = true), DialogButton(action, destructive, onClick = onConfirm)))

    fun prompt(title: String, message: String? = null, placeholder: String? = null, confirm: String = "Submit", required: Boolean = false, onSubmit: (String) -> Unit) {
        prompts += PromptSpec(title, message, placeholder, confirm, required, onSubmit)
    }
}

@Composable
fun DialogHost() {
    Dialogs.queue.firstOrNull()?.let { spec ->
        val dismiss = { Dialogs.queue.remove(spec) }
        AlertDialog(
            onDismissRequest = { dismiss() },
            title = { Text(spec.title, fontFamily = Jakarta, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp, color = C.ink) },
            text = spec.message?.let { { Text(it, fontFamily = Jakarta, fontSize = 14.sp, color = C.soft) } },
            confirmButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    spec.buttons.forEach { b ->
                        TextButton(onClick = { dismiss(); b.onClick() }) {
                            Text(b.text, fontFamily = Jakarta, fontWeight = FontWeight.Bold, color = when {
                                b.destructive -> C.danger
                                b.cancel -> C.soft
                                else -> C.primary
                            })
                        }
                    }
                }
            },
            containerColor = Color.White,
        )
    }
    Dialogs.prompts.firstOrNull()?.let { spec ->
        var value by remember(spec) { mutableStateOf("") }
        val dismiss = { Dialogs.prompts.remove(spec) }
        AlertDialog(
            onDismissRequest = { dismiss() },
            title = { Text(spec.title, fontFamily = Jakarta, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp, color = C.ink) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    spec.message?.let { Small(it) }
                    Input(value, { value = it }, placeholder = spec.placeholder, multiline = true, minLines = 2)
                }
            },
            dismissButton = { TextButton(onClick = { dismiss() }) { Text("Cancel", fontFamily = Jakarta, color = C.soft) } },
            confirmButton = {
                TextButton(enabled = !spec.required || value.isNotBlank(), onClick = { dismiss(); spec.onSubmit(value.trim()) }) {
                    Text(spec.confirm, fontFamily = Jakarta, fontWeight = FontWeight.Bold, color = C.primary)
                }
            },
            containerColor = Color.White,
        )
    }
}

/* ── Pickers ────────────────────────────────────────────────────── */

@Composable
private fun FieldBox(label: String?, error: String?, onClick: () -> Unit, content: @Composable RowScope.() -> Unit) {
    Column {
        if (label != null) Label(label, Modifier.padding(bottom = 6.dp))
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(C.whiteGlass)
                .border(1.dp, if (error != null) C.danger else Color(0xD9FFFFFF), RoundedCornerShape(18.dp))
                .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 13.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) { content() }
        if (error != null) Small(error, Modifier.padding(top = 4.dp), C.danger)
    }
}

private fun LocalDate.utcMillis() = atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
private fun Long.utcDate(): LocalDate = Instant.ofEpochMilli(this).atZone(ZoneOffset.UTC).toLocalDate()

private fun bounds(min: LocalDate?, max: LocalDate?) = object : SelectableDates {
    override fun isSelectableDate(utcTimeMillis: Long): Boolean {
        val d = utcTimeMillis.utcDate()
        return (min == null || !d.isBefore(min)) && (max == null || !d.isAfter(max))
    }
}

@Composable
private fun DateDialog(initial: LocalDate, min: LocalDate?, max: LocalDate?, onDismiss: () -> Unit, onPick: (LocalDate) -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = initial.utcMillis(), selectableDates = bounds(min, max))
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = { state.selectedDateMillis?.let { onPick(it.utcDate()) } ?: onDismiss() }) { Text("OK") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    ) { DatePicker(state) }
}

/** Tap to pick a calendar date — no time component (gate pass from/to dates). */
@Composable
fun DateField(label: String?, value: LocalDate?, onChange: (LocalDate) -> Unit, min: LocalDate? = null, max: LocalDate? = null, error: String? = null) {
    var open by remember { mutableStateOf(false) }
    FieldBox(label, error, { open = true }) {
        Icon(Icons.Rounded.CalendarMonth, null, Modifier.size(16.dp), tint = C.primary)
        if (value != null) T(Fmt.format(value, "EEEE, dd MMM yyyy"), Type.body.copy(fontWeight = FontWeight.SemiBold))
        else T("Select a date", Type.body.copy(fontWeight = FontWeight.SemiBold), color = C.muted)
    }
    if (open) DateDialog(value ?: max ?: LocalDate.now(), min, max, { open = false }) { open = false; onChange(it) }
}

/** Tap to pick a date, then a time (two dialogs, like the Android native pickers). */
@Composable
fun DateTimeField(label: String?, value: ZonedDateTime, onChange: (ZonedDateTime) -> Unit, min: ZonedDateTime? = null, max: ZonedDateTime? = null, error: String? = null) {
    var mode by remember { mutableStateOf<String?>(null) }
    FieldBox(label, error, { mode = "date" }) {
        Icon(Icons.Rounded.CalendarMonth, null, Modifier.size(16.dp), tint = C.primary)
        T(Fmt.dateTime(value), Type.body.copy(fontWeight = FontWeight.SemiBold))
    }
    when (mode) {
        "date" -> DateDialog(value.toLocalDate(), min?.toLocalDate(), max?.toLocalDate(), { mode = null }) { d ->
            onChange(value.with(d))
            mode = "time"
        }
        "time" -> {
            val state = rememberTimePickerState(value.hour, value.minute, false)
            AlertDialog(
                onDismissRequest = { mode = null },
                confirmButton = {
                    TextButton(onClick = {
                        onChange(value.with(LocalTime.of(state.hour, state.minute)).withSecond(0).withNano(0))
                        mode = null
                    }) { Text("OK") }
                },
                dismissButton = { TextButton(onClick = { mode = null }) { Text("Cancel") } },
                text = { TimePicker(state) },
            )
        }
    }
}

/** Tap to open a searchable full-screen list and pick one option (state dropdown). */
@Composable
fun PickerField(label: String?, value: String?, onChange: (String) -> Unit, options: List<String>, placeholder: String = "Select…", error: String? = null) {
    var open by remember { mutableStateOf(false) }
    var q by remember { mutableStateOf("") }
    FieldBox(label, error, { open = true }) {
        T(value?.takeIf { it.isNotEmpty() } ?: placeholder, Type.body.copy(fontWeight = FontWeight.SemiBold), Modifier.weight(1f), if (value.isNullOrEmpty()) C.muted else C.ink)
        Icon(Icons.Rounded.KeyboardArrowDown, null, Modifier.size(16.dp), tint = C.muted)
    }
    if (open) {
        Dialog(onDismissRequest = { open = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Column(Modifier.fillMaxSize().background(C.bg).statusBarsPadding().navigationBarsPadding().padding(16.dp)) {
                H2(label ?: "Choose one", Modifier.padding(bottom = 12.dp))
                Input(q, { q = it }, placeholder = "Search")
                LazyColumn(Modifier.weight(1f).padding(vertical = 12.dp)) {
                    items(options.filter { it.contains(q, ignoreCase = true) }) { item ->
                        Box(Modifier.fillMaxWidth().clickable { onChange(item); open = false; q = "" }.padding(vertical = 14.dp)) {
                            T(item, if (item == value) Type.body.copy(fontWeight = FontWeight.Bold, color = C.primary) else Type.body)
                        }
                        HorizontalDivider(color = Color(0x1A1D6FEB))
                    }
                }
                Box(Modifier.fillMaxWidth().clickable { open = false }.padding(vertical = 14.dp), contentAlignment = Alignment.Center) { Strong("Close", color = C.primary) }
            }
        }
    }
}

/** Compact dropdown select (the web's <Select>). */
@Composable
fun <V> SelectField(label: String?, value: V?, options: List<Opt<V>>, onChange: (V) -> Unit, placeholder: String = "Select…", error: String? = null, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        FieldBox(label, error, { open = true }) {
            val current = options.firstOrNull { it.value == value }?.label
            T(current ?: placeholder, Type.body.copy(fontWeight = FontWeight.SemiBold), Modifier.weight(1f), if (current == null) C.muted else C.ink, maxLines = 1)
            Icon(Icons.Rounded.KeyboardArrowDown, null, Modifier.size(16.dp), tint = C.muted)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Color.White) {
            options.forEach { o ->
                DropdownMenuItem(text = { T(o.label, if (o.value == value) Type.strong.copy(color = C.primary) else Type.body) }, onClick = { open = false; onChange(o.value) })
            }
        }
    }
}

/* ── Bottom sheet ───────────────────────────────────────────────── */

/** Card that slides up from the bottom (the RN `Modal` sheets). */
@Composable
fun Sheet(title: String?, onClose: () -> Unit, footer: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = C.bg,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(bottom = 18.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (title != null) H3(title)
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
            footer?.invoke()
        }
    }
}

/* ── Holidays ───────────────────────────────────────────────────── */

// Display helpers only: which holidays apply to whom is decided by the server.

/** Holidays whose range (YYYY-MM-DD strings, inclusive) covers [key]. */
fun holidaysOn(holidays: List<JsonElement>, key: String): List<JsonElement> =
    holidays.filter { (it["startDate"].str ?: "") <= key && (it["endDate"].str ?: "") >= key }

fun fmtHolidayDates(h: JsonElement): String {
    val s = h["startDate"].str
    val e = h["endDate"].str
    return if (s == e) Fmt.classDay(s) else "${Fmt.classDay(s)} – ${Fmt.classDay(e)}"
}

/** HOLIDAY · reason · scope — shown wherever a class or date is on holiday. */
@Composable
fun HolidayCard(holiday: JsonElement?, text: String? = "Attendance cannot be taken for this class on this date.") {
    if (holiday == null) return
    RowCard(Modifier.fillMaxWidth(), background = C.dangerSoft, border = Color(0x4DF43F5E), gap = 10.dp, verticalAlignment = Alignment.Top) {
        Icon(Icons.Rounded.EventBusy, null, Modifier.size(20.dp), tint = C.danger)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Label("HOLIDAY", color = Color(0xFFBE123C))
            Strong(holiday["reason"].str)
            Small("${holiday["scope"].str ?: ""} · ${fmtHolidayDates(holiday)}")
            if (text != null) Small(text)
        }
    }
}

/* ── Markdown (Study Assistant answers) ─────────────────────────── */

private val base = TextStyle(fontFamily = Jakarta, fontSize = 14.sp, lineHeight = 21.sp, color = C.ink)
private val INLINE = Regex("(`[^`\\n]+`)|(\\*\\*[^*\\n]+\\*\\*)|(\\*[^*\\n]+\\*)|(\\[([^\\]\\n]+)\\]\\((https?://[^)\\s]+)\\))|(\\[S\\d+\\])")

private fun AnnotatedString.Builder.inline(text: String) {
    var last = 0
    for (m in INLINE.findAll(text)) {
        if (m.range.first > last) append(text.substring(last, m.range.first))
        val g = m.groupValues
        when {
            g[1].isNotEmpty() -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = C.primarySoft, color = C.primary600)) { append(g[1].drop(1).dropLast(1)) }
            g[2].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { inline(g[2].drop(2).dropLast(2)) }
            g[3].isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(g[3].drop(1).dropLast(1)) }
            g[4].isNotEmpty() -> {
                pushStringAnnotation("URL", g[6])
                withStyle(SpanStyle(color = C.primary, textDecoration = TextDecoration.Underline)) { append(g[5]) }
                pop()
            }
            g[7].isNotEmpty() -> withStyle(SpanStyle(fontSize = 10.sp, fontWeight = FontWeight.Bold, color = C.primary)) { append(" " + g[7].drop(1).dropLast(1)) }
        }
        last = m.range.last + 1
    }
    if (last < text.length) append(text.substring(last))
}

@Composable
private fun InlineText(text: String, style: TextStyle = base, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val annotated = remember(text) { buildAnnotatedString { inline(text) } }
    @Suppress("DEPRECATION")
    ClickableText(annotated, modifier, style) { offset ->
        annotated.getStringAnnotations("URL", offset, offset).firstOrNull()?.let {
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it.item))) }
        }
    }
}

/**
 * Lightweight Markdown: headings, bullet/numbered lists, fenced code, **bold**,
 * *italic*, `code`, http(s) links and [S1] citation tags. Plain text only —
 * nothing is ever evaluated as markup.
 */
@Composable
fun MarkdownText(text: String?) {
    val lines = (text ?: "").replace("\r\n", "\n").split("\n")
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            if (Regex("^\\s*```").containsMatchIn(line)) {
                val body = mutableListOf<String>()
                i++
                while (i < lines.size && !Regex("^\\s*```").containsMatchIn(lines[i])) body += lines[i++]
                i++
                Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(C.ink).padding(10.dp)) {
                    Text(body.joinToString("\n"), fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 18.sp, color = Color(0xFFE2E8F0))
                }
                continue
            }
            if (line.isBlank()) { i++; continue }
            val h = Regex("^#{1,4}\\s+(.*)$").find(line)
            if (h != null) {
                InlineText(h.groupValues[1], base.copy(fontWeight = FontWeight.ExtraBold, fontSize = 15.sp))
                i++; continue
            }
            val li = Regex("^\\s*([-*•]|\\d+[.)])\\s+(.*)$").find(line)
            if (li != null) {
                val bullet = if (li.groupValues[1].any { it.isDigit() }) li.groupValues[1] else "•"
                val indent = minOf(line.length - line.trimStart().length, 6) * 4
                Row(Modifier.padding(start = indent.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(bullet, style = base.copy(color = C.primary, fontWeight = FontWeight.Bold))
                    InlineText(li.groupValues[2], modifier = Modifier.weight(1f))
                }
                i++; continue
            }
            // Table separator rows and horizontal rules are dropped.
            if (Regex("^[\\s|:*-]+$").matches(line) && line.contains('-')) { i++; continue }
            InlineText(line.replace(Regex("^\\s*>\\s?"), ""))
            i++
        }
    }
}

/** Helper for "now" rounded the way the RN forms did (seconds/ms cleared). */
fun nowMinute(): ZonedDateTime = ZonedDateTime.now(ZoneId.systemDefault()).withSecond(0).withNano(0)

fun LocalDateTime.zoned(): ZonedDateTime = atZone(ZoneId.systemDefault())

@Composable
fun VSpace() = Box(Modifier.width(0.dp).heightIn(min = 0.dp))
