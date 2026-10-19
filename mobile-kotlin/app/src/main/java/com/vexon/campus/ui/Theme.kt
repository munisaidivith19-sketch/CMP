package com.vexon.campus.ui

import android.content.Context
import android.content.SharedPreferences
import android.content.res.Configuration
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vexon.campus.R

/** Which look the app uses. System follows the phone's dark-mode setting. */
enum class ThemeMode { System, Light, Dark }

/**
 * The app's light/dark state. Every colour in [C] and every [Type] style reads
 * [dark], and because these are Compose snapshot states, switching repaints
 * the whole app at once. The user's choice is kept in SharedPreferences.
 */
object ThemeState {
    private const val PREFS = "vexon_ui"
    private const val KEY = "theme_mode"
    private var prefs: SharedPreferences? = null

    var mode by mutableStateOf(ThemeMode.System)
        private set

    /** The phone's own dark-mode setting (kept current by [VexonTheme]). */
    var systemDark by mutableStateOf(false)
        internal set

    val dark: Boolean get() = when (mode) {
        ThemeMode.System -> systemDark
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
    }

    fun init(context: Context) {
        val p = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs = p
        mode = runCatching { ThemeMode.valueOf(p.getString(KEY, null) ?: "") }.getOrDefault(ThemeMode.System)
        systemDark = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    }

    fun select(m: ThemeMode) {
        mode = m
        prefs?.edit()?.putString(KEY, m.name)?.apply()
    }

    /**
     * One tap: switch to the opposite of what is on screen now. Landing back on
     * the phone's own setting returns to "System", so the app follows the phone again.
     */
    fun toggle() {
        val wantDark = !dark
        select(if (wantDark == systemDark) ThemeMode.System else if (wantDark) ThemeMode.Dark else ThemeMode.Light)
    }
}

private fun pick(light: Color, dark: Color) = if (ThemeState.dark) dark else light

/**
 * Vexon design tokens (port of src/theme.js). Light: crisp white glass cards
 * with black text. Dark: deep navy cards with white text. Read through
 * getters, so they always match the current [ThemeState].
 */
object C {
    private val darkSurface = Color(0xFF1A2536)

    val bg get() = pick(Color(0xFFEFF5FC), Color(0xFF0B1220))
    val card get() = pick(Color(0xF0FFFFFF), Color(0xF0152033)) // the glass card
    /** Opaque panels: text boxes, menus, dialogs, sheets, other people's chat bubbles. */
    val surface get() = pick(Color.White, darkSurface)
    /** Translucent panel (light: white at [alpha], dark: navy at [alpha]). */
    fun glass(alpha: Float) = pick(Color.White.copy(alpha = alpha), darkSurface.copy(alpha = alpha))
    val border get() = pick(Color(0x241F6FEB), Color(0x3D7EB6F7))
    val divider get() = pick(Color(0x1A1D6FEB), Color(0x267EB6F7))
    /** Main text: black in light mode, white in dark mode. */
    val ink get() = pick(Color.Black, Color.White)
    val soft get() = pick(Color(0xFF3B4658), Color(0xFFCBD5E1))
    val muted get() = pick(Color(0xFF5B6779), Color(0xFF94A3B8))
    val primary50 get() = pick(Color(0xFFEAF3FF), Color(0xFF13243D))
    val primary100 get() = pick(Color(0xFFD2E6FF), Color(0xFF1A3253))
    val primary300 = Color(0xFF7EB6F7)
    val primary400 = Color(0xFF4396EF)
    val primary get() = pick(Color(0xFF1D6FEB), Color(0xFF4D94F5))
    val primary600 get() = pick(Color(0xFF1257C4), Color(0xFF8CC0FA))
    val success = Color(0xFF10B981)
    val successSoft get() = pick(Color(0x1F10B981), Color(0x3310B981))
    val danger get() = pick(Color(0xFFF43F5E), Color(0xFFFB7185))
    val dangerSoft get() = pick(Color(0x1FF43F5E), Color(0x33F43F5E))
    val dangerBorder = Color(0x4DF43F5E)
    val dangerText get() = pick(Color(0xFFBE123C), Color(0xFFFDA4AF))
    val warning = Color(0xFFF59E0B)
    val warningSoft get() = pick(Color(0x26F59E0B), Color(0x33F59E0B))
    val warningText get() = pick(Color(0xFFB45309), Color(0xFFFBBF24))
    val info = Color(0xFF0EA5E9)
    val infoSoft get() = pick(Color(0x1F0EA5E9), Color(0x330EA5E9))
    val neutralSoft get() = pick(Color(0x1F64748B), Color(0x3394A3B8))
    val primarySoft get() = pick(Color(0x1A1D6FEB), Color(0x334D94F5))
    val white = Color.White
    val whiteGlass get() = glass(0.75f)
    val amberText get() = pick(Color(0xFFB45309), Color(0xFFFBBF24))
    val roseText get() = pick(Color(0xFFBE123C), Color(0xFFFB7185))
    val emeraldText get() = pick(Color(0xFF047857), Color(0xFF34D399))
    val skyText get() = pick(Color(0xFF0369A1), Color(0xFF38BDF8))
    val slateText get() = pick(Color(0xFF475569), Color(0xFFCBD5E1))
}

