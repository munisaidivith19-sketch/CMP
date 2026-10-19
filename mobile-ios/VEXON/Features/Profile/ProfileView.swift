import SwiftUI
import VEXONKit

/// The signed-in account (own data only) and sign-out. Profile editing,
/// password change and session management remain on web / Android in this phase.
struct ProfileView: View {
    let user: User
    @Environment(AppModel.self) private var app
    @State private var confirmSignOut = false
    @State private var signingOut = false

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    AsyncImage(url: avatarURL) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Image(systemName: "person.crop.circle.fill").resizable().foregroundStyle(Theme.primary.opacity(0.5))
                    }
                    .frame(width: 64, height: 64)
                    .clipShape(Circle())
                    .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(user.displayName).font(.title3.bold())
                        StatusPill(text: user.role.label, color: Theme.primary)
                    }
                }
                .padding(.vertical, 4)
            }

            Section("Account") {
                row("Email", user.email)
                row("Department", user.department)
                if FeatureAccess.isStudent(user.role) {
                    row("Roll number", user.rollNo)
                    row("Year", user.year.map(String.init))
                    row("Section", user.section)
                    row("Semester", user.semester.map(String.init))
                } else {
                    row("Employee ID", user.employeeId)
                    row("Designation", user.designation)
                }
            }

            Section("App") {
                NavigationLink("Notification settings") { NotificationSettingsView() }
                row("Server", app.serverAddress.isEmpty ? "Not set" : app.serverAddress)
                row("Version", BuildSettings.appVersion)
            }

            Section {
                Button(role: .destructive) {
                    confirmSignOut = true
                } label: {
                    if signingOut { ProgressView() } else { Text("Sign out") }
                }
                .disabled(signingOut)
                .accessibilityIdentifier("profile.signOut")
            } footer: {
                Text("Forgot your password? Contact your Class In-Charge or Admin to reset it.")
            }
        }
        .navigationTitle("Profile")
        .refreshable { await app.reloadUser() }
        .confirmationDialog("Sign out of VEXON on this iPhone?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                signingOut = true
                Task { await app.signOut() }
            }
        }
    }

    private var avatarURL: URL? {
        guard let avatar = user.avatar else { return nil }
        // Resolve against the server actually in use (it may be overridden on the device).
        return ServerConfiguration(environment: BuildSettings.environment, buildBaseURL: URL(string: app.serverAddress)).assetURL(avatar)
    }

    @ViewBuilder private func row(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            LabeledContent(label, value: value)
        }
    }
}
