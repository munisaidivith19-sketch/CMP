import SwiftUI
import VEXONKit

/// Swaps the whole UI between launch, sign-in and the signed-in tabs.
struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Which top-level screen is showing — the value the screen transition animates on.
    private enum Screen: Equatable { case launching, offline, signIn, passwordChange, checking, permission, main }

    private var screen: Screen {
        switch model.phase {
        case .launching: return .launching
        case .offlineLaunch: return .offline
        case .signedOut: return .signIn
        case .signedIn(let user) where user.mustChangePassword == true: return .passwordChange
        case .signedIn:
            switch model.push.gate {
            case .allowed: return .main
            case .checking: return .checking
            case .canRequest, .settingsOnly: return .permission
            }
        }
    }

    private var showsOfflineBanner: Bool { model.user != nil && !model.isOnline }

    var body: some View {
        ZStack {
            AppBackground()
            switch model.phase {
            case .launching:
                LaunchView().transition(.opacity)
            case .offlineLaunch:
                OfflineLaunchView().transition(.opacity)
            case .signedOut(let sessionEnded):
                LoginView(sessionEnded: sessionEnded).transition(.opacity)
            case .signedIn(let user) where user.mustChangePassword == true:
                PasswordChangeRequiredView().transition(.opacity)
            case .signedIn(let user):
                switch model.push.gate {
                case .allowed:
                    MainTabView(user: user)
                        // New identity = brand-new view tree: no state carries over between accounts.
                        .id(user.id)
                        .transition(.opacity)
                case .checking:
                    LaunchView().transition(.opacity)
                case .canRequest, .settingsOnly:
                    // Notifications are mandatory once signed in (sign-in itself is never gated).
                    NotificationRequiredView(state: model.push.gate).transition(.opacity)
                }
            }
        }
        // The offline pill takes its own row above the screen (the navigation bar moves
        // down for it), so it never covers a title or a toolbar button on any iPhone.
        .safeAreaInset(edge: .top, spacing: 0) {
            if showsOfflineBanner { OfflineBanner() }
        }
        .animation(reduceMotion ? Motion.reduced : Motion.smooth, value: screen)
        .animation(reduceMotion ? Motion.reduced : Motion.smooth, value: showsOfflineBanner)
    }
}

private struct LaunchView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    var body: some View {
        VStack(spacing: 22) {
            Image("Logo")
                .resizable()
                .scaledToFit()
                .frame(width: 76, height: 76)
                .padding(22)
                .glass(in: Circle())
                .scaleEffect(breathing ? 1.04 : 0.97)
                .accessibilityHidden(true)
            ProgressView()
                .accessibilityLabel("Starting VEXON")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) { breathing = true }
        }
    }
}

/// Thin pill while the server is unreachable; screens refetch when it comes back.
private struct OfflineBanner: View {
    var body: some View {
        Label("Offline — reconnecting…", systemImage: "wifi.slash")
            .font(.footnote.weight(.semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .glass(in: Capsule(), tint: Theme.warning)
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity)
            .transition(.move(edge: .top).combined(with: .opacity))
            .accessibilityAddTraits(.updatesFrequently)
    }
}

struct MainTabView: View {
    let user: User
    @Environment(AppModel.self) private var model
    @State private var selection: Tab = .home
    @State private var banner: InAppBanner?

    enum Tab: Hashable { case home, chat, bus, notifications, profile }

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack { DashboardView(user: user) }
                .tabItem { Label("Home", systemImage: "house") }
                .tag(Tab.home)

            if FeatureAccess.allows(.chat, for: user.role) {
                NavigationStack { ConversationsView() }
                    .tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }
                    .tag(Tab.chat)
            }

            if FeatureAccess.allows(.busTracking, for: user.role) {
                NavigationStack { BusTrackingView() }
                    .tabItem { Label("Bus", systemImage: "bus") }
                    .tag(Tab.bus)
            }

            NavigationStack { NotificationsView() }
                .tabItem { Label("Alerts", systemImage: "bell") }
                .tag(Tab.notifications)

            NavigationStack { ProfileView(user: user) }
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
                .tag(Tab.profile)
        }
        .minimizingTabBar()
        .sensoryFeedback(.selection, trigger: selection)
        .overlay(alignment: .top) {
            if let banner {
                InAppBannerView(banner: banner, onOpen: { open(banner) }, onDismiss: { self.banner = nil })
                    .id(banner.id)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(Motion.smooth, value: banner)
        .sensoryFeedback(.impact(weight: .light), trigger: banner?.id)
        .task { await popUps() }
        .task(id: banner?.id) {
            // Auto-dismiss; a newer banner restarts the timer.
            guard banner != nil else { return }
            try? await Task.sleep(for: .seconds(4.5))
            if !Task.isCancelled { banner = nil }
        }
    }

    /// While the app is open, new notifications and chat messages pop up as a
    /// banner — unless the user is already looking at them.
    private func popUps() async {
        for await event in model.realtime.events() {
            switch event.name {
            case "notification":
                guard selection != .notifications, let n = event.decode(AppNotification.self) else { continue }
                banner = InAppBanner(title: n.title, text: n.message, isChat: n.category == "chat")
            case "chat:message":
                guard let e = event.decode(ChatMessageEvent.self), e.message.sender.id != user.id,
                      model.openConversationId != e.conversationId else { continue }
                banner = InAppBanner(title: e.message.sender.value?.name ?? "New message", text: e.message.body ?? "📎 Attachment", isChat: true)
            default:
                continue
            }
        }
    }

    private func open(_ banner: InAppBanner) {
        self.banner = nil
        selection = banner.isChat && FeatureAccess.allows(.chat, for: user.role) ? .chat : .notifications
    }
}
