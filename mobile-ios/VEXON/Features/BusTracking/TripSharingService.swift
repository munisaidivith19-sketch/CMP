import CoreLocation
import Observation
import VEXONKit

/// Staff fallback when a bus has no vehicle tracker: share THIS phone's
/// position for one bus during an explicitly started trip.
///
/// * Only roles the server allows (`TRIP_SHARER_ROLES`) for a bus they are
///   assigned to can start a trip — enforced by `POST /transport/trips`.
/// * Location runs only while the trip is active. iOS shows the blue
///   location indicator whenever it continues in the background.
/// * It stops on "End trip", or by itself when the server answers that the
///   trip is no longer active (ended elsewhere, timed out, bus deactivated) or
///   that this user may no longer share it.
/// * Fixes are filtered and batched by `TripFixBuffer` (accuracy, interval,
///   age) to match the server's ingestion rules.
@MainActor
@Observable
final class TripSharingService: NSObject, CLLocationManagerDelegate {
    enum Phase: Equatable {
        case idle
        case starting
        case active(tripId: String, busNumber: String)
        case stopping
    }

    private(set) var phase: Phase = .idle
    private(set) var problem: String?
    private(set) var lastSentAt: Date?
    private(set) var lastAccuracy: Double?
    private(set) var queued = 0

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var buffer = TripFixBuffer()
    @ObservationIgnored private var uploader: Task<Void, Never>?
    @ObservationIgnored private var client: APIClient?
    @ObservationIgnored private var pendingStart: (() -> Void)?

    var isActive: Bool {
        if case .active = phase { return true }
        return false
    }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
    }

    // MARK: - Trip lifecycle

    func start(busId: String, busNumber: String, client: APIClient) async {
        guard phase == .idle else { return }
        problem = nil
        phase = .starting
        guard await ensurePermission() else {
            phase = .idle
            return
        }
        do {
            let response = try await client.send(API.startTrip(busId: busId))
            begin(tripId: response.trip.id, busNumber: busNumber, client: client)
        } catch {
            phase = .idle
            problem = APIError.wrap(error).userMessage
        }
    }

    /// Continue a trip this user already started (e.g. after the app was closed).
    /// The server only reports `activeTrip` to the person sharing it.
    func resume(_ trip: TransportMine.ActiveTrip, client: APIClient) async {
        guard phase == .idle, trip.status == "active" else { return }
        problem = nil
        phase = .starting
        guard await ensurePermission() else {
            phase = .idle
            return
        }
        begin(tripId: trip.id, busNumber: trip.bus.number, client: client)
    }

    func stop() async {
        guard case .active = phase else { return }
        await flush() // send the last positions while the trip is still active
        guard case .active(let tripId, let busNumber) = phase, let client else { return }
        phase = .stopping
        do {
            _ = try await client.send(API.stopTrip(id: tripId))
            endLocally(message: nil)
        } catch {
            let e = APIError.wrap(error)
            if case .conflict = e {
                endLocally(message: nil) // already ended on the server
            } else {
                // The trip is still active on the server: keep sharing and let the user retry.
                phase = .active(tripId: tripId, busNumber: busNumber)
                problem = "Could not end the trip: \(e.userMessage)"
            }
        }
    }

    /// Sign-out or session end: stop the phone's location immediately.
    func stopForSignOut() {
        if phase != .idle { endLocally(message: nil) }
    }

    private func begin(tripId: String, busNumber: String, client: APIClient) {
        self.client = client
        buffer.reset()
        phase = .active(tripId: tripId, busNumber: busNumber)
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        uploader?.cancel()
        uploader = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                await self?.flush()
            }
        }
    }

    private func endLocally(message: String?) {
        uploader?.cancel()
        uploader = nil
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        buffer.reset()
        queued = 0
        phase = .idle
        client = nil
        problem = message
    }

    /// Upload the next batch. Network failures keep the batch for the next tick
    /// (a duplicate after a lost response is rejected by the server as out of order).
    private func flush() async {
        guard let client, case .active(let tripId, _) = phase else { return }
        let batch = buffer.nextBatch(now: Date())
        queued = buffer.pending.count
        guard !batch.isEmpty else { return }
        do {
            _ = try await client.send(API.postTripLocations(tripId: tripId, fixes: batch))
            buffer.confirm(count: batch.count)
            queued = buffer.pending.count
            lastSentAt = Date()
            problem = nil
        } catch {
            handleUploadError(APIError.wrap(error))
        }
    }

    private func handleUploadError(_ error: APIError) {
        switch error {
        case .conflict(let body) where body?.code == "trip_not_active":
            endLocally(message: "The trip has ended, so location sharing stopped.")
        case .forbidden, .notFound:
            endLocally(message: "You can no longer share this bus’s location, so sharing stopped.")
        case .unauthorized:
            endLocally(message: "You were signed out, so location sharing stopped.")
        case .network, .timeout:
            problem = "No connection — positions are queued and will be sent when you are back online."
        case .cancelled:
            break
        default:
            problem = error.userMessage
        }
    }

    // MARK: - Permission

    private func ensurePermission() async -> Bool {
        guard CLLocationManager.locationServicesEnabled() else {
            problem = "Turn on Location Services in iOS Settings to share the bus location."
            return false
        }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            return checkPrecision()
        case .denied, .restricted:
            problem = "Location access is off for VEXON. Allow it in Settings → VEXON → Location to share the bus location."
            return false
        case .notDetermined:
            let granted = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                pendingStart = { [weak self] in
                    guard let self else { return continuation.resume(returning: false) }
                    let status = self.manager.authorizationStatus
                    continuation.resume(returning: status == .authorizedWhenInUse || status == .authorizedAlways)
                }
                manager.requestWhenInUseAuthorization()
            }
            if !granted { problem = "Location permission was not granted, so the trip was not started." }
            return granted && checkPrecision()
        @unknown default:
            return false
        }
    }

    private func checkPrecision() -> Bool {
        if manager.accuracyAuthorization == .reducedAccuracy {
            problem = "Precise Location is off. Turn it on in Settings → VEXON → Location — approximate positions are rejected."
            return false
        }
        return true
    }

    // MARK: - CLLocationManagerDelegate

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        MainActor.assumeIsolated {
            if status != .notDetermined, let resume = pendingStart {
                pendingStart = nil
                resume()
            }
            if isActive, status == .denied || status == .restricted {
                endLocally(message: "Location access was turned off, so sharing stopped.")
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let fixes = locations.map { ($0.coordinate, $0.timestamp, $0.horizontalAccuracy, $0.speed, $0.course) }
        MainActor.assumeIsolated {
            guard isActive else { return }
            for (coordinate, at, accuracy, speed, course) in fixes {
                lastAccuracy = accuracy >= 0 ? accuracy : nil
                buffer.add(lat: coordinate.latitude, lng: coordinate.longitude, at: at, accuracy: accuracy, speed: speed, heading: course)
            }
            queued = buffer.pending.count
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let denied = (error as? CLError)?.code == .denied
        MainActor.assumeIsolated {
            if denied, isActive { endLocally(message: "Location access was turned off, so sharing stopped.") }
        }
    }
}
