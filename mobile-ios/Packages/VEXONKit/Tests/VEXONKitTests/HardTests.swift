import Foundation
import Testing
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import VEXONKit

// "Hard" tests: boundaries, hostile input, failure paths and concurrency.
// All data is SYNTHETIC — no real accounts, tokens, phone numbers or positions.

extension Tag {
    @Tag static var hard: Self
    @Tag static var security: Self
    @Tag static var concurrency: Self
}

/// Records everything the API client logs, so tests can prove secrets never reach a log.
final class RecordingLog: LogSink, @unchecked Sendable {
    private let lock = NSLock()
    private var _lines: [String] = []
    func log(_ level: LogLevel, _ message: String) { lock.lock(); _lines.append(message); lock.unlock() }
    var text: String { lock.lock(); defer { lock.unlock() }; return _lines.joined(separator: "\n") }
}

private func kind(_ e: APIError) -> String {
    switch e {
    case .notConfigured: return "notConfigured"
    case .network: return "network"
    case .timeout: return "timeout"
    case .cancelled: return "cancelled"
    case .unauthorized: return "unauthorized"
    case .forbidden: return "forbidden"
    case .notFound: return "notFound"
    case .conflict: return "conflict"
    case .validation: return "validation"
    case .locked: return "locked"
    case .rateLimited: return "rateLimited"
    case .server: return "server"
    case .http: return "http"
    case .decoding: return "decoding"
    }
}

// MARK: - Log redaction

