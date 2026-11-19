import SwiftUI
import VEXONKit

/// Role-specific home: greeting, today's current/next class, the student's
/// overall attendance and the modules this role can open. Each card loads on
/// its own, so one unavailable service never blanks the whole screen.
struct DashboardView: View {
    let user: User
    @Environment(AppModel.self) private var app
    @State private var current: LoadState<CurrentClassResponse> = .idle
    @State private var attendance: LoadState<AttendanceSummary> = .idle

    private var modules: [Feature] {
        FeatureAccess.features(for: user.role).filter { [.attendance, .timetable, .exams, .studyMaterials, .complaints, .busTracking].contains($0) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                hero.entrance(0)
                if FeatureAccess.allows(.timetable, for: user.role) { classCard.entrance(1) }
                if FeatureAccess.isStudent(user.role) { attendanceCard.entrance(2) }
                moduleGrid.entrance(3)
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Home")
        .navigationDestination(for: Feature.self) { feature in
            FeatureDestination(feature: feature, user: user)
        }
        .refreshable { await load() }
        .task { await load() }
        .task { await liveUpdates() }
    }

    private var hero: some View {
        let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)
        return VStack(alignment: .leading, spacing: 8) {
            Text("Hello, \(user.displayName)")
                .font(.title2.bold())
                .lineLimit(2)
                .minimumScaleFactor(0.75)
            HStack(spacing: 8) {
                StatusPill(text: user.role.label, color: .white)
                if let line = user.classLine {
                    Text(line).font(.footnote).lineLimit(2)
                }
            }
        }
        .foregroundStyle(.white)
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            shape.fill(Theme.heroGradient)
                // Soft highlights, clipped to the card, that give the gradient depth.
                .overlay(alignment: .topTrailing) {
                    Circle().fill(Color.white.opacity(0.16)).frame(width: 150, height: 150).offset(x: 46, y: -62)
                }
                .overlay(alignment: .bottomLeading) {
                    Circle().fill(Color.white.opacity(0.08)).frame(width: 120, height: 120).offset(x: -40, y: 60)
                }
                .clipShape(shape)
                .shadow(color: Theme.primary.opacity(0.30), radius: 18, y: 10)
        }
        .overlay { shape.strokeBorder(Color.white.opacity(0.28), lineWidth: 1).allowsHitTesting(false) }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var classCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Today", systemImage: "clock").font(.headline)
            switch current {
            case .idle, .loading:
                ProgressView().frame(maxWidth: .infinity)
            case .failed(let error):
                Text(error.userMessage).font(.footnote).foregroundStyle(.secondary)
            case .loaded(let response):
                if let now = response.current {
                    SlotLine(prefix: "Now", slot: now)
                }
                if let next = response.next {
                    SlotLine(prefix: "Next", slot: next)
                }
                if response.current == nil && response.next == nil {
                    Text(response.today.isEmpty ? "No classes scheduled today." : "No more classes today.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        .card()
        .animation(Motion.smooth, value: current.value?.current?.id)
        .animation(Motion.smooth, value: current.value?.next?.id)
    }

    @ViewBuilder private var attendanceCard: some View {
        NavigationLink(value: Feature.attendance) {
            HStack(spacing: 16) {
                switch attendance {
                case .loaded(let summary):
                    AttendanceRing(percentage: summary.overall.percentage, threshold: summary.threshold)
                        .frame(width: 64, height: 64)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Attendance").font(.headline)
                        Text("\(summary.overall.presentPeriods) of \(summary.overall.totalPeriods) periods")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                case .failed(let error):
                    Label(error.userMessage, systemImage: "exclamationmark.triangle").font(.footnote)
                default:
                    ProgressView().frame(height: 64)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .card()
            .contentShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
        }
        .buttonStyle(.pressable)
    }

    private var moduleGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
            ForEach(modules) { feature in
                NavigationLink(value: feature) {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: feature.systemImage)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Theme.primary)
                            .frame(width: 44, height: 44)
                            .background(Theme.primary.opacity(0.14), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                        Text(feature.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.primary)
                            .multilineTextAlignment(.leading)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, minHeight: 84, alignment: .topLeading)
                    .card()
                    .contentShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
                }
                .buttonStyle(.pressable)
                .accessibilityIdentifier("module.\(feature.rawValue)")
            }
        }
    }

