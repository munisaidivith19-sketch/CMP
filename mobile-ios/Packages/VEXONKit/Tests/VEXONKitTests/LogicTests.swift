import Foundation
import Testing
@testable import VEXONKit

// Synthetic coordinates only — TEST DATA, not real bus positions.

@Suite("Bus map maths")
struct BusMathTests {
    @Test("The map opens on Chennai at city level (latitude/longitude not swapped)")
    func defaultCamera() {
        #expect(abs(BusMath.defaultCenter.lat - 13.08) < 0.05)
        #expect(abs(BusMath.defaultCenter.lng - 80.27) < 0.05)
        #expect((10...12).contains(BusMath.defaultZoom))
    }

    @Test func shortestTurn() {
        #expect(BusMath.shortestTurn(from: 350, to: 10) == 20)
        #expect(BusMath.shortestTurn(from: 10, to: 350) == -20)
        #expect(BusMath.shortestTurn(from: 0, to: 180) == 180)
    }

    @Test("Heading is shown only while moving at ≥ 2 m/s")
    func reliableHeading() {
        #expect(BusMath.reliableHeading(90, speed: 5) == 90)
        #expect(BusMath.reliableHeading(90, speed: 1.9) == nil)
        #expect(BusMath.reliableHeading(nil, speed: 10) == nil)
        #expect(BusMath.reliableHeading(400, speed: 10) == nil)
    }

    @Test("Freshness thresholds match the server defaults (60 s live, 300 s stale)")
    func freshness() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        #expect(BusMath.freshness(of: now.addingTimeInterval(-30), now: now) == .live)
        #expect(BusMath.freshness(of: now.addingTimeInterval(-120), now: now) == .stale)
        #expect(BusMath.freshness(of: now.addingTimeInterval(-301), now: now) == .offline)
        #expect(BusMath.freshness(of: nil, now: now) == .offline)
    }

    @Test func agoAndAccuracyText() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        #expect(BusMath.agoText(now.addingTimeInterval(-5), now: now) == "just now")
        #expect(BusMath.agoText(now.addingTimeInterval(-45), now: now) == "45 s ago")
        #expect(BusMath.agoText(now.addingTimeInterval(-600), now: now) == "10 min ago")
        #expect(BusMath.accuracyText(8.4) == "± 8 m")
        #expect(BusMath.accuracyText(2400) == "± 2.4 km")
    }

    @Test func markerLabel() {
        #expect(BusMath.markerLabel(number: "TEST-01", route: "Test Route") == ["TEST-01", "Test Route"])
        #expect(BusMath.markerLabel(number: "TEST-01", route: " ") == ["TEST-01"])
    }

    @Test("Interpolation clamps and eases")
    func lerp() {
        let a = BusMath.LatLng(lat: 10, lng: 20), b = BusMath.LatLng(lat: 12, lng: 24)
        #expect(BusMath.lerp(a, b, 0.5) == BusMath.LatLng(lat: 11, lng: 22))
        #expect(BusMath.lerp(a, b, 2) == b)
        #expect(BusMath.easeOut(0) == 0)
        #expect(BusMath.easeOut(1) == 1)
    }

    @Test("Route split at progress gives travelled + remaining that meet")
    func split() {
        let path = [BusMath.LatLng(lat: 12.0, lng: 77.0), BusMath.LatLng(lat: 12.0, lng: 77.1), BusMath.LatLng(lat: 12.0, lng: 77.2)]
        let parts = BusMath.split(path: path, fraction: 0.5)
        #expect(parts.travelled.last == parts.remaining.first)
        #expect(abs((parts.travelled.last?.lng ?? 0) - 77.1) < 0.001)
        #expect(BusMath.split(path: path, fraction: nil).remaining == path)
    }

    @Test("Bounds ignore invalid points (0,0 / out of range)")
    func bounds() {
        let b = BusMath.bounds([BusMath.LatLng(lat: 12, lng: 77), BusMath.LatLng(lat: 0, lng: 0), BusMath.LatLng(lat: 13, lng: 78)])
        #expect(b?.southWest == BusMath.LatLng(lat: 12, lng: 77))
        #expect(b?.northEast == BusMath.LatLng(lat: 13, lng: 78))
        #expect(BusMath.bounds([]) == nil)
    }

    @Test("ETA text never invents precision")
    func etaText() throws {
        func eta(_ json: String) throws -> BusETA { try VEXONJSON.decoder().decode(BusETA.self, from: Data(json.utf8)) }
        #expect(BusMath.etaText(nil) == "ETA unavailable")
        #expect(BusMath.etaText(try eta(#"{"status":"ok","minutes":7,"confidence":"high"}"#)) == "About 7 min")
        #expect(BusMath.etaText(try eta(#"{"status":"ok","minutes":7,"confidence":"low"}"#)) == "About 7 min (approximate)")
        #expect(BusMath.etaText(try eta(#"{"status":"ok","minutes":0,"confidence":"high"}"#)) == "Arriving now")
        #expect(BusMath.etaText(try eta(#"{"status":"unavailable","reason":"The bus is not on its route right now"}"#)) == "The bus is not on its route right now")
    }

    @Test("Out-of-order and invalid fixes never move a marker")
    func fixGate() {
        let t0 = Date(timeIntervalSince1970: 1_000_000)
        let current = BusFix(lat: 12.9, lng: 77.5, at: t0)
        #expect(FixGate.accept(BusFix(lat: 12.91, lng: 77.5, at: t0.addingTimeInterval(5)), current: current))
        #expect(!FixGate.accept(BusFix(lat: 12.91, lng: 77.5, at: t0.addingTimeInterval(-5)), current: current))
        #expect(!FixGate.accept(BusFix(lat: 95, lng: 77.5, at: t0.addingTimeInterval(5)), current: current))
        #expect(!FixGate.accept(BusFix(lat: 0, lng: 0, at: t0.addingTimeInterval(5)), current: nil))
    }
}