object Grad {
    val primary = listOf(Color(0xFF4396EF), Color(0xFF1D6FEB), Color(0xFF1257C4))
    val hero = listOf(Color(0xFF3E8BF2), Color(0xFF1D6FEB), Color(0xFF0B4F9E))
    val emerald = listOf(Color(0xFF34D399), Color(0xFF14B8A6))
    val rose = listOf(Color(0xFFFB7185), Color(0xFFEC4899))
    val sky = listOf(Color(0xFF38BDF8), Color(0xFF1D6FEB))
    val amber = listOf(Color(0xFFFBBF24), Color(0xFFF97316))
    val violet = listOf(Color(0xFFA78BFA), Color(0xFF6366F1))
    val cyan = listOf(Color(0xFF22D3EE), Color(0xFF0EA5E9))
    val fuchsia = listOf(Color(0xFFE879F9), Color(0xFFA855F7))

    fun linear(colors: List<Color>) = Brush.linearGradient(colors)
}

val Jakarta = FontFamily(
    Font(R.font.jakarta_regular, FontWeight.Normal),
    Font(R.font.jakarta_semibold, FontWeight.SemiBold),
    Font(R.font.jakarta_bold, FontWeight.Bold),
    Font(R.font.jakarta_extrabold, FontWeight.ExtraBold),
)

/** Text variants of `<T v="…">`. */
object Type {
    val h1 get() = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.ExtraBold, fontSize = 26.sp, color = C.ink, letterSpacing = (-0.5).sp)
    val h2 get() = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp, color = C.ink, letterSpacing = (-0.3).sp)
    val h3 get() = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = C.ink)
    val body get() = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Normal, fontSize = 14.sp, color = C.ink, lineHeight = 20.sp)
    val strong get() = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = C.ink)
    val small get() = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = C.soft)
    val label get() = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 11.sp, color = C.soft, letterSpacing = 0.8.sp)
    // Gate codes read aloud at the gate.
    val code get() = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.ExtraBold, fontSize = 40.sp, lineHeight = 52.sp, letterSpacing = 6.sp, color = C.ink)
}

object Radius {
    val sm = 12.dp
    val md = 18.dp
    val lg = 24.dp
    val xl = 28.dp
}

@Composable
fun VexonTheme(content: @Composable () -> Unit) {
    // Follow the phone's dark-mode switch while the user's choice is "System".
    val systemDark = isSystemInDarkTheme()
    SideEffect { ThemeState.systemDark = systemDark }
    val dark = ThemeState.dark
    val scheme = if (dark) {
        darkColorScheme(
            primary = C.primary, onPrimary = Color.White, background = C.bg, onBackground = C.ink,
            surface = C.surface, onSurface = C.ink, surfaceVariant = C.surface, onSurfaceVariant = C.soft, error = C.danger,
        )
    } else {
        lightColorScheme(
            primary = C.primary, onPrimary = Color.White, background = C.bg, onBackground = C.ink,
            surface = Color.White, onSurface = C.ink, error = C.danger,
        )
    }
    MaterialTheme(colorScheme = scheme) {
        // Text without an explicit colour follows the theme too.
        CompositionLocalProvider(LocalContentColor provides C.ink, content = content)
    }
}

// ── Roles & academic constants (same rules as the server) ────────────────

