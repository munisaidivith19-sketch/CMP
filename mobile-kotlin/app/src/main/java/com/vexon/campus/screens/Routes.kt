package com.vexon.campus.screens

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DesktopWindows
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.vexon.campus.nav.Nav
import com.vexon.campus.nav.Route
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.Screen

/**
 * The route table — the expo-router `src/app` tree as a `when`. Every route here
 * is a screen of the RN app; anything else (e.g. a staff-only web page linked
 * from a notification) lands on [NotFoundScreen].
 */
@Composable
fun RouteContent(route: Route) {
    val s = route.segments
    when {
        route.path == "/" -> TabsScreen()
        route.path == "/login" -> LoginScreen()
        route.path == "/forgot-password" -> ForgotPasswordScreen()

        route.path == "/announcements" -> AnnouncementsScreen()
        route.path == "/clubs" -> ClubsScreen()
        s.size == 2 && s[0] == "clubs" -> ClubDetailScreen(s[1])
        route.path == "/events" -> EventsScreen()
        s.size == 2 && s[0] == "events" -> EventDetailScreen(s[1])
        route.path == "/discussions" -> DiscussionsScreen()
        route.path == "/discussions/new" -> NewDiscussionScreen()
        s.size == 2 && s[0] == "discussions" -> DiscussionDetailScreen(s[1])
        s.size == 2 && s[0] == "people" -> PersonScreen(s[1])
        route.path == "/search" -> SearchScreen()
        route.path == "/calendar" -> CalendarScreen()
        route.path == "/study-materials" -> StudyMaterialsScreen()
        route.path == "/settings/security" -> SecuritySettingsScreen()
        route.path == "/settings/notifications" -> NotificationSettingsScreen()
        route.path == "/admin/create-user" -> CreateUserScreen()
        route.path == "/admin/chat-requests" -> ChatRequestsScreen()
        route.path == "/lost-found" -> LostFoundScreen()
        route.path == "/lost-found/new" -> ReportItemScreen()
        s.size == 2 && s[0] == "lost-found" -> LostFoundItemScreen(s[1])
        route.path == "/chat/new" -> NewChatScreen()
        s.size == 2 && s[0] == "chat" -> ThreadScreen(s[1])
        route.path == "/timetable" -> TimetableScreen()
        // Notification links for OD / Leave point at the web's Attendance tab.
        route.path == "/attendance" && route.q("tab") == "od-leave" -> OdLeaveScreen()
        route.path == "/attendance" -> AttendanceScreen(route)
        route.path == "/od-leave" -> OdLeaveScreen()
        route.path == "/hostel" -> HostelScreen()
        route.path == "/class/students" -> ClassStudentsScreen()
        route.path == "/sos" -> SosScreen()
        route.path == "/attendance/corrections" -> AttendanceScreen(Route("/attendance?tab=corrections"))
        route.path == "/gate-pass" -> GatePassScreen()
        route.path == "/gate-pass/new" -> NewGatePassScreen()
        route.path == "/gate-pass/in" -> GateVerifyScreen("in")
        route.path == "/gate-pass/out" -> GateVerifyScreen("out")
        route.path == "/gate-pass/mass" -> MassOutpassScreen()
        s.size == 3 && s[0] == "gate-pass" && s[1] == "students" -> GateStudentsScreen(s[2])
        s.size == 2 && s[0] == "gate-pass" -> GatePassDetailScreen(s[1])
        route.path == "/complaints" -> ComplaintsScreen()
        route.path == "/complaints/new" -> RegisterComplaintScreen()
        s.size == 2 && s[0] == "complaints" -> ComplaintDetailScreen(s[1])

        route.path == "/achievements" -> AchievementsScreen(route)
        route.path == "/achievements/new" -> AchievementFormScreen(null)
        s.size == 3 && s[0] == "achievements" && s[2] == "edit" -> AchievementFormScreen(s[1])
        s.size == 2 && s[0] == "achievements" -> AchievementDetailScreen(s[1])
        route.path == "/holidays" -> HolidaysScreen()
        route.path == "/exams" -> ExamTimetableScreen()
        route.path == "/transport" -> BusTrackingScreen(route)
        route.path == "/transport/history" -> TransportHistoryScreen()
        s.size == 3 && s[0] == "transport" && s[1] == "history" -> TransportHistoryTripScreen(s[2])
        route.path == "/people" -> PeopleScreen()

        route.path == "/skill-wallet" -> SkillWalletScreen(route)
        route.path == "/skill-wallet/new" -> NewSwProjectScreen()
        s.size == 3 && s[0] == "skill-wallet" && s[1] == "projects" -> SwProjectScreen(s[2])

        route.path == "/alumni" -> AlumniScreen(route)
        route.path == "/alumni/jobs/new" -> PostJobScreen()
        route.path == "/alumni/events/new" -> HostAlumniEventScreen()
        route.path == "/alumni/sessions" -> MentorshipSessionsScreen()
        route.path == "/alumni/sessions/book" -> BookSessionScreen(route)
        route.path == "/alumni/admin/analytics" -> AlumniAnalyticsScreen()
        route.path == "/alumni/admin/verification" -> AlumniVerificationScreen()
        s.size == 3 && s[0] == "alumni" && s[1] == "jobs" -> AlumniJobDetailScreen(s[2])
        s.size == 3 && s[0] == "alumni" && s[1] == "events" -> AlumniEventDetailScreen(s[2])
        s.size == 3 && s[0] == "alumni" && s[1] == "chapters" -> ChapterWallScreen(s[2])
        s.size == 2 && s[0] == "alumni" -> AlumniProfileScreen(s[1])

        else -> NotFoundScreen()
    }
}

/** Links to staff-only web pages (e.g. from a notification) land here. */
@Composable
fun NotFoundScreen() {
    Screen {
        Card(Modifier.padding(top = 60.dp)) {
            EmptyState(
                Icons.Rounded.DesktopWindows, "Open this on the web",
                "This page is part of the JNN web console and isn’t available in the Android app.",
                action = { Button("Go home", { Nav.replace("/") }) },
            )
        }
    }
}