    private func load() async {
        async let classTask: Void = loadCurrent()
        async let attendanceTask: Void = loadAttendance()
        _ = await (classTask, attendanceTask)
    }

    private func loadCurrent() async {
        guard FeatureAccess.allows(.timetable, for: user.role) else { return }
        if current.value == nil { current = .loading }
        do { current = .loaded(try await app.client.send(API.currentClass())) } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { current = .failed(e) }
        }
    }

    private func loadAttendance() async {
        guard FeatureAccess.isStudent(user.role) else { return }
        if attendance.value == nil { attendance = .loading }
        // The current semester, as the Attendance screen opens on.
        do { attendance = .loaded(try await app.client.send(API.myAttendance(range: .all, semester: user.semester))) } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { attendance = .failed(e) }
        }
    }

    /// Refresh the cards when the server announces timetable / attendance changes.
    private func liveUpdates() async {
        for await event in app.realtime.events() {
            switch event.name {
            case "timetable:updated", "holiday:changed", "connect": await loadCurrent()
            case "attendance:updated": await loadAttendance()
            default: break
            }
        }
    }
}

private struct SlotLine: View {
    let prefix: String
    let slot: TimetableSlot

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(prefix).font(.caption.weight(.bold)).foregroundStyle(Theme.primary).frame(width: 40, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(slot.title).font(.subheadline.weight(.semibold))
                Text("\(slot.startTime)–\(slot.endTime)\(slot.room.map { " · \($0)" } ?? "")")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct AttendanceRing: View {
    let percentage: Double
    let threshold: Double
    /// The ring draws itself in the first time it appears.
    @State private var drawn = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var color: Color { percentage >= threshold ? Theme.success : Theme.danger }
    private var fraction: Double { max(0, min(1, percentage / 100)) }

    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(0.18), lineWidth: 8)
            Circle()
                .trim(from: 0, to: drawn ? fraction : 0)
                .stroke(color, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(Int(percentage.rounded()))%")
                .font(.subheadline.weight(.bold))
                .monospacedDigit()
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .contentTransition(.numericText())
                .padding(.horizontal, 10)
        }
        .padding(4) // the stroke is centred on the circle's edge; keep it inside the frame
        .animation(reduceMotion ? Motion.reduced : Motion.smooth, value: percentage)
        .onAppear {
            guard !drawn else { return }
            withAnimation(reduceMotion ? Motion.reduced : .spring(response: 0.9, dampingFraction: 0.85)) { drawn = true }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Attendance \(Int(percentage.rounded())) percent, threshold \(Int(threshold)) percent")
    }
}

extension Feature {
    var systemImage: String {
        switch self {
        case .attendance: return "checkmark.circle"
        case .timetable: return "calendar"
        case .exams: return "doc.text"
        case .studyMaterials: return "books.vertical"
        case .complaints: return "exclamationmark.bubble"
        case .chat: return "bubble.left.and.bubble.right"
        case .busTracking: return "bus"
        case .notifications: return "bell"
        case .profile: return "person.crop.circle"
        }
    }
}

/// Navigation target for a module tile.
struct FeatureDestination: View {
    let feature: Feature
    let user: User

    var body: some View {
        switch feature {
        case .attendance: AttendanceView(user: user)
        case .timetable: TimetableView(user: user)
        case .exams: ExamsView()
        case .studyMaterials: StudyMaterialsView()
        case .complaints: ComplaintsView()
        case .busTracking: BusTrackingView()
        case .chat: ConversationsView()
        case .notifications: NotificationsView()
        case .profile: ProfileView(user: user)
        }
    }
}
