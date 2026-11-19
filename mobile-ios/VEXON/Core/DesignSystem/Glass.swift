import SwiftUI

// VEXON's glass design system.
//
// Two kinds of surface, used consistently:
//
// * `glass(...)`   — a FLOATING surface over live content (map controls, banners,
//                    the chat composer, panels over the map). On iOS 26+ it is real
//                    Liquid Glass (`glassEffect`); on iOS 17–25 it is a blurred
//                    system material with a light rim and a soft shadow.
// * `frosted(...)` — a CONTENT surface (cards, list rows). A translucent fill with
//                    the same rim. It never blurs live content, so long lists stay
//                    smooth on older iPhones — the backdrop behind it is already a
//                    soft gradient, which is what a blur of it would look like.
//
// Both honour Reduce Transparency (they become opaque) and both adapt to dark mode.

// MARK: - Tokens

enum GlassTokens {
    /// Translucent fill of a content surface.
    static let fill = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(white: 1, alpha: 0.08)
            : UIColor(white: 1, alpha: 0.62)
    })

    /// Used instead of any translucency when Reduce Transparency is on.
    static let opaqueFill = Color(uiColor: .secondarySystemGroupedBackground)

    /// Fill of a text field or an inset well drawn on top of glass.
    static let well = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(white: 1, alpha: 0.07)
            : UIColor(white: 0, alpha: 0.045)
    })

    /// The light edge that makes a surface read as glass: bright top-left, faint bottom-right.
    static func rim(_ scheme: ColorScheme) -> LinearGradient {
        LinearGradient(
            colors: scheme == .dark
                ? [Color.white.opacity(0.30), Color.white.opacity(0.05)]
                : [Color.white.opacity(0.95), Color.white.opacity(0.30)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

// MARK: - Backdrop

/// The soft colour field every screen sits on. Static (no animation), so it costs
/// nothing while scrolling. Fills the whole screen, including behind the bars and
/// the keyboard.
struct AppBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            let h = proxy.size.height
            let dark = scheme == .dark
            ZStack {
                Theme.background
                glow(Theme.primary, opacity: dark ? 0.38 : 0.24, radius: w * 0.95)
                    .position(x: w * 0.08, y: h * 0.06)
                glow(Theme.aurora, opacity: dark ? 0.26 : 0.16, radius: w * 0.85)
                    .position(x: w * 1.0, y: h * 0.36)
                glow(Theme.info, opacity: dark ? 0.22 : 0.18, radius: w * 0.9)
                    .position(x: w * 0.15, y: h * 0.98)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }

    private func glow(_ color: Color, opacity: Double, radius: CGFloat) -> some View {
        Circle()
            .fill(RadialGradient(
                colors: [color.opacity(opacity), color.opacity(0)],
                center: .center,
                startRadius: 0,
                endRadius: max(radius, 1)
            ))
            .frame(width: max(radius, 1) * 2, height: max(radius, 1) * 2)
    }
}

// MARK: - Surfaces

struct GlassSurface<S: InsettableShape>: ViewModifier {
    enum Kind { case floating, content }

    let shape: S
    let kind: Kind
    var tint: Color?
    var interactive = false

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var scheme

    @ViewBuilder
    func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background { shape.fill(GlassTokens.opaqueFill) }
                .overlay { shape.strokeBorder(Color.primary.opacity(0.18), lineWidth: 1).allowsHitTesting(false) }
        } else {
            switch kind {
            case .content: frosted(content)
            case .floating: floating(content)
            }
        }
    }

    private func frosted(_ content: Content) -> some View {
        content
            .background {
                shape.fill(GlassTokens.fill)
                    .overlay { shape.fill((tint ?? Color.clear).opacity(tint == nil ? 0 : 0.12)) }
                    .shadow(color: Color.black.opacity(scheme == .dark ? 0.22 : 0.06), radius: 10, y: 4)
            }
            .overlay { shape.strokeBorder(GlassTokens.rim(scheme), lineWidth: 1).allowsHitTesting(false) }
    }

    @ViewBuilder
    private func floating(_ content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            content.glassEffect(liquid, in: shape)
        } else {
            material(content)
        }
        #else
        material(content)
        #endif
    }

    /// iOS 17–25: blurred system material, tint wash, rim and shadow.
    private func material(_ content: Content) -> some View {
        content
            .background {
                shape.fill(.thinMaterial)
                    .overlay { shape.fill((tint ?? Color.clear).opacity(tint == nil ? 0 : 0.16)) }
                    .shadow(color: Color.black.opacity(scheme == .dark ? 0.40 : 0.14), radius: 14, y: 6)
            }
            .overlay { shape.strokeBorder(GlassTokens.rim(scheme), lineWidth: 1).allowsHitTesting(false) }
    }

    #if compiler(>=6.2)
    @available(iOS 26.0, *)
    private var liquid: Glass {
        var glass = Glass.regular
        if let tint { glass = glass.tint(tint.opacity(0.35)) }
        if interactive { glass = glass.interactive() }
        return glass
    }
    #endif
}

/// Row background for grouped lists and forms.
struct GlassRowBackground: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        Rectangle().fill(reduceTransparency ? GlassTokens.opaqueFill : GlassTokens.fill)
    }
}