@Suite("Trip fix buffer")
struct TripFixBufferTests {
    let t0 = Date(timeIntervalSince1970: 2_000_000)

    @Test("Drops inaccurate, invalid and too-frequent fixes")
    func filtering() {
        var buffer = TripFixBuffer()
        #expect(buffer.add(lat: 12.9, lng: 77.5, at: t0, accuracy: 250, speed: nil, heading: nil) == .droppedInaccurate)
        #expect(buffer.add(lat: 12.9, lng: 77.5, at: t0, accuracy: nil, speed: nil, heading: nil) == .droppedInaccurate)
        #expect(buffer.add(lat: 91, lng: 77.5, at: t0, accuracy: 5, speed: nil, heading: nil) == .droppedInvalid)
        #expect(buffer.add(lat: 12.9, lng: 77.5, at: t0, accuracy: 5, speed: 3, heading: 45) == .queued)
        #expect(buffer.add(lat: 12.9, lng: 77.5, at: t0.addingTimeInterval(1), accuracy: 5, speed: 3, heading: 45) == .droppedTooSoon)
        #expect(buffer.add(lat: 12.9, lng: 77.5, at: t0.addingTimeInterval(3), accuracy: 5, speed: -1, heading: -1) == .queued)
        let batch = buffer.nextBatch(now: t0.addingTimeInterval(4))
        #expect(batch.count == 2)
        #expect(batch[1].speed == nil) // negative "unknown" values are sent as null
        #expect(batch[1].heading == nil)
    }

    @Test("Batches are capped at 20 and stale fixes are discarded, not sent late")
    func batching() {
        var buffer = TripFixBuffer(capacity: 60)
        for i in 0..<30 { buffer.add(lat: 12.9, lng: 77.5, at: t0.addingTimeInterval(Double(i * 3)), accuracy: 5, speed: nil, heading: nil) }
        #expect(buffer.nextBatch(now: t0.addingTimeInterval(90)).count == 20)
        buffer.confirm(count: 20)
        #expect(buffer.pending.count == 10)
        // Ten minutes later everything left is too old for the server.
        #expect(buffer.nextBatch(now: t0.addingTimeInterval(700)).isEmpty)
    }

    @Test("Queue is bounded during long outages")
    func bounded() {
        var buffer = TripFixBuffer(capacity: 25)
        for i in 0..<100 { buffer.add(lat: 12.9, lng: 77.5, at: t0.addingTimeInterval(Double(i * 3)), accuracy: 5, speed: nil, heading: nil) }
        #expect(buffer.pending.count == 25)
    }
}

@Suite("Role-based presentation")
struct FeatureAccessTests {
    @Test("Students see their modules including bus tracking")
    func student() {
        let f = FeatureAccess.features(for: .student)
        #expect(f.contains(.attendance) && f.contains(.busTracking) && f.contains(.complaints) && f.contains(.chat))
    }

    @Test("Confined roles only see their own module (mirrors coeGuard.js)")
    func confined() {
        #expect(FeatureAccess.features(for: .transport) == [.busTracking, .notifications, .profile])
        #expect(!FeatureAccess.allows(.chat, for: .office))
        #expect(FeatureAccess.allows(.timetable, for: .coe))
        #expect(!FeatureAccess.allows(.busTracking, for: .coe))
    }

    @Test("Timetable-blocked roles and alumni")
    func blocked() {
        #expect(!FeatureAccess.allows(.timetable, for: .security))
        #expect(!FeatureAccess.allows(.busTracking, for: .alumni))
        #expect(FeatureAccess.allows(.busTracking, for: .warden))
    }

