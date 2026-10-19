import SwiftUI
import VEXONKit

/// The student's own attendance: overall and subject-wise summary for a range,
/// plus the paged list of recent records. Read-only; marking stays with staff
/// on web / Android.
struct AttendanceView: View {
    @Environment(AppModel.self) private var app
    @State private var range: AttendanceRange = .semester
    @State private var summary: LoadState<AttendanceSummary> = .idle
    @State private var records: [AttendanceRecord] = []
    @State private var recordsPage: Pagination?
    @State private var loadingMore = false
    @State private var recordsError: APIError?

    var body: some View {
        List {
            Section {
                Picker("Range", selection: $range) {
                    ForEach(AttendanceRange.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
            }

            switch summary {
            case .idle, .loading:
                Section { ProgressView().frame(maxWidth: .infinity) }
            case .failed(let error):
                Section { ErrorStateView(error: error) { await loadSummary() } }
            case .loaded(let s):
                overallSection(s)
                subjectsSection(s)
            }

            recordsSection
        }
        .navigationTitle("Attendance")
        .refreshable { await reload() }
        .task(id: range) { await loadSummary() }
        .task { await loadRecords(reset: true) }
        .task {
            for await event in app.realtime.events() where event.name == "attendance:updated" {
                await reload()
            }
        }
    }

    private func overallSection(_ s: AttendanceSummary) -> some View {
        Section("Overall") {
            HStack(spacing: 16) {
                AttendanceRing(percentage: s.overall.percentage, threshold: s.threshold)
                    .frame(width: 72, height: 72)
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(s.overall.presentPeriods) present · \(s.overall.absentPeriods) absent")
                    if let od = s.overall.odPeriods, od > 0 { Text("\(od) on duty").foregroundStyle(.secondary) }
                    if let must = s.overall.mustAttend, must > 0 {
                        Text("Attend the next \(must) classes to reach \(Int(s.threshold))%.")
                            .foregroundStyle(Theme.danger)
                    } else if let canMiss = s.overall.canMiss, canMiss > 0 {
                        Text("You can miss \(canMiss) more and stay at \(Int(s.threshold))%.")
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.subheadline)
            }
        }
    }

    private func subjectsSection(_ s: AttendanceSummary) -> some View {
        Section("Subjects") {
            if s.subjects.isEmpty {
                Text("No attendance recorded in this range.").foregroundStyle(.secondary)
            }
            ForEach(s.subjects) { line in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(line.subject.display).font(.subheadline.weight(.semibold))
                        Text("\(line.presentPeriods)/\(line.totalPeriods) periods").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("\(Int(line.percentage.rounded()))%")
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(line.percentage >= s.threshold ? Theme.success : Theme.danger)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var recordsSection: some View {
        Section("Recent records") {
            if let recordsError, records.isEmpty {
                Text(recordsError.userMessage).foregroundStyle(.secondary)
            }
            ForEach(records) { record in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(record.subject?.value?.display ?? "Class").font(.subheadline)
                        Text("\(record.date.formatted(date: .abbreviated, time: .omitted))\(record.period.map { " · Period \($0)" } ?? "")")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    StatusPill(text: record.status.label, color: color(record.status))
                }
                .onAppear {
                    if record.id == records.last?.id { Task { await loadRecords(reset: false) } }
                }
            }
            if loadingMore { ProgressView().frame(maxWidth: .infinity) }
        }
    }

    private func color(_ status: AttendanceStatus) -> Color {
        switch status {
        case .present: return Theme.success
        case .absent: return Theme.danger
        case .od: return Theme.info
        }
    }

    private func reload() async {
        await loadSummary()
        await loadRecords(reset: true)
    }

    private func loadSummary() async {
        if summary.value == nil { summary = .loading }
        do { summary = .loaded(try await app.client.send(API.myAttendance(range: range))) } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { summary = .failed(e) }
        }
    }

    /// Paged loading: next page only when the last row appears and more exist.
    private func loadRecords(reset: Bool) async {
        if loadingMore { return }
        if !reset, let page = recordsPage, !page.hasMore { return }
        let next = reset ? 1 : (recordsPage?.page ?? 0) + 1
        loadingMore = true
        defer { loadingMore = false }
        do {
            let page = try await app.client.send(API.attendanceRecords(page: next))
            records = reset ? page.records : records + page.records.filter { r in !records.contains { $0.id == r.id } }
            recordsPage = page.pagination
            recordsError = nil
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { recordsError = e }
        }
    }
}
