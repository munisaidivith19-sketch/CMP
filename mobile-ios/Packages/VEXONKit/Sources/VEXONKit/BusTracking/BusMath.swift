import Foundation

/// Pure helpers for the bus map — the same rules as the web map (busGeo.js) and
/// the Android app (BusMath.kt), so all three move, rotate and label buses
/// identically. No UIKit/MapLibre types, so everything here is unit-tested.
public enum BusMath {
    public struct LatLng: Sendable, Equatable, Hashable {
        public let lat: Double
        public let lng: Double
        public init(lat: Double, lng: Double) {
            self.lat = lat
            self.lng = lng
        }

        public var isValid: Bool {
            lat.isFinite && lng.isFinite && (-90...90).contains(lat) && (-180...180).contains(lng) && !(lat == 0 && lng == 0)
        }
    }

    /// Where the map opens before a bus, route or the user's position is known:
    /// Chennai at city level. Applied once when the map is created — never
    /// re-applied, so the user can still pan / zoom out to Tamil Nadu, India or the world.
    public static let defaultCenter = LatLng(lat: 13.0827, lng: 80.2707)
    public static let defaultZoom: Double = 11

    public static func lerp(_ a: LatLng, _ b: LatLng, _ t: Double) -> LatLng {
        let k = min(1, max(0, t))
        return LatLng(lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k)
    }

    public static func easeOut(_ t: Double) -> Double {
        let k = 1 - min(1, max(0, t))
        return 1 - k * k * k
    }

    /// Shortest signed turn from one heading to another (350° → 10° is +20°).
    public static func shortestTurn(from: Double, to: Double) -> Double {
        let d = (((to - from).truncatingRemainder(dividingBy: 360)) + 540).truncatingRemainder(dividingBy: 360) - 180
        return d == -180 ? 180 : d
    }

    /// A heading worth showing: reported AND the bus is moving (≥ 2 m/s).
    public static func reliableHeading(_ heading: Double?, speed: Double?) -> Double? {
        guard let heading, let speed, speed >= 2, (0...360).contains(heading) else { return nil }
        return heading
    }

    /// Freshness of a fix on the device clock — used between server refreshes so a
    /// bus that stops reporting turns stale/offline on screen without a reload.
    public static func freshness(of fixAt: Date?, now: Date, liveSeconds: Int = 60, staleSeconds: Int = 300) -> TrackingState {
        guard let fixAt else { return .offline }
        let age = now.timeIntervalSince(fixAt)
        if age <= Double(liveSeconds) { return .live }
        if age <= Double(staleSeconds) { return .stale }
        return .offline
    }

    public static func agoText(_ fixAt: Date?, now: Date) -> String {
        guard let fixAt else { return "never" }
        let s = max(0, Int(now.timeIntervalSince(fixAt).rounded()))
        switch s {
        case ..<10: return "just now"
        case ..<60: return "\(s) s ago"
        case ..<3600: return "\(s / 60) min ago"
        default: return "\(s / 3600) h ago"
        }
    }

    /// Coarser than this (metres) is an estimate, not a GPS fix.
    public static let coarseFixMeters = 100.0

    /// "± 8 m", "± 350 m", "± 2.4 km".
    public static func accuracyText(_ meters: Double) -> String {
        if meters < 1000 { return "± \(Int(meters.rounded())) m" }
        return "± " + String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), meters / 1000) + " km"
    }

    /// Marker label: bus number above the route name.
    public static func markerLabel(number: String, route: String?) -> [String] {
        guard let route, !route.trimmingCharacters(in: .whitespaces).isEmpty else { return [number] }
        return [number, route]
    }

    /// ETA text — never more precise than the data allows.
    public static func etaText(_ eta: BusETA?) -> String {
        guard let eta else { return "ETA unavailable" }
        guard eta.isAvailable, let minutes = eta.minutes else { return eta.reason ?? "ETA unavailable" }
        if minutes <= 0 { return "Arriving now" }
        if eta.confidence == "low" { return "About \(minutes) min (approximate)" }
        return "About \(minutes) min"
    }

    /// Great-circle distance in metres.
    public static func distance(_ a: LatLng, _ b: LatLng) -> Double {
        let r = 6_371_008.8
        let dLat = (b.lat - a.lat) * .pi / 180
        let dLng = (b.lng - a.lng) * .pi / 180
        let la1 = a.lat * .pi / 180
        let la2 = b.lat * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(la1) * cos(la2) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * r * asin(min(1, sqrt(h)))
    }

    /// The smallest box containing all points (for "fit bus and me"); nil when empty.
    public static func bounds(_ points: [LatLng]) -> (southWest: LatLng, northEast: LatLng)? {
        let valid = points.filter(\.isValid)
        guard let first = valid.first else { return nil }
        var minLat = first.lat, maxLat = first.lat, minLng = first.lng, maxLng = first.lng
        for p in valid.dropFirst() {
            minLat = min(minLat, p.lat); maxLat = max(maxLat, p.lat)
            minLng = min(minLng, p.lng); maxLng = max(maxLng, p.lng)
        }
        return (LatLng(lat: minLat, lng: minLng), LatLng(lat: maxLat, lng: maxLng))
    }

    /// Split the route line at the bus's progress into travelled / remaining parts.
    /// `fraction` comes from the server's route projection (0…1).
    public static func split(path: [LatLng], fraction: Double?) -> (travelled: [LatLng], remaining: [LatLng]) {
        guard let fraction, path.count >= 2 else { return ([], path) }
        var cumulative: [Double] = [0]
        for i in 1..<path.count { cumulative.append(cumulative[i - 1] + distance(path[i - 1], path[i])) }
        let total = cumulative.last ?? 0
        guard total > 0 else { return ([], path) }
        let target = min(1, max(0, fraction)) * total
        guard let i = cumulative.firstIndex(where: { $0 >= target }), i > 0 else { return ([], path) }
        let segment = cumulative[i] - cumulative[i - 1]
        let t = segment > 0 ? (target - cumulative[i - 1]) / segment : 0
        let cut = lerp(path[i - 1], path[i], t)
        return (Array(path[0..<i]) + [cut], [cut] + Array(path[i...]))
    }
}

/// Validation of a fix before it is shown on the map. The server already
/// rejects bad fixes; this guards the client against malformed socket payloads
/// and keeps out-of-order updates from moving a marker backwards.
public enum FixGate {
    public static func accept(_ incoming: BusFix, current: BusFix?) -> Bool {
        guard BusMath.LatLng(lat: incoming.lat, lng: incoming.lng).isValid else { return false }
        if let current, incoming.at <= current.at { return false }
        return true
    }
}