@Suite("Hard: log redaction", .tags(.hard, .security))
struct RedactionHardTests {
    @Test("Every secret-looking JSON key is redacted", arguments: [
        "password", "currentPassword", "newPassword", "confirmPassword", "PASSWORD",
        "token", "accessToken", "refreshToken", "access_token", "pushToken", "otp", "clientSecret",
    ])
    func secretKeys(_ key: String) {
        let out = Redactor.redact(#"{"\#(key)":"S3cr3t-Value!","name":"ok"}"#)
        #expect(!out.contains("S3cr3t-Value!"), "\(key) leaked: \(out)")
        #expect(out.contains(#""name":"ok""#), "an ordinary field was damaged: \(out)")
    }

    @Test("A secret containing an escaped quote is redacted completely")
    func escapedQuote() {
        let out = Redactor.redact(#"{"password":"ab\"cd-tail","x":1}"#)
        #expect(!out.contains("cd-tail"), "\(out)")
    }

    @Test("A numeric one-time code is redacted")
    func numericOTP() {
        let out = Redactor.redact(#"{"otp":482913}"#)
        #expect(!out.contains("482913"), "\(out)")
    }

    @Test("Authorization headers of every scheme and token query parameters are redacted", arguments: [
        ("Authorization: Basic dXNlcjpzZWNyZXQ=", "dXNlcjpzZWNyZXQ"),
        ("Authorization: Bearer abc.def-123", "abc.def-123"),
        ("authorization=Token zz-secret-zz", "zz-secret-zz"),
        ("GET https://x.test/socket?token=tok-123&EIO=4", "tok-123"),
        ("GET https://x.test/a?refresh_token=rt-9", "rt-9"),
    ])
    func headersAndQuery(raw: String, secret: String) {
        let out = Redactor.redact(raw)
        #expect(!out.contains(secret), "\(out)")
    }

    @Test("Phone numbers in common formats are redacted", arguments: [
        "Call 9876543210 now", "+91 98765 43210", "+91-98765-43210", "phone:919876543210",
    ])
    func phones(_ raw: String) {
        let out = Redactor.redact(raw)
        #expect(out.contains("[PHONE]"), "\(out)")
        #expect(!out.contains("43210"), "\(out)")
    }

    @Test("Ids, dates, times and epoch timestamps survive redaction (logs stay useful)", arguments: [
        "GET /api/transport/buses/65f0000000000000000000ab → 200 (12 ms)",
        "GET /api/users/650000000000000000000001 → 404 (3 ms)",
        "at 2026-10-16T09:30:00Z",
        "since 2026-10-16",
        "createdAt 1731170000000",
    ])
    func survives(_ raw: String) {
        #expect(Redactor.redact(raw) == raw)
    }
}

// MARK: - Server address

@Suite("Hard: server address", .tags(.hard, .security))
struct ServerAddressHardTests {
    @Test("Unusable addresses are refused", arguments: [
        "https://user:pass@vexon.example.test",
        "https://user@vexon.example.test",
        "ftp://vexon.example.test",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "https://",
        "https://vexon.example.test?x=1",
        "https://vexon.example.test#frag",
        "",
        "   ",
        "vexon.example.test",
    ])
    func refused(_ raw: String) {
        #expect(throws: ServerAddressError.self) { try ServerConfiguration.clean(raw, allowInsecureHTTP: true).get() }
    }

    @Test("Messy but valid input is normalised", arguments: [
        (" https://vexon.example.test/api/// ", "https://vexon.example.test"),
        ("https://vexon.example.test/API", "https://vexon.example.test"),
        ("https://vexon.example.test/campus/api/", "https://vexon.example.test/campus"),
        ("https://vexon.example.test:8443", "https://vexon.example.test:8443"),
    ])
    func normalised(raw: String, expected: String) throws {
        #expect(try ServerConfiguration.clean(raw, allowInsecureHTTP: false).get().absoluteString == expected)
    }

    @Test("Asset links: absolute URLs in any letter case stay absolute; relative ones stay on our server")
    func assetURLs() {
        let c = Fixtures.config()
        #expect(c.assetURL("HTTPS://cdn.example.test/a.png")?.host == "cdn.example.test")
        #expect(c.assetURL("/uploads/a.png")?.absoluteString == "https://vexon.example.test/uploads/a.png")
        #expect(c.assetURL("uploads/a.png")?.absoluteString == "https://vexon.example.test/uploads/a.png")
        #expect(c.assetURL("//evil.example.test/x.png")?.host == "vexon.example.test")
        #expect(c.assetURL("") == nil)
        #expect(c.assetURL(nil) == nil)
    }

    @Test("Ids pasted into a path can never add a query string or fragment")
    func pathCannotAddQuery() throws {
        let url = try #require(Fixtures.config().apiURL(path: "/transport/buses/x?admin=1#top"))
        #expect(url.query == nil)
        #expect(url.fragment == nil)
        #expect(url.absoluteString.hasPrefix("https://vexon.example.test/api/transport/buses/"))
    }

    @Test("A saved address that this build may not use is ignored at launch", arguments: [
        "http://evil.example.test", "https://user:pass@evil.example.test", "not a url",
    ])
    func savedOverrideIgnored(_ saved: String) async {
        let store = MemorySecureStore([SecureStoreKey.serverURL: saved])
        let client = APIClient(configuration: Fixtures.config(), transport: MockTransport { _ in (Data(), 200) }, store: store, allowInsecureHTTP: false)
        #expect(await client.configuration.baseURL?.host == "vexon.example.test")
    }

    @Test("Changing the server ends the session and remembers the new address")
    func overrideEndsSession() async throws {
        let store = MemorySecureStore([SecureStoreKey.refreshToken: "r"])
        let client = Fixtures.client(store: store, transport: MockTransport { _ in (Fixtures.session(), 200) })
        _ = try await client.login(email: "a@example.test", password: "x")
        await client.setServerOverride(URL(string: "https://other.example.test")!)
        #expect(store.string(for: SecureStoreKey.refreshToken) == nil)
        #expect(store.string(for: SecureStoreKey.serverURL) == "https://other.example.test")
        #expect(await client.socketToken == nil)
        #expect(await client.currentUser == nil)
        #expect(await client.configuration.baseURL?.host == "other.example.test")
    }
}

// MARK: - Error mapping

@Suite("Hard: error mapping", .tags(.hard))
struct ErrorMappingHardTests {
    @Test("Every status maps to the right category and keeps the server's message", arguments: [
        (400, "", "validation"), (422, "", "validation"), (401, "", "unauthorized"),
        (401, #","locked":true"#, "locked"), (403, "", "forbidden"), (404, "", "notFound"),
        (409, "", "conflict"), (423, "", "locked"), (429, "", "rateLimited"),
        (500, "", "server"), (503, "", "server"), (418, "", "http"), (302, "", "http"),
    ])
    func statuses(status: Int, extra: String, expected: String) {
        let error = APIError.from(status: status, body: Data(#"{"message":"From server"\#(extra)}"#.utf8))
        #expect(kind(error) == expected)
        #expect(error.userMessage == "From server")
    }

    @Test("Garbage error bodies never crash and fall back to a plain message", arguments: [
        "", "<html>502 Bad Gateway</html>", "null", "[]", #"{"message":5}"#, "\u{FEFF}{",
    ])
    func garbageBodies(_ body: String) {
        let error = APIError.from(status: 502, body: Data(body.utf8))
        #expect(kind(error) == "server")
        #expect(error.userMessage == "The server had a problem. Please try again shortly.")
    }

    @Test("Field errors keep the first message per field")
    func fieldErrors() {
        let body = #"{"message":"Check","errors":[{"field":"email","message":"first"},{"field":"email","message":"second"},{"message":"no field"}]}"#
        let error = APIError.from(status: 422, body: Data(body.utf8))
        #expect(error.fieldErrors == ["email": "first"])
    }
}

// MARK: - API client

@Suite("Hard: API client", .tags(.hard))
struct APIClientHardTests {
    @Test("A cancelled request is reported as cancelled — not offline, and not retried")
    func cancellationIsNotOffline() async throws {
        let calls = Counter()
        let transport = MockTransport { _ in
            if calls.next() == 1 { throw CancellationError() }
            return (Fixtures.json("{}"), 404)
        }
        let client = Fixtures.client(transport: transport)
        var iterator = client.events.makeAsyncIterator()

        do {
            _ = try await client.send(API.buses())
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error == .cancelled)
        }
        #expect(transport.requests.count == 1)

        // The next answer from the server is the FIRST event: cancelling never marked us offline.
        _ = try? await client.send(API.buses())
        #expect(await iterator.next() == .reachability(true))
    }

    @Test("GET retry policy per status", arguments: [(502, 3), (503, 3), (504, 3), (500, 1), (404, 1), (429, 1), (401, 1)])
    func getRetries(status: Int, expectedCalls: Int) async {
        let transport = MockTransport { _ in (Fixtures.json("{}"), status) }
        let client = Fixtures.client(transport: transport) // no stored token: a 401 cannot refresh
        await #expect(throws: APIError.self) { try await client.send(API.buses()) }
        #expect(transport.requests.filter { $0.url?.path == "/api/transport/buses" }.count == expectedCalls)
    }

    @Test("Writes are never retried, even after 503 or a dropped connection", arguments: [503, 0])
    func writesNotRetried(status: Int) async {
        let transport = MockTransport { _ in
            if status == 0 { throw APIError.network }
            return (Fixtures.json("{}"), status)
        }
        let client = Fixtures.client(transport: transport)
        await #expect(throws: APIError.self) { try await client.send(API.stopTrip(id: "65f000000000000000000002")) }
        #expect(transport.requests.count == 1)
    }

    @Test("Cancelling during the retry back-off ends as .cancelled after one attempt")
    func cancelDuringBackoff() async {
        let transport = MockTransport { _ in throw APIError.network }
        let client = APIClient(configuration: Fixtures.config(), transport: transport, store: MemorySecureStore(), retryDelay: { _ in throw CancellationError() })
        do {
            _ = try await client.send(API.buses())
            Issue.record("expected a failure")
        } catch let error as APIError {
            #expect(error == .cancelled)
        } catch {
            Issue.record("unexpected \(error)")
        }
        #expect(transport.requests.count == 1)
    }

    @Test("Refresh outcome per server answer; only a 401 forgets the stored token", arguments: [
        (401, "expired", false), (503, "offline", true), (429, "offline", true), (500, "offline", true), (200, "offline", true),
    ])
    func refreshOutcomes(status: Int, expected: String, keepsToken: Bool) async {
        let store = MemorySecureStore([SecureStoreKey.refreshToken: "stored"])
        // A 200 here carries a body that is not a session (a broken proxy page).
        let transport = MockTransport { _ in (Fixtures.json(status == 200 ? "<html>" : "{}"), status) }
        let outcome = await Fixtures.client(store: store, transport: transport).refreshSession()
        switch outcome {
        case .expired: #expect(expected == "expired")
        case .offline: #expect(expected == "offline")
        case .refreshed: Issue.record("must not succeed")
        }
        #expect((store.string(for: SecureStoreKey.refreshToken) != nil) == keepsToken)
    }

    @Test("Only the exact sign-in / refresh / sign-out paths skip the refresh dance")
    func noRefreshIsExact() async throws {
        let store = MemorySecureStore([SecureStoreKey.refreshToken: "old"])
        let transport = MockTransport { request in
            if request.url?.path == "/api/auth/refresh" { return (Fixtures.session(access: "new-access"), 200) }
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer new-access" { return (Fixtures.json("[]"), 200) }
            return (Fixtures.json("{}"), 401)
        }
        let client = Fixtures.client(store: store, transport: transport)
        // A path that merely STARTS with "/auth/login" is an ordinary signed-in request.
        _ = try await client.send(Endpoint<[String]>(.get, "/auth/login-history"))
        #expect(transport.count(path: "/api/auth/refresh") == 1)
    }

    @Test("Sign-out clears the session even when the server refuses or is unreachable", arguments: [401, 500, 0])
    func logoutAlwaysClears(status: Int) async throws {
        let store = MemorySecureStore()
        let transport = MockTransport { request in
            if request.url?.path == "/api/auth/login" { return (Fixtures.session(), 200) }
            if status == 0 { throw APIError.network }
            return (Fixtures.json("{}"), status)
        }
        let client = Fixtures.client(store: store, transport: transport)
        _ = try await client.login(email: "a@example.test", password: "x")
        await client.logout()
        #expect(store.string(for: SecureStoreKey.refreshToken) == nil)
        #expect(await client.socketToken == nil)
        #expect(transport.count(path: "/api/auth/refresh") == 0)
    }

    @Test("Public endpoints never receive the access token")
    func publicEndpointsGetNoToken() async throws {
        let transport = MockTransport { request in
            if request.url?.path == "/api/auth/login" { return (Fixtures.session(), 200) }
            return (Fixtures.json(#"{"policy":"terms","version":2,"title":"T","sections":[]}"#), 200)
        }
        let client = Fixtures.client(transport: transport)
        _ = try await client.login(email: "a@example.test", password: "x")
        _ = try? await client.send(API.legalPolicy(.terms))
        let policyRequest = try #require(transport.requests.first { $0.url?.path == "/api/legal/policies/terms" })
        #expect(policyRequest.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test("Nothing secret or personal reaches the log, on success or failure", .tags(.security))
    func logsStayClean() async throws {
        let log = RecordingLog()
        let calls = Counter()
        let transport = MockTransport { request in
            switch calls.next() {
            case 1: return (Fixtures.session(access: "acc-SECRET", refresh: "ref-SECRET"), 200)
            case 2: return (Fixtures.json(#"{"unexpected":"student@example.test"}"#), 200) // decoding failure
            default: throw APIError.network
            }
        }
        let client = APIClient(configuration: Fixtures.config(), transport: transport, store: MemorySecureStore(), log: log, retryDelay: { _ in })
        _ = try await client.login(email: "student@example.test", password: "pw-SECRET")
        _ = try? await client.send(API.me())
        _ = try? await client.send(API.buses())
        let text = log.text
        #expect(!text.isEmpty)
        for secret in ["acc-SECRET", "ref-SECRET", "pw-SECRET", "student@example.test"] {
            #expect(!text.contains(secret), "\(secret) reached the log")
        }
    }

    @Test("Three concurrent 401s share ONE refresh, even when the refresh is slow", .tags(.concurrency), .timeLimit(.minutes(1)))
    func singleFlightDeterministic() async throws {
        let store = MemorySecureStore([SecureStoreKey.refreshToken: "old"])
        let rejected = Counter()
        let transport = MockTransport { request in
            if request.url?.path == "/api/auth/refresh" {
                // Hold the refresh until every request has been rejected (bounded to ~2 s).
                for _ in 0..<2000 where rejected.current < 3 { try await Task.sleep(nanoseconds: 1_000_000) }
                return (Fixtures.session(access: "new-access"), 200)
            }
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer new-access" {
                return (Fixtures.json(#"{"_id":"65f000000000000000000001","name":"Test Student","role":"student"}"#), 200)
            }
            _ = rejected.next()
            return (Fixtures.json("{}"), 401)
        }
        let client = Fixtures.client(store: store, transport: transport)
        async let a = client.send(API.me())
        async let b = client.send(API.me())
        async let c = client.send(API.me())
        let users = try await [a, b, c]
        #expect(users.allSatisfy { $0.role == .student })
        #expect(transport.count(path: "/api/auth/refresh") == 1)
        #expect(store.string(for: SecureStoreKey.refreshToken) == "test-refresh-2")
    }
}

// MARK: - Trip fix buffer

@Suite("Hard: trip fix buffer", .tags(.hard, .concurrency))
struct TripFixBufferHardTests {
    let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    private func fill(_ buffer: inout TripFixBuffer, _ range: Range<Int>) {
        for i in range {
            buffer.add(lat: 12.9, lng: 77.5 + Double(i) * 1e-4, at: t0.addingTimeInterval(Double(i * 2)), accuracy: 5, speed: nil, heading: nil)
        }
    }

    @Test("Positions that arrive while an upload is in flight are never lost when the queue overflows")
    func overflowDuringUpload() {
        var buffer = TripFixBuffer(capacity: 60)
        fill(&buffer, 0..<60)
        let batch = buffer.nextBatch(now: t0.addingTimeInterval(118))
        #expect(batch.count == 20)
        fill(&buffer, 60..<90) // the queue overflows: the 30 oldest (including the batch) are pushed out
        buffer.confirm(batch)
        #expect(buffer.pending.count == 60, "unsent positions were dropped")
        #expect(buffer.pending.first?.at == t0.addingTimeInterval(60))
    }

    @Test("Confirming the same batch twice (two overlapping uploads) removes it only once")
    func doubleConfirm() {
        var buffer = TripFixBuffer(capacity: 60)
        fill(&buffer, 0..<30)
        let first = buffer.nextBatch(now: t0.addingTimeInterval(60))
        let second = buffer.nextBatch(now: t0.addingTimeInterval(60)) // a second flush races in
        #expect(first == second)
        buffer.confirm(first)
        buffer.confirm(second)
        #expect(buffer.pending.count == 10)
    }

    @Test("Invalid or imprecise positions are refused")
    func invalidFixes() {
        let cases: [(Double, Double, Double?, TripFixBuffer.Decision)] = [
            (.nan, 77.5, 5, .droppedInvalid), (12.9, .infinity, 5, .droppedInvalid),
            (90.0001, 77.5, 5, .droppedInvalid), (12.9, -180.0001, 5, .droppedInvalid), (0, 0, 5, .droppedInvalid),
            (12.9, 77.5, nil, .droppedInaccurate), (12.9, 77.5, -1, .droppedInaccurate),
            (12.9, 77.5, 100.0001, .droppedInaccurate), (12.9, 77.5, .nan, .droppedInaccurate),
        ]
        for (i, c) in cases.enumerated() {
            var buffer = TripFixBuffer()
            #expect(buffer.add(lat: c.0, lng: c.1, at: t0, accuracy: c.2, speed: nil, heading: nil) == c.3, "case \(i)")
            #expect(buffer.pending.isEmpty)
        }
    }

    @Test("Edges are inclusive: 100 m accuracy, exactly 2 s apart, exactly 120 s old")
    func edges() {
        var buffer = TripFixBuffer()
        #expect(buffer.add(lat: 90, lng: 180, at: t0, accuracy: 100, speed: nil, heading: nil) == .queued)
        #expect(buffer.add(lat: -90, lng: -180, at: t0.addingTimeInterval(2), accuracy: 0, speed: nil, heading: nil) == .queued)
        #expect(buffer.add(lat: 12.9, lng: 77.5, at: t0.addingTimeInterval(3.999), accuracy: 5, speed: nil, heading: nil) == .droppedTooSoon)
        #expect(buffer.nextBatch(now: t0.addingTimeInterval(120)).count == 2)
        #expect(buffer.nextBatch(now: t0.addingTimeInterval(120.001)).count == 1)
    }

    @Test("Batch size is clamped to the server's limit of 20")
    func clamps() {
        #expect(TripFixBuffer(maxBatch: 500).maxBatch == 20)
        #expect(TripFixBuffer(maxBatch: 0).maxBatch == 1)
        #expect(TripFixBuffer(maxBatch: 20, capacity: 5).capacity == 20)
    }
}

// MARK: - Password rule (must agree with server/src/utils/passwordPolicy.js)

@Suite("Hard: password rule matches the server", .tags(.hard))
struct PasswordRuleHardTests {
    @Test("Exactly 8 and 72 characters pass; 7 and 73 fail")
    func lengthEdges() {
        #expect(PasswordRule.problem("Abcde1$x") == nil)
        #expect(PasswordRule.problem("Abcd1$x") != nil)
        #expect(PasswordRule.problem(String(repeating: "A", count: 69) + "a1$") == nil)
        #expect(PasswordRule.problem(String(repeating: "A", count: 70) + "a1$") != nil)
    }

    @Test("Length counts UTF-16 units like JavaScript: an emoji counts as two")
    func emojiLength() {
        #expect(PasswordRule.problem("Ab1\u{1F600}xx") != nil) // 7 units — too short on the server too
        #expect(PasswordRule.problem("Abc1\u{1F600}xx") == nil) // 8 units, the emoji is the symbol
    }

    // Expected values were taken from the server's passwordProblem() on Node.
    @Test("Unusual spaces are treated exactly as the server's JavaScript \\s", arguments: [
        ("Campusx1\u{FEFF}", false), // zero-width no-break space: \s in JavaScript → no symbol
        ("Campusx1\u{00A0}", false), // no-break space
        ("Campusx1\u{3000}", false), // ideographic space
        ("Campusx1\u{2028}", false), // line separator
        ("Campusx1\u{0085}", true), // NEL: NOT \s in JavaScript → counts as the symbol
        ("Campusx1\u{1F600}", true), // emoji symbol
    ])
    func unicodeSpaces(password: String, accepted: Bool) {
        #expect((PasswordRule.problem(password) == nil) == accepted)
    }
}
