package com.vexon.campus.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vexon.campus.R

/**
 * Vexon design tokens (port of src/theme.js) — a "classic" light glass look
 * (sky-blue, airline-style): crisp white cards with just enough translucency to
 * read as glass, high-contrast navy text, no dark backgrounds.
 */
object C {
    val bg = Color(0xFFEFF5FC)
    val card = Color(0xF0FFFFFF) // rgba(255,255,255,0.94) — Android variant of the glass card
    val border = Color(0x241F6FEB) // rgba(31,111,235,0.14)
    val ink = Color(0xFF101B2D)
    val soft = Color(0xFF48566C)
    val muted = Color(0xFF8592A6)
    val primary50 = Color(0xFFEAF3FF)
    val primary100 = Color(0xFFD2E6FF)
    val primary300 = Color(0xFF7EB6F7)
    val primary400 = Color(0xFF4396EF)
    val primary = Color(0xFF1D6FEB)
    val primary600 = Color(0xFF1257C4)
    val success = Color(0xFF10B981)
    val successSoft = Color(0x1F10B981)
    val danger = Color(0xFFF43F5E)
    val dangerSoft = Color(0x1FF43F5E)
    val warning = Color(0xFFF59E0B)
    val warningSoft = Color(0x26F59E0B)
    val info = Color(0xFF0EA5E9)
    val infoSoft = Color(0x1F0EA5E9)
    val neutralSoft = Color(0x1F64748B)
    val primarySoft = Color(0x1A1D6FEB)
    val white = Color.White
    val whiteGlass = Color(0xBFFFFFFF) // rgba(255,255,255,0.75)
    val amberText = Color(0xFFB45309)
    val roseText = Color(0xFFE11D48)
    val emeraldText = Color(0xFF059669)
    val skyText = Color(0xFF0284C7)
    val slateText = Color(0xFF475569)
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
    val h1 = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.ExtraBold, fontSize = 26.sp, color = C.ink, letterSpacing = (-0.5).sp)
    val h2 = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.ExtraBold, fontSize = 20.sp, color = C.ink, letterSpacing = (-0.3).sp)
    val h3 = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = C.ink)
    val body = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Normal, fontSize = 14.sp, color = C.ink, lineHeight = 20.sp)
    val strong = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = C.ink)
    val small = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = C.soft)
    val label = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 11.sp, color = C.soft, letterSpacing = 0.8.sp)
    // Gate codes read aloud at the gate.
    val code = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.ExtraBold, fontSize = 40.sp, lineHeight = 52.sp, letterSpacing = 6.sp, color = C.ink)
}

object Radius {
    val sm = 12.dp
    val md = 18.dp
    val lg = 24.dp
    val xl = 28.dp
}

@Composable
fun VexonTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = C.primary,
            onPrimary = Color.White,
            background = C.bg,
            surface = Color.White,
            onSurface = C.ink,
            onBackground = C.ink,
            error = C.danger,
        ),
        content = content,
    )
}

// ── Roles & academic constants (same rules as the server) ────────────────

val ROLE_LABELS = mapOf(
    "student" to "Student", "club_admin" to "Club Admin", "faculty" to "Faculty", "hod" to "HOD", "principal" to "Principal",
    "admin" to "Admin", "security" to "Security", "dean" to "Dean", "ao" to "AO", "chairman" to "Chairman", "warden" to "Warden",
    "alumni" to "Alumni",
)
val STUDENT_ROLES = setOf("student", "club_admin")
/** Can mark attendance / act on academic data. */
val STAFF = setOf("admin", "faculty", "hod")
/** College-wide academic visibility (mirrors server COLLEGE_WIDE_ROLES); all but admin read-only. */
val COLLEGE_WIDE = setOf("admin", "principal", "chairman", "dean", "ao")
/** Read attendance but never mark it. */
val ATTENDANCE_READ_ONLY = setOf("principal", "chairman", "dean", "ao")
/** Sees today's college (college-wide roles) or department (HOD) attendance summary. */
val SUMMARY_VIEW = setOf("hod") + COLLEGE_WIDE
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
