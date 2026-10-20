import SwiftUI
import VEXONKit

/// Journey history (same server data as the web's Transport → Journey history).
/// The server decides scope: transport managers, principal, dean, AO and chairman
/// see every trip; staff who share a bus see only their own. Only RECORDED times
/// are shown — no predictions, no GPS tracks. Reports and manual stop records
/// stay on the web console.
struct TransportHistoryView: View {
    @Environment(AppModel.self) private var app
    @State private var range = "week"
    @State private var direction: String?
    @State private var status: String?
    @State private var trips: [HistoryTrip] = []
    @State private var result: HistoryTripList?
    @State private var state: LoadState<Void> = .idle

    var body: some View {
        List {
            Section {
                Picker("Period", selection: $range) {
                    Text("Today").tag("day")
                    Text("This week").tag("week")
                    Text("This month").tag("month")
                    Text("All").tag("all")
                }
                Picker("Direction", selection: $direction) {
                    Text("Both").tag(String?.none)
                    ForEach(JourneyFormat.directions, id: \.self) { Text(JourneyFormat.directionLabel($0)).tag(Optional($0)) }
                }
                Picker("Status", selection: $status) {
                    Text("All").tag(String?.none)
                    Text("Completed").tag(Optional("completed"))
                    Text("Interrupted").tag(Optional("interrupted"))
                    Text("In progress").tag(Optional("active"))
                }
            } footer: {
                Text(result?.scope == "own" ? "Trips you shared, with recorded stop times." : "Recorded bus trips and stop times. Times are on the campus clock.")
            }
            Section {
                switch state {
                case .idle, .loading:
                    ProgressView("Loading…").frame(maxWidth: .infinity)
                case .failed(let error):
                    VStack(alignment: .leading, spacing: 8) {
                        Text(error.userMessage).font(.footnote).foregroundStyle(.secondary)
                        Button("Try again") { Task { await load(reset: true) } }
                    }
                case .loaded:
                    if trips.isEmpty {
                        ContentUnavailableView("No trips found", systemImage: "clock.arrow.circlepath", description: Text("No recorded trips match these filters."))
                    }
                    ForEach(trips) { trip in
                        NavigationLink {
                            TransportHistoryTripView(tripId: trip.id)
                        } label: {
                            HistoryTripRow(trip: trip, tz: result?.timezone)
                        }
                        .onAppear { if trip.id == trips.last?.id { Task { await load(reset: false) } } }
                    }
                }
            }
        }
        .navigationTitle("Journey history")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load(reset: true) }
        .task(id: "\(range)|\(direction ?? "")|\(status ?? "")") { await load(reset: true) }
    }

    private func load(reset: Bool) async {
        if !reset, let result, !result.hasMore { return }
        if reset { state = .loading }
        let page = reset ? 1 : (result?.page ?? 0) + 1
        do {
            let r = try await app.client.send(API.transportHistory(range: range, direction: direction, status: status, page: page))
            trips = reset ? r.trips : trips + r.trips.filter { t in !trips.contains { $0.id == t.id } }
            result = r
            state = .loaded(())
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled, reset || trips.isEmpty { state = .failed(e) }
        }
    }
}

private func statusColor(_ t: HistoryTrip) -> Color {
    switch t.status {
    case "active": return Theme.primary
    case "completed": return Theme.success
    default: return t.interrupted == true ? Theme.warning : .secondary
    }
}

private struct HistoryTripRow: View {
    let trip: HistoryTrip
    let tz: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text("Bus \(trip.bus?.number ?? "—")").font(.headline)
                Spacer()
                StatusPill(text: JourneyFormat.tripStatus(trip.status, interrupted: trip.interrupted == true), color: statusColor(trip))
            }
            let dir = JourneyFormat.directionText(trip.direction, assumed: trip.directionAssumed == true)
            Text([dir.isEmpty ? "Direction not recorded" : dir, trip.route?.name].compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline).foregroundStyle(.secondary)
            let duration = JourneyFormat.durationText(trip.durationMinutes)
            Text("\(JourneyFormat.campusDate(trip.tripStartedAt, tz: tz)), started \(JourneyFormat.campusTime(trip.tripStartedAt, tz: tz))\(duration.isEmpty ? "" : " · \(duration)")")
                .font(.caption)
            Text("Stops recorded: \(trip.stopsRecorded ?? 0) of \(trip.stopsPlanned ?? 0)\((trip.manualRecords ?? 0) > 0 ? " · \(trip.manualRecords!) by staff" : "")\(trip.operator.map { " · \($0.name)" } ?? "")")
                .font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// One past trip: recorded stop-by-stop times, dwell, gaps and (with a timetable) delay.
