import SwiftUI

/// VEXON palette — the same tokens as the Android app (ui/Theme.kt) and web
/// Tailwind theme, resolved for light and dark mode.
enum Theme {
    static let primary = Color("AccentColor")
    static let background = Color("Background")
    static let success = Color(red: 0x10 / 255, green: 0xB9 / 255, blue: 0x81 / 255)
    static let warning = Color(red: 0xF5 / 255, green: 0x9E / 255, blue: 0x0B / 255)
    static let danger = Color(red: 0xF4 / 255, green: 0x3F / 255, blue: 0x5E / 255)
    static let info = Color(red: 0x0E / 255, green: 0xA5 / 255, blue: 0xE9 / 255)

    /// Bus marker body colours by tracking state (shared with web busMarker.js and Android BusIcon.kt).
    static let busLive = UIColor(red: 0xCB / 255, green: 0x01 / 255, blue: 0x01 / 255, alpha: 1)
    static let busStale = UIColor(red: 0xD9 / 255, green: 0x77 / 255, blue: 0x06 / 255, alpha: 1)
    static let busOffline = UIColor(red: 0x6B / 255, green: 0x72 / 255, blue: 0x80 / 255, alpha: 1)

    static let heroGradient = LinearGradient(
        colors: [Color(red: 0x3E / 255, green: 0x8B / 255, blue: 0xF2 / 255),
                 Color(red: 0x1D / 255, green: 0x6F / 255, blue: 0xEB / 255),
                 Color(red: 0x0B / 255, green: 0x4F / 255, blue: 0x9E / 255)],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )

    static let cornerRadius: CGFloat = 16
}

/// Card surface used across screens.
struct CardBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                    .strokeBorder(Theme.primary.opacity(0.12))
            )
    }
}

extension View {
    func card() -> some View { modifier(CardBackground()) }
}

/// A coloured capsule label ("Live", "Present", "ESCALATED").
struct StatusPill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(color)
            .background(color.opacity(0.14), in: Capsule())
            .accessibilityLabel(text)
    }
}
