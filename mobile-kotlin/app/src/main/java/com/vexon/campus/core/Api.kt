package com.vexon.campus.core

import android.net.Uri
import androidx.compose.runtime.Composable
import kotlinx.serialization.json.JsonElement

/**
 * Every backend endpoint the app uses — a 1:1 port of src/services/api.js. The
 * mobile app talks to the SAME API as the web app; every rule (roles, scope,
 * ownership) is enforced by the server.
 *
 * Reads are composables returning a cached [Query] (`Api.dashboard()`), writes
 * are suspend functions that invalidate the same tags the RTK Query version did.
 */
typealias Params = Map<String, Any?>

private fun keyOf(path: String, params: Params?): String =
    if (params.isNullOrEmpty()) path else path + "?" + params.toSortedMap().entries.filter { it.value != null && it.value !== Omit }.joinToString("&") { "${it.key}=${it.value}" }

@Composable
private fun get(
    path: String,
    vararg tags: String,
    params: Params? = null,
    skip: Boolean = false,
    pollMs: Long = 0,
    keep: Boolean = true,
): Query = rememberQuery(keyOf(path, params), tags.toSet(), skip, pollMs, keep) { Http.request("GET", path, params) }

private suspend fun send(method: String, path: String, body: Any? = null, vararg invalidates: String, timeoutMs: Long = 20_000): JsonElement {
    val res = Http.request(method, path, body = body, timeoutMs = timeoutMs)
    if (invalidates.isNotEmpty()) QueryClient.invalidate(*invalidates)
    return res
}

private suspend fun post(path: String, body: Any? = null, vararg tags: String) = send("POST", path, body, *tags)
private suspend fun put(path: String, body: Any? = null, vararg tags: String) = send("PUT", path, body, *tags)
private suspend fun patch(path: String, body: Any? = null, vararg tags: String) = send("PATCH", path, body, *tags)
private suspend fun delete(path: String, body: Any? = null, vararg tags: String) = send("DELETE", path, body, *tags)

object Api {
    // ── Auth / account ────────────────────────────────
    suspend fun login(email: String, password: String) = post("/auth/login", jsonOf("email" to email, "password" to password))
    suspend fun changePassword(body: JsonElement) = post("/auth/change-password", body, "Session")
    @Composable fun me() = get("/auth/me", "Me")
    @Composable fun sessions() = get("/auth/sessions", "Session")
    suspend fun revokeSession(id: String) = delete("/auth/sessions/$id", null, "Session")
    suspend fun revokeOtherSessions() = post("/auth/sessions/revoke-others", null, "Session")
    @Composable fun loginHistory(params: Params? = null) = get("/auth/login-history", "Session", params = params)
    suspend fun registerPushToken(token: String) = post("/auth/push-token", jsonOf("token" to token))
    suspend fun updateMe(body: JsonElement) = put("/users/me", body, "Me", "User")

    // ── Study materials + JNN Study Assistant ──
    @Composable fun studyMaterials(params: Params? = null) = get("/study-materials", "StudyMaterial", params = params)
    // Faculty upload only for the classes they currently teach; HODs inside their department (server-enforced).
    @Composable fun myTeachingAssignments(skip: Boolean = false) = get("/study-materials/my-assignments", "StudyMaterial", "Timetable", skip = skip)
    suspend fun uploadStudyMaterial(body: JsonElement) = post("/study-materials", body, "StudyMaterial")
    suspend fun deleteStudyMaterial(id: String) = delete("/study-materials/$id", null, "StudyMaterial")
    // Web research can take a while — allow longer than the default 20s.
    suspend fun askStudyAssistant(body: JsonElement) = send("POST", "/ai/study-assistant/chat", body, timeoutMs = 90_000)
    suspend fun assistantConversation(id: String) = Http.request("GET", "/ai/study-assistant/conversations/$id")
    suspend fun deleteAssistantConversation(id: String) = delete("/ai/study-assistant/conversations/$id")

    // ── Dashboard / search / uploads ──────────────────
    @Composable fun dashboard() = get("/dashboard", "Dashboard")
    @Composable fun search(q: String, skip: Boolean = false) = get("/search", params = mapOf("q" to q), skip = skip)
    suspend fun uploadImage(uri: Uri) = Http.request("POST", "/uploads", params = mapOf("kind" to "image"), body = Http.imagePart(uri), timeoutMs = 60_000)
    // A document: image, PDF, DOC/DOCX or TXT — the server checks the real type from the file's bytes.
    suspend fun uploadDocument(uri: Uri) = Http.request("POST", "/uploads", params = mapOf("kind" to "document"), body = Http.imagePart(uri), timeoutMs = 90_000)
    suspend fun uploadAvatar(uri: Uri): JsonElement {
        val res = Http.request("PUT", "/users/me/avatar", body = Http.imagePart(uri), timeoutMs = 60_000)
        QueryClient.invalidate("Me", "User")
        return res
    }
    @Composable fun users(params: Params? = null, skip: Boolean = false) = get("/users", "User", params = params, skip = skip)
    @Composable fun user(id: String) = get("/users/$id", "User")