    @Test("Study materials follow STUDY_MATERIAL_BLOCKED_ROLES")
    func studyMaterials() {
        #expect(FeatureAccess.allows(.studyMaterials, for: .student))
        #expect(FeatureAccess.allows(.studyMaterials, for: .faculty))
        #expect(!FeatureAccess.allows(.studyMaterials, for: .warden))
        #expect(!FeatureAccess.allows(.studyMaterials, for: .coe))
        #expect(!FeatureAccess.allows(.studyMaterials, for: .alumni))
    }

    @Test("A student's semester dropdown runs 1 … current; staff get 1 … 8")
    func semesterOptions() throws {
        let student = try VEXONJSON.decoder().decode(StudyMaterialFilters.self, from: Data(#"{"currentSemester":5,"semesters":[2,5],"categories":["notes"],"subjects":[{"_id":"s1","name":"Networks","code":"CS501","semester":5}]}"#.utf8))
        #expect(student.semesterOptions == [1, 2, 3, 4, 5])
        #expect(student.subjects.first?.display == "CS501 · Networks")
        let staff = try VEXONJSON.decoder().decode(StudyMaterialFilters.self, from: Data(#"{"currentSemester":null,"semesters":[],"categories":[],"subjects":[]}"#.utf8))
        #expect(staff.semesterOptions == Array(1...8))
    }

    @Test("Unknown roles get only the always-available modules")
    func unknown() {
        #expect(FeatureAccess.features(for: .other("librarian")) == [.notifications, .profile])
    }
}

@Suite("Configuration, validation and redaction")
struct MiscTests {
    @Test("Server address normalisation (port of ServerConfig.clean)")
    func clean() throws {
        #expect(try ServerConfiguration.clean(" https://vexon.example.test/api/ ", allowInsecureHTTP: false).get().absoluteString == "https://vexon.example.test")
        #expect(throws: ServerAddressError.insecure) { try ServerConfiguration.clean("http://10.0.0.5:5000", allowInsecureHTTP: false).get() }
        #expect(try ServerConfiguration.clean("http://10.0.0.5:5000", allowInsecureHTTP: true).get().absoluteString == "http://10.0.0.5:5000")
        #expect(throws: ServerAddressError.invalid) { try ServerConfiguration.clean("vexon", allowInsecureHTTP: true).get() }
    }

    @Test func apiURL() {
        let c = ServerConfiguration(environment: .testing, buildBaseURL: URL(string: "https://vexon.example.test"))
        #expect(c.apiURL(path: "/transport/buses")?.absoluteString == "https://vexon.example.test/api/transport/buses")
        #expect(c.assetURL("/uploads/a.png")?.absoluteString == "https://vexon.example.test/uploads/a.png")
        #expect(c.assetURL("https://cdn.example.test/a.png")?.absoluteString == "https://cdn.example.test/a.png")
    }

    @Test("Grievance form mirrors complaintCreateRules")
    func complaintValidation() {
        var c = NewComplaint(category: "hostel", subCategory: "mess", escalateTo: "warden", description: "The mess food is cold every day.", anonymous: false)
        #expect(c.validationError() == nil)
        c.escalateTo = "hod"
        #expect(c.validationError() == "Choose a valid authority to escalate to")
        c = NewComplaint(category: "ragging_harassment", subCategory: nil, escalateTo: "principal", description: "short", anonymous: true)
        #expect(c.validationError() == "Describe the grievance (10–2000 characters)")
        c.description = "A detailed synthetic description."
        #expect(c.validationError() == nil)
        c = NewComplaint(category: "academics", subCategory: nil, escalateTo: "faculty", description: "A detailed synthetic description.", anonymous: false)
        #expect(c.validationError() == "Choose a valid subcategory")
    }

    @Test func chatMessageValidation() {
        #expect(NewChatMessage.validated("   ") == nil)
        #expect(NewChatMessage.validated(" hi ")?.body == "hi")
        #expect(NewChatMessage.validated(String(repeating: "a", count: 5001)) == nil)
    }

    @Test("Logs never contain tokens, emails or phone numbers")
    func redaction() {
        let raw = #"Authorization: Bearer abc.def-123 {"refreshToken":"r1","password":"p"} student@example.test +91 98765 43210 eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl"#
        let out = Redactor.redact(raw)
        #expect(!out.contains("abc.def-123"))
        #expect(!out.contains("\"r1\""))
        #expect(!out.contains("student@example.test"))
        #expect(!out.contains("98765"))
        #expect(!out.contains("eyJhbGciOi"))
        #expect(Redactor.describe(method: "GET", url: URL(string: "https://x.test/api/transport/search?q=secret")) == "GET /api/transport/search?q=[…]")
    }
}
