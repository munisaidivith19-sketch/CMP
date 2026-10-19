import Foundation

/// Where VEXONKit writes diagnostics. The app plugs in `os.Logger`; tests plug in
/// a recorder. Messages passed here have already been redacted.
public protocol LogSink: Sendable {
    func log(_ level: LogLevel, _ message: String)
}

public enum LogLevel: String, Sendable {
    case debug, info, warning, error
}

/// Discards everything (default, and for release builds that want no request logs).
public struct SilentLogSink: LogSink {
    public init() {}
    public func log(_ level: LogLevel, _ message: String) {}
}

/// Removes credentials and personal data before anything is logged.
/// Request logs contain only method, path (ids kept, query values dropped),
/// status and duration — never headers, bodies, tokens, emails or phone numbers.
public enum Redactor {
    private static let patterns: [(NSRegularExpression, String)] = {
        let raw: [(String, String)] = [
            // Bearer / JWT-looking tokens.
            (#"(?i)bearer\s+[A-Za-z0-9\-._~+/]+=*"#, "Bearer [REDACTED]"),
            (#"eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}"#, "[JWT]"),
            // "token":"...", "password":"...", "refreshToken":"..."
            (#"(?i)"(access_?token|refresh_?token|token|password|otp|secret)"\s*:\s*"[^"]*""#, "\"$1\":\"[REDACTED]\""),
            // Email addresses.
            (#"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#, "[EMAIL]"),
            // Phone numbers (10+ digits, optional +country code).
            (#"\+?\d[\d\s-]{8,}\d"#, "[PHONE]"),
        ]
        return raw.compactMap { pattern, template in
            (try? NSRegularExpression(pattern: pattern)).map { ($0, template) }
        }
    }()

    public static func redact(_ text: String) -> String {
        var out = text
        for (re, template) in patterns {
            let range = NSRange(out.startIndex..<out.endIndex, in: out)
            out = re.stringByReplacingMatches(in: out, range: range, withTemplate: template)
        }
        return out
    }

    /// "GET /api/transport/buses/abc?stopId=…" → "GET /api/transport/buses/abc?stopId=[…]".
    public static func describe(method: String, url: URL?) -> String {
        guard let url, let c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return method }
        let names = (c.queryItems ?? []).map { "\($0.name)=[…]" }
        return "\(method) \(c.percentEncodedPath)\(names.isEmpty ? "" : "?" + names.joined(separator: "&"))"
    }
}
