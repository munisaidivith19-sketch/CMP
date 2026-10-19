import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import VEXONKit

// Test doubles. All data here is SYNTHETIC test data — no real accounts,
// tokens or GPS positions.

/// A transport answering from a script; records every request it receives.
final class MockTransport: HTTPTransport, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest) async throws -> (Data, Int)
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    private let handler: Handler

    init(_ handler: @escaping Handler) { self.handler = handler }

    var requests: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return _requests
    }

    func count(path: String) -> Int { requests.filter { $0.url?.path == path }.count }

    func send(_ request: URLRequest) async throws -> (Data, Int) {
        record(request)
        return try await handler(request)
    }

    private func record(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        _requests.append(request)
    }
}

/// Thread-safe counter for use inside @Sendable handlers.
final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func next() -> Int { lock.lock(); defer { lock.unlock() }; value += 1; return value }
    var current: Int { lock.lock(); defer { lock.unlock() }; return value }
}

enum Fixtures {
    static let base = URL(string: "https://vexon.example.test")!

    static func config() -> ServerConfiguration {
        ServerConfiguration(environment: .testing, buildBaseURL: base)
    }

    static func json(_ text: String) -> Data { Data(text.utf8) }

    static func session(access: String = "test-access-1", refresh: String = "test-refresh-2", role: String = "student") -> Data {
        json("""
        {"accessToken":"\(access)","refreshToken":"\(refresh)","idleTimeoutSec":null,
         "user":{"_id":"65f000000000000000000001","name":"Test Student","email":"student@example.test","role":"\(role)",
                 "department":"CSE","year":2,"section":"A"}}
        """)
    }

    static func bodyJSON(_ request: URLRequest) -> [String: Any] {
        guard let data = request.httpBody, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }

    static func client(store: SecureStore = MemorySecureStore(), transport: HTTPTransport) -> APIClient {
        APIClient(configuration: config(), transport: transport, store: store, deviceName: "Test iPhone", retryDelay: { _ in })
    }
}