    // ── Announcements / events / clubs / discussions ──
    @Composable fun announcements(params: Params? = null) = get("/announcements", "Announcement", params = params)
    @Composable fun events(params: Params? = null) = get("/events", "Event", params = params)
    @Composable fun event(id: String) = get("/events/$id", "Event")
    suspend fun registerEvent(id: String) = post("/events/$id/register", null, "Event", "Dashboard")
    suspend fun cancelRegistration(id: String) = delete("/events/$id/register", null, "Event", "Dashboard")
    // Participants (organiser / coordinators / staff — server-decided) and per-day attendance (coordinators / hosting HOD).
    @Composable fun eventParticipants(id: String, skip: Boolean = false) = get("/events/$id/participants", "Event", skip = skip)
    suspend fun markEventAttendance(id: String, userId: String, attended: Boolean, date: String) =
        patch("/events/$id/attendance/$userId", jsonOf("attended" to attended, "date" to date), "Event", "Attendance")
    @Composable fun clubs(params: Params? = null) = get("/clubs", "Club", params = params)
    @Composable fun club(id: String) = get("/clubs/$id", "Club")
    suspend fun joinClub(id: String, message: String?) = post("/clubs/$id/join", jsonOf("message" to (message ?: Omit)), "Club")
    suspend fun cancelJoin(id: String) = delete("/clubs/$id/join", null, "Club")
    suspend fun leaveClub(id: String) = post("/clubs/$id/leave", null, "Club", "Dashboard", "Me")
    @Composable fun discussions(params: Params? = null) = get("/discussions", "Discussion", params = params)
    @Composable fun discussion(id: String) = get("/discussions/$id", "Discussion")
    suspend fun createDiscussion(body: JsonElement) = post("/discussions", body, "Discussion")
    suspend fun addReply(id: String, body: String) = post("/discussions/$id/replies", jsonOf("body" to body), "Discussion")
    suspend fun upvoteDiscussion(id: String) = post("/discussions/$id/upvote", null, "Discussion")

    // Posting: the Principal (whole campus or any class) and HODs (own scope); the API re-checks every audience.
    suspend fun createAnnouncement(body: JsonElement) = post("/announcements", body, "Announcement", "Dashboard")
    suspend fun deleteAnnouncement(id: String) = delete("/announcements/$id", null, "Announcement", "Dashboard")
    suspend fun togglePinAnnouncement(id: String) = patch("/announcements/$id/pin", null, "Announcement", "Dashboard")

    // ── Notifications ─────────────────────────────────
    @Composable fun notifications(params: Params? = null) = get("/notifications", "Notification", params = params)
    suspend fun markNotificationRead(id: String) = patch("/notifications/$id/read", null, "Notification")
    // ── College buses ──
    @Composable fun transportConfig(skip: Boolean = false) = get("/transport/config", "Transport", skip = skip)
    @Composable fun buses(skip: Boolean = false, pollMs: Long = 0) = get("/transport/buses", "Transport", skip = skip, pollMs = pollMs)
    @Composable fun bus(id: String, stopId: String?, skip: Boolean = false, pollMs: Long = 0) =
        get("/transport/buses/$id", "Transport", params = mapOf("stopId" to stopId), skip = skip, pollMs = pollMs)
    @Composable fun transportSearch(q: String, skip: Boolean = false) = get("/transport/search", "TransportSearch", params = mapOf("q" to q), skip = skip)
    @Composable fun transportMe(skip: Boolean = false) = get("/transport/me", "Transport", skip = skip)
    suspend fun startBusTrip(busId: String) = post("/transport/trips", jsonOf("busId" to busId), "Transport")
    suspend fun stopBusTrip(tripId: String) = post("/transport/trips/$tripId/stop", jsonOf("reason" to "completed"), "Transport")
    // FCM device registration (bound by the server to this account and session) and notification preferences.
    suspend fun registerDevice(token: String) = post("/devices", jsonOf("token" to token, "deviceName" to "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".take(80), "appVersion" to com.vexon.campus.BuildConfig.VERSION_NAME))
    @Composable fun notificationPrefs(skip: Boolean = false) = get("/notifications/preferences", "NotificationPrefs", skip = skip)
    suspend fun updateNotificationPrefs(body: JsonElement) = put("/notifications/preferences", body, "NotificationPrefs")
    suspend fun markAllNotificationsRead() = patch("/notifications/read-all", null, "Notification")