val ROLE_LABELS = mapOf(
    "student" to "Student", "club_admin" to "Club Admin", "faculty" to "Faculty", "hod" to "HOD", "principal" to "Principal",
    "admin" to "Admin", "security" to "Security", "dean" to "Dean", "ao" to "AO", "chairman" to "Chairman", "warden" to "Warden",
    "alumni" to "Alumni", "coe" to "COE", "office" to "Office", "transport" to "Transport",
)
val STUDENT_ROLES = setOf("student", "club_admin")
/** Can mark attendance / act on academic data. */
val STAFF = setOf("admin", "faculty", "hod")
/** College-wide academic visibility (mirrors server COLLEGE_WIDE_ROLES); all but admin read-only. */
val COLLEGE_WIDE = setOf("admin", "principal", "chairman", "dean", "ao")
/** Campus-wide academic READ (class timetable, attendance): the college-wide roles plus the COE. */
val ACADEMIC_OVERSIGHT = COLLEGE_WIDE + "coe" + "office"
/** Read attendance but never mark it (the COE and the Office included). */
val ATTENDANCE_READ_ONLY = setOf("principal", "chairman", "dean", "ao", "coe", "office")
/** Sees today's college (college-wide roles, COE) or department (HOD) attendance summary. */
val SUMMARY_VIEW = setOf("hod") + ACADEMIC_OVERSIGHT
/** May start a group chat; faculty groups wait for admin approval. */
val GROUP_CREATORS = setOf("admin", "hod", "faculty")
val DEPARTMENTS = listOf("CSE (Cyber Security)", "CSE", "AI & DS", "ECE", "VLSI", "Robotics", "Agri", "Bio Medical", "Science & Humanities")
const val FIRST_YEAR_HOD_DEPT = "Science & Humanities"
fun isFirstYearHod(role: String?, department: String?) = role == "hod" && department == FIRST_YEAR_HOD_DEPT
fun isBranchHod(role: String?, department: String?) = role == "hod" && department != FIRST_YEAR_HOD_DEPT
// A class is Department + Year + Section + Semester (same rule as the server).
val SECTIONS = listOf("A", "B", "C", "D", "E", "F", "G", "H", "J")
val ACADEMIC_YEARS = listOf(1, 2, 3, 4)
val YEAR_LABELS = mapOf(1 to "1st Year", 2 to "2nd Year", 3 to "3rd Year", 4 to "4th Year")
fun semestersOfYear(year: Int?): List<Int> = if (year == null || year == 0) emptyList() else listOf(year * 2 - 1, year * 2)

val GATE_PASS_REGARDING = mapOf("outing" to "Outing", "home" to "Home")

// Complaints — labels only (same as the web); routing/escalation rules live on the server.
val COMPLAINT_CATEGORY_LABELS = linkedMapOf(
    "academics" to "Academics",
    "ragging_harassment" to "Ragging & Harassment",
    "infrastructure" to "Infrastructure",
    "hostel" to "Hostel",
)
val COMPLAINT_SUBCATEGORY_OPTIONS: Map<String, List<Pair<String, String>>> = mapOf(
    "academics" to listOf("subject" to "Subject", "faculty_conduct" to "Faculty Conduct", "attendance" to "Attendance", "exam_and_evaluation" to "Exam and Evaluation"),
    "ragging_harassment" to emptyList(),
    "infrastructure" to listOf(
        "classroom" to "Classroom", "network" to "Network", "water" to "Water", "restroom" to "Restroom",
        "electronic_appliance" to "Electronic Appliance", "environment_and_pathway" to "Environment & Pathway",
    ),
    "hostel" to listOf(
        "mess" to "Mess", "electricity" to "Electricity", "water" to "Water", "housekeeping" to "Housekeeping",
        "pest_control" to "Pest Control", "laundry" to "Laundry", "network" to "Network", "restroom" to "Restroom",
    ),
)
val COMPLAINT_ESCALATE_TO_OPTIONS = mapOf(
    "academics" to listOf("faculty", "hod", "principal", "dean", "ao", "chairman"),
    "ragging_harassment" to listOf("hod", "principal", "dean", "ao", "chairman"),
    "infrastructure" to listOf("hod", "principal", "dean", "ao", "chairman"),
    "hostel" to listOf("warden", "ao", "chairman"),
)
val COMPLAINT_STATUSES = listOf("SUBMITTED", "IN_REVIEW", "IN_PROGRESS", "RESOLVED", "NOT_RESOLVED", "ESCALATED", "CANCELLED", "CLOSED")
val INDIAN_STATES = listOf(
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
    "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
    "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
    "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
)
