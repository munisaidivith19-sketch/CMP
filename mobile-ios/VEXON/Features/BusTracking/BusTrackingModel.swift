import Foundation
import Observation
import VEXONKit

/// State of the live bus map, independent of MapLibre so it can be unit-tested.
///
/// Data flow (same as web and Android): initial REST snapshot
/// (`/transport/config`, `/transport/buses`) → join the permitted Socket.IO
/// rooms with `transport:subscribe` → apply `bus:location` / `bus:trip` events.
/// Rooms are re-joined after every reconnect, and the snapshot is refetched so
/// nothing missed while offline is shown as current.
///
/// Nothing here invents data: a bus without a valid recent fix is shown as
/// stale/offline, and ETAs come only from the server with its own reason when
/// unavailable.
@MainActor
@Observable
final class BusTrackingModel {
    private(set) var config: TransportConfig?
    private(set) var busesById: [String: Bus] = [:]
    private(set) var listState: LoadState<Void> = .idle
    private(set) var selectedBusId: String?
    private(set) var selectedStopId: String?
    private(set) var detail: LoadState<BusDetail> = .idle
    private(set) var searchResults: TransportSearchResult?
    private(set) var searching = false
    private(set) var subscribed = false
    private(set) var mine: TransportMine?
    /// Wall clock used for freshness; ticked by the view every few seconds.
    private(set) var now = Date()
    /// Bumped when a fix arrives so the map can animate that marker.
    private(set) var lastMovedBusId: String?

    @ObservationIgnored private let client: APIClient
    @ObservationIgnored private var lastDetailFetch: Date = .distantPast
    @ObservationIgnored private let detailRefreshInterval: TimeInterval

    init(client: APIClient, detailRefreshInterval: TimeInterval = 15) {
        self.client = client
        self.detailRefreshInterval = detailRefreshInterval
    }

    // MARK: - Derived

    /// Buses sorted by number, with tracking recomputed on the device clock.
    var buses: [Bus] {
        busesById.values
            .map { bus in
                var b = bus
                b.tracking = effectiveTracking(bus)
                return b
            }
            .sorted { $0.number.localizedStandardCompare($1.number) == .orderedAscending }
    }

    var selectedBus: Bus? {
        guard let id = selectedBusId, var bus = busesById[id] else { return nil }
        bus.tracking = effectiveTracking(bus)
        return bus
    }

    var liveCount: Int { buses.filter { $0.tracking == .live }.count }

    /// The server's state, downgraded locally if no fix has arrived for a while
    /// (so a bus that stopped reporting goes stale without a reload).
    func effectiveTracking(_ bus: Bus) -> TrackingState {
        let local = BusMath.freshness(of: bus.location?.at, now: now,
                                      liveSeconds: config?.liveSeconds ?? 60,
                                      staleSeconds: config?.staleSeconds ?? 300)
        return worse(bus.tracking, local)
    }

    private func worse(_ a: TrackingState, _ b: TrackingState) -> TrackingState {
        let rank: [TrackingState: Int] = [.live: 0, .stale: 1, .offline: 2]
        return (rank[a] ?? 2) >= (rank[b] ?? 2) ? a : b
    }

    // MARK: - Loading

    func load() async {
        if busesById.isEmpty { listState = .loading }
        do {
            if config == nil { config = try await client.send(API.transportConfig()) }
            let list = try await client.send(API.buses())
            busesById = Dictionary(list.buses.map { ($0.id, $0) }, uniquingKeysWith: { _, new in new })
            // Correct for a device clock that differs from the server's.
            now = Date()
            listState = .loaded(())
            if config?.canShare == true, mine == nil { mine = try? await client.send(API.transportMine()) }
            if let selectedBusId, busesById[selectedBusId] == nil { clearSelection() }
            if selectedBusId != nil { await refreshDetail(force: true) }
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled, busesById.isEmpty { listState = .failed(e) }
        }
    }

    func refreshMine() async {
        mine = try? await client.send(API.transportMine())
    }

    func tick(_ date: Date = Date()) { now = date }

    // MARK: - Selection

