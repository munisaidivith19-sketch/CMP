import Foundation

// MARK: - Study materials (GET /study-materials, /study-materials/filters)

/// Server STUDY_MATERIAL_CATEGORIES, in the same order as web and Android.
public enum StudyMaterialCategory: String, Sendable, CaseIterable, Identifiable {
    case notes, questionBank = "question_bank", labManual = "lab_manual", syllabus, assignment, other
    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .notes: return "Notes"
        case .questionBank: return "Question bank"
        case .labManual: return "Lab manual"
        case .syllabus: return "Syllabus"
        case .assignment: return "Assignment"
        case .other: return "Other"
        }
    }

    public static func label(for raw: String?) -> String {
        raw.flatMap { StudyMaterialCategory(rawValue: $0) }?.label ?? (raw ?? "Material")
    }
}

public struct StudyMaterial: Decodable, Sendable, Identifiable, Equatable {
    public struct File: Decodable, Sendable, Equatable {
        public let url: String?
        public let name: String?
    }

    public let id: String
    public let title: String
    public let description: String?
    public let category: String?
    public let department: String?
    public let section: String?
    public let semester: Int?
    public let subjectName: String?
    public let subjectCode: String?
    public let file: File?
    public let createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case title, description, category, department, section, semester, subjectName, subjectCode, file, createdAt
    }

    /// "CS501 · Network Security · Sem 5".
    public var subjectLine: String {
        var parts = [subjectCode, subjectName].compactMap { $0?.isEmpty == false ? $0 : nil }
        if let semester { parts.append("Sem \(semester)") }
        return parts.joined(separator: " · ")
    }
}

public struct StudyMaterialsPage: Decodable, Sendable {
    public let items: [StudyMaterial]
    public let total: Int
    public let page: Int
    public let pages: Int
}

/// What the Materials dropdowns may offer, built by the server from the same
/// read scope as the list. `currentSemester` is set for students only.
public struct StudyMaterialFilters: Decodable, Sendable, Equatable {
    public let currentSemester: Int?
    public let semesters: [Int]
    public let categories: [String]
    public let subjects: [SubjectRef]

    /// A student reads semesters 1 … current; staff any of 1 … 8.
    public var semesterOptions: [Int] {
        Array(1...max(1, currentSemester ?? 8))
    }
}

/// A faculty member's current timetable assignment (GET /study-materials/my-assignments).
public struct TeachingAssignment: Decodable, Sendable, Equatable {
    public let department: String?
    public let section: String?
    public let semester: Int?
    public let year: Int?
    public let subject: SubjectRef?

    /// "CSE · Year 3 · Section A".
    public var classLine: String {
        var parts: [String] = []
        if let department, !department.isEmpty { parts.append(department) }
        if let year { parts.append("Year \(year)") }
        if let section, !section.isEmpty { parts.append("Section \(section)") }
        return parts.joined(separator: " · ")
    }
}
