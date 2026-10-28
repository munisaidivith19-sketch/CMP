import SwiftUI
import VEXONKit

// Terms and Conditions / Privacy Policy / About the App — the same documents
// and acceptance record as the web and Android apps (server/src/services/legal.js).

/// The profile's "About the App" section: exactly the three entries in `Legal.aboutEntries`.
struct AboutTheAppSection: View {
    var body: some View {
        Section("About the App") {
            ForEach(Legal.aboutEntries) { entry in
                NavigationLink(entry.label) {
                    switch entry {
                    case .about: AboutAppView()
                    case .terms: PolicyView(policy: .terms)
                    case .privacy: PolicyView(policy: .privacy)
                    }
                }
            }
        }
    }
}

/// One policy's text, version and effective date. Rendered from plain-text
/// blocks (`Legal.blocks`) — never as HTML or a web view.
struct PolicyDocumentView: View {
    let document: PolicyDocument

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(document.title).font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Text("Version \(document.version) · Effective \(Legal.formatEffective(document.effectiveAt))")
                .font(.footnote)
                .foregroundStyle(.secondary)
            ForEach(Array(Legal.blocks(document.content).enumerated()), id: \.offset) { _, block in
                switch block {
                case .heading(let text):
                    Text(inline(text)).font(.headline).padding(.top, 6).accessibilityAddTraits(.isHeader)
                case .bullet(let text):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("•").foregroundStyle(Theme.primary)
                        Text(inline(text))
                    }
                case .paragraph(let text):
                    Text(inline(text))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }

    /// **bold** / *italic* only; anything else stays literal text.
    private func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }
}

/// Loads one published policy (public endpoint, no session needed).
private struct PolicyLoader<Content: View>: View {
    let policy: Legal.Policy
    @Binding var state: LoadState<PolicyDocument>
    /// Changing it loads the document again (e.g. after a newer version was published).
    var reloadID = 0
    @ViewBuilder let content: (PolicyDocument) -> Content
    @Environment(AppModel.self) private var app

    var body: some View {
        LoadStateView(state: state, retry: load) { doc in content(doc) }
            .task(id: reloadID) { await load() }
    }

    private func load() async {
        state = .loading
        do {
            state = .loaded(try await app.client.send(API.legalPolicy(policy)))
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { state = .failed(e) }
        }
    }
}

struct PolicyView: View {
    let policy: Legal.Policy
    @State private var state: LoadState<PolicyDocument> = .idle

    var body: some View {
        PolicyLoader(policy: policy, state: $state) { doc in
            ScrollView { PolicyDocumentView(document: doc).padding() }
        }
        .navigationTitle(policy.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AboutAppView: View {
    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(Legal.appName).font(.title3.bold())
                    Text("\(Legal.appName) is the campus platform of \(Legal.institution). It brings attendance, timetables, announcements, events and clubs, gate passes, hostel and transport information, complaints, chat and study tools together for students, faculty and staff on the web, Android and iOS.")
                }
                .padding(.vertical, 4)
            }
            Section {
                LabeledContent("Application", value: Legal.appName)
                LabeledContent("Version", value: "\(BuildSettings.appVersion) (iOS)")
                LabeledContent("Institution", value: Legal.institution)
                // Not shown as a link until the College confirms its official address.
                LabeledContent("Official website", value: "To be announced by the College")
            }
            Section {
                NavigationLink("Terms and Conditions") { PolicyView(policy: .terms) }
                NavigationLink("Privacy Policy") { PolicyView(policy: .privacy) }
            }
        }
        .navigationTitle("About the App")
    }
}

/// Shown by RootView instead of the app while the server says the current
/// Terms must be accepted. The box is never ticked for the user; the server
/// records the acceptance and enforces it on every API.
struct TermsAcceptanceView: View {
    @Environment(AppModel.self) private var app
    @State private var state: LoadState<PolicyDocument> = .idle
    @State private var agreed = false
    @State private var declined = false
    @State private var showPrivacy = false
    @State private var accepting = false
    @State private var signingOut = false
    @State private var errorMessage: String?
    @State private var reloadID = 0

    var body: some View {
        NavigationStack {
            Group {
                if declined { declinedView } else { acceptView }
            }
            .navigationTitle("Terms and Conditions")
            .navigationBarTitleDisplayMode(.inline)
        }
        .sheet(isPresented: $showPrivacy) {
            NavigationStack {
                PolicyView(policy: .privacy)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showPrivacy = false } } }
            }
        }
        .alert("Could not record your acceptance", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var updated: Bool { app.user?.legal?.termsAcceptedVersion != nil }

    private var acceptView: some View {
        PolicyLoader(policy: .terms, state: $state, reloadID: reloadID) { doc in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(updated
                         ? "The Terms and Conditions have been updated. Please read and accept the new version to keep using \(Legal.appName)."
                         : "Before you start, please read and accept the Terms and Conditions. Acceptance is required to use \(Legal.appName).")
                    PolicyDocumentView(document: doc)
                        .padding()
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: Theme.cornerRadius))
                    Button("Read the Privacy Policy") { showPrivacy = true }
                    Text("The Privacy Policy explains how your information is used. Accepting the Terms does not, by itself, give consent to every kind of processing described there.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Toggle(isOn: $agreed) { Text(Legal.checkboxLabel).font(.body.weight(.semibold)) }
                        .toggleStyle(CheckboxToggleStyle())
                        .accessibilityIdentifier("terms.agree")
                    Button {
                        Task { await accept(doc) }
                    } label: {
                        if accepting { ProgressView().frame(maxWidth: .infinity) } else { Text("Accept and continue").frame(maxWidth: .infinity) }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(!agreed || accepting)
                    .accessibilityIdentifier("terms.accept")
                    if !agreed {
                        Text("Tick the box above to continue.").font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                    }
                    Button("Decline") { declined = true }
                        .frame(maxWidth: .infinity)
                }
                .padding()
            }
        }
    }

    private var declinedView: some View {
        VStack(spacing: 16) {
            Text("You have not accepted the Terms").font(.title3.bold()).multilineTextAlignment(.center)
            Text("\(Legal.appName) can only be used after accepting its Terms and Conditions. Your account and your information are not changed or deleted — you can come back and accept at any time, or sign out now.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Review the Terms again") { declined = false }
                .buttonStyle(.bordered)
            Button(role: .destructive) {
                signingOut = true
                Task { await app.signOut() }
            } label: {
                if signingOut { ProgressView() } else { Text("Sign out") }
            }
            .disabled(signingOut)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func accept(_ doc: PolicyDocument) async {
        guard agreed else { return }
        accepting = true
        defer { accepting = false }
        do {
            try await app.acceptTerms(version: doc.version)
        } catch {
            let e = APIError.wrap(error)
            if Legal.isVersionChanged(e) {
                agreed = false
                reloadID += 1 // load the new version
                errorMessage = "The Terms were just updated. Please read the new version before accepting."
            } else if e != .cancelled {
                errorMessage = e.userMessage
            }
        }
    }
}

/// A checkbox (iOS has no built-in one); announced as a toggle by VoiceOver.
private struct CheckboxToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.title3)
                    .foregroundStyle(configuration.isOn ? Theme.primary : .secondary)
                    .accessibilityHidden(true)
                configuration.label.multilineTextAlignment(.leading)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? [.isSelected] : [])
        .accessibilityValue(configuration.isOn ? "Checked" : "Not checked")
    }
}