    // ── Chat ──────────────────────────────────────────
    @Composable fun conversations(params: Params? = null) = get("/chat/conversations", "Chat", params = params)
    @Composable fun conversation(id: String) = get("/chat/conversations/$id", "Chat")
    @Composable fun chatUnread(skip: Boolean = false) = get("/chat/unread", "Chat", skip = skip)
    suspend fun createConversation(body: JsonElement) = post("/chat/conversations", body, "Chat")
    suspend fun messages(id: String, params: Params? = null) = Http.request("GET", "/chat/conversations/$id/messages", params)
    suspend fun sendMessage(id: String, body: JsonElement) = post("/chat/conversations/$id/messages", body)
    suspend fun deleteMessage(id: String, msgId: String) = delete("/chat/conversations/$id/messages/$msgId")
    @Composable fun groupRequests(params: Params? = null, skip: Boolean = false) = get("/chat/requests", "ChatRequest", params = params, skip = skip)
    suspend fun reviewGroupRequest(id: String, body: JsonElement) = patch("/chat/requests/$id", body, "ChatRequest", "Chat", "Notification")
    // HOD group builder: own-department years/sections, and every student of one class.
    @Composable fun peopleFilters(skip: Boolean = false) = get("/users/people-filters", "User", skip = skip)
    @Composable fun groupClass(params: Params, skip: Boolean = false) = get("/chat/group-class", "User", params = params, skip = skip)

    // ── Timetable / attendance ────────────────────────
    // Faculty may pass { scope: 'class' } (Our Class) or { scope: 'handling' };
    // the server derives both scopes from the account.
    @Composable fun timetable(params: Params? = null, skip: Boolean = false) = get("/timetable", "Timetable", params = params, skip = skip)
    // HOD only: the department's master schedule and who is free each period.
    @Composable fun masterTimetable(params: Params? = null, skip: Boolean = false) = get("/timetable/master", "Timetable", params = params, skip = skip)
    @Composable fun facultyAvailability(params: Params? = null, skip: Boolean = false) = get("/timetable/faculty-availability", "Timetable", params = params, skip = skip)
    // Holidays that apply to this account — the server decides which (read-only on mobile).
    @Composable fun holidays(params: Params? = null, skip: Boolean = false) = get("/holidays", "Holiday", params = params, skip = skip)
    // Exam timetable — the server decides which exams this account sees (read-only on mobile).
    @Composable fun exams(params: Params? = null, skip: Boolean = false) = get("/exams", "Exam", "Attendance", params = params, skip = skip)
    @Composable fun ourClassAttendance(params: Params? = null, skip: Boolean = false) = get("/attendance/our-class", "Attendance", params = params, skip = skip)
    @Composable fun reportOptions(skip: Boolean = false) = get("/attendance/reports/options", "Attendance", "Timetable", skip = skip)
    @Composable fun reportPeriods(params: Params?, skip: Boolean = false) = get("/attendance/reports/periods", "Attendance", "Timetable", params = params, skip = skip)
    @Composable fun attendanceReport(type: String, params: Params?, skip: Boolean = false) = get("/attendance/reports/$type", "Attendance", params = params, skip = skip)
    @Composable fun currentClass(skip: Boolean = false, pollMs: Long = 0) = get("/timetable/current", "Timetable", skip = skip, pollMs = pollMs)
    @Composable fun myAttendance(params: Params? = null, skip: Boolean = false) = get("/attendance/my", "Attendance", params = params, skip = skip)
    @Composable fun attendanceRecords(params: Params? = null, skip: Boolean = false) = get("/attendance/records", "Attendance", params = params, skip = skip)
    @Composable fun corrections(params: Params? = null, skip: Boolean = false) = get("/attendance/corrections", "Correction", params = params, skip = skip)
    suspend fun requestCorrection(body: JsonElement) = post("/attendance/corrections", body, "Correction")
    @Composable fun subjects(params: Params? = null, skip: Boolean = false) = get("/subjects", params = params, skip = skip)
    @Composable fun roster(params: Params?, skip: Boolean = false) = get("/attendance/roster", "Attendance", params = params, skip = skip, keep = false)
    // Faculty: today's timetable periods with live UPCOMING / ACTIVE / COMPLETED, holiday and exam state.
    @Composable fun myPeriods(pollMs: Long = 0, skip: Boolean = false) = get("/attendance/my-periods", "Attendance", "Timetable", "Exam", skip = skip, pollMs = pollMs)
    suspend fun markClassAttendance(body: JsonElement) = post("/attendance/mark", body, "Attendance", "StaffAttendance")
    @Composable fun attendanceSummary(params: Params? = null, skip: Boolean = false, pollMs: Long = 0) = get("/attendance/summary", "Attendance", "StaffAttendance", params = params, skip = skip, pollMs = pollMs)
    @Composable fun summaryStudents(params: Params?, skip: Boolean = false) = get("/attendance/summary/students", "Attendance", params = params, skip = skip)
    @Composable fun summaryFaculty(params: Params?, skip: Boolean = false) = get("/attendance/summary/faculty", "StaffAttendance", params = params, skip = skip)
    @Composable fun facultyRoster(params: Params?, skip: Boolean = false) = get("/attendance/faculty/roster", "StaffAttendance", params = params, skip = skip, keep = false)
    suspend fun markFacultyAttendance(body: JsonElement) = post("/attendance/faculty/mark", body, "StaffAttendance")
    suspend fun createAdminUser(body: JsonElement) = post("/admin/users", body, "Admin", "User")
    // Own effective permissions: which roles this admin may create (server-enforced; shapes the UI only).
    @Composable fun myPolicies(skip: Boolean = false) = get("/admin/my-policies", "MyPolicies", skip = skip, keep = false)

