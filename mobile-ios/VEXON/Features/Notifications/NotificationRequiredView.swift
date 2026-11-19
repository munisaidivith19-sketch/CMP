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
                    .frame(width: 84, height: 84)
                    .glass(cornerRadius: 28, tint: Theme.primary)
                    .accessibilityHidden(true)

                Text("Notifications Required")
                    .font(.title2.bold())
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)

                Text("Notifications are required to use JNN. Please enable notifications to continue using the app and receive important updates.")
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

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
                    if busy { ProgressView().tint(.white) } else { Text("Enable Notifications") }
                }
                .buttonStyle(.primary)
                .disabled(busy || signingOut)

                Button {
                    Task { await openSettings() }
                } label: {
                    Text("Open Settings")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .glass(cornerRadius: 14, interactive: true)
                }
                .buttonStyle(.pressable)
                .disabled(signingOut)

                Button("Sign out") {
                    signingOut = true
                    Task {
                        await app.signOut()
                        signingOut = false
                    }
                }
                .disabled(signingOut)
                .frame(minHeight: 44)
            }
            .padding(24)
            .frosted(cornerRadius: 28)
            .padding(20)
            .entrance()
            .animation(Motion.snappy, value: settingsFailed)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .defaultScrollAnchor(.center)
        .screenBackground()
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