struct TransportHistoryTripView: View {
    let tripId: String
    @Environment(AppModel.self) private var app
    @State private var state: LoadState<HistoryTripDetail> = .idle

    var body: some View {
        LoadStateView(state: state, retry: { await load() }) { d in
            List {
                Section {
                    HStack(spacing: 8) {
                        StatusPill(text: JourneyFormat.tripStatus(d.trip.status, interrupted: d.trip.interrupted == true), color: statusColor(d.trip))
                        let dir = JourneyFormat.directionText(d.trip.direction, assumed: d.trip.directionAssumed == true)
                        if !dir.isEmpty { StatusPill(text: dir, color: d.trip.directionAssumed == true ? Theme.warning : .secondary) }
                    }
                    row("Route", d.trip.route?.name ?? "—")
                    row("Date", JourneyFormat.campusDate(d.trip.tripStartedAt, tz: d.timezone))
                    row("Started", JourneyFormat.campusTime(d.trip.tripStartedAt, tz: d.timezone))
                    if let end = d.trip.endedAt { row("Ended", JourneyFormat.campusTime(end, tz: d.timezone)) }
                    let duration = JourneyFormat.durationText(d.trip.durationMinutes)
                    if !duration.isEmpty { row("Trip duration", duration) }
                    let journey = JourneyFormat.durationText(d.trip.journeyMinutes)
                    if !journey.isEmpty { row("First departure → final stop", journey) }
                    if let college = d.trip.collegeArrivedAt { row("Reached college", JourneyFormat.campusTime(college, tz: d.timezone)) }
                    if let op = d.trip.operator { row("Shared by", op.name) }
                }
                Section {
                    if d.stops.isEmpty {
                        Text("This trip was recorded before stop arrival times were kept.").foregroundStyle(.secondary)
                    }
                    ForEach(d.stops) { stop in StopRecordRow(stop: stop, tz: d.timezone) }
                } header: {
                    Text("Stops in travel order")
                } footer: {
                    Text("Only recorded times are shown. “Late / early” is measured against the route timetable, where one exists.")
                }
            }
        }
        .navigationTitle(state.value.map { "Bus \($0.trip.bus?.number ?? "—")" } ?? "Trip")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    private func row(_ label: String, _ value: String) -> some View {
        LabeledContent(label, value: value)
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            state = .loaded(try await app.client.send(API.transportHistoryTrip(id: tripId)))
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled, state.value == nil { state = .failed(e) }
        }
    }
}

private struct StopRecordRow: View {
    let stop: HistoryStop
    let tz: String?

    var body: some View {
        let details = [
            stop.minutesFromPreviousStop.map { "\(JourneyFormat.durationText($0)) from previous stop" },
            stop.dwellMinutes.map { "stopped \(JourneyFormat.durationText($0))" },
            JourneyFormat.delayText(stop.delayMinutes),
            stop.isManual ? "recorded by staff" : nil,
            stop.isCorrected ? "corrected" : nil,
        ].compactMap { $0 }
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: stop.actualArrivalAt != nil ? "checkmark.circle.fill" : "circle.dashed")
                .foregroundStyle(stop.actualArrivalAt != nil ? Theme.success : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(stop.order + 1). \(stop.name)\(stop.isCollege == true ? " (college)" : "")").font(.subheadline.weight(.semibold))
                Text(JourneyFormat.historyStopLine(stop, tz: tz)).font(.subheadline)
                if !details.isEmpty { Text(details.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary) }
                if let reason = stop.arrival?.reason { Text("Reason: \(reason)").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