    // Staff attendance tools (same endpoints as the web Attendance Center).
    suspend fun reviewCorrection(id: String, action: String, note: String?) =
        patch("/attendance/corrections/$id", jsonOf("action" to action, "note" to (note?.takeIf { it.isNotBlank() } ?: Omit)), "Correction", "Attendance")
    @Composable fun attendanceSessions(params: Params?, skip: Boolean = false) = get("/attendance/sessions", "Attendance", params = params, skip = skip)
    @Composable fun lowAttendance(params: Params?, skip: Boolean = false) = get("/attendance/low", "Attendance", params = params, skip = skip)
    suspend fun notifyLowAttendance(id: String, message: String) = post("/attendance/notify/$id", jsonOf("message" to message))
    @Composable fun studentAttendance(id: String, params: Params? = null, skip: Boolean = false) = get("/attendance/student/$id", "Attendance", params = params, skip = skip)
    @Composable fun subjectAttendance(id: String, params: Params?, skip: Boolean = false) = get("/attendance/subject/$id", "Attendance", params = params, skip = skip)
    @Composable fun myClassOptions(skip: Boolean = false) = get("/attendance/my-classes/options", "Attendance", "Timetable", skip = skip)
    @Composable fun myClassAttendance(params: Params?, skip: Boolean = false) = get("/attendance/my-classes", "Attendance", params = params, skip = skip)

    // Holidays: everyone sees the ones that apply to them; only the Principal may
    // declare / edit / delete (enforced by the server).
    @Composable fun holidayOptions(skip: Boolean = false) = get("/holidays/options", skip = skip)
    suspend fun createHoliday(body: JsonElement) = post("/holidays", body, "Holiday", "Attendance", "Timetable")
    suspend fun updateHoliday(id: String, body: JsonElement) = put("/holidays/$id", body, "Holiday", "Attendance", "Timetable")
    suspend fun deleteHoliday(id: String) = delete("/holidays/$id", null, "Holiday", "Attendance", "Timetable")

    // ── Student achievements ──────────────────────────
    @Composable fun achievements(params: Params?, skip: Boolean = false) = get("/achievements", "Achievement", params = params, skip = skip)
    @Composable fun achievementsDashboard(skip: Boolean = false) = get("/achievements/dashboard", "Achievement", skip = skip)
    @Composable fun achievement(id: String) = get("/achievements/$id", "Achievement")
    @Composable fun studentAchievements(id: String, skip: Boolean = false) = get("/achievements/student/$id", "Achievement", skip = skip)
    @Composable fun achievementStats(skip: Boolean = false) = get("/achievements/stats", "Achievement", skip = skip)
    @Composable fun achievementStudents(q: String, skip: Boolean = false) = get("/achievements/students", params = mapOf("q" to q.ifBlank { null }), skip = skip)
    suspend fun createAchievement(body: JsonElement) = post("/achievements", body, "Achievement", "Announcement", "Notification")
    suspend fun updateAchievement(id: String, body: JsonElement) = put("/achievements/$id", body, "Achievement", "Notification")
    suspend fun deleteAchievement(id: String) = delete("/achievements/$id", null, "Achievement", "Announcement")
    suspend fun restoreAchievement(id: String) = post("/achievements/$id/restore", null, "Achievement")
    suspend fun toggleFeaturedAchievement(id: String) = patch("/achievements/$id/feature", null, "Achievement")
    suspend fun congratulateAchievement(id: String) = post("/achievements/$id/congratulate", null, "Achievement")
    suspend fun requestAchievementHide(id: String, reason: String?) =
        post("/achievements/$id/hide-request", jsonOf("reason" to (reason?.takeIf { it.isNotBlank() } ?: Omit)), "Achievement")
    suspend fun resolveAchievementHide(id: String, reqId: String, action: String) =
        patch("/achievements/$id/hide-request/$reqId", jsonOf("action" to action), "Achievement")

