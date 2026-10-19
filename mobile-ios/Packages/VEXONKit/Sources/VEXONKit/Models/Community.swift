import Foundation

// MARK: - Complaints / grievances (GET/POST /complaints)

/// Categories, subcategories and escalation targets — the server's lists
/// (server/src/constants.js). The server re-validates every value; these only
/// drive the form so a student cannot pick a combination the server rejects.
public enum ComplaintCatalog {
    public static let categories = ["academics", "ragging_harassment", "infrastructure", "hostel"]

    public static let subcategories: [String: [String]] = [
        "academics": ["subject", "faculty_conduct", "attendance", "exam_and_evaluation"],
        "ragging_harassment": [],
        "infrastructure": ["classroom", "network", "water", "restroom", "electronic_appliance", "environment_and_pathway"],
        "hostel": ["mess", "electricity", "water", "housekeeping", "pest_control", "laundry", "network", "restroom"],
    ]

    public static let escalateTo: [String: [String]] = [
        "academics": ["faculty", "hod", "principal", "dean", "ao", "chairman"],
        "ragging_harassment": ["hod", "principal", "dean", "ao", "chairman"],
        "infrastructure": ["hod", "principal", "dean", "ao", "chairman"],
        "hostel": ["warden", "ao", "chairman"],
    ]

    public static let descriptionLength = 10...2000

    /// "exam_and_evaluation" → "Exam and evaluation".
    public static func label(_ key: String) -> String {
        if let role = ["hod": "HOD", "ao": "AO"][key] { return role }
        let words = key.replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}

public struct NewComplaint: Encodable, Sendable, Equatable {
    public var category: String
    public var subCategory: String?
    public var escalateTo: String
    public var description: String
    public var anonymous: Bool

    public init(category: String, subCategory: String?, escalateTo: String, description: String, anonymous: Bool) {
        self.category = category
        self.subCategory = subCategory
        self.escalateTo = escalateTo
        self.description = description
        self.anonymous = anonymous
    }

    /// Client-side check mirroring `complaintCreateRules`; nil when valid.
    public func validationError() -> String? {
        guard ComplaintCatalog.categories.contains(category) else { return "Choose a valid grievance category" }
        let subs = ComplaintCatalog.subcategories[category] ?? []
        if !subs.isEmpty, !(subCategory.map(subs.contains) ?? false) { return "Choose a valid subcategory" }
        guard (ComplaintCatalog.escalateTo[category] ?? []).contains(escalateTo) else { return "Choose a valid authority to escalate to" }
        let length = description.trimmingCharacters(in: .whitespacesAndNewlines).count
        guard ComplaintCatalog.descriptionLength.contains(length) else { return "Describe the grievance (10–2000 characters)" }
        return nil
    }

    enum CodingKeys: String, CodingKey { case category, subCategory, escalateTo, description, anonymous }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(category, forKey: .category)
        try c.encodeIfPresent(subCategory, forKey: .subCategory)
        try c.encode(escalateTo, forKey: .escalateTo)
        try c.encode(description.trimmingCharacters(in: .whitespacesAndNewlines), forKey: .description)
        try c.encode(anonymous, forKey: .anonymous)
    }
}

public struct Complaint: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let complaintCode: String?
    public let category: String
    public let subCategory: String?
    public let description: String?
    public let status: String
    public let priority: String?
    public let anonymous: Bool?
    public let currentAuthorityRole: String?
    public let escalationLevel: Int?
    public let createdAt: Date?
    public let resolvedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case complaintCode, category, subCategory, description, status, priority, anonymous, currentAuthorityRole, escalationLevel, createdAt, resolvedAt
    }

    /// Statuses the server lets a student cancel from (`COMPLAINT_CANCELLABLE_STATUSES`).
    public var isCancellable: Bool { ["SUBMITTED", "IN_REVIEW", "IN_PROGRESS"].contains(status) }

    public var statusLabel: String {
        status.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

public struct ComplaintsPage: Decodable, Sendable {
    public let complaints: [Complaint]
    public let pagination: Pagination
}

// MARK: - Notifications (GET /notifications)

public struct AppNotification: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let type: String?
    public let title: String
    public let message: String?
    public let link: String?
    public let read: Bool
    public let category: String?
    public let createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case type, title, message, link, read, category, createdAt
    }
}

/// `{ items, unread, total, page, limit, pages }`.
public struct NotificationsPage: Decodable, Sendable {
    public let items: [AppNotification]
    public let unread: Int
    public let total: Int
    public let page: Int
    public let limit: Int
    public let pages: Int

    public var hasMore: Bool { page < pages }
}

/// `{ disabled, reminderMinutes, optional, reminderChoices }`.
public struct NotificationPreferences: Decodable, Sendable, Equatable {
    public var disabled: [String]
    public var reminderMinutes: Int
    public let optional: [String]
    public let reminderChoices: [Int]
}

// MARK: - Chat (GET /chat/conversations, /chat/conversations/:id/messages)

public struct ChatLastMessage: Decodable, Sendable, Equatable {
    public let body: String?
    public let sender: Ref<PersonRef>?
    public let sentAt: Date?
}

public struct Conversation: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let type: String
    public let name: String?
    public let participants: [PersonRef]
    public let lastMessage: ChatLastMessage?
    public let unreadCount: Int?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case type, name, participants, lastMessage, unreadCount
    }

    /// Group name, or the other person's name in a private chat.
    public func title(myId: String?) -> String {
        if type != "private", let name, !name.isEmpty { return name }
        return participants.first { $0.id != myId }?.name ?? name ?? "Conversation"
    }
}

public struct ChatAttachment: Decodable, Sendable, Equatable {
    public let url: String?
    public let name: String?
    public let mimeType: String?
}

public struct ChatMessage: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let conversation: String?
    public let sender: Ref<PersonRef>
    public let body: String?
    public let createdAt: Date
    public let deletedAt: Date?
    public let editedAt: Date?
    public let attachment: ChatAttachment?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case conversation, sender, body, createdAt, deletedAt, editedAt, attachment
    }
}

public struct MessagesPage: Decodable, Sendable {
    public let messages: [ChatMessage]
    public let pagination: Pagination
}

/// Socket event `chat:message` → `{ conversationId, message }`.
public struct ChatMessageEvent: Decodable, Sendable {
    public let conversationId: String
    public let message: ChatMessage
}

public struct NewChatMessage: Encodable, Sendable {
    public let body: String
    public init(body: String) { self.body = body }

    /// The server accepts 1–5000 characters after trimming.
    public static func validated(_ text: String) -> NewChatMessage? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...5000).contains(trimmed.count) else { return nil }
        return NewChatMessage(body: trimmed)
    }
}
