import SwiftUI
import VEXONKit

/// The week timetable for the signed-in account (the server picks the class /
/// teaching scope from the account; nothing the app sends can widen it).
struct TimetableView: View {
    let user: User
    @Environment(AppModel.self) private var app
    @State private var state: LoadState<TimetableResponse> = .idle
    @State private var day: Weekday = Weekday.of(Date())

    private let schoolDays: [Weekday] = [.monday, .tuesday, .wednesday, .thursday, .friday, .saturday]

    var body: some View {
        VStack(spacing: 0) {
            Picker("Day", selection: $day) {
                ForEach(schoolDays) { Text($0.short).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding()

            LoadStateView(
                state: state,
                isEmpty: { ($0.byDay[day] ?? []).isEmpty },
                emptyTitle: state.value?.needsSection == true ? "Class not set" : "No classes",
                emptySystemImage: "calendar",
                emptyMessage: state.value?.needsSection == true
                    ? "Your department, year or section is not set. Ask your Class In-Charge to update your profile."
                    : "Nothing is scheduled on \(day.rawValue.capitalized).",
                retry: load
            ) { response in
                List(response.byDay[day] ?? []) { slot in
                    TimetableRow(slot: slot, isToday: day == Weekday.of(Date()), showFaculty: FeatureAccess.isStudent(user.role))
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Timetable")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                NavigationLink { ExamsView() } label: { Label("Exams", systemImage: "doc.text") }
            }
        }
        .onAppear { if day == .sunday { day = .monday } }
        .refreshable { await load() }
        .task { await load() }
        .task {
            for await event in app.realtime.events() where ["timetable:updated", "holiday:changed"].contains(event.name) {
                await load()
            }
        }
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do { state = .loaded(try await app.client.send(API.timetable())) } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { state = .failed(e) }
        }
    }
}

private struct TimetableRow: View {
    let slot: TimetableSlot
    let isToday: Bool
    let showFaculty: Bool

    private var isNow: Bool {
        guard isToday else { return false }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX") // 24-hour even when the device uses 12-hour time
        f.dateFormat = "HH:mm"
        let now = f.string(from: Date())
        return slot.startTime <= now && now < slot.endTime
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .trailing) {
                Text(slot.startTime).font(.subheadline.monospacedDigit().weight(.semibold))
                Text(slot.endTime).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            .frame(width: 56, alignment: .trailing)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(slot.title).font(.subheadline.weight(.semibold))
                    if isNow { StatusPill(text: "Now", color: Theme.success) }
                }
                if slot.isBreak != true {
                    Text(details).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
        .opacity(slot.isBreak == true ? 0.7 : 1)
        .accessibilityElement(children: .combine)
    }

    private var details: String {
        var parts = ["Period \(slot.period)"]
        if let room = slot.room, !room.isEmpty { parts.append(room) }
        if showFaculty, let name = slot.faculty?.value?.name { parts.append(name) }
        return parts.joined(separator: " · ")
    }
}

/// Published exam timetable for the viewer's classes (GET /exams).
struct ExamsView: View {
    @Environment(AppModel.self) private var app
    @State private var state: LoadState<ExamsResponse> = .idle

    var body: some View {
        LoadStateView(
            state: state,
            isEmpty: { $0.exams.isEmpty },
            emptyTitle: "No exams published",
            emptySystemImage: "doc.text",
            emptyMessage: "Published exams for your class will appear here.",
            retry: load
        ) { response in
            List(response.exams.sorted { $0.date < $1.date }) { exam in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("\(exam.subjectCode) · \(exam.subjectName)").font(.subheadline.weight(.semibold))
                        Spacer()
                        if exam.isCancelled { StatusPill(text: "Cancelled", color: Theme.danger) }
                    }
                    Text("\(exam.date.formatted(date: .complete, time: .omitted)) · \(exam.startTime)–\(exam.endTime)")
                        .font(.caption).foregroundStyle(.secondary)
                    if let notes = exam.notes, !notes.isEmpty {
                        Text(notes).font(.caption)
                    }
                }
                .strikethrough(exam.isCancelled)
                .accessibilityElement(children: .combine)
            }
        }
        .navigationTitle("Exams")
        .refreshable { await load() }
        .task { await load() }
        .task {
            for await event in app.realtime.events() where event.name == "exam:updated" { await load() }
        }
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do { state = .loaded(try await app.client.send(API.exams())) } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { state = .failed(e) }
        }
    }
}
