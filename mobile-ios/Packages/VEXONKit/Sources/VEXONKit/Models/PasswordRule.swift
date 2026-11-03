import Foundation

/// The password rule (mirrors server/src/utils/passwordPolicy.js, which is the real check).
public enum PasswordRule {
    public static let hint = "8–72 characters with a capital letter, a small letter, a number and a symbol"

    /// The first rule this password breaks, or nil.
    public static func problem(_ p: String) -> String? {
        let u = Array(p.utf16)
        let isUpper = { (c: UInt16) in c >= 65 && c <= 90 }
        let isLower = { (c: UInt16) in c >= 97 && c <= 122 }
        let isDigit = { (c: UInt16) in c >= 48 && c <= 57 }
        let isSpace = { (c: UInt16) in Unicode.Scalar(c)?.properties.isWhitespace ?? false }
        if u.count < 8 { return "Use at least 8 characters." }
        if u.count > 72 { return "Use at most 72 characters." }
        if !u.contains(where: isUpper) { return "Include a capital letter." }
        if !u.contains(where: isLower) { return "Include a small letter." }
        if !u.contains(where: isDigit) { return "Include a number." }
        if !u.contains(where: { !isUpper($0) && !isLower($0) && !isDigit($0) && !isSpace($0) }) { return "Include a symbol." }
        return nil
    }
}
