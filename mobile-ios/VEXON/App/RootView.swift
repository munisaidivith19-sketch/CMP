import SwiftUI
import VEXONKit

/// Swaps the whole UI between launch, sign-in and the signed-in tabs.
struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack(alignment: .top) {
            switch model.phase {
            case .launching:
                LaunchView()
            case .offlineLaunch:
                OfflineLaunchView()
            case .signedOut(let sessionEnded):
                LoginView(sessionEnded: sessionEnded)
            case .signedIn(let user) where user.termsAcceptanceRequired:
                // The current Terms come first; the server refuses every other API until then.
                TermsAcceptanceView()
            case .signedIn(let user):
                switch model.push.gate {
                case .allowed:
                    MainTabView(user: user)
                        // New identity = brand-new view tree: no state carries over between accounts.
                        .id(user.id)
                case .checking:
                    LaunchView()
                case .canRequest, .settingsOnly:
                    // Notifications are mandatory once signed in (sign-in itself is never gated).
                    NotificationRequiredView(state: model.push.gate)
                }
            }
            if model.user != nil && !model.isOnline {
                OfflineBanner()
            }
        }
        .animation(.default, value: model.isOnline)
    }
}

private struct LaunchView: View {
    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            ProgressView()
                .accessibilityLabel("Starting VEXON")
        }
    }
}

/// Thin banner while the server is unreachable; screens refetch when it comes back.
private struct OfflineBanner: View {
    var body: some View {
        Label("Offline — reconnecting…", systemImage: "wifi.slash")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(Color(red: 0.11, green: 0.11, blue: 0.23).opacity(0.92), in: Capsule())
            .padding(.top, 4)
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
        .overlay(alignment: .top) {
            if let banner {
                InAppBannerView(banner: banner, onOpen: { open(banner) }, onDismiss: { self.banner = nil })
                    .id(banner.id)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.35), value: banner)
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
