import SwiftUI
import VEXONKit

/// Live college bus map. Creates its model once per screen with the shared client.
struct BusTrackingView: View {
    @Environment(AppModel.self) private var app
    @State private var model: BusTrackingModel?

    var body: some View {
        Group {
            if let model {
                BusTrackingScreen(model: model)
            } else {
                ProgressView("Loading buses…")
            }
        }
        .navigationTitle("Bus Tracking")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Title + subtitle inside the navigation bar (the system keeps it clear of the
            // status bar and notch). iOS 17 has no navigationSubtitle, hence the principal item.
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text("Bus Tracking").font(.headline).lineLimit(1)
                    Text("College buses at their latest GPS position")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
            }
        }
        .onAppear { if model == nil { model = BusTrackingModel(client: app.client) } }
    }
}

private struct BusTrackingScreen: View {
    let model: BusTrackingModel
    @Environment(AppModel.self) private var app
    @State private var locator = StudentLocator()
    @State private var query = ""
    @State private var command: MapCommand?
    @State private var mapError: String?
    @State private var showBusList = false

    var body: some View {
        content
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Bus number, route or stop")
            .task(id: query) {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                await model.search(query)
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showBusList = true } label: { Label("All buses", systemImage: "list.bullet") }
                }
                // Journey history: only for accounts the server allows (managers, principal, dean, AO, chairman, bus sharers).
                if model.config?.canViewHistory == true {
                    ToolbarItem(placement: .primaryAction) {
                        NavigationLink { TransportHistoryView() } label: { Label("Journey history", systemImage: "clock.arrow.circlepath") }
                    }
                }
            }
            .sheet(isPresented: $showBusList) {
                BusListSheet(model: model) { id in
                    showBusList = false
                    Task {
                        await model.select(busId: id)
                        command = MapCommand(kind: .bus(id))
                    }
                }
            }
            .task { await model.load() }
            .task { await live() }
            .task {
                // Re-evaluate freshness so a silent bus turns stale/offline on screen.
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    model.tick()
                }
            }
            .onDisappear {
                model.unsubscribe(using: app.realtime)
                locator.clear()
            }
    }

    @ViewBuilder private var content: some View {
        switch model.listState {
        case .idle, .loading:
            ProgressView("Loading buses…").frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let error):
            ErrorStateView(error: error) { await model.load() }
        case .loaded:
            mapLayer
        }
    }

    private var styleURL: URL? { model.config.flatMap { URL(string: $0.mapStyleUrl) } }

    private var mapLayer: some View {
        ZStack(alignment: .top) {
            if let styleURL {
                BusMapView(
                    styleURL: styleURL,
                    buses: model.buses,
                    selectedBusId: model.selectedBusId,
                    // The route the bus is actually following (a separate return route, when it has one).
                    route: model.detail.value?.mapRoute,
                    fraction: JourneyFormat.mapFraction(model.detail.value),
                    passed: JourneyFormat.mapPassed(model.detail.value),
                    selectedStopId: model.selectedStopId,
                    student: locator.coordinate,
                    command: command,
                    onSelectBus: { id in Task { await model.select(busId: id) } },
                    onSelectStop: { id in Task { await model.select(stopId: id) } },
                    onMapError: { mapError = $0 }
                )
                .ignoresSafeArea(edges: .bottom)
            } else {
                ContentUnavailableView("Map not configured", systemImage: "map", description: Text("The server did not provide a map style."))
            }

            VStack(spacing: 8) {
                if let results = model.searchResults, !query.isEmpty {
                    SearchResultsList(results: results, model: model) { kind in
                        query = ""
                        command = MapCommand(kind: kind)
                    }
                }
                banners
                Spacer()
                HStack(alignment: .bottom) {
                    Spacer()
                    controls
                }
                bottomPanel
            }
            .padding(12)
        }
    }

    // MARK: Banners (honest status)

    @ViewBuilder private var banners: some View {
        if !app.realtime.isConnected {
            Banner(icon: "bolt.horizontal.circle", text: "Live updates paused — reconnecting. Positions refresh when you are back online.", color: Theme.warning)
        }
        if let mapError {
            Banner(icon: "map", text: mapError, color: Theme.danger)
        }
        if model.buses.isEmpty {
            Banner(icon: "bus", text: "No buses are available to you right now.", color: .secondary)
        } else if model.buses.allSatisfy({ $0.location == nil }) {
            Banner(icon: "location.slash", text: "No bus has reported a GPS position yet. Buses appear on the map once tracking starts.", color: .secondary)
        }
        switch locator.state {
        case .denied:
            Banner(icon: "location.slash", text: "Location permission is off. You can still see buses; allow location in Settings to show yourself on the map.", color: Theme.warning)
        case .restricted:
            Banner(icon: "location.slash", text: "Location is restricted on this device.", color: Theme.warning)
        case .unavailable(let message):
            Banner(icon: "location.slash", text: message, color: Theme.warning)
        case .located where locator.isApproximate:
            Banner(icon: "location.circle", text: "Your position is approximate (Precise Location is off).", color: .secondary)
        default:
            EmptyView()
        }
    }

    // MARK: Map controls

    private var controls: some View {
        VStack(spacing: 10) {
            if let id = model.selectedBusId {
                MapButton(icon: "bus", label: "Centre on selected bus") { command = MapCommand(kind: .bus(id)) }
                if locator.coordinate != nil {
                    MapButton(icon: "arrow.up.left.and.arrow.down.right", label: "Show me and the bus") { command = MapCommand(kind: .fitBusAndMe(id)) }
                }
            }
            MapButton(icon: locator.state == .requesting ? "location.circle" : "location.fill", label: "Centre on my location") {
                locator.locateOnce()
            }
            .onChange(of: locator.coordinate?.latitude) { _, _ in
                if locator.coordinate != nil { command = MapCommand(kind: .me) }
            }
            MapButton(icon: "square.dashed", label: "Show all buses") { command = MapCommand(kind: .fitAll) }
            MapButton(icon: "arrow.clockwise", label: "Refresh") { Task { await model.load() } }
        }
    }

    // MARK: Bottom panel

    @ViewBuilder private var bottomPanel: some View {
        if model.config?.canShare == true, showSharingCard {
            TripSharingCard(model: model)
        }
        if let bus = model.selectedBus {
            BusDetailPanel(bus: bus, model: model)
        } else {
            Text(model.buses.isEmpty ? "" : "\(model.liveCount) of \(model.buses.count) buses live · tap a bus for details")
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(.regularMaterial, in: Capsule())
                .opacity(model.buses.isEmpty ? 0 : 1)
        }
    }

    /// Staff with a shareable bus, an active trip, or a sharing message to show.
    private var showSharingCard: Bool {
        let sharing = app.tripSharing
        return sharing.phase != .idle || sharing.problem != nil
            || model.mine?.activeTrip != nil || !(model.mine?.shareable.isEmpty ?? true)
    }

    private func live() async {
        let realtime = app.realtime
        if realtime.isConnected { await model.subscribe(using: realtime) }
        for await event in realtime.events() {
            await model.handle(event, realtime: realtime)
        }
    }
}

