import SwiftUI
import VEXONKit

/// The signed-in account (own data only) and sign-out. Staff see their role,
/// employee ID and mobile number; faculty also the classes they are assigned to.
/// Profile editing, password change and session management remain on web /
/// Android in this phase.
struct ProfileView: View {
    let user: User
    @Environment(AppModel.self) private var app
    @State private var confirmSignOut = false
    @State private var signingOut = false
    @State private var assignments: LoadState<[TeachingAssignment]> = .idle

    private var isStaff: Bool { !FeatureAccess.isStudent(user.role) && user.role != .alumni }

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
                if isStaff {
                    LabeledContent("Role", value: user.role.label)
                    LabeledContent("Employee ID", value: Self.orDash(user.employeeId))
                    LabeledContent("Mobile number", value: Self.orDash(user.phone))
                    if user.role == .hod { LabeledContent("Department", value: Self.orDash(user.department)) }
                    row("Designation", user.designation)
                    row("Email", user.email)
                } else {
                    row("Email", user.email)
                    row("Department", user.department)
                    row("Roll number", user.rollNo)
                    row("Year", user.year.map(String.init))
                    row("Section", user.section)
                    row("Semester", user.semester.map(String.init))
                }
            }

            if user.role == .faculty { assignedClasses }

            Section("App") {
                NavigationLink("Notification settings") { NotificationSettingsView() }
                row("Server", app.serverAddress.isEmpty ? "Not set" : app.serverAddress)
                row("Version", BuildSettings.appVersion)
            }

            AboutTheAppSection()

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
        .refreshable {
            await app.reloadUser()
            await loadAssignments()
        }
        .task { await loadAssignments() }
        .confirmationDialog("Sign out of VEXON on this iPhone?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                signingOut = true
                Task { await app.signOut() }
            }
        }
    }

    /// The department, year and section a faculty member is assigned to: their
    /// timetable assignments, plus the class they are Class In-Charge of.
    @ViewBuilder private var assignedClasses: some View {
        Section("Assigned classes") {
            if let year = user.inChargeYear, let section = user.section {
                LabeledContent("Class In-Charge", value: [user.department, "Year \(year)", "Section \(section)", user.inChargeSemester.map { "Sem \($0)" }]
                    .compactMap { $0 }.joined(separator: " · "))
            }
            switch assignments {
            case .idle, .loading:
                ProgressView().frame(maxWidth: .infinity)
            case .failed(let error):
                Text(error.userMessage).font(.footnote).foregroundStyle(.secondary)
            case .loaded(let list) where list.isEmpty:
                row("Department", user.department)
                Text("No timetable classes are assigned to you yet.").font(.footnote).foregroundStyle(.secondary)
            case .loaded(let list):
                ForEach(Self.grouped(list), id: \.line) { group in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(group.line).font(.subheadline.weight(.semibold))
                        Text(group.subjects).font(.caption).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    /// One row per class ("CSE · Year 3 · Section A") with its subjects.
    private static func grouped(_ list: [TeachingAssignment]) -> [(line: String, subjects: String)] {
        var order: [String] = []
        var subjects: [String: [String]] = [:]
        for a in list {
            if subjects[a.classLine] == nil { order.append(a.classLine) }
            let name = [a.subject?.display, a.semester.map { "Sem \($0)" }].compactMap { $0 }.joined(separator: " · ")
            subjects[a.classLine, default: []].append(name)
        }
        return order.map { ($0, subjects[$0, default: []].joined(separator: ", ")) }
    }

    private func loadAssignments() async {
        guard user.role == .faculty else { return }
        if assignments.value == nil { assignments = .loading }
        do { assignments = .loaded(try await app.client.send(API.myTeachingAssignments())) } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { assignments = .failed(e) }
        }
    }

    private var avatarURL: URL? {
        guard let avatar = user.avatar else { return nil }
        // Resolve against the server actually in use (it may be overridden on the device).
        return ServerConfiguration(environment: BuildSettings.environment, buildBaseURL: URL(string: app.serverAddress)).assetURL(avatar)
    }

    private static func orDash(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "—" }
        return value
    }

    @ViewBuilder private func row(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            LabeledContent(label, value: value)
        }
    }
}
