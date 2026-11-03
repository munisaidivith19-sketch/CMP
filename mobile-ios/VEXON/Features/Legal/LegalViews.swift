import SwiftUI
import VEXONKit

// Terms and Conditions / Privacy Policy / About the App — the same documents
// as the web and Android apps (server/src/services/legal.js).

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
    @ViewBuilder let content: (PolicyDocument) -> Content
    @Environment(AppModel.self) private var app

    var body: some View {
        LoadStateView(state: state, retry: load) { doc in content(doc) }
            .task { await load() }
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
