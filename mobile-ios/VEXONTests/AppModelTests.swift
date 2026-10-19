import Foundation
import Testing
import VEXONKit
@testable import VEXON

// SYNTHETIC TEST DATA ONLY — no real accounts, buses or GPS positions.

/// Scripted HTTP transport keyed by request path.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var routes: [String: (Int, String)]
    private(set) var paths: [String] = []

    init(_ routes: [String: (Int, String)]) { self.routes = routes }

    func set(_ path: String, _ status: Int, _ body: String) {
        lock.lock(); routes[path] = (status, body); lock.unlock()
    }

    func send(_ request: URLRequest) async throws -> (Data, Int) {
        guard let (status, body) = route(for: request.url?.path ?? "") else { return (Data(#"{"message":"not stubbed"}"#.utf8), 404) }
        return (Data(body.utf8), status)
    }

    private func route(for path: String) -> (Int, String)? {
        lock.lock(); defer { lock.unlock() }
        paths.append(path)
        return routes[path]
    }
}

enum Stub {
    static func client(_ transport: StubTransport) -> APIClient {
        APIClient(configuration: ServerConfiguration(environment: .testing, buildBaseURL: URL(string: "https://vexon.example.test")),
                  transport: transport, store: MemorySecureStore(), retryDelay: { _ in })
    }

    static let config = #"{"mapStyleUrl":"https://tiles.example.test/style.json","mapAttribution":"test","studentVisibility":"all","liveSeconds":60,"staleSeconds":300,"canManage":false,"canShare":false}"#

    static func buses(at: String) -> String {
        """
        {"buses":[
          {"_id":"bus1","number":"TEST-01","route":{"_id":"r1","name":"Test Route"},"location":{"lat":12.90,"lng":77.50,"at":"\(at)","speed":5,"heading":90},"tracking":"live","trip":null},
          {"_id":"bus2","number":"TEST-02","route":"r2","location":null,"tracking":"offline","trip":null}
        ],"serverTime":"\(at)"}
        """
    }

    static func iso(_ date: Date) -> String { VEXONJSON.formatISO(date) }
}

@MainActor
@Suite("Bus tracking model")
struct BusTrackingModelTests {
    @Test("Initial snapshot loads all authorised buses, offline ones included")
    func snapshot() async {
        let now = Date()
        let transport = StubTransport(["/api/transport/config": (200, Stub.config), "/api/transport/buses": (200, Stub.buses(at: Stub.iso(now)))])
        let model = BusTrackingModel(client: Stub.client(transport))
        await model.load()
        #expect(model.buses.map(\.number) == ["TEST-01", "TEST-02"])
        #expect(model.liveCount == 1)
        #expect(model.buses.last?.tracking == .offline)
    }

    @Test("A newer fix moves the bus; older, invalid or unknown-bus fixes are ignored")
    func liveFixes() async throws {
        let t0 = Date()
        let transport = StubTransport(["/api/transport/config": (200, Stub.config), "/api/transport/buses": (200, Stub.buses(at: Stub.iso(t0)))])
        let model = BusTrackingModel(client: Stub.client(transport))
        await model.load()

        func event(_ bus: String, _ lat: Double, _ at: Date) throws -> BusLocationEvent {
            try VEXONJSON.decoder().decode(BusLocationEvent.self, from: Data("""
            {"busId":"\(bus)","lat":\(lat),"lng":77.5,"at":"\(Stub.iso(at))","accuracy":5,"speed":6,"heading":45,"source":"phone","tripId":"t1"}
            """.utf8))
        }

        await model.apply(try event("bus1", 12.91, t0.addingTimeInterval(5)))
        #expect(model.busesById["bus1"]?.location?.lat == 12.91)
        #expect(model.lastMovedBusId == "bus1")

        await model.apply(try event("bus1", 12.80, t0.addingTimeInterval(-30))) // out of order
        #expect(model.busesById["bus1"]?.location?.lat == 12.91)

        await model.apply(try event("bus1", 95, t0.addingTimeInterval(10))) // invalid latitude
        #expect(model.busesById["bus1"]?.location?.lat == 12.91)

        await model.apply(try event("not-mine", 12.5, t0.addingTimeInterval(10))) // not in this viewer's snapshot
        #expect(model.busesById["not-mine"] == nil)

        // First fix for a bus that had none brings it online.
        await model.apply(try event("bus2", 12.95, t0.addingTimeInterval(10)))
        #expect(model.busesById["bus2"]?.tracking == .live)
    }

    @Test("A bus that stops reporting turns stale, then offline, without a reload")
    func freshnessDowngrade() async {
        let t0 = Date()
        let transport = StubTransport(["/api/transport/config": (200, Stub.config), "/api/transport/buses": (200, Stub.buses(at: Stub.iso(t0)))])
        let model = BusTrackingModel(client: Stub.client(transport))
        await model.load()
        model.tick(t0.addingTimeInterval(120))
        #expect(model.buses.first?.tracking == .stale)
        model.tick(t0.addingTimeInterval(600))
        #expect(model.buses.first?.tracking == .offline)
    }

    @Test("Selecting a bus loads detail; an unavailable ETA keeps the server's reason")
    func detailAndEta() async {
        let now = Stub.iso(Date())
        let transport = StubTransport([
            "/api/transport/config": (200, Stub.config),
            "/api/transport/buses": (200, Stub.buses(at: now)),
            "/api/transport/buses/bus1": (200, """
            {"bus":{"_id":"bus1","number":"TEST-01","route":{"_id":"r1","name":"Test Route"},"location":{"lat":12.9,"lng":77.5,"at":"\(now)"},"tracking":"live","trip":null},
             "route":{"_id":"r1","name":"Test Route","stops":[{"_id":"s1","name":"Stop A","lat":12.9,"lng":77.5,"sequence":1},{"_id":"s2","name":"Stop B","lat":12.95,"lng":77.55,"sequence":2}],"geometry":null},
             "progress":{"fraction":0.1,"offRoute":false,"passedSequences":[1],"alongMeters":100},
             "eta":{"status":"unavailable","reason":"Not enough movement data yet — the bus may be stopped","computedAt":"\(now)"},
             "myStop":"s2","travelled":[],"serverTime":"\(now)"}
            """),
        ])
        let model = BusTrackingModel(client: Stub.client(transport))
        await model.load()
        await model.select(busId: "bus1")
        #expect(model.detail.value?.route?.stops.count == 2)
        #expect(model.selectedStopId == "s2") // the student's assigned stop
        #expect(BusMath.etaText(model.detail.value?.eta) == "Not enough movement data yet — the bus may be stopped")
    }

    @Test("Access revoked (404 on detail) removes the bus and clears the selection")
    func revokedBus() async {
        let transport = StubTransport(["/api/transport/config": (200, Stub.config), "/api/transport/buses": (200, Stub.buses(at: Stub.iso(Date())))])
        let model = BusTrackingModel(client: Stub.client(transport))
        await model.load()
        transport.set("/api/transport/buses/bus1", 404, #"{"message":"Bus not found"}"#)
        await model.select(busId: "bus1")
        #expect(model.selectedBusId == nil)
        #expect(model.busesById["bus1"] == nil)
    }

    @Test("A forbidden role sees the server's message, not an empty map")
    func forbidden() async {
        let transport = StubTransport(["/api/transport/config": (403, #"{"message":"You do not have access to bus tracking"}"#)])
        let model = BusTrackingModel(client: Stub.client(transport))
        await model.load()
        guard case .failed(let error) = model.listState else { Issue.record("expected failure"); return }
        #expect(error.userMessage == "You do not have access to bus tracking")
    }

    @Test("Multiple buses update independently")
    func multipleBuses() async throws {
        let t0 = Date()
        let transport = StubTransport(["/api/transport/config": (200, Stub.config), "/api/transport/buses": (200, Stub.buses(at: Stub.iso(t0)))])
        let model = BusTrackingModel(client: Stub.client(transport))
        await model.load()
        for i in 1...20 {
            for bus in ["bus1", "bus2"] {
                let e = try VEXONJSON.decoder().decode(BusLocationEvent.self, from: Data("""
                {"busId":"\(bus)","lat":\(12.9 + Double(i) * 0.001),"lng":77.5,"at":"\(Stub.iso(t0.addingTimeInterval(Double(i))))"}
                """.utf8))
                await model.apply(e)
            }
        }
        #expect(model.busesById["bus1"]?.location?.lat == model.busesById["bus2"]?.location?.lat)
        #expect(abs((model.busesById["bus1"]?.location?.lat ?? 0) - 12.92) < 0.0001)
    }
}

@MainActor
@Suite("Sign-in form")
struct LoginFormModelTests {
    @Test("Validation mirrors the Android sign-in screen")
    func validation() {
        let form = LoginFormModel()
        #expect(!form.validate())
        #expect(form.emailError == "Email is required")
        form.email = "not-an-email"
        form.password = "x"
        #expect(!form.validate())
        #expect(form.emailError == "Enter a valid email")
        form.email = "student@example.test"
        #expect(form.validate())
    }

    @Test("Locked account disables the form")
    func locked() async {
        let form = LoginFormModel()
        form.email = "student@example.test"
        form.password = "wrong"
        await form.submit { _, _ in throw APIError.locked(ServerErrorBody(message: "Locked for 15 minutes", locked: true)) }
        #expect(form.isLocked)
        #expect(form.lockedMessage == "Locked for 15 minutes")
    }

    @Test("Remaining attempts are shown after a failed sign-in; password cleared on success")
    func attempts() async {
        let form = LoginFormModel()
        form.email = "student@example.test"
        form.password = "wrong"
        await form.submit { _, _ in throw APIError.unauthorized(ServerErrorBody(message: "Invalid credentials", remainingAttempts: 3)) }
        #expect(form.remainingAttempts == 3)
        #expect(form.errorMessage == "Invalid credentials")
        await form.submit { _, _ in }
        #expect(form.password.isEmpty)
    }
}

@MainActor
@Suite("Chat thread")
struct ChatThreadModelTests {
    @Test("Socket and refetch copies of a message are merged once, in order")
    func merge() throws {
        let model = ChatThreadModel(conversationId: "c1")
        func message(_ id: String, _ seconds: Int) throws -> ChatMessage {
            try VEXONJSON.decoder().decode(ChatMessage.self, from: Data("""
            {"_id":"\(id)","conversation":"c1","sender":{"_id":"u2","name":"Test Friend"},"body":"m\(id)","createdAt":"2026-10-16T08:00:\(String(format: "%02d", seconds)).000Z"}
            """.utf8))
        }
        model.merge([try message("b", 20), try message("a", 10)])
        let event = RealtimeEvent(name: "chat:message", payload: Data("""
        {"conversationId":"c1","message":{"_id":"b","conversation":"c1","sender":{"_id":"u2","name":"Test Friend"},"body":"mb","createdAt":"2026-10-16T08:00:20.000Z"}}
        """.utf8))
        model.handle(event)
        let other = RealtimeEvent(name: "chat:message", payload: Data("""
        {"conversationId":"OTHER","message":{"_id":"z","conversation":"OTHER","sender":"u3","body":"x","createdAt":"2026-10-16T08:00:30.000Z"}}
        """.utf8))
        model.handle(other)
        #expect(model.messages.map(\.id) == ["a", "b"])
    }
}