    // ── Gate pass ─────────────────────────────────────
    @Composable fun gatePasses(params: Params? = null, skip: Boolean = false) = get("/gate-pass", "GatePass", params = params, skip = skip)
    @Composable fun gatePass(id: String) = get("/gate-pass/$id", "GatePass")
    @Composable fun gatePassQr(id: String, skip: Boolean = false) = get("/gate-pass/$id/qr", "GatePass", skip = skip, keep = false)
    @Composable fun gateDashboard(skip: Boolean = false) = get("/gate-pass/dashboard", "GatePass", skip = skip)
    @Composable fun securityDashboard(pollMs: Long = 0, skip: Boolean = false) = get("/gate-pass/dashboard/security", "GatePass", skip = skip, pollMs = pollMs)
    // Who a Security home card counts — view = in | out | left — with each student's leave period.
    @Composable fun securityStudents(params: Params, pollMs: Long = 0) = get("/gate-pass/dashboard/security/students", "GatePass", params = params, pollMs = pollMs)
    suspend fun createGatePass(body: JsonElement) = post("/gate-pass", body, "GatePass")
    suspend fun facultyReviewGatePass(id: String, body: JsonElement) = patch("/gate-pass/$id/faculty-review", body, "GatePass")
    @Composable fun parentOtp(id: String, skip: Boolean = false) = get("/gate-pass/$id/parent-otp", skip = skip, keep = false)
    // mobile + reason only when the faculty edited the number (registered one not reachable).
    suspend fun requestParentOtp(id: String, mobile: String? = null, reason: String? = null) =
        post("/gate-pass/$id/parent-otp", if (mobile == null) null else jsonOf("mobile" to mobile, "reason" to (reason ?: "")))
    suspend fun verifyParentOtp(id: String, otp: String) = post("/gate-pass/$id/parent-otp/verify", jsonOf("otp" to otp), "GatePass")
    suspend fun hodReviewGatePass(id: String, body: JsonElement) = patch("/gate-pass/$id/hod-review", body, "GatePass")
    suspend fun principalReviewGatePass(id: String, body: JsonElement) = patch("/gate-pass/$id/principal-review", body, "GatePass")
    suspend fun cancelGatePass(id: String) = patch("/gate-pass/$id/cancel", null, "GatePass")
    suspend fun revokeGatePass(id: String, reason: String) = patch("/gate-pass/$id/revoke", jsonOf("reason" to reason), "GatePass")
    suspend fun verifyGatePass(code: String) = post("/gate-pass/verify", jsonOf("code" to code))
    suspend fun recordGateOut(id: String, code: String) = patch("/gate-pass/$id/out", jsonOf("code" to code), "GatePass")
    suspend fun createEmergencyGatePass(body: JsonElement) = post("/gate-pass/emergency", body, "GatePass")
    suspend fun emergencyReviewGatePass(id: String, body: JsonElement) = patch("/gate-pass/$id/emergency-review", body, "GatePass")
    suspend fun recordGateIn(id: String, code: String) = patch("/gate-pass/$id/in", jsonOf("code" to code), "GatePass")
    suspend fun verifyReturnCredential(code: String) = post("/gate-pass/return/verify", jsonOf("code" to code))
    suspend fun verifyReturnLocation(id: String, reading: JsonElement) = post("/gate-pass/$id/return-location/verify", reading, "GatePass")
    @Composable fun returnCredential(id: String, skip: Boolean = false) = get("/gate-pass/$id/return-credential", "GatePass", skip = skip, keep = false)

    // Day scholar same-day Outing, and the Principal's institutional mass outpass.
    suspend fun createDayScholarOuting(body: JsonElement) = post("/gate-pass/outing", body, "GatePass")
    suspend fun massApproveGatePass(body: JsonElement) = post("/gate-pass/mass-approve", body, "GatePass", "Hostel")

    // Bulk approval ("Bind") groups: class in-charge builds, HOD forwards, principal approves.
    @Composable fun bindGroups(params: Params? = null, skip: Boolean = false) = get("/gate-pass/bind-groups", "GatePass", params = params, skip = skip)
    suspend fun createBindGroup(body: JsonElement) = post("/gate-pass/bind-groups", body, "GatePass")
    suspend fun deleteBindGroup(id: String) = delete("/gate-pass/bind-groups/$id", null, "GatePass")
    suspend fun bindGatePass(id: String, groupId: String) = post("/gate-pass/$id/bind", jsonOf("groupId" to groupId), "GatePass")
    suspend fun unbindGatePass(id: String) = delete("/gate-pass/$id/bind", null, "GatePass")
    suspend fun submitBindGroup(id: String) = post("/gate-pass/bind-groups/$id/submit", null, "GatePass")
    suspend fun hodReviewBindGroup(id: String, body: JsonElement) = patch("/gate-pass/bind-groups/$id/hod-review", body, "GatePass")
    suspend fun principalReviewBindGroup(id: String, body: JsonElement) = patch("/gate-pass/bind-groups/$id/principal-review", body, "GatePass")
    suspend fun rejectBindMember(id: String, passId: String, reason: String?) =
        patch("/gate-pass/bind-groups/$id/members/$passId/reject", jsonOf("reason" to (reason?.takeIf { it.isNotBlank() } ?: Omit)), "GatePass")

    // ── On Duty (OD) & Leave ──────────────────────────
    @Composable fun myOdLeave(params: Params? = null, skip: Boolean = false, pollMs: Long = 0) = get("/attendance/od-leave/my", "ODLeave", params = params, skip = skip, pollMs = pollMs)
    @Composable fun odLeaveReviews(params: Params? = null, skip: Boolean = false, pollMs: Long = 0) = get("/attendance/od-leave/reviews", "ODLeave", params = params, skip = skip, pollMs = pollMs)
    suspend fun createOdLeave(body: JsonElement) = post("/attendance/od-leave", body, "ODLeave", "Attendance")
    suspend fun reviewOdLeave(id: String, body: JsonElement) = patch("/attendance/od-leave/$id/review", body, "ODLeave", "Attendance")
    suspend fun cancelOdLeave(id: String) = patch("/attendance/od-leave/$id/cancel", null, "ODLeave", "Attendance")

