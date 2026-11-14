import Foundation

/// The password rule (mirrors server/src/utils/passwordPolicy.js, which is the real check).
public enum PasswordRule {
    public static let hint = "8–72 characters with a capital letter, a small letter, a number and a symbol"

    /// The UTF-16 units JavaScript's `\s` matches (ECMAScript WhiteSpace + LineTerminator).
    static let jsWhitespace: Set<UInt16> = Set<UInt16>([0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF])
        .union(0x2000...0x200A)

    /// The first rule this password breaks, or nil.
    public static func problem(_ p: String) -> String? {
        let u = Array(p.utf16)
        let isUpper = { (c: UInt16) in c >= 65 && c <= 90 }
        let isLower = { (c: UInt16) in c >= 97 && c <= 122 }
        let isDigit = { (c: UInt16) in c >= 48 && c <= 57 }
        // Exactly JavaScript's \s (the server's check): includes U+FEFF, excludes U+0085.
        let isSpace = { (c: UInt16) in jsWhitespace.contains(c) }
        if u.count < 8 { return "Use at least 8 characters." }
        if u.count > 72 { return "Use at most 72 characters." }
        if !u.contains(where: isUpper) { return "Include a capital letter." }
        if !u.contains(where: isLower) { return "Include a small letter." }
        if !u.contains(where: isDigit) { return "Include a number." }
        if !u.contains(where: { !isUpper($0) && !isLower($0) && !isDigit($0) && !isSpace($0) }) { return "Include a symbol." }
        return nil
    }
}
