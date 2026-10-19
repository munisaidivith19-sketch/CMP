import Foundation
import Testing
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import VEXONKit

@Suite("API client: auth, refresh, retries")
struct APIClientTests {
    @Test("Sign-in sends mobile headers, keeps the refresh token in the secure store only")
    func loginStoresRefreshToken() async throws {
        let store = MemorySecureStore()
        let transport = MockTransport { _ in (Fixtures.session(), 200) }
        let client = Fixtures.client(store: store, transport: transport)

        let user = try await client.login(email: "student@example.test", password: "synthetic-pass")

        #expect(user.role == .student)
        #expect(store.string(for: SecureStoreKey.refreshToken) == "test-refresh-2")
        let request = try #require(transport.requests.first)
        #expect(request.url?.absoluteString == "https://vexon.example.test/api/auth/login")
        #expect(request.value(forHTTPHeaderField: "x-client-platform") == "mobile")
        #expect(request.value(forHTTPHeaderField: "x-device-name") == "Test iPhone")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(request.httpMethod == "POST")
        #expect(Fixtures.bodyJSON(request)["email"] as? String == "student@example.test")
        #expect(await client.socketToken == "test-access-1")
    }

    @Test("Locked account maps to .locked; failed attempts expose remainingAttempts")
    func loginErrors() async {
        let transport = MockTransport { _ in (Fixtures.json(#"{"message":"Invalid credentials","remainingAttempts":2}"#), 401) }
        let client = Fixtures.client(transport: transport)
        do {
            _ = try await client.login(email: "a@example.test", password: "x")
            Issue.record("expected failure")
        } catch let error as APIError {
            #expect(error.body?.remainingAttempts == 2)
            #expect(error.userMessage == "Invalid credentials")
            // A failed sign-in must never trigger the refresh dance.
            #expect(transport.count(path: "/api/auth/refresh") == 0)
        } catch {
            Issue.record("unexpected \(error)")
        }

        let lockedTransport = MockTransport { _ in (Fixtures.json(#"{"message":"Locked","locked":true}"#), 423) }
        do {
            _ = try await Fixtures.client(transport: lockedTransport).login(email: "a@example.test", password: "x")
        } catch let error as APIError {
            guard case .locked = error else { Issue.record("expected locked, got \(error)"); return }
        } catch {
            Issue.record("unexpected \(error)")
        }
    }

    @Test("401 refreshes once and replays the request with the new token")
    func refreshAndReplay() async throws {
        let store = MemorySecureStore([SecureStoreKey.refreshToken: "old-refresh"])
        let transport = MockTransport { request in
            switch request.url?.path {
            case "/api/auth/refresh":
                return (Fixtures.session(access: "new-access", refresh: "rotated-refresh"), 200)
            case "/api/auth/me":
                let auth = request.value(forHTTPHeaderField: "Authorization")
                if auth == "Bearer new-access" {
                    return (Fixtures.json(#"{"_id":"65f000000000000000000001","name":"Test Student","role":"student"}"#), 200)
                }
                return (Fixtures.json(#"{"message":"Your session has expired"}"#), 401)
            default:
                return (Data(), 404)
            }
        }
        let client = Fixtures.client(store: store, transport: transport)

        let me = try await client.send(API.me())

        #expect(me.name == "Test Student")
        #expect(transport.count(path: "/api/auth/refresh") == 1)
        #expect(transport.count(path: "/api/auth/me") == 2)
        #expect(store.string(for: SecureStoreKey.refreshToken) == "rotated-refresh")
        let refreshBody = Fixtures.bodyJSON(try #require(transport.requests.first { $0.url?.path == "/api/auth/refresh" }))
        #expect(refreshBody["refreshToken"] as? String == "old-refresh")
    }

    @Test("Concurrent 401s share a single refresh (the server revokes replayed refresh tokens)")
    func singleFlightRefresh() async throws {
        let store = MemorySecureStore([SecureStoreKey.refreshToken: "old-refresh"])
        let transport = MockTransport { request in
            if request.url?.path == "/api/auth/refresh" {
                try await Task.sleep(nanoseconds: 50_000_000)
                return (Fixtures.session(access: "new-access"), 200)
            }
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer new-access" {
                return (Fixtures.json(#"{"_id":"65f000000000000000000001","name":"Test Student","role":"student"}"#), 200)
            }
            return (Fixtures.json("{}"), 401)
        }
        let client = Fixtures.client(store: store, transport: transport)

        async let a = client.send(API.me())
        async let b = client.send(API.me())
        async let c = client.send(API.me())
        _ = try await (a, b, c)

        #expect(transport.count(path: "/api/auth/refresh") == 1)
    }

    @Test("A rejected refresh token signs out: token cleared and .expired emitted")
    func expiredSession() async throws {
        let store = MemorySecureStore([SecureStoreKey.refreshToken: "revoked"])
        let transport = MockTransport { _ in (Fixtures.json(#"{"message":"Your session has ended"}"#), 401) }
        let client = Fixtures.client(store: store, transport: transport)
        let events = client.events

        await #expect(throws: APIError.self) { try await client.send(API.buses()) }

        #expect(store.string(for: SecureStoreKey.refreshToken) == nil)
        var sawExpired = false
        for await event in events {
            if event == .expired { sawExpired = true; break }
        }
        #expect(sawExpired)
    }

    @Test("Restore reports offline (keeps the token) when the server is unreachable")
    func restoreOffline() async {
        let store = MemorySecureStore([SecureStoreKey.refreshToken: "kept"])
        let client = Fixtures.client(store: store, transport: MockTransport { _ in throw APIError.network })
        #expect(await client.restore() == .offline)
        #expect(store.string(for: SecureStoreKey.refreshToken) == "kept")
    }

    @Test("Restore without a stored token is signed out without any request")
    func restoreSignedOut() async {
        let transport = MockTransport { _ in (Data(), 500) }
        #expect(await Fixtures.client(transport: transport).restore() == .signedOut)
        #expect(transport.requests.isEmpty)
    }

    @Test("GETs are retried after a dropped connection; writes are never retried")
    func retryPolicy() async throws {
        let attempts = Counter()
        let flaky = MockTransport { request in
            if request.httpMethod == "GET", attempts.next() < 3 { throw APIError.network }
            if request.httpMethod == "POST" { throw APIError.timeout }
            return (Fixtures.json(#"{"buses":[],"serverTime":"2026-10-16T08:00:00.000Z"}"#), 200)
        }
        let client = Fixtures.client(transport: flaky)

        let list = try await client.send(API.buses())
        #expect(list.buses.isEmpty)
        #expect(flaky.count(path: "/api/transport/buses") == 3)

        await #expect(throws: APIError.timeout) { try await client.send(API.startTrip(busId: "65f0000000000000000000aa")) }
        #expect(flaky.count(path: "/api/transport/trips") == 1)
    }

    @Test("GET retries stop after two extra attempts")
    func retryBound() async {
        let transport = MockTransport { _ in throw APIError.network }
        await #expect(throws: APIError.network) { try await Fixtures.client(transport: transport).send(API.buses()) }
        #expect(transport.requests.count == 3)
    }

    @Test("403 is surfaced with the server's message and does not refresh")
    func forbidden() async {
        let transport = MockTransport { _ in (Fixtures.json(#"{"message":"The transport account can only use Bus Tracking"}"#), 403) }
        do {
            _ = try await Fixtures.client(transport: transport).send(API.conversations())
            Issue.record("expected 403")
        } catch let error as APIError {
            #expect(error.status == 403)
            #expect(error.userMessage == "The transport account can only use Bus Tracking")
            #expect(transport.count(path: "/api/auth/refresh") == 0)
        } catch {
            Issue.record("unexpected \(error)")
        }
    }

    @Test("Malformed 2xx bodies become .decoding, not a crash")
    func decodingFailure() async {
        let transport = MockTransport { _ in (Fixtures.json(#"{"unexpected":true}"#), 200) }
        await #expect(throws: APIError.decoding("BusList")) { try await Fixtures.client(transport: transport).send(API.buses()) }
    }

    @Test("No configured server fails fast with .notConfigured")
    func notConfigured() async {
        let client = APIClient(configuration: ServerConfiguration(environment: .development, buildBaseURL: nil),
                               transport: MockTransport { _ in (Data(), 200) }, store: MemorySecureStore(), retryDelay: { _ in })
        await #expect(throws: APIError.notConfigured) { try await client.send(API.buses()) }
    }

    @Test("Logout posts the refresh token and forgets the session even if the call fails")
    func logout() async throws {
        let store = MemorySecureStore()
        let transport = MockTransport { request in
            if request.url?.path == "/api/auth/login" { return (Fixtures.session(), 200) }
            throw APIError.network
        }
        let client = Fixtures.client(store: store, transport: transport)
        _ = try await client.login(email: "s@example.test", password: "p")

        await client.logout()

        #expect(store.string(for: SecureStoreKey.refreshToken) == nil)
        #expect(await client.socketToken == nil)
        #expect(await client.currentUser == nil)
        let body = Fixtures.bodyJSON(try #require(transport.requests.last))
        #expect(body["refreshToken"] as? String == "test-refresh-2")
    }

    @Test("Changing the server address signs out")
    func serverOverride() async throws {
        let store = MemorySecureStore()
        let client = Fixtures.client(store: store, transport: MockTransport { _ in (Fixtures.session(), 200) })
        _ = try await client.login(email: "s@example.test", password: "p")

        await client.setServerOverride(URL(string: "https://other.example.test"))

        #expect(await client.configuration.baseURL?.absoluteString == "https://other.example.test")
        #expect(store.string(for: SecureStoreKey.serverURL) == "https://other.example.test")
        #expect(store.string(for: SecureStoreKey.refreshToken) == nil)
        #expect(await client.socketToken == nil)
    }

    @Test("Query parameters are encoded and nil values omitted")
    func queryEncoding() async throws {
        let transport = MockTransport { _ in (Fixtures.json(#"{"buses":[],"routes":[],"stops":[]}"#), 200) }
        let client = Fixtures.client(transport: transport)
        _ = try await client.send(API.transportSearch("Route 5 & Main"))
        let url = try #require(transport.requests.first?.url)
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        #expect(items == [URLQueryItem(name: "q", value: "Route 5 & Main")])

        _ = try? await client.send(API.bus(id: "65f0000000000000000000aa", stopId: nil))
        #expect(transport.requests.last?.url?.query == nil)
    }
}