    // ── Hostel (admin, principal, dean, AO, chairman, warden — enforced server-side) ──
    @Composable fun hostelSummary(skip: Boolean = false, pollMs: Long = 0) = get("/hostel/summary", "Hostel", "GatePass", skip = skip, pollMs = pollMs)
    @Composable fun hostelStudents(params: Params?, skip: Boolean = false) = get("/hostel/students", "Hostel", "GatePass", params = params, skip = skip)

    // ── Class In-Charge: own class's students (the class comes from the account) ──
    @Composable fun classStudents(skip: Boolean = false) = get("/class-students", "ClassStudents", skip = skip)
    @Composable fun classStudent(id: String, skip: Boolean = false) = get("/class-students/$id", "ClassStudents", skip = skip, keep = false)
    suspend fun createClassStudent(body: JsonElement) = post("/class-students", body, "ClassStudents")
    suspend fun updateClassStudent(id: String, body: JsonElement) = patch("/class-students/$id", body, "ClassStudents", "Attendance", "User")
    suspend fun resetUserPassword(id: String, body: JsonElement) = post("/users/$id/reset-password", body)

    // ── Campus SOS: anyone raises; responders list, acknowledge and resolve ──
    @Composable fun sosAlerts(params: Params? = null, skip: Boolean = false, pollMs: Long = 0) = get("/sos", "SOSAlert", params = params, skip = skip, pollMs = pollMs)
    suspend fun createSos(body: JsonElement) = post("/sos", body, "SOSAlert", "Dashboard")
    suspend fun ackSos(id: String) = patch("/sos/$id/ack", null, "SOSAlert", "Dashboard")
    suspend fun resolveSos(id: String, body: JsonElement) = patch("/sos/$id/resolve", body, "SOSAlert", "Dashboard")

    // ── Lost & found ──────────────────────────────────
    @Composable fun lostFound(params: Params? = null) = get("/lost-found", "LostFound", params = params)
    @Composable fun lostFoundItem(id: String) = get("/lost-found/$id", "LostFound")
    @Composable fun lostFoundMatches(id: String, skip: Boolean = false) = get("/lost-found/$id/matches", "LostFound", skip = skip)
    suspend fun reportLostFound(body: JsonElement) = post("/lost-found", body, "LostFound")
    suspend fun closeLostFound(id: String) = patch("/lost-found/$id/status", jsonOf("status" to "closed"), "LostFound")

    // ── Complaints ────────────────────────────────────
    @Composable fun complaints(params: Params? = null, skip: Boolean = false) = get("/complaints", "Complaint", params = params, skip = skip)
    @Composable fun complaint(id: String) = get("/complaints/$id", "Complaint")
    @Composable fun complaintDashboard(params: Params? = null, skip: Boolean = false) = get("/complaints/dashboard", "Complaint", params = params, skip = skip)
    suspend fun createComplaint(body: JsonElement) = post("/complaints", body, "Complaint")
    suspend fun authorityUpdateComplaint(id: String, body: JsonElement) = patch("/complaints/$id/authority-update", body, "Complaint")
    suspend fun markComplaintNotResolved(id: String) = patch("/complaints/$id/not-resolved", null, "Complaint")
    suspend fun markComplaintResolved(id: String) = patch("/complaints/$id/resolved", null, "Complaint")
    suspend fun cancelComplaint(id: String) = patch("/complaints/$id/cancel", null, "Complaint")

    // ── Skill Wallet (students; the server checks ownership / membership) ──
    @Composable fun swConfig() = get("/skill-wallet/config", "SWConfig")
    @Composable fun swProjects(params: Params? = null) = get("/skill-wallet/projects", "SWProject", params = params, keep = false)
    @Composable fun swProject(id: String) = get("/skill-wallet/projects/$id", "SWProject", keep = false)
    @Composable fun swInvitations(params: Params? = null) = get("/skill-wallet/invitations", "SWInvite", params = params, keep = false)
    suspend fun createSwProject(body: JsonElement) = post("/skill-wallet/projects", body, "SWProject")
    suspend fun acceptSwInvitation(id: String) = post("/skill-wallet/invitations/$id/accept", null, "SWInvite", "SWProject", "Notification")
    suspend fun declineSwInvitation(id: String) = post("/skill-wallet/invitations/$id/decline", null, "SWInvite", "Notification")

    // ── Alumni Network ────────────────────────────────
    @Composable fun alumni(params: Params? = null, skip: Boolean = false) = get("/alumni", "AlumniProfile", params = params, skip = skip)
    @Composable fun alumniFilters(skip: Boolean = false) = get("/alumni/filters", "AlumniProfile", skip = skip)
    @Composable fun alumniProfile(userId: String, skip: Boolean = false) = get("/alumni/$userId", "AlumniProfile", skip = skip)
    @Composable fun myAlumniProfile(skip: Boolean = false) = get("/alumni/me", "AlumniProfile", "Me", skip = skip)
    suspend fun upsertAlumniProfile(body: JsonElement) = put("/alumni/me", body, "AlumniProfile", "Me")
    suspend fun verifyAlumniProfile(id: String) = patch("/alumni/$id/verify", null, "AlumniProfile", "AlumniAnalytics")
    suspend fun rejectAlumniProfile(id: String, reason: String) = post("/alumni/$id/reject", jsonOf("reason" to reason), "AlumniProfile", "AlumniAnalytics")

