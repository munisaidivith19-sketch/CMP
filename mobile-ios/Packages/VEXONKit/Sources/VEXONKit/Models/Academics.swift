import Foundation

/// `{ _id, name, code }` — a subject inside attendance / timetable payloads.
public struct SubjectRef: Decodable, Sendable, Identifiable, Equatable, Hashable {
    public let id: String
    public let name: String?
    public let code: String?
    public let semester: Int?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, code, semester
    }

    public init(id: String, name: String?, code: String?, semester: Int? = nil) {
        self.id = id
        self.name = name
        self.code = code
        self.semester = semester
    }

    public var display: String {
        switch (code, name) {
        case let (c?, n?): return "\(c) · \(n)"
        case let (nil, n?): return n
        case let (c?, nil): return c
        default: return "Subject"
        }
    }
}

// MARK: - Attendance (GET /attendance/my, /attendance/records)

/// Student summary (server/src/controllers/attendanceController.js `studentSummary`).
public struct AttendanceSummary: Decodable, Sendable, Equatable {
    public struct DateRange: Decodable, Sendable, Equatable {
        public let from: String?
        public let to: String?
    }

    public struct Overall: Decodable, Sendable, Equatable {
        public let presentPeriods: Int
        public let odPeriods: Int?
        public let totalPeriods: Int
        public let absentPeriods: Int
        public let percentage: Double
        /// Classes the student can still miss and stay at the threshold.
        public let canMiss: Int?
        /// Classes the student must attend to get back to the threshold.
        public let mustAttend: Int?
    }

    public struct SubjectLine: Decodable, Sendable, Equatable, Identifiable {
        public let subject: SubjectRef
        public let totalPeriods: Int
        public let presentPeriods: Int
        public let odPeriods: Int?
        public let absentPeriods: Int
        public let percentage: Double
        public let lastMarked: Date?

        public var id: String { subject.id }
    }

    public let range: DateRange?
    public let threshold: Double
    public let overall: Overall
    public let subjects: [SubjectLine]
    public let belowThreshold: [SubjectLine]
}

/// Range filter accepted by `/attendance/my` (`rangeQuery` in routes/index.js).
public enum AttendanceRange: String, Sendable, CaseIterable, Identifiable {
    case week, month, semester, all
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .week: return "This week"
        case .month: return "This month"
        case .semester: return "Semester"
        case .all: return "All time"
        }
    }
}

public enum AttendanceStatus: String, Decodable, Sendable {
    case present, absent, od
    public var label: String {
        switch self {
        case .present: return "Present"
        case .absent: return "Absent"
        case .od: return "On duty"
        }
    }
}

public struct AttendanceRecord: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let date: Date
    public let period: Int?
    public let status: AttendanceStatus
    public let subject: Ref<SubjectRef>?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case date, period, status, subject
    }
}

public struct AttendanceRecordsPage: Decodable, Sendable {
    public let records: [AttendanceRecord]
    public let pagination: Pagination
}

// MARK: - Timetable (GET /timetable, /timetable/current)

public enum Weekday: String, Decodable, Sendable, CaseIterable, Identifiable {
    case monday, tuesday, wednesday, thursday, friday, saturday, sunday
    public var id: String { rawValue }
    public var short: String { String(rawValue.prefix(3)).capitalized }

    /// The weekday of a date in a given calendar/time zone (campus time on device).
    public static func of(_ date: Date, calendar: Calendar = .current) -> Weekday {
        // Calendar weekday: 1 = Sunday … 7 = Saturday.
        switch calendar.component(.weekday, from: date) {
        case 1: return .sunday
        case 2: return .monday
        case 3: return .tuesday
        case 4: return .wednesday
        case 5: return .thursday
        case 6: return .friday
        default: return .saturday
        }
    }
}

public struct TimetableSlot: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let dayOfWeek: Weekday
    public let period: Int
    public let startTime: String
    public let endTime: String
    public let room: String?
    public let subject: Ref<SubjectRef>?
    public let faculty: Ref<PersonRef>?
    public let section: String?
    public let department: String?
    public let isBreak: Bool?
    public let breakLabel: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case dayOfWeek, period, startTime, endTime, room, subject, faculty, section, department, isBreak, breakLabel
    }

    public var title: String {
        if isBreak == true { return breakLabel ?? "Break" }
        return subject?.value?.display ?? "Class"
    }
}

public struct TimetableResponse: Decodable, Sendable {
    public let slots: [TimetableSlot]
    public let needsSection: Bool?

    /// Slots grouped by weekday, each day sorted by period.
    public var byDay: [Weekday: [TimetableSlot]] {
        Dictionary(grouping: slots, by: \.dayOfWeek).mapValues { $0.sorted { $0.period < $1.period } }
    }
}

/// `{ current, next, today, weekday, time }`.
public struct CurrentClassResponse: Decodable, Sendable {
    public let current: TimetableSlot?
    public let next: TimetableSlot?
    public let today: [TimetableSlot]
    public let weekday: String?
    public let time: String?
}

// MARK: - Exams (GET /exams)

public struct Exam: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let subjectCode: String
    public let subjectName: String
    public let date: Date
    public let startTime: String
    public let endTime: String
    public let status: String
    public let notes: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case subjectCode, subjectName, date, startTime, endTime, status, notes
    }

    public var isCancelled: Bool { status == "cancelled" }
}

public struct ExamsResponse: Decodable, Sendable {
    public let exams: [Exam]
    public let canManage: Bool?
    public let needsSection: Bool?
}
