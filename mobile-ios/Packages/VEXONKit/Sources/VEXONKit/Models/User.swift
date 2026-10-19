import Foundation

/// Server roles (server/src/constants.js `ROLES`). Unknown future roles decode
/// as `.other` so a new server role never breaks sign-in.
public enum Role: Sendable, Hashable, Codable {
    case student, clubAdmin, faculty, hod, principal, admin, security, dean, ao
    case chairman, warden, alumni, coe, office, transport
    case other(String)

    public init(rawValue: String) {
        switch rawValue {
        case "student": self = .student
        case "club_admin": self = .clubAdmin
        case "faculty": self = .faculty
        case "hod": self = .hod
        case "principal": self = .principal
        case "admin": self = .admin
        case "security": self = .security
        case "dean": self = .dean
        case "ao": self = .ao
        case "chairman": self = .chairman
        case "warden": self = .warden
        case "alumni": self = .alumni
        case "coe": self = .coe
        case "office": self = .office
        case "transport": self = .transport
        default: self = .other(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .student: return "student"
        case .clubAdmin: return "club_admin"
        case .faculty: return "faculty"
        case .hod: return "hod"
        case .principal: return "principal"
        case .admin: return "admin"
        case .security: return "security"
        case .dean: return "dean"
        case .ao: return "ao"
        case .chairman: return "chairman"
        case .warden: return "warden"
        case .alumni: return "alumni"
        case .coe: return "coe"
        case .office: return "office"
        case .transport: return "transport"
        case .other(let raw): return raw
        }
    }

    public init(from decoder: Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(rawValue)
    }

    /// Display label used across web and Android.
    public var label: String {
        switch self {
        case .student: return "Student"
        case .clubAdmin: return "Club Admin"
        case .faculty: return "Faculty"
        case .hod: return "HOD"
        case .principal: return "Principal"
        case .admin: return "Admin"
        case .security: return "Security"
        case .dean: return "Dean"
        case .ao: return "AO"
        case .chairman: return "Chairman"
        case .warden: return "Warden"
        case .alumni: return "Alumni"
        case .coe: return "COE"
        case .office: return "Office"
        case .transport: return "Transport"
        case .other(let raw): return raw.capitalized
        }
    }
}

/// The signed-in account as returned by `/auth/login`, `/auth/refresh` and `/auth/me`.
public struct User: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let email: String?
    public let role: Role
    public let title: String?
    public let department: String?
    public let year: Int?
    public let section: String?
    public let semester: Int?
    public let rollNo: String?
    public let employeeId: String?
    public let designation: String?
    public let avatar: String?
    public let phone: String?
    public let bio: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, email, role, title, department, year, section, semester, rollNo, employeeId, designation, avatar, phone, bio
    }

    public init(id: String, name: String, email: String? = nil, role: Role, title: String? = nil, department: String? = nil,
                year: Int? = nil, section: String? = nil, semester: Int? = nil, rollNo: String? = nil, employeeId: String? = nil,
                designation: String? = nil, avatar: String? = nil, phone: String? = nil, bio: String? = nil) {
        self.id = id
        self.name = name
        self.email = email
        self.role = role
        self.title = title
        self.department = department
        self.year = year
        self.section = section
        self.semester = semester
        self.rollNo = rollNo
        self.employeeId = employeeId
        self.designation = designation
        self.avatar = avatar
        self.phone = phone
        self.bio = bio
    }

    /// "Dr. Priya" when a title is set.
    public var displayName: String {
        if let title, !title.isEmpty { return "\(title). \(name)" }
        return name
    }

    /// "CSE · Year 2 · Section A" for students.
    public var classLine: String? {
        var parts: [String] = []
        if let department, !department.isEmpty { parts.append(department) }
        if let year { parts.append("Year \(year)") }
        if let section, !section.isEmpty { parts.append("Section \(section)") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// `{ accessToken, user, idleTimeoutSec, refreshToken? }` — mobile clients get
/// the refresh token in the body (server/src/controllers/authController.js `issueSession`).
public struct SessionPayload: Decodable, Sendable {
    public let accessToken: String
    public let refreshToken: String?
    public let user: User
    public let idleTimeoutSec: Double?
}

/// A person reference inside other payloads (sender, faculty, participant).
public struct PersonRef: Decodable, Sendable, Identifiable, Equatable, Hashable {
    public let id: String
    public let name: String?
    public let avatar: String?
    public let role: Role?
    public let online: Bool?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, avatar, role, online
    }

    public init(id: String, name: String?, avatar: String? = nil, role: Role? = nil, online: Bool? = nil) {
        self.id = id
        self.name = name
        self.avatar = avatar
        self.role = role
        self.online = online
    }
}
