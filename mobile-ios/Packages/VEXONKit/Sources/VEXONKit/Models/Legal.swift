import Foundation

/// `user.legal` from `/auth/login`, `/auth/refresh`, `/auth/me` and the answer
/// of `POST /legal/accept` (server/src/services/legal.js `legalStatus`).
/// Version numbers only — the app never shows an acceptance history.
public struct LegalStatus: Codable, Sendable, Equatable {
    public let termsRequired: Bool
    public let termsVersion: Int?
    public let termsAcceptedVersion: Int?
    public let privacyVersion: Int?

    public init(termsRequired: Bool, termsVersion: Int? = nil, termsAcceptedVersion: Int? = nil, privacyVersion: Int? = nil) {
        self.termsRequired = termsRequired
        self.termsVersion = termsVersion
        self.termsAcceptedVersion = termsAcceptedVersion
        self.privacyVersion = privacyVersion
    }

    /// The same status, marked as needing acceptance (after a 403 from the Terms gate).
    public var markedRequired: LegalStatus {
        LegalStatus(termsRequired: true, termsVersion: termsVersion, termsAcceptedVersion: termsAcceptedVersion, privacyVersion: privacyVersion)
    }
}

/// A published policy version (`GET /legal/policies/:policyId`). Public.
public struct PolicyDocument: Decodable, Sendable, Equatable {
    public let policyId: String
    public let title: String
    public let version: Int
    public let effectiveAt: Date?
    public let content: String
}

/// Terms and Conditions / Privacy Policy — shared with the web (client/src/utils/legal.js)
/// and Android (core/Legal.kt). The server decides and enforces; nothing here is a security boundary.
public enum Legal {
    public enum Policy: String, Sendable, CaseIterable, Identifiable {
        case terms, privacy
        public var id: String { rawValue }
        public var title: String { self == .terms ? "Terms and Conditions" : "Privacy Policy" }
    }

    public static let termsRequiredCode = "TERMS_ACCEPTANCE_REQUIRED"
    public static let versionChangedCode = "POLICY_VERSION_CHANGED"
    public static let checkboxLabel = "I have read and agree to the Terms and Conditions."
    public static let appName = "J.N.N Campus Connect"
    public static let institution = "J.N.N Institute of Engineering"

    public enum Entry: String, Sendable, CaseIterable, Identifiable {
        case about, terms, privacy
        public var id: String { rawValue }
        public var label: String {
            switch self {
            case .about: return "About the App"
            case .terms: return "Terms and Conditions"
            case .privacy: return "Privacy Policy"
            }
        }
    }

    /// The profile's "About the App" section: exactly these three entries.
    public static let aboutEntries: [Entry] = Entry.allCases

    /// A 403 from the server's Terms gate.
    public static func isTermsRequired(_ error: APIError) -> Bool {
        if case .forbidden(let body) = error { return body?.code == termsRequiredCode }
        return false
    }

    /// The Terms changed while the acceptance screen was open.
    public static func isVersionChanged(_ error: APIError) -> Bool {
        if case .conflict(let body) = error { return body?.code == versionChangedCode }
        return false
    }

    /// "22 October 2026" — effective dates are calendar dates (UTC).
    public static func formatEffective(_ date: Date?) -> String {
        guard let date else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "d MMMM yyyy"
        return f.string(from: date)
    }

    /// One displayable block of a policy's Markdown text. Rendered as plain
    /// styled text — the content is never interpreted as HTML.
    public enum Block: Sendable, Equatable {
        case heading(String)
        case bullet(String)
        case paragraph(String)
    }

    /// Split policy Markdown into headings, bullets and paragraphs (blank lines
    /// separate paragraphs; a leading "> " is dropped).
    public static func blocks(_ markdown: String) -> [Block] {
        var out: [Block] = []
        var paragraph: [String] = []
        func flush() {
            if !paragraph.isEmpty { out.append(.paragraph(paragraph.joined(separator: " "))) }
            paragraph = []
        }
        for raw in markdown.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false) {
            var line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix(">") { line = String(line.dropFirst()).trimmingCharacters(in: .whitespaces) }
            if line.isEmpty { flush(); continue }
            if let hashes = line.firstIndex(where: { $0 != "#" }), hashes != line.startIndex, line[hashes] == " " {
                flush()
                out.append(.heading(String(line[hashes...]).trimmingCharacters(in: .whitespaces)))
            } else if line.hasPrefix("- ") || line.hasPrefix("* ") {
                flush()
                out.append(.bullet(String(line.dropFirst(2))))
            } else {
                paragraph.append(line)
            }
        }
        flush()
        return out
    }
}
