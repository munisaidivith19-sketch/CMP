import Foundation
import Observation
import SocketIO
import VEXONKit

/// A server-sent Socket.IO event with its first argument as JSON.
struct RealtimeEvent: Sendable {
    let name: String
    let payload: Data?

    func decode<T: Decodable>(_ type: T.Type) -> T? {
        guard let payload else { return nil }
        return try? VEXONJSON.decoder().decode(T.self, from: payload)
    }
}

/// One Socket.IO connection to the same server the web and Android apps use
/// (port of Android `Realtime`). The server authenticates the access token in
/// the handshake and only admits the socket to rooms it is authorised for
/// (own user room, verified chat rooms, permitted bus rooms).
///
/// Rooms do not survive a reconnect, so features re-join on every `connect`
/// event they receive from `events()`.
@MainActor
@Observable
final class RealtimeClient {
    private(set) var isConnected = false

    @ObservationIgnored private var manager: SocketManager?
    @ObservationIgnored private var socket: SocketIOClient?
    @ObservationIgnored private var subscribers: [UUID: AsyncStream<RealtimeEvent>.Continuation] = [:]
    @ObservationIgnored private var tokenProvider: (@MainActor () async -> String?)?
    @ObservationIgnored private var reauthenticate: (@MainActor () async -> Bool)?
    @ObservationIgnored private var reauthInFlight = false

    /// Connect for the signed-in user. `reauthenticate` refreshes the session and
    /// returns true when the socket should retry with the new token.
    func connect(
        baseURL: URL,
        tokenProvider: @escaping @MainActor () async -> String?,
        reauthenticate: @escaping @MainActor () async -> Bool
    ) async {
        guard socket == nil else { return }
        self.tokenProvider = tokenProvider
        self.reauthenticate = reauthenticate
        let manager = SocketManager(socketURL: baseURL, config: [
            .log(false),
            .compress,
            .forceWebsockets(true),
            .version(.three), // Socket.IO protocol v3/v4 (server: socket.io ^4.8)
            .reconnects(true),
            .reconnectWait(1),
            .reconnectWaitMax(10),
            .handleQueue(.main),
        ])
        let socket = manager.defaultSocket
        self.manager = manager
        self.socket = socket

        socket.on(clientEvent: .connect) { [weak self] _, _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.isConnected = true
                self.broadcast(RealtimeEvent(name: "connect", payload: nil))
            }
        }
        socket.on(clientEvent: .disconnect) { [weak self] data, _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.isConnected = false
                self.broadcast(RealtimeEvent(name: "disconnect", payload: nil))
                // The server dropped us (session revoked or token expired): re-authenticate.
                if (data.first as? String) == "io server disconnect" { self.reauth() }
            }
        }
        socket.on(clientEvent: .error) { [weak self] data, _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                if Self.isUnauthorized(data) { self.reauth() }
            }
        }
        socket.onAny { [weak self] event in
            let name = event.event
            let payload = Self.json(event.items?.first)
            MainActor.assumeIsolated {
                self?.broadcast(RealtimeEvent(name: name, payload: payload))
            }
        }

        let token = await tokenProvider() ?? ""
        socket.connect(withPayload: ["token": token])
    }

    func disconnect() {
        socket?.removeAllHandlers()
        socket?.disconnect()
        manager?.disconnect()
        socket = nil
        manager = nil
        isConnected = false
        tokenProvider = nil
        reauthenticate = nil
    }

    /// iOS suspends sockets in the background; reconnect when the app is active again.
    func resume() {
        guard let socket, socket.status != .connected, socket.status != .connecting else { return }
        Task { await reconnectWithFreshToken() }
    }

    /// A stream of every server event. Cancelled automatically when the consuming task ends.
    func events() -> AsyncStream<RealtimeEvent> {
        let id = UUID()
        let (stream, continuation) = AsyncStream.makeStream(of: RealtimeEvent.self, bufferingPolicy: .bufferingNewest(64))
        subscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor in self?.subscribers[id] = nil }
        }
        return stream
    }

    func emit(_ event: String, _ item: String) {
        guard let socket, socket.status == .connected else { return }
        socket.emit(event, item)
    }

    /// Emit and wait (max 5 s) for the server's acknowledgement. Nil when offline or timed out.
    func emitWithAck(_ event: String, _ item: String) async -> Data? {
        guard let socket, socket.status == .connected else { return nil }
        return await withCheckedContinuation { continuation in
            socket.emitWithAck(event, item).timingOut(after: 5) { data in
                if let first = data.first as? String, first == SocketAckStatus.noAck.rawValue {
                    continuation.resume(returning: nil)
                } else {
                    continuation.resume(returning: Self.json(data.first))
                }
            }
        }
    }

    // MARK: - Private

    private func broadcast(_ event: RealtimeEvent) {
        for continuation in subscribers.values { continuation.yield(event) }
    }

    private func reauth() {
        guard !reauthInFlight, let reauthenticate else { return }
        reauthInFlight = true
        Task {
            let ok = await reauthenticate()
            reauthInFlight = false
            if ok { await reconnectWithFreshToken() }
        }
    }

    private func reconnectWithFreshToken() async {
        guard let socket, let tokenProvider else { return }
        let token = await tokenProvider() ?? ""
        socket.disconnect()
        socket.connect(withPayload: ["token": token])
    }

    nonisolated private static func isUnauthorized(_ data: [Any]) -> Bool {
        data.contains { item in
            if let text = item as? String { return text.contains("unauthorized") }
            if let dict = item as? [String: Any] { return (dict["message"] as? String) == "unauthorized" }
            return false
        }
    }

    nonisolated private static func json(_ item: Any?) -> Data? {
        guard let item else { return nil }
        if JSONSerialization.isValidJSONObject(item) {
            return try? JSONSerialization.data(withJSONObject: item)
        }
        if let text = item as? String { return try? JSONEncoder().encode(text) }
        return nil
    }
}