    // Mentorship
    @Composable fun mentorshipRequests(params: Params? = null, skip: Boolean = false) = get("/mentorship-requests", "MentorshipRequest", params = params, skip = skip)
    @Composable fun mentorshipRequest(id: String) = get("/mentorship-requests/$id", "MentorshipRequest")
    suspend fun createMentorshipRequest(body: JsonElement) = post("/mentorship-requests", body, "MentorshipRequest", "AlumniProfile")
    suspend fun respondMentorshipRequest(id: String, body: JsonElement) = patch("/mentorship-requests/$id", body, "MentorshipRequest", "AlumniProfile")
    suspend fun cancelMentorshipRequest(id: String, reason: String?) = patch("/mentorship-requests/$id/cancel", jsonOf("reason" to (reason ?: Omit)), "MentorshipRequest", "AlumniProfile")
    suspend fun completeMentorship(id: String) = patch("/mentorship-requests/$id/complete", null, "MentorshipRequest", "AlumniProfile")
    suspend fun rateMentorship(id: String, body: JsonElement) = patch("/mentorship-requests/$id/rate", body, "MentorshipRequest", "AlumniProfile")
    suspend fun updateMentorshipGoals(id: String, goals: Any?) = patch("/mentorship-requests/$id/goals", jsonOf("goals" to goals), "MentorshipRequest")
    @Composable fun slots(params: Params? = null, skip: Boolean = false) = get("/mentorship/slots", "MentorshipSlot", params = params, skip = skip)
    suspend fun createSlots(body: JsonElement) = post("/mentorship/slots", body, "MentorshipSlot")
    suspend fun deleteMentorshipSlot(id: String) = delete("/mentorship/slots/$id", null, "MentorshipSlot")
    suspend fun bookSession(body: JsonElement) = post("/mentorship/sessions", body, "MentorshipSlot", "MentorshipSession", "MentorshipRequest")
    @Composable fun mentorshipSessions(params: Params? = null, skip: Boolean = false) = get("/mentorship/sessions", "MentorshipSession", params = params, skip = skip)
    suspend fun rescheduleSession(id: String, slot: String) = patch("/mentorship/sessions/$id/reschedule", jsonOf("slot" to slot), "MentorshipSlot", "MentorshipSession")
    suspend fun cancelSession(id: String, reason: String?) = patch("/mentorship/sessions/$id/cancel", jsonOf("reason" to (reason ?: Omit)), "MentorshipSlot", "MentorshipSession")
    suspend fun completeSession(id: String, outcome: String?) = patch("/mentorship/sessions/$id/complete", jsonOf("outcome" to (outcome ?: Omit)), "MentorshipSession", "MentorshipRequest")
    suspend fun updateSessionNotes(id: String, body: JsonElement) = patch("/mentorship/sessions/$id/notes", body, "MentorshipSession")
    suspend fun messageMentor(id: String) = post("/mentorship/requests/$id/message", null, "Chat")

    // Jobs
    @Composable fun alumniJobs(params: Params? = null, skip: Boolean = false) = get("/alumni/jobs", "AlumniJob", params = params, skip = skip)
    @Composable fun alumniJob(id: String) = get("/alumni/jobs/$id", "AlumniJob")
    suspend fun createAlumniJob(body: JsonElement) = post("/alumni/jobs", body, "AlumniJob", "AlumniAnalytics")
    suspend fun updateAlumniJob(id: String, body: JsonElement) = patch("/alumni/jobs/$id", body, "AlumniJob")
    suspend fun closeAlumniJob(id: String) = patch("/alumni/jobs/$id/close", null, "AlumniJob")
    suspend fun reopenAlumniJob(id: String) = patch("/alumni/jobs/$id/reopen", null, "AlumniJob")
    suspend fun removeAlumniJob(id: String, reason: String?) = delete("/alumni/jobs/$id", jsonOf("reason" to (reason ?: Omit)), "AlumniJob", "AlumniAnalytics")
    suspend fun applyToJob(id: String, body: JsonElement) = post("/alumni/jobs/$id/apply", body, "AlumniJob", "JobApplication", "AlumniAnalytics")
    @Composable fun jobApplications(id: String, skip: Boolean = false) = get("/alumni/jobs/$id/applications", "JobApplication", skip = skip)
    @Composable fun myApplications(skip: Boolean = false) = get("/alumni/job-applications/mine", "JobApplication", skip = skip)
    suspend fun updateApplication(id: String, body: JsonElement) = patch("/alumni/job-applications/$id", body, "JobApplication", "AlumniJob", "AlumniAnalytics")
    suspend fun withdrawApplication(id: String) = patch("/alumni/job-applications/$id/withdraw", null, "JobApplication", "AlumniJob", "AlumniAnalytics")

