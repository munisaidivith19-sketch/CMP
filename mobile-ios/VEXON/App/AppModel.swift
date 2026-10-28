import Foundation
import Observation
import VEXONKit

/// App-wide session state (port of the Android `Auth` + `AppState` objects).
///
/// Owns the single `APIClient` and `RealtimeClient`. Signing in or out swaps
/// the whole UI, disconnects the socket and drops every cached screen state,
/// so one account's data is never shown to the next.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case launching
        /// The saved session could not be checked because the server is unreachable.
        case offlineLaunch
        /// `sessionEnded`: the server ended the session (revoked / expired), not a manual sign-out.
        case signedOut(sessionEnded: Bool)
        case signedIn(User)
    }

    private(set) var phase: Phase = .launching
    private(set) var isOnline = true
    private(set) var serverAddress: String

    let client: APIClient
    let realtime = RealtimeClient()
    let push = PushManager()
    /// Lives at app level so an active staff trip keeps sharing while the user uses other tabs.
    let tripSharing = TripSharingService()
    let allowInsecureHTTP: Bool
    /// The chat thread on screen, so its new messages do not also pop up as a banner.
    var openConversationId: String?

    @ObservationIgnored private var eventsTask: Task<Void, Never>?

    var user: User? {
        if case .signedIn(let user) = phase { return user }
        return nil
    }

    init(client: APIClient? = nil) {
        let insecure = BuildSettings.allowInsecureHTTP
        allowInsecureHTTP = insecure
        let store: SecureStore = BuildSettings.isUITesting ? MemorySecureStore() : KeychainStore()
        let config = BuildSettings.serverConfiguration
        self.client = client ?? APIClient(
            configuration: config,
            store: store,
            log: OSLogSink(),
            deviceName: "Apple iPhone", // a generic label; never the user-assigned device name
            allowInsecureHTTP: insecure
        )
        serverAddress = config.baseURL?.absoluteString ?? ""
        listenForSessionEvents()
    }

    // MARK: - Session

    func start() async {
        phase = .launching
        await push.refreshStatus() // the notification gate is decided before the first signed-in frame
        await refreshServerAddress()
        switch await client.restore() {
        case .signedIn(let user): didSignIn(user)
        case .signedOut: phase = .signedOut(sessionEnded: false)
        case .offline: phase = .offlineLaunch
        }
    }

    /// From the offline launch screen: continue to sign-in without a session check.
    func skipOfflineLaunch() {
        phase = .signedOut(sessionEnded: false)
    }

    func signIn(email: String, password: String) async throws {
        let user = try await client.login(email: email, password: password)
        didSignIn(user)
    }

    func signOut() async {
        if tripSharing.isActive { await tripSharing.stop() } // end the trip on the server first
        tripSharing.stopForSignOut()
        await push.unregisterLocally()
        realtime.disconnect()
        await client.logout()
        phase = .signedOut(sessionEnded: false)
    }

    /// Re-read the profile after it changed elsewhere.
    func reloadUser() async {
        guard let me = try? await client.send(API.me()) else { return }
        await client.updateCurrentUser(me)
        if case .signedIn = phase { phase = .signedIn(me) }
    }

    // MARK: - Terms and Conditions

    /// The server refused a request until the current Terms are accepted: RootView shows the acceptance screen.
    func markTermsRequired() {
        guard case .signedIn(let user) = phase, !user.termsAcceptanceRequired else { return }
        let updated = user.replacingLegal((user.legal ?? LegalStatus(termsRequired: true)).markedRequired)
        phase = .signedIn(updated)
        Task { await client.updateCurrentUser(updated) }
    }

    /// Record acceptance of `version` for the signed-in account (the server takes the account from the session).
    func acceptTerms(version: Int) async throws {
        let legal = try await client.send(API.acceptTerms(version: version))
        guard case .signedIn(let user) = phase else { return }
        let updated = user.replacingLegal(legal)
        await client.updateCurrentUser(updated)
        phase = .signedIn(updated)
    }

    // MARK: - Server address

    func setServerAddress(_ raw: String) async -> ServerAddressError? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            await client.setServerOverride(nil)
        } else {
            switch ServerConfiguration.clean(trimmed, allowInsecureHTTP: allowInsecureHTTP) {
            case .success(let url): await client.setServerOverride(url)
            case .failure(let error): return error
            }
        }
        tripSharing.stopForSignOut()
        realtime.disconnect()
        await refreshServerAddress()
        phase = .signedOut(sessionEnded: false)
        return nil
    }

    private func refreshServerAddress() async {
        serverAddress = await client.configuration.baseURL?.absoluteString ?? ""
    }

    // MARK: - Private

    private func didSignIn(_ user: User) {
        phase = .signedIn(user)
        Task { await connectRealtime() }
    }

    private func connectRealtime() async {
        guard let base = await client.configuration.baseURL else { return }
        let client = self.client
        await realtime.connect(
            baseURL: base,
            tokenProvider: { await client.socketToken },
            reauthenticate: { [weak self] in
                switch await client.refreshSession() {
                case .refreshed: return true
                case .offline: return false
                case .expired:
                    self?.sessionExpired()
                    return false
                }
            }
        )
    }

    private func sessionExpired() {
        guard case .signedIn = phase else { return }
        tripSharing.stopForSignOut() // never keep collecting location without a session
        realtime.disconnect()
        phase = .signedOut(sessionEnded: true)
    }

    private func listenForSessionEvents() {
        let events = client.events
        eventsTask = Task { [weak self] in
            for await event in events {
                guard let self else { return }
                switch event {
                case .expired: self.sessionExpired()
                case .reachability(let online): if self.isOnline != online { self.isOnline = online }
                case .termsRequired: self.markTermsRequired()
                }
            }
        }
    }

    /// Called when the app returns to the foreground.
    func didBecomeActive() {
        // Back from Settings, or notifications revoked while away: re-check the mandatory permission.
        Task { await push.refreshStatus() }
        guard case .signedIn = phase else { return }
        realtime.resume()
    }
}