    func select(busId: String?) async {
        guard selectedBusId != busId else { return }
        selectedBusId = busId
        selectedStopId = nil
        detail = busId == nil ? .idle : .loading
        if busId != nil { await refreshDetail(force: true) }
    }

    func select(stopId: String?) async {
        selectedStopId = stopId
        await refreshDetail(force: true)
    }

    func clearSelection() {
        selectedBusId = nil
        selectedStopId = nil
        detail = .idle
    }

    /// Detail (route, stops, progress, ETA) for the selected bus. The ETA is
    /// recomputed by the server as fixes arrive; refetch at most every
    /// `detailRefreshInterval` seconds unless forced.
    func refreshDetail(force: Bool = false) async {
        guard let id = selectedBusId else { return }
        if !force, Date().timeIntervalSince(lastDetailFetch) < detailRefreshInterval { return }
        lastDetailFetch = Date()
        do {
            let d = try await client.send(API.bus(id: id, stopId: selectedStopId))
            guard id == selectedBusId else { return } // selection changed meanwhile
            detail = .loaded(d)
            busesById[id] = d.bus
            if selectedStopId == nil, let mine = d.myStop { selectedStopId = mine }
        } catch {
            let e = APIError.wrap(error)
            guard e != .cancelled, id == selectedBusId else { return }
            if case .notFound = e {
                // Access revoked or bus deactivated: drop it from the map.
                busesById[id] = nil
                clearSelection()
            } else if detail.value == nil {
                detail = .failed(e)
            }
        }
    }

    // MARK: - Search

    func search(_ text: String) async {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else {
            searchResults = nil
            return
        }
        searching = true
        defer { searching = false }
        do {
            let result = try await client.send(API.transportSearch(q))
            searchResults = result
        } catch {
            if APIError.wrap(error) != .cancelled { searchResults = nil }
        }
    }

    func clearSearch() { searchResults = nil }

    /// A stop search hit: select a bus serving that route, then that stop.
    func chooseStop(_ hit: TransportSearchResult.StopHit) async {
        searchResults = nil
        if let bus = buses.first(where: { $0.route?.id == hit.routeId }) {
            await select(busId: bus.id)
            await select(stopId: hit.stopId)
        }
    }

    func chooseRoute(_ hit: TransportSearchResult.RouteHit) async {
        searchResults = nil
        if let bus = buses.first(where: { $0.route?.id == hit.id }) { await select(busId: bus.id) }
    }

    // MARK: - Realtime

    /// Join the rooms this viewer may see. The server checks access on every
    /// subscribe (a deactivated account is refused).
    func subscribe(using realtime: RealtimeClient) async {
        guard let data = await realtime.emitWithAck("transport:subscribe", "all") else {
            subscribed = false
            return
        }
        struct Ack: Decodable { let ok: Bool }
        subscribed = (try? JSONDecoder().decode(Ack.self, from: data))?.ok ?? false
    }

    func unsubscribe(using realtime: RealtimeClient) {
        realtime.emit("transport:unsubscribe", "all")
        subscribed = false
    }

    func handle(_ event: RealtimeEvent, realtime: RealtimeClient) async {
        switch event.name {
        case "connect":
            await subscribe(using: realtime)
            await load() // catch up on anything missed while disconnected
        case "disconnect":
            subscribed = false
        case "bus:location":
            if let e = event.decode(BusLocationEvent.self) { await apply(e) }
        case "bus:trip":
            if let e = event.decode(BusTripEvent.self) {
                if busesById[e.busId] == nil || e.busId == selectedBusId { await load() }
                if config?.canShare == true { await refreshMine() }
            }
        default:
            break
        }
    }

    /// Apply one live fix. Out-of-order, invalid or unknown-bus fixes are ignored
    /// (an unknown bus is one this viewer was not given in the snapshot).
    func apply(_ event: BusLocationEvent) async {
        guard var bus = busesById[event.busId] else { return }
        let fix = event.fix
        guard FixGate.accept(fix, current: bus.location) else { return }
        bus.location = fix
        bus.tracking = .live
        busesById[event.busId] = bus
        now = Date()
        lastMovedBusId = event.busId
        if event.busId == selectedBusId { await refreshDetail() }
    }
}
