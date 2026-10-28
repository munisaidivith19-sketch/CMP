import SwiftUI
import VEXONKit

/// Shown instead of the main tabs while a signed-in user has not fully allowed
/// notifications (see `NotificationGate`). It never prompts by itself: the
/// user taps Enable. The status is re-read whenever the app becomes active, so
/// allowing notifications in Settings and coming back continues automatically.
struct NotificationRequiredView: View {
    let state: NotificationGate.State
    @Environment(AppModel.self) private var app
    @State private var busy = false
    @State private var settingsFailed = false
    @State private var signingOut = false

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Image(systemName: "bell.slash.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(Theme.primary)
                    .frame(width: 72, height: 72)
                    .background(Theme.primary.opacity(0.12), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
                    .accessibilityHidden(true)

                Text("Notifications Required")
                    .font(.title2.bold())
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)

                Text("Notifications are required to use JNN. Please enable notifications to continue using the app and receive important updates.")
                    .multilineTextAlignment(.center)

                Text(state == .canRequest
                     ? "Tap Enable Notifications and choose Allow."
                     : "Notifications are turned off for JNN. Tap Open Settings, turn on Allow Notifications, then come back — JNN continues automatically.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                if settingsFailed {
                    Text("Settings could not be opened. Open the Settings app → JNN → Notifications and turn on Allow Notifications.")
                        .font(.footnote)
                        .foregroundStyle(Theme.danger)
                        .multilineTextAlignment(.center)
                }

                Button {
                    Task { await enable() }
                } label: {
                    if busy { ProgressView() } else { Text("Enable Notifications").frame(maxWidth: .infinity) }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(busy || signingOut)

                Button {
                    Task { await openSettings() }
                } label: {
                    Text("Open Settings").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(signingOut)

                Button("Sign out") {
                    signingOut = true
                    Task {
                        await app.signOut()
                        signingOut = false
                    }
                }
                .disabled(signingOut)
            }
            .padding(28)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .defaultScrollAnchor(.center)
        .background(Theme.background.ignoresSafeArea())
    }

    private func enable() async {
        busy = true
        defer { busy = false }
        settingsFailed = false
        if state == .canRequest {
            // iOS shows its prompt once (and again from provisional); the result updates the gate.
            await app.push.requestPermission()
        } else {
            // Denied: iOS never prompts again, only Settings can turn it back on.
            await openSettings()
        }
    }

    private func openSettings() async {
        settingsFailed = !(await app.push.openSettings())
    }
}
