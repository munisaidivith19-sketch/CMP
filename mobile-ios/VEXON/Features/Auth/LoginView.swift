import SwiftUI
import VEXONKit

/// Sign-in form logic, kept out of the view so it can be unit-tested.
@MainActor
@Observable
final class LoginFormModel {
    var email = ""
    var password = ""
    private(set) var emailError: String?
    private(set) var passwordError: String?
    private(set) var errorMessage: String?
    private(set) var lockedMessage: String?
    private(set) var remainingAttempts: Int?
    private(set) var isSubmitting = false

    var isLocked: Bool { lockedMessage != nil }

    /// Same checks as the Android sign-in screen; the server re-validates.
    func validate() -> Bool {
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty {
            emailError = "Email is required"
        } else if trimmed.range(of: #"^\S+@\S+\.\S+$"#, options: .regularExpression) == nil {
            emailError = "Enter a valid email"
        } else {
            emailError = nil
        }
        passwordError = password.isEmpty ? "Password is required" : nil
        return emailError == nil && passwordError == nil
    }

    /// Submit once; a second tap while a request is running is ignored.
    func submit(using signIn: @MainActor (String, String) async throws -> Void) async {
        guard !isSubmitting, !isLocked, validate() else { return }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            try await signIn(email.trimmingCharacters(in: .whitespaces), password)
            password = ""
            remainingAttempts = nil
        } catch {
            let apiError = APIError.wrap(error)
            if case .cancelled = apiError { return }
            if case .locked(let body) = apiError {
                lockedMessage = body?.message ?? apiError.userMessage
                remainingAttempts = nil
            } else {
                remainingAttempts = apiError.body?.remainingAttempts
                errorMessage = apiError.userMessage
            }
        }
    }
}

struct LoginView: View {
    let sessionEnded: Bool
    @Environment(AppModel.self) private var app
    @State private var form = LoginFormModel()
    @State private var showServer = false
    @State private var showPassword = false
    @FocusState private var focus: Field?

    private enum Field { case email, password }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    header
                    VStack(alignment: .leading, spacing: 14) {
                        banners
                        emailField
                        passwordField
                        if let message = form.errorMessage, !form.isLocked {
                            Text(message)
                                .font(.footnote)
                                .foregroundStyle(Theme.danger)
                                .accessibilityIdentifier("login.error")
                        }
                        Button {
                            Task { await form.submit(using: app.signIn) }
                        } label: {
                            Group {
                                if form.isSubmitting { ProgressView().tint(.white) } else { Text(form.isLocked ? "Locked" : "Sign in") }
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(form.isSubmitting || form.isLocked)
                        .accessibilityIdentifier("login.submit")

                        Text("Forgot your password? Contact your Class In-Charge or Admin to reset your password.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .multilineTextAlignment(.center)
                    }
                    .card()

                    Button {
                        showServer = true
                    } label: {
                        Label(app.serverAddress.isEmpty ? "Set server address" : "Server: \(displayHost)", systemImage: "server.rack")
                            .font(.footnote)
                    }
                    .accessibilityIdentifier("login.server")
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .scrollDismissesKeyboard(.interactively)
            .sheet(isPresented: $showServer) { ServerSettingsView() }
        }
    }

    private var displayHost: String {
        app.serverAddress.replacingOccurrences(of: #"^https?://"#, with: "", options: .regularExpression)
    }

    private var header: some View {
        VStack(spacing: 10) {
            Image("Logo")
                .resizable()
                .scaledToFit()
                .frame(width: 84, height: 84)
                .accessibilityLabel("College logo")
            Text("Welcome back")
                .font(.largeTitle.bold())
            Text("Sign in with your college email to continue.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 24)
    }

    @ViewBuilder private var banners: some View {
        if sessionEnded && !form.isLocked {
            Label("You were signed out because your session ended or was revoked. Please sign in again.", systemImage: "info.circle")
                .font(.footnote)
                .foregroundStyle(Theme.warning)
                .accessibilityIdentifier("login.sessionEnded")
        }
        if let locked = form.lockedMessage {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Account temporarily locked").bold()
                    Text(locked)
                }
            } icon: {
                Image(systemName: "lock.shield")
            }
            .font(.footnote)
            .foregroundStyle(Theme.danger)
        }
        if !form.isLocked, let left = form.remainingAttempts, left > 0 {
            Text("Invalid credentials. \(left) attempt\(left == 1 ? "" : "s") remaining before temporary lockout.")
                .font(.footnote)
                .foregroundStyle(Theme.warning)
        }
    }

    private var emailField: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("College email").font(.subheadline.weight(.semibold))
            TextField("you@campus.edu", text: $form.email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($focus, equals: .email)
                .onSubmit { focus = .password }
                .padding(12)
                .background(.background, in: RoundedRectangle(cornerRadius: 10))
                .disabled(form.isLocked)
                .accessibilityIdentifier("login.email")
            if let error = form.emailError {
                Text(error).font(.caption).foregroundStyle(Theme.danger)
            }
        }
    }

    private var passwordField: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Password").font(.subheadline.weight(.semibold))
            HStack {
                Group {
                    if showPassword {
                        TextField("Password", text: $form.password)
                    } else {
                        SecureField("Password", text: $form.password)
                    }
                }
                .textContentType(.password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .focused($focus, equals: .password)
                .onSubmit { Task { await form.submit(using: app.signIn) } }
                .accessibilityIdentifier("login.password")
                Button {
                    showPassword.toggle()
                } label: {
                    Image(systemName: showPassword ? "eye.slash" : "eye")
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel(showPassword ? "Hide password" : "Show password")
                .foregroundStyle(.secondary)
            }
            .padding(.leading, 12)
            .background(.background, in: RoundedRectangle(cornerRadius: 10))
            .disabled(form.isLocked)
            if let error = form.passwordError {
                Text(error).font(.caption).foregroundStyle(Theme.danger)
            }
        }
    }
}

/// Shown at launch when the saved session could not be checked because the server is unreachable.
struct OfflineLaunchView: View {
    @Environment(AppModel.self) private var app
    @State private var retrying = false

    var body: some View {
        ContentUnavailableView {
            Label("Can’t reach VEXON", systemImage: "icloud.slash")
        } description: {
            Text("Check your mobile data or Wi-Fi. You are still signed in — we’ll pick up where you left off.")
        } actions: {
            Button {
                retrying = true
                Task {
                    await app.start()
                    retrying = false
                }
            } label: {
                if retrying { ProgressView() } else { Text("Try again") }
            }
            .buttonStyle(.borderedProminent)
            .disabled(retrying)
            Button("Go to sign in") { app.skipOfflineLaunch() }
        }
        .background(Theme.background.ignoresSafeArea())
    }
}

/// Device-level server address (same feature as the Android sign-in "Server" sheet).
struct ServerSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://vexon.example.edu", text: $address)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("server.address")
                } header: {
                    Text("Server address")
                } footer: {
                    Text(app.allowInsecureHTTP
                         ? "Leave empty to use this build's default server. Development builds also accept http:// addresses on your network."
                         : "Leave empty to use this build's default server. Only https:// addresses are accepted.")
                }
                if let error {
                    Text(error).foregroundStyle(Theme.danger)
                }
            }
            .navigationTitle("Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saving = true
                        Task {
                            if let failure = await app.setServerAddress(address) {
                                error = failure.message
                            } else {
                                dismiss()
                            }
                            saving = false
                        }
                    }
                    .disabled(saving)
                }
            }
            .onAppear { address = app.serverAddress }
        }
    }
}