extension View {
    /// Floating glass in any shape (Liquid Glass on iOS 26+).
    func glass<S: InsettableShape>(in shape: S, tint: Color? = nil, interactive: Bool = false) -> some View {
        modifier(GlassSurface(shape: shape, kind: .floating, tint: tint, interactive: interactive))
    }

    /// Floating glass in a continuous rounded rectangle.
    func glass(cornerRadius: CGFloat = Theme.cornerRadius, tint: Color? = nil, interactive: Bool = false) -> some View {
        glass(in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous), tint: tint, interactive: interactive)
    }

    /// Frosted content surface in any shape.
    func frosted<S: InsettableShape>(in shape: S, tint: Color? = nil) -> some View {
        modifier(GlassSurface(shape: shape, kind: .content, tint: tint))
    }

    /// Frosted content surface in a continuous rounded rectangle.
    func frosted(cornerRadius: CGFloat = Theme.cornerRadius, tint: Color? = nil) -> some View {
        frosted(in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous), tint: tint)
    }

    /// The app backdrop behind a screen that is not a list.
    func screenBackground() -> some View {
        background { AppBackground() }
    }

    /// A `List` / `Form` on the app backdrop instead of the opaque system background.
    func glassList() -> some View {
        scrollContentBackground(.hidden).background { AppBackground() }
    }

    /// Frosted rows for a grouped `List` / `Form` (apply to a row, a `Section`, or a `Group` of them).
    func glassRow() -> some View {
        listRowBackground(GlassRowBackground())
    }

    /// A full-width frosted card around compact content (the inside of a button label, for example).
    func glassCard() -> some View {
        padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frosted(cornerRadius: Theme.cornerRadius)
    }

    /// A row of a plain `List` with no separator or background of its own, for card rows.
    func clearListRow() -> some View {
        listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }

    /// A row of a plain `List` drawn as its own frosted card (no separators).
    func glassCardRow() -> some View {
        glassCard().clearListRow()
    }

    /// A sheet whose backdrop is glass. iOS 26 sheets are Liquid Glass already.
    @ViewBuilder
    func glassSheet() -> some View {
        if #available(iOS 26.0, *) {
            self
        } else {
            presentationBackground(.regularMaterial)
        }
    }

    /// iOS 26: the floating tab bar shrinks out of the way while scrolling down.
    @ViewBuilder
    func minimizingTabBar() -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            tabBarMinimizeBehavior(.onScrollDown)
        } else {
            self
        }
        #else
        self
        #endif
    }
}

// MARK: - Motion

enum Motion {
    /// Screen and panel changes.
    static let smooth = Animation.spring(response: 0.45, dampingFraction: 0.86)
    /// Small state changes (a pill, an error line, a press).
    static let snappy = Animation.spring(response: 0.3, dampingFraction: 0.8)
    /// Used instead of movement when Reduce Motion is on.
    static let reduced = Animation.easeInOut(duration: 0.2)
}

/// Fades and lifts a view in the first time it appears; `index` staggers a column of cards.
/// With Reduce Motion it only fades.
struct Entrance: ViewModifier {
    let index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 16)
            .onAppear {
                guard !shown else { return }
                let animation = reduceMotion ? Motion.reduced : Motion.smooth.delay(Double(min(index, 8)) * 0.06)
                withAnimation(animation) { shown = true }
            }
    }
}

extension View {
    func entrance(_ index: Int = 0) -> some View { modifier(Entrance(index: index)) }
}

/// Pressed: slightly smaller and dimmed, springing back on release.
struct PressableButtonStyle: ButtonStyle {
    var scale: CGFloat = 0.96

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.82 : 1)
            .animation(Motion.snappy, value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PressableButtonStyle {
    static var pressable: PressableButtonStyle { PressableButtonStyle() }
}

/// The main call-to-action: full-width gradient with a glass rim.
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PrimaryButtonBody(configuration: configuration)
    }

    private struct PrimaryButtonBody: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
            configuration.label
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(Theme.heroGradient, in: shape)
                .overlay { shape.strokeBorder(Color.white.opacity(0.35), lineWidth: 1).allowsHitTesting(false) }
                .shadow(color: Theme.primary.opacity(isEnabled ? 0.35 : 0), radius: 12, y: 6)
                .opacity(isEnabled ? 1 : 0.55)
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .animation(Motion.snappy, value: configuration.isPressed)
                .contentShape(shape)
        }
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

// MARK: - Layout

/// Content that is exactly as tall as it needs to be, up to `maxHeight`; beyond that
/// it scrolls. Used for panels over the map so they can never grow past the screen
/// on a small iPhone or at a large text size.
struct FittingScroll<Content: View>: View {
    let maxHeight: CGFloat
    @ViewBuilder let content: Content
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        ScrollView {
            content
                .onGeometryChange(for: CGFloat.self) { proxy in
                    proxy.size.height
                } action: { height in
                    contentHeight = height
                }
        }
        .scrollBounceBehavior(.basedOnSize)
        // While everything fits, let shadows of the content draw past the edge.
        .scrollClipDisabled(contentHeight <= maxHeight)
        .frame(height: max(1, min(contentHeight, max(maxHeight, 1))))
    }
}
