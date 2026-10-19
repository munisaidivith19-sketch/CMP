import CoreLocation
import Observation
import VEXONKit

/// The viewer's own position for the bus map — ONE-SHOT only.
///
/// Permission is requested only when the user taps "My location", and each tap
/// takes a single fix (`requestLocation`). Nothing runs in the background and
/// no position is sent to the server: opening the map never starts continuous
/// tracking of a student.
@MainActor
@Observable
final class StudentLocator: NSObject, CLLocationManagerDelegate {
    enum State: Equatable {
        case idle
        case requesting
        case located(CLLocationCoordinate2D, accuracy: Double)
        case denied
        case restricted
        case unavailable(String)

        static func == (a: State, b: State) -> Bool {
            switch (a, b) {
            case (.idle, .idle), (.requesting, .requesting), (.denied, .denied), (.restricted, .restricted): return true
            case let (.located(c1, a1), .located(c2, a2)): return c1.latitude == c2.latitude && c1.longitude == c2.longitude && a1 == a2
            case let (.unavailable(m1), .unavailable(m2)): return m1 == m2
            default: return false
            }
        }
    }

    private(set) var state: State = .idle
    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var wantsFix = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    var coordinate: CLLocationCoordinate2D? {
        if case .located(let c, _) = state { return c }
        return nil
    }

    /// Accuracy coarser than 100 m (e.g. "Precise Location" off) — shown as approximate.
    var isApproximate: Bool {
        if case .located(_, let accuracy) = state { return accuracy > BusMath.coarseFixMeters }
        return false
    }

    /// Called from the "My location" button.
    func locateOnce() {
        guard CLLocationManager.locationServicesEnabled() else {
            state = .unavailable("Location Services are turned off in iOS Settings.")
            return
        }
        switch manager.authorizationStatus {
        case .notDetermined:
            wantsFix = true
            state = .requesting
            manager.requestWhenInUseAuthorization()
        case .denied:
            state = .denied
        case .restricted:
            state = .restricted
        case .authorizedWhenInUse, .authorizedAlways:
            state = .requesting
            manager.requestLocation()
        @unknown default:
            state = .unavailable("Location is not available.")
        }
    }

    /// Forget the position when leaving the map.
    func clear() {
        wantsFix = false
        if case .located = state { state = .idle }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        MainActor.assumeIsolated {
            guard wantsFix else { return }
            switch status {
            case .authorizedWhenInUse, .authorizedAlways:
                wantsFix = false
                self.manager.requestLocation()
            case .denied:
                wantsFix = false
                state = .denied
            case .restricted:
                wantsFix = false
                state = .restricted
            default:
                break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        let coordinate = last.coordinate
        let accuracy = last.horizontalAccuracy
        MainActor.assumeIsolated {
            guard accuracy >= 0 else {
                state = .unavailable("Could not get a reliable position. Try again outdoors.")
                return
            }
            state = .located(coordinate, accuracy: accuracy)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let denied = (error as? CLError)?.code == .denied
        MainActor.assumeIsolated {
            state = denied ? .denied : .unavailable("Your position is not available right now. Try again in a moment.")
        }
    }
}
