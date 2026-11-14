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
            // Authorization values of any scheme (Basic, Token, …) and Bearer / JWT-looking tokens.
            (#"(?i)(authorization["']?\s*[:=]\s*["']?)([A-Za-z]+)\s+[^\s"',;]+"#, "$1$2 [REDACTED]"),
            (#"(?i)bearer\s+[A-Za-z0-9\-._~+/]+=*"#, "Bearer [REDACTED]"),
            (#"eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}"#, "[JWT]"),
            // Any JSON key that names a secret: "password", "newPassword", "refreshToken",
            // "pushToken", "clientSecret", "otp" … — string values (escaped quotes included) or numbers.
            (#"(?i)"([A-Za-z_]*(?:token|password|passwd|secret)[A-Za-z_]*|otp)"\s*:\s*(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)"#, "\"$1\":\"[REDACTED]\""),
            // Secrets in a URL query (?token=…, &refresh_token=…).
            (#"(?i)([?&](?:[A-Za-z_]*token|password|otp|code|secret)=)[^&\s"']+"#, "$1[REDACTED]"),
            // Email addresses.
            (#"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#, "[EMAIL]"),
            // Phone numbers: 10–12 digits (optional +country code, spaces or dashes), standing
            // alone — so ids ("65f0…01"), dates ("2026-10-16") and epoch-ms timestamps survive.
            (#"(?<![\w+-])\+?\d(?:[ -]?\d){9,11}(?![\w-])"#, "[PHONE]"),
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
