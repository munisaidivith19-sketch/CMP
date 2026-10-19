import Foundation

/// Every backend endpoint the iOS app uses — the same paths the Android app
/// (core/Api.kt) and web app (client/src/services/api.js) call. Every rule
/// (roles, scope, ownership) is enforced by the server.
public enum API {
    // MARK: Account
    public static func me() -> Endpoint<User> { Endpoint(.get, "/auth/me") }

    // MARK: Attendance
    public static func myAttendance(range: AttendanceRange) -> Endpoint<AttendanceSummary> {
        Endpoint(.get, "/attendance/my", query: ["range": range.rawValue])
    }

    public static func attendanceRecords(page: Int, limit: Int = 30) -> Endpoint<AttendanceRecordsPage> {
        Endpoint(.get, "/attendance/records", query: ["page": String(page), "limit": String(limit)])
    }

    // MARK: Timetable & exams
    public static func timetable() -> Endpoint<TimetableResponse> { Endpoint(.get, "/timetable") }
    public static func currentClass() -> Endpoint<CurrentClassResponse> { Endpoint(.get, "/timetable/current") }
    public static func exams() -> Endpoint<ExamsResponse> { Endpoint(.get, "/exams") }

    // MARK: Complaints
    public static func complaints(page: Int) -> Endpoint<ComplaintsPage> {
        Endpoint(.get, "/complaints", query: ["page": String(page), "limit": "20"])
    }

    public static func createComplaint(_ complaint: NewComplaint) -> Endpoint<EmptyResponse> {
        Endpoint(.post, "/complaints", body: complaint)
    }

    public static func cancelComplaint(id: String) -> Endpoint<EmptyResponse> {
        Endpoint(.patch, "/complaints/\(id)/cancel")
    }

    // MARK: Notifications
    public static func notifications(page: Int) -> Endpoint<NotificationsPage> {
        Endpoint(.get, "/notifications", query: ["page": String(page), "limit": "20"])
    }

    public static func markNotificationRead(id: String) -> Endpoint<EmptyResponse> { Endpoint(.patch, "/notifications/\(id)/read") }
    public static func markAllNotificationsRead() -> Endpoint<EmptyResponse> { Endpoint(.patch, "/notifications/read-all") }
    public static func notificationPreferences() -> Endpoint<NotificationPreferences> { Endpoint(.get, "/notifications/preferences") }

    public static func updateNotificationPreferences(disabled: [String], reminderMinutes: Int) -> Endpoint<NotificationPreferences> {
        struct Body: Encodable, Sendable { let disabled: [String]; let reminderMinutes: Int }
        return Endpoint(.put, "/notifications/preferences", body: Body(disabled: disabled, reminderMinutes: reminderMinutes))
    }

    // MARK: Chat
    public static func conversations(search: String? = nil) -> Endpoint<[Conversation]> {
        Endpoint(.get, "/chat/conversations", query: ["search": search?.isEmpty == false ? search : nil])
    }

    public static func messages(conversationId: String, before: Date? = nil) -> Endpoint<MessagesPage> {
        Endpoint(.get, "/chat/conversations/\(conversationId)/messages", query: ["before": before.map(VEXONJSON.formatISO)])
    }

    public static func sendMessage(conversationId: String, _ message: NewChatMessage) -> Endpoint<EmptyResponse> {
        Endpoint(.post, "/chat/conversations/\(conversationId)/messages", body: message)
    }

    public static func markConversationRead(id: String) -> Endpoint<EmptyResponse> { Endpoint(.patch, "/chat/conversations/\(id)/read") }

    // MARK: Transport
    public static func transportConfig() -> Endpoint<TransportConfig> { Endpoint(.get, "/transport/config") }
    public static func buses() -> Endpoint<BusList> { Endpoint(.get, "/transport/buses") }

    public static func bus(id: String, stopId: String?) -> Endpoint<BusDetail> {
        Endpoint(.get, "/transport/buses/\(id)", query: ["stopId": stopId])
    }

    public static func transportSearch(_ q: String) -> Endpoint<TransportSearchResult> {
        Endpoint(.get, "/transport/search", query: ["q": String(q.prefix(60))])
    }

    public static func transportMine() -> Endpoint<TransportMine> { Endpoint(.get, "/transport/me") }

    public static func startTrip(busId: String) -> Endpoint<StartTripResponse> {
        struct Body: Encodable, Sendable { let busId: String }
        return Endpoint(.post, "/transport/trips", body: Body(busId: busId))
    }

    public static func stopTrip(id: String) -> Endpoint<EmptyResponse> {
        struct Body: Encodable, Sendable { let reason: String }
        return Endpoint(.post, "/transport/trips/\(id)/stop", body: Body(reason: "completed"))
    }

    public static func postTripLocations(tripId: String, fixes: [OutgoingFix]) -> Endpoint<TripLocationsResult> {
        Endpoint(.post, "/transport/trips/\(tripId)/locations", body: TripLocationsBody(fixes: fixes))
    }
}