    // Events
    @Composable fun alumniEvents(params: Params? = null, skip: Boolean = false) = get("/alumni/events", "AlumniEvent", params = params, skip = skip)
    @Composable fun alumniEvent(id: String) = get("/alumni/events/$id", "AlumniEvent")
    suspend fun createAlumniEvent(body: JsonElement) = post("/alumni/events", body, "AlumniEvent", "AlumniAnalytics")
    suspend fun updateAlumniEvent(id: String, body: JsonElement) = patch("/alumni/events/$id", body, "AlumniEvent")
    suspend fun approveAlumniEvent(id: String) = post("/alumni/events/$id/approve", null, "AlumniEvent", "AlumniAnalytics")
    suspend fun rejectAlumniEvent(id: String, reason: String) = post("/alumni/events/$id/reject", jsonOf("reason" to reason), "AlumniEvent", "AlumniAnalytics")
    suspend fun cancelAlumniEvent(id: String, reason: String?) = post("/alumni/events/$id/cancel", jsonOf("reason" to (reason ?: Omit)), "AlumniEvent", "AlumniAnalytics")
    suspend fun rsvpEvent(id: String) = post("/alumni/events/$id/rsvp", null, "AlumniEvent", "AlumniAnalytics")
    suspend fun cancelRsvp(id: String) = delete("/alumni/events/$id/rsvp", null, "AlumniEvent", "AlumniAnalytics")
    @Composable fun attendees(id: String, skip: Boolean = false) = get("/alumni/events/$id/attendees", "AlumniEvent", skip = skip)
    suspend fun checkInAttendee(id: String, userId: String) = post("/alumni/events/$id/checkin", jsonOf("userId" to userId), "AlumniEvent", "AlumniAnalytics")

    // Chapters
    @Composable fun chapters(params: Params? = null, skip: Boolean = false) = get("/alumni/chapters", "Chapter", params = params, skip = skip)
    @Composable fun chapter(slug: String) = get("/alumni/chapters/$slug", "Chapter")
    suspend fun createChapter(body: JsonElement) = post("/alumni/chapters", body, "Chapter", "AlumniAnalytics")
    suspend fun updateChapter(slug: String, body: JsonElement) = patch("/alumni/chapters/$slug", body, "Chapter")
    suspend fun archiveChapter(slug: String) = delete("/alumni/chapters/$slug", null, "Chapter", "AlumniAnalytics")
    suspend fun joinChapter(slug: String) = post("/alumni/chapters/$slug/join", null, "Chapter", "AlumniAnalytics")
    suspend fun leaveChapter(slug: String) = delete("/alumni/chapters/$slug/join", null, "Chapter", "AlumniAnalytics")
    suspend fun approveChapterMember(slug: String, userId: String, status: String) = patch("/alumni/chapters/$slug/members/$userId", jsonOf("status" to status), "Chapter")
    @Composable fun chapterMembers(slug: String, skip: Boolean = false) = get("/alumni/chapters/$slug/members", "Chapter", skip = skip)
    @Composable fun chapterPosts(slug: String, params: Params? = null, skip: Boolean = false) = get("/alumni/chapters/$slug/posts", "ChapterPost", params = params, skip = skip)
    suspend fun createChapterPost(slug: String, body: JsonElement) = post("/alumni/chapters/$slug/posts", body, "ChapterPost", "Chapter", "AlumniAnalytics")
    suspend fun deletePost(id: String) = delete("/alumni/chapters/posts/$id", null, "ChapterPost", "Chapter")
    suspend fun pinPost(id: String) = patch("/alumni/chapters/posts/$id/pin", null, "ChapterPost")
    suspend fun likePost(id: String) = post("/alumni/chapters/posts/$id/like", null, "ChapterPost")
    @Composable fun comments(postId: String, skip: Boolean = false) = get("/alumni/chapters/posts/$postId/comments", "ChapterPost", skip = skip)
    suspend fun addComment(postId: String, body: String) = post("/alumni/chapters/posts/$postId/comments", jsonOf("body" to body), "ChapterPost")
    suspend fun deleteComment(id: String) = delete("/alumni/chapters/comments/$id", null, "ChapterPost")

    // Invites & Analytics
    @Composable fun invites(params: Params? = null, skip: Boolean = false) = get("/alumni/invites", "AlumniInvite", params = params, skip = skip)
    suspend fun resendInvite(id: String) = post("/alumni/invites/$id/resend", null, "AlumniInvite")
    suspend fun revokeInvite(id: String) = patch("/alumni/invites/$id/revoke", null, "AlumniInvite")
    @Composable fun alumniAnalytics(params: Params? = null, skip: Boolean = false) = get("/alumni/analytics", "AlumniAnalytics", params = params, skip = skip)
    @Composable fun alumniDashboard(skip: Boolean = false) =
        get("/alumni/dashboard", "AlumniProfile", "MentorshipRequest", "MentorshipSession", "AlumniJob", "AlumniEvent", "ChapterPost", skip = skip)
}
