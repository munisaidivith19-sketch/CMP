import SwiftUI
import VEXONKit

/// Shown by RootView instead of the app until a new account (or one given a
/// temporary password) has chosen its own password. The server refuses every
/// other API until then.
struct PasswordChangeRequiredView: View {
    @Environment(AppModel.self) private var app
    @State private var current = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var problem: String?
    @State private var saving = false
    @State private var signingOut = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("You signed in with a password someone else set. Choose your own password to continue.")
                }
                Section {
                    SecureField("Current password", text: $current)
                        .textContentType(.password)
                        .accessibilityIdentifier("password.current")
                    SecureField("New password", text: $new)
                        .textContentType(.newPassword)
                        .accessibilityIdentifier("password.new")
                    SecureField("Confirm new password", text: $confirm)
                        .textContentType(.newPassword)
                        .accessibilityIdentifier("password.confirm")
                } footer: {
                    Text(PasswordRule.hint)
                }
                if let problem {
                    Section { Text(problem).foregroundStyle(.red) }
                }
                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        if saving { ProgressView().frame(maxWidth: .infinity) } else { Text("Update password").frame(maxWidth: .infinity) }
                    }
                    .disabled(saving || current.isEmpty || new.isEmpty)
                    .accessibilityIdentifier("password.submit")
                    Button(role: .destructive) {
                        signingOut = true
                        Task { await app.signOut() }
                    } label: {
                        if signingOut { ProgressView().frame(maxWidth: .infinity) } else { Text("Sign out").frame(maxWidth: .infinity) }
                    }
                    .disabled(signingOut)
                }
            }
            .navigationTitle("Choose your password")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func submit() async {
        if let weak = PasswordRule.problem(new) {
            problem = weak
            return
        }
        guard new == confirm else {
            problem = "Passwords do not match."
            return
        }
        problem = nil
        saving = true
        defer { saving = false }
        do {
            try await app.changePassword(current: current, new: new)
        } catch {
            problem = APIError.wrap(error).userMessage
        }
    }
}
