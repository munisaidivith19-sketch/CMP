import Foundation

/// App modules the iOS client presents.
public enum Feature: String, Sendable, CaseIterable, Identifiable {
    case attendance, timetable, exams, complaints, chat, busTracking, notifications, profile
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .attendance: return "Attendance"
        case .timetable: return "Timetable"
        case .exams: return "Exams"
        case .complaints: return "Grievances"
        case .chat: return "Chat"
        case .busTracking: return "Bus Tracking"
        case .notifications: return "Notifications"
        case .profile: return "Profile"
        }
    }
}

/// Which modules to SHOW for a role. This is presentation only — hiding a
/// button is not authorization. The server enforces the same rules
/// (server/src/constants.js, middleware/coeGuard.js) and answers 403 otherwise;
/// the app shows that message instead of failing.
public enum FeatureAccess {
    static let studentRoles: Set<Role> = [.student, .clubAdmin]
    /// TIMETABLE_BLOCKED_ROLES.
    static let timetableBlocked: Set<Role> = [.warden, .security, .alumni, .office, .transport]
    /// TRANSPORT_VIEW_ROLES.
    static let transportView: Set<Role> = [.student, .clubAdmin, .faculty, .hod, .principal, .admin, .security, .dean, .ao, .chairman, .warden, .transport]
    /// Confined roles (coeGuard.js): only their own module plus account / notifications.
    static let confined: Set<Role> = [.coe, .office, .transport]

    public static func isStudent(_ role: Role) -> Bool { studentRoles.contains(role) }

    public static func allows(_ feature: Feature, for role: Role) -> Bool {
        switch feature {
        case .notifications, .profile:
            return true
        case .busTracking:
            return transportView.contains(role)
        case .timetable, .exams:
            if case .other = role { return false }
            return !timetableBlocked.contains(role)
        case .attendance:
            // The iOS attendance module is the student's own record (GET /attendance/my);
            // staff marking and reports remain on the web and Android apps for now.
            return isStudent(role)
        case .complaints:
            // Students file and track grievances; authority review is not in this phase.
            return isStudent(role)
        case .chat:
            if case .other = role { return false }
            return !confined.contains(role)
        }
    }

    public static func features(for role: Role) -> [Feature] {
        Feature.allCases.filter { allows($0, for: role) }
    }
}