// MARK: - Detail panel

private struct BusDetailPanel: View {
    let bus: Bus
    let model: BusTrackingModel
    @State private var expanded = false

    private var detail: BusDetail? { model.detail.value }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Bus \(bus.number)").font(.title3.bold())
                    if let route = bus.routeName { Text(route).font(.subheadline).foregroundStyle(.secondary) }
                }
                Spacer()
                StatusPill(text: bus.tracking.label, color: color(bus.tracking))
                Button {
                    model.clearSelection()
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.title2).foregroundStyle(.secondary)
                }
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel("Close bus details")
            }

            TimelineView(.periodic(from: .now, by: 5)) { context in
                HStack(spacing: 14) {
                    InfoItem(title: "Last update", value: BusMath.agoText(bus.location?.at, now: context.date))
                    if let speed = bus.location?.speed, bus.tracking == .live {
                        InfoItem(title: "Speed", value: "\(Int((speed * 3.6).rounded())) km/h")
                    }
                    if let accuracy = bus.location?.accuracy {
                        InfoItem(title: "GPS", value: BusMath.accuracyText(accuracy))
                    }
                }
            }

            switch model.detail {
            case .loading, .idle:
                ProgressView().frame(maxWidth: .infinity)
            case .failed(let error):
                Text(error.userMessage).font(.footnote).foregroundStyle(.secondary)
            case .loaded(let d):
                if let journey = d.journey {
                    JourneySection(journey: journey, tz: model.config?.timezone, mine: bus.trip?.mine == true,
                                   selectedStopId: model.selectedStopId, model: model)
                } else {
                    etaSection(d)
                }
                if d.journey == nil, let route = d.route, !route.stops.isEmpty {
                    DisclosureGroup(isExpanded: $expanded) {
                        StopList(route: route, progress: d.progress, selectedStopId: model.selectedStopId) { id in
                            Task { await model.select(stopId: id) }
                        }
                    } label: {
                        Text(progressLabel(d)).font(.subheadline.weight(.semibold))
                    }
                }
            }
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private func etaSection(_ d: BusDetail) -> some View {
        let eta = d.eta
        VStack(alignment: .leading, spacing: 4) {
            if let next = eta?.nextStop {
                Text("Next stop: \(next.name)").font(.subheadline)
            }
            HStack(alignment: .firstTextBaseline) {
                Image(systemName: eta?.isAvailable == true ? "clock" : "clock.badge.exclamationmark")
                Text(eta?.stop.map { "To \($0.name): " } ?? "")
                    .font(.subheadline.weight(.semibold))
                + Text(BusMath.etaText(eta)).font(.subheadline)
            }
            .foregroundStyle(eta?.isAvailable == true ? Color.primary : Color.secondary)
            if let eta, eta.isAvailable {
                if let at = eta.arrivalAt, eta.confidence != "low" {
                    Text("Expected around \(at.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary)
                }
                Text(etaBasis(eta)).font(.caption2).foregroundStyle(.secondary)
            }
            if d.progress?.offRoute == true {
                Text("The bus appears to be off its usual route.").font(.caption).foregroundStyle(Theme.warning)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func etaBasis(_ eta: BusETA) -> String {
        var parts: [String] = []
        switch eta.method {
        case "recent_speed": parts.append("Based on the bus’s recent speed")
        case "schedule": parts.append("Based on the route timetable")
        default: break
        }
        if eta.approximateRoute == true { parts.append("route distance is approximate") }
        parts.append("no live traffic data")
        if let at = eta.computedAt { parts.append("updated \(at.formatted(date: .omitted, time: .shortened))") }
        return parts.joined(separator: " · ")
    }

    private func progressLabel(_ d: BusDetail) -> String {
        guard let route = d.route else { return "Stops" }
        let passed = d.progress?.passedSequences.count ?? 0
        return "Stops · \(passed) of \(route.stops.count) passed"
    }

    private func color(_ t: TrackingState) -> Color {
        switch t {
        case .live: return Theme.success
        case .stale: return Theme.warning
        case .offline: return .secondary
        }
    }
}

/// The server-recorded journey of the bus's active trip: direction, the stop it
/// is at, next and following stop with ETAs, the college, and every stop in
/// travel order with RECORDED times or a PREDICTED time — never mixed up.
/// The person sharing can correct the direction until a stop is recorded.
private struct JourneySection: View {
    let journey: TripJourney
    let tz: String?
    let mine: Bool
    let selectedStopId: String?
    let model: BusTrackingModel
    @State private var expanded = false
    @State private var switching = false
    @State private var problem: String?

    private var assumed: Bool { journey.directionAssumed == true }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                StatusPill(text: JourneyFormat.directionText(journey.direction, assumed: assumed),
                           color: assumed ? Theme.warning : Theme.primary)
                if let started = journey.tripStartedAt {
                    Text("Trip started \(JourneyFormat.campusTime(started, tz: tz))").font(.caption).foregroundStyle(.secondary)
                }
            }
            if assumed {
                Text("The direction was not chosen when the trip started, so “towards college” is assumed. Stops may be in the wrong order until it is corrected.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if journey.nextStopUncertain == true, let reason = journey.uncertainReason {
                Text("\(reason). The next stop may not be accurate.").font(.caption).foregroundStyle(Theme.warning)
            }
            if let current = journey.currentStop {
                Text("At stop now: \(current.name) · arrived \(JourneyFormat.campusTime(current.actualArrivalAt, tz: tz)) (recorded)")
                    .font(.subheadline)
            }
            nextStopBox
            if let following = journey.followingStop {
                Text("Then: \(following.name)\(following.eta.map { " · \(JourneyFormat.etaLine($0, tz: tz))" } ?? "")")
                    .font(.footnote)
            }
            if let college = journey.college {
                Text("College · \(college.name): \(collegeText(college))").font(.footnote)
            }
            DisclosureGroup(isExpanded: $expanded) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(journey.stops) { stop in stopRow(stop) }
                    }
                }
                .frame(maxHeight: 220)
            } label: {
                Text("Stops in travel order").font(.subheadline.weight(.semibold))
            }
            Text("Arrival and departure times are recorded by VEXON from the bus’s GPS. “Expected” times are estimates.")
                .font(.caption2).foregroundStyle(.secondary)
            if mine, journey.canChangeDirection {
                let other = JourneyFormat.opposite(journey.direction)
                Button {
                    switching = true
                    Task {
                        problem = await model.changeDirection(tripId: journey.tripId, to: other)
                        switching = false
                    }
                } label: {
                    if switching { ProgressView() } else { Text("Wrong direction? Switch to \(JourneyFormat.directionLabel(other).lowercased())") }
                }
                .buttonStyle(.bordered)
                .disabled(switching)
                if let problem { Text(problem).font(.caption).foregroundStyle(Theme.warning) }
            }
        }
    }

    private var nextStopBox: some View {
        let next = journey.nextStop
        let ok = next?.eta?.isAvailable == true
        return VStack(alignment: .leading, spacing: 2) {
            Text("Next stop").font(.caption).foregroundStyle(.secondary)
            Text(next?.name ?? (journey.isActive ? "No stops left on this trip" : "—")).font(.subheadline.bold())
            if let eta = next?.eta {
                Text(JourneyFormat.etaLine(eta, tz: tz)).font(.subheadline)
                if ok, let method = JourneyFormat.methodText(eta.method) {
                    Text("Predicted \(method) · \(eta.confidence ?? "low") confidence · no live traffic data")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background((ok ? Theme.success : Color.secondary).opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
    }

    private func collegeText(_ c: JourneyCollege) -> String {
        if let at = c.actualArrivalAt { return "Arrived \(JourneyFormat.campusTime(at, tz: tz)) (recorded)" }
        if let eta = c.eta { return "Expected \(JourneyFormat.etaLine(eta, tz: tz))" }
        return "—"
    }

    private func stopRow(_ stop: JourneyStop) -> some View {
        let done = stop.status != "upcoming"
        let line = JourneyFormat.stopLine(stop, tz: tz) + (stop.isManual ? " · recorded by staff" : "")
        return Button { Task { await model.select(stopId: stop.stopId) } } label: {
            HStack(spacing: 10) {
                Image(systemName: stop.status == "arrived" ? "bus.fill" : done ? "checkmark.circle.fill" : (stop.stopId == selectedStopId ? "mappin.circle.fill" : "circle"))
                    .foregroundStyle(stop.stopId == selectedStopId ? Color.orange : (done ? Color.secondary : Theme.primary))
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(stop.order + 1). \(stop.name)\(stop.isCollege == true ? " (college)" : "")")
                        .foregroundStyle(stop.status == "departed" ? .secondary : .primary)
                    Text(line).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(stop.name). \(line)\(stop.stopId == selectedStopId ? ", selected" : "")")
    }
}

private struct StopList: View {
    let route: BusRoute
    let progress: RouteProgress?
    let selectedStopId: String?
    let onSelect: (String) -> Void

    var body: some View {
        let passed = Set(progress?.passedSequences ?? [])
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(route.orderedStops) { stop in
                    Button { onSelect(stop.id) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: passed.contains(stop.sequence) ? "checkmark.circle.fill" : (stop.id == selectedStopId ? "mappin.circle.fill" : "circle"))
                                .foregroundStyle(stop.id == selectedStopId ? Color.orange : (passed.contains(stop.sequence) ? Color.secondary : Theme.primary))
                            Text("\(stop.sequence). \(stop.name)")
                                .foregroundStyle(passed.contains(stop.sequence) ? .secondary : .primary)
                            Spacer()
                            if let time = stop.scheduledTime { Text(time).font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(stop.name)\(passed.contains(stop.sequence) ? ", passed" : "")\(stop.id == selectedStopId ? ", selected" : "")")
                    .accessibilityHint("Shows the arrival estimate for this stop")
                }
            }
        }
        .frame(maxHeight: 220)
    }
}

// MARK: - Search

private struct SearchResultsList: View {
    let results: TransportSearchResult
    let model: BusTrackingModel
    let move: (MapCommand.Kind) -> Void

    var body: some View {
        List {
            if results.isEmpty {
                Text("No buses, routes or stops match.").foregroundStyle(.secondary)
            }
            if !results.buses.isEmpty {
                Section("Buses") {
                    ForEach(results.buses) { bus in
                        Button {
                            Task {
                                model.clearSearch()
                                await model.select(busId: bus.id)
                                move(.bus(bus.id))
                            }
                        } label: {
                            Label("\(bus.number)\(bus.routeName.map { " · \($0)" } ?? "")", systemImage: "bus")
                        }
                    }
                }
            }
            if !results.routes.isEmpty {
                Section("Routes") {
                    ForEach(results.routes) { route in
                        Button {
                            Task {
                                await model.chooseRoute(route)
                                if let id = model.selectedBusId { move(.bus(id)) }
                            }
                        } label: {
                            Label(route.name, systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                        }
                    }
                }
            }
            if !results.stops.isEmpty {
                Section("Stops") {
                    ForEach(results.stops) { stop in
                        Button {
                            Task {
                                await model.chooseStop(stop)
                                if let id = model.selectedBusId { move(.bus(id)) }
                            }
                        } label: {
                            Label("\(stop.name) · \(stop.routeName)", systemImage: "mappin.and.ellipse")
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .frame(maxHeight: 300)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

private struct BusListSheet: View {
    let model: BusTrackingModel
    let onSelect: (String) -> Void

    var body: some View {
        NavigationStack {
            List(model.buses) { bus in
                Button { onSelect(bus.id) } label: {
                    HStack {
                        Image(uiImage: BusIconRenderer.image(state: bus.tracking, size: 32))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading) {
                            Text(bus.number).font(.headline)
                            if let route = bus.routeName { Text(route).font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        VStack(alignment: .trailing) {
                            Text(bus.tracking.label).font(.caption.weight(.semibold))
                            Text(BusMath.agoText(bus.location?.at, now: model.now)).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(bus.location == nil)
            }
            .navigationTitle("Buses")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Staff trip sharing

private struct TripSharingCard: View {
    let model: BusTrackingModel
    @Environment(AppModel.self) private var app
    @State private var chosenBus: String?
    /// Which way the trip runs — chosen before starting; sets the stop order riders see.
    @State private var direction: String?
    @State private var confirmStop = false

    private var sharing: TripSharingService { app.tripSharing }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch sharing.phase {
            case .active(_, let number):
                HStack {
                    Image(systemName: "location.fill.viewfinder").foregroundStyle(Theme.success)
                    VStack(alignment: .leading) {
                        Text("Sharing location for bus \(number)").font(.subheadline.bold())
                        Text(statusLine).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("End trip", role: .destructive) { confirmStop = true }
                        .buttonStyle(.bordered)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Tracking active for bus \(number). \(statusLine)")
            case .starting, .stopping:
                ProgressView()
            case .idle:
                if let trip = model.mine?.activeTrip {
                    Text("You have an active trip for bus \(trip.bus.number).").font(.subheadline)
                    Button("Resume sharing on this iPhone") { Task { await sharing.resume(trip, client: app.client) } }
                        .buttonStyle(.borderedProminent)
                } else if let buses = model.mine?.shareable, !buses.isEmpty {
                    Text("Share this iPhone’s location for a bus trip").font(.subheadline.bold())
                    Picker("Direction", selection: $direction) {
                        ForEach(JourneyFormat.directions, id: \.self) { Text(JourneyFormat.directionLabel($0)).tag(Optional($0)) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityLabel("Trip direction")
                    HStack {
                        Picker("Bus", selection: Binding(get: { chosenBus ?? buses.first?.id ?? "" }, set: { chosenBus = $0 })) {
                            ForEach(buses) { Text("\($0.number)\($0.route.map { " · \($0)" } ?? "")").tag($0.id) }
                        }
                        Spacer()
                        Button("Start trip") {
                            let id = chosenBus ?? buses.first?.id
                            guard let id, let direction, let bus = buses.first(where: { $0.id == id }) else { return }
                            Task {
                                await sharing.start(busId: bus.id, busNumber: bus.number, direction: direction, client: app.client)
                                await model.refreshMine()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(direction == nil)
                    }
                    if direction == nil { Text("Choose the direction first.").font(.caption).foregroundStyle(.secondary) }
                    Text("Location is shared only while the trip is active and stops when you end it.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            if let problem = sharing.problem {
                Text(problem).font(.caption).foregroundStyle(Theme.warning)
            }
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        .confirmationDialog("End this bus trip? Location sharing will stop.", isPresented: $confirmStop, titleVisibility: .visible) {
            Button("End trip", role: .destructive) {
                Task {
                    await sharing.stop()
                    await model.refreshMine()
                }
            }
        }
    }

    private var statusLine: String {
        var parts: [String] = []
        if let at = sharing.lastSentAt { parts.append("sent \(at.formatted(date: .omitted, time: .standard))") } else { parts.append("waiting for GPS") }
        if let accuracy = sharing.lastAccuracy { parts.append(BusMath.accuracyText(accuracy)) }
        if sharing.queued > 0 { parts.append("\(sharing.queued) queued") }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Small components

private struct Banner: View {
    let icon: String
    let text: String
    let color: Color

    var body: some View {
        Label(text, systemImage: icon)
            .font(.footnote)
            .foregroundStyle(color)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct MapButton: View {
    let icon: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.primary)
                .frame(width: 44, height: 44)
                // Opaque and outlined so it stays readable over any map tiles, light or dark.
                .background(Color(uiColor: .systemBackground), in: Circle())
                .overlay(Circle().strokeBorder(Color(uiColor: .systemGray2), lineWidth: 1.5))
                .shadow(color: .black.opacity(0.25), radius: 3, y: 1)
                .contentShape(Circle())
        }
        .buttonStyle(MapButtonStyle())
        .accessibilityLabel(label)
    }
}

/// Pressed: dimmed and slightly smaller, so a tap is visible over the map.
private struct MapButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.7 : 1)
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct InfoItem: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.caption.weight(.semibold))
        }
        .accessibilityElement(children: .combine)
    }
}
