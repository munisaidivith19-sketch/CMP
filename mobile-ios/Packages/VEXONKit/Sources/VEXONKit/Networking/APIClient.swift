import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Session-level events the app reacts to (sign the user out, show the offline banner).
public enum SessionEvent: Sendable, Equatable {
    /// The server ended the session (revoked, expired, password changed, account disabled).
    case expired
    /// Connectivity changed: true after any HTTP answer, false after a network failure.
    case reachability(Bool)
}

/// Outcome of exchanging the stored refresh token.
public enum RefreshOutcome: Sendable, Equatable {
    case refreshed(User)
    /// The network or server is down — keep the stored token and try later.
    case offline
    /// No token, or the server rejected it (401) — the user must sign in again.
    case expired
}

/// Result of restoring a session at launch.
public enum RestoreOutcome: Sendable, Equatable {
    case signedIn(User)
    case signedOut
    /// The saved session could not be checked because the server is unreachable.
    case offline
}

/// Central API client — the single place that talks HTTP to the VEXON backend.
///
/// Mirrors the Android `Http` + `Auth` objects:
///  * Every request carries `x-client-platform: mobile` so the server returns the
///    refresh token in the body (never a cookie) and records a mobile session.
///  * The access token lives only in memory; the refresh token only in the
///    `SecureStore` (Keychain).
///  * On 401 the session is refreshed once (single-flight — the server rotates the
///    refresh token on every use and revokes the session if an old one is replayed)
///    and the request is replayed.
///  * GETs are retried (max 2 times, exponential backoff) after connectivity
///    failures or 502/503/504; writes are never retried automatically.
public actor APIClient {
    public private(set) var configuration: ServerConfiguration
    public private(set) var currentUser: User?
    private var accessToken: String?
    private var refreshTask: Task<RefreshOutcome, Never>?

    private let transport: HTTPTransport
    private let store: SecureStore
    private let log: LogSink
    private let deviceName: String
    private let allowInsecureHTTP: Bool
    private let retryDelay: @Sendable (Int) async throws -> Void

    public nonisolated let events: AsyncStream<SessionEvent>
    private let eventContinuation: AsyncStream<SessionEvent>.Continuation

    private static let noRefreshPaths = ["/auth/login", "/auth/refresh", "/auth/logout"]

    public init(
        configuration: ServerConfiguration,
        transport: HTTPTransport = URLSessionTransport(),
        store: SecureStore,
        log: LogSink = SilentLogSink(),
        deviceName: String = "iPhone",
        allowInsecureHTTP: Bool = false,
        retryDelay: (@Sendable (Int) async throws -> Void)? = nil
    ) {
        var config = configuration
        if config.overrideBaseURL == nil,
           let saved = store.string(for: SecureStoreKey.serverURL),
           case .success(let url) = ServerConfiguration.clean(saved, allowInsecureHTTP: allowInsecureHTTP) {
            config.setOverride(url)
        }
        self.configuration = config
        self.transport = transport
        self.store = store
        self.log = log
        self.deviceName = String(deviceName.prefix(60))
        self.allowInsecureHTTP = allowInsecureHTTP
        self.retryDelay = retryDelay ?? { attempt in
            try await Task.sleep(nanoseconds: UInt64(500_000_000) << UInt64(attempt))
        }
        let (stream, continuation) = AsyncStream.makeStream(of: SessionEvent.self, bufferingPolicy: .bufferingNewest(16))
        self.events = stream
        self.eventContinuation = continuation
    }

    // MARK: - Configuration

    /// Save (or clear, with nil) the device-level server address. Signs out,
    /// because a session belongs to one server.
    public func setServerOverride(_ url: URL?) {
        configuration.setOverride(url)
        store.set(url?.absoluteString, for: SecureStoreKey.serverURL)
        clearSession()
    }

    public var socketToken: String? { accessToken }

    // MARK: - Session lifecycle

    public func login(email: String, password: String) async throws -> User {
        struct Body: Encodable, Sendable { let email: String; let password: String }
        let payload = try await perform(
            Endpoint<SessionPayload>(.post, "/auth/login", body: Body(email: email, password: password), authenticated: false),
            token: nil
        )
        adopt(payload)
        return payload.user
    }

    /// Restore the saved session at launch. Offline is reported separately so the
    /// user is not thrown back to sign-in just because the network is down.
    public func restore() async -> RestoreOutcome {
        switch await refreshSession() {
        case .refreshed(let user): return .signedIn(user)
        case .offline: return .offline
        case .expired: return .signedOut
        }
    }

    /// Exchange the stored refresh token for a new session. Concurrent callers share one request.
    public func refreshSession() async -> RefreshOutcome {
        if let running = refreshTask { return await running.value }
        let task = Task { await self.performRefresh() }
        refreshTask = task
        let outcome = await task.value
        refreshTask = nil
        return outcome
    }

    private func performRefresh() async -> RefreshOutcome {
        guard let token = store.string(for: SecureStoreKey.refreshToken), !token.isEmpty else { return .expired }
        guard configuration.baseURL != nil else { return .expired }
        struct Body: Encodable, Sendable { let refreshToken: String }
        do {
            let payload = try await perform(
                Endpoint<SessionPayload>(.post, "/auth/refresh", body: Body(refreshToken: token), authenticated: false, timeout: 15),
                token: nil
            )
            adopt(payload)
            return .refreshed(payload.user)
        } catch let error as APIError {
            if case .unauthorized = error {
                clearSession()
                return .expired
            }
            return .offline // network down / server error — keep the stored token
        } catch {
            return .offline
        }
    }

    /// Sign out on the server (best effort) and forget the session locally.
    public func logout() async {
        if let token = store.string(for: SecureStoreKey.refreshToken) {
            struct Body: Encodable, Sendable { let refreshToken: String }
            _ = try? await perform(
                Endpoint<EmptyResponse>(.post, "/auth/logout", body: Body(refreshToken: token), authenticated: false, timeout: 10),
                token: accessToken
            )
        }
        clearSession()
    }

    public func updateCurrentUser(_ user: User) {
        currentUser = user
    }

    private func adopt(_ payload: SessionPayload) {
        accessToken = payload.accessToken
        currentUser = payload.user
        if let refresh = payload.refreshToken, !refresh.isEmpty {
            store.set(refresh, for: SecureStoreKey.refreshToken)
        }
    }

    private func clearSession() {
        accessToken = nil
        currentUser = nil
        store.set(nil, for: SecureStoreKey.refreshToken)
    }

    // MARK: - Requests

    /// Send an endpoint with auth, refresh-and-replay and bounded retries.
    public func send<T>(_ endpoint: Endpoint<T>) async throws -> T {
        var attempt = 0
        while true {
            do {
                return try await sendAuthenticated(endpoint)
            } catch let error as APIError {
                guard endpoint.isIdempotent, attempt < 2, Self.isRetryable(error) else { throw error }
                attempt += 1
                do { try await retryDelay(attempt) } catch { throw APIError.cancelled }
            }
        }
    }

    static func isRetryable(_ error: APIError) -> Bool {
        switch error {
        case .network, .timeout: return true
        case .server(let status, _): return [502, 503, 504].contains(status)
        default: return false
        }
    }

    private func sendAuthenticated<T>(_ endpoint: Endpoint<T>) async throws -> T {
        guard endpoint.authenticated else { return try await perform(endpoint, token: nil) }
        do {
            return try await perform(endpoint, token: accessToken)
        } catch APIError.unauthorized(let body) {
            if Self.noRefreshPaths.contains(where: endpoint.path.hasPrefix) { throw APIError.unauthorized(body) }
            switch await refreshSession() {
            case .refreshed:
                return try await perform(endpoint, token: accessToken)
            case .offline:
                throw APIError.unauthorized(body)
            case .expired:
                eventContinuation.yield(.expired)
                throw APIError.unauthorized(body)
            }
        }
    }

    private func perform<T>(_ endpoint: Endpoint<T>, token: String?) async throws -> T {
        if Task.isCancelled { throw APIError.cancelled }
        guard let url = configuration.apiURL(path: endpoint.path, query: endpoint.query) else { throw APIError.notConfigured }
        var request = URLRequest(url: url, timeoutInterval: endpoint.timeout)
        request.httpMethod = endpoint.method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("mobile", forHTTPHeaderField: "x-client-platform")
        request.setValue(deviceName, forHTTPHeaderField: "x-device-name")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body = endpoint.body {
            request.httpBody = try VEXONJSON.encoder().encode(AnyEncodable(body))
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        }

        let started = Date()
        let data: Data
        let status: Int
        do {
            (data, status) = try await transport.send(request)
        } catch let error as APIError {
            if error.isConnectivity { eventContinuation.yield(.reachability(false)) }
            log.log(.warning, "\(Redactor.describe(method: endpoint.method.rawValue, url: url)) failed: \(Redactor.redact(String(describing: error)))")
            throw error
        } catch {
            eventContinuation.yield(.reachability(false))
            throw APIError.network
        }
        eventContinuation.yield(.reachability(true))
        let ms = Int(Date().timeIntervalSince(started) * 1000)
        log.log(.debug, "\(Redactor.describe(method: endpoint.method.rawValue, url: url)) → \(status) (\(ms) ms)")

        guard (200..<300).contains(status) else { throw APIError.from(status: status, body: data) }
        if T.self == EmptyResponse.self, let empty = EmptyResponse() as? T { return empty }
        do {
            return try VEXONJSON.decoder().decode(T.self, from: data)
        } catch {
            log.log(.error, "Decoding \(T.self) from \(endpoint.path) failed: \(Redactor.redact(String(describing: error)))")
            throw APIError.decoding(String(describing: T.self))
        }
    }
}

/// Type-erases an `Encodable` so a heterogeneous body can be encoded.
struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}
