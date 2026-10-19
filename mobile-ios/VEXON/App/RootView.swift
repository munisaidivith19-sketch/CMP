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
            case .signedIn(let user):
                MainTabView(user: user)
                    // New identity = brand-new view tree: no state carries over between accounts.
                    .id(user.id)
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
    }
}
