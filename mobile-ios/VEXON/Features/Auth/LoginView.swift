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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var form = LoginFormModel()
    @State private var showServer = false
    @State private var showPassword = false
    @FocusState private var focus: Field?

    private enum Field { case email, password }

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                header
                    .entrance(0)
                VStack(alignment: .leading, spacing: 14) {
                    banners
                    emailField
                    passwordField
                    if let message = form.errorMessage, !form.isLocked {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(Theme.danger)
                            .fixedSize(horizontal: false, vertical: true)
                            .transition(.opacity)
                            .accessibilityIdentifier("login.error")
                    }
                    Button {
                        focus = nil
                        Task { await form.submit(using: app.signIn) }
                    } label: {
                        if form.isSubmitting { ProgressView().tint(.white) } else { Text(form.isLocked ? "Locked" : "Sign in") }
                    }
                    .buttonStyle(.primary)
                    .disabled(form.isSubmitting || form.isLocked)
                    .accessibilityIdentifier("login.submit")

                    Text("Forgot your password? Contact your Class In-Charge or Admin to reset your password.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(20)
                .glass(cornerRadius: 26)
                .entrance(1)
                .animation(reduceMotion ? Motion.reduced : Motion.snappy, value: form.errorMessage)
                .animation(reduceMotion ? Motion.reduced : Motion.snappy, value: form.emailError)
                .animation(reduceMotion ? Motion.reduced : Motion.snappy, value: form.passwordError)
                .animation(reduceMotion ? Motion.reduced : Motion.snappy, value: form.lockedMessage)

                Button {
                    showServer = true
                } label: {
                    Label(app.serverAddress.isEmpty ? "Set server address" : "Server: \(displayHost)", systemImage: "server.rack")
                        .font(.footnote.weight(.medium))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 44)
                        .glass(in: Capsule(), interactive: true)
                }
                .buttonStyle(.pressable)
                .entrance(2)
                .accessibilityIdentifier("login.server")
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
            // Comfortable on the largest iPhone, full width on the smallest.
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .defaultScrollAnchor(.center)
        .scrollDismissesKeyboard(.interactively)
        .screenBackground()
        .sheet(isPresented: $showServer) { ServerSettingsView() }
    }

    private var displayHost: String {
        app.serverAddress.replacingOccurrences(of: #"^https?://"#, with: "", options: .regularExpression)
    }

    private var header: some View {
        VStack(spacing: 10) {
            Image("Logo")
                .resizable()
                .scaledToFit()
                .frame(width: 72, height: 72)
                .padding(18)
                .glass(in: Circle())
                .accessibilityLabel("College logo")
            Text("Welcome back")
                .font(.largeTitle.bold())
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.7)
            Text("Sign in with your college email to continue.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var banners: some View {
        if sessionEnded && !form.isLocked {
            Label("You were signed out because your session ended or was revoked. Please sign in again.", systemImage: "info.circle")
                .font(.footnote)
                .foregroundStyle(Theme.warning)
                .fixedSize(horizontal: false, vertical: true)
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
            .fixedSize(horizontal: false, vertical: true)
            .transition(.opacity)
        }
        if !form.isLocked, let left = form.remainingAttempts, left > 0 {
            Text("Invalid credentials. \(left) attempt\(left == 1 ? "" : "s") remaining before temporary lockout.")
                .font(.footnote)
                .foregroundStyle(Theme.warning)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// The well a text field sits in; the rim lights up while it has focus.
    private func fieldWell(focused: Bool, invalid: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        return shape
            .fill(GlassTokens.well)
            .overlay {
                shape.strokeBorder(
                    invalid ? Theme.danger : (focused ? Theme.primary : Color.primary.opacity(0.10)),
                    lineWidth: focused || invalid ? 1.5 : 1
                )
            }
            .animation(Motion.snappy, value: focused)
    }

    private var emailField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("College email").font(.subheadline.weight(.semibold))
            TextField("you@campus.edu", text: $form.email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($focus, equals: .email)
                .onSubmit { focus = .password }
                .padding(.horizontal, 12)
                .frame(minHeight: 48)
                .background { fieldWell(focused: focus == .email, invalid: form.emailError != nil) }
                .disabled(form.isLocked)
                .accessibilityIdentifier("login.email")
            if let error = form.emailError {
                Text(error).font(.caption).foregroundStyle(Theme.danger).transition(.opacity)
            }
        }
    }

    private var passwordField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Password").font(.subheadline.weight(.semibold))
            HStack(spacing: 0) {
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
                .frame(minHeight: 48)
                .accessibilityIdentifier("login.password")
                Button {
                    // Swapping the secure field for a plain one drops focus; keep the keyboard up.
                    let wasEditing = focus == .password
                    showPassword.toggle()
                    if wasEditing { Task { focus = .password } }
                } label: {
                    Image(systemName: showPassword ? "eye.slash" : "eye")
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 44, height: 48)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(showPassword ? "Hide password" : "Show password")
                .foregroundStyle(.secondary)
            }
            .padding(.leading, 12)
            .background { fieldWell(focused: focus == .password, invalid: form.passwordError != nil) }
            .disabled(form.isLocked)
            if let error = form.passwordError {
                Text(error).font(.caption).foregroundStyle(Theme.danger).transition(.opacity)
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
                .frame(minHeight: 44)
        }
        .screenBackground()
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
            .scrollContentBackground(.hidden)
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
        .glassSheet()
    }
}
