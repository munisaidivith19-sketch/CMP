import Foundation

// Models for the bus-tracking API (server/src/controllers/transportController.js).
// The server decides who may see which bus; these types carry only transport
// data — no passenger lists, phone numbers or other personal information.

/// `GET /transport/config`.
public struct TransportConfig: Decodable, Sendable, Equatable {
    public let mapStyleUrl: String
    public let mapAttribution: String
    public let studentVisibility: String
    public let liveSeconds: Int
    public let staleSeconds: Int
    public let canManage: Bool
    public let canShare: Bool
}

/// Freshness of a bus's last fix, as computed by the server (`freshness()`).
public enum TrackingState: String, Decodable, Sendable {
    case live, stale, offline

    public var label: String {
        switch self {
        case .live: return "Live"
        case .stale: return "Delayed signal"
        case .offline: return "Tracking offline"
        }
    }
}

public struct BusFix: Decodable, Sendable, Equatable {
    public let lat: Double
    public let lng: Double
    public let at: Date
    public let accuracy: Double?
    public let speed: Double?
    /// Only sent when the bus is moving (≥ 2 m/s); otherwise null.
    public let heading: Double?
    public let source: String?

    public init(lat: Double, lng: Double, at: Date, accuracy: Double? = nil, speed: Double? = nil, heading: Double? = nil, source: String? = nil) {
        self.lat = lat
        self.lng = lng
        self.at = at
        self.accuracy = accuracy
        self.speed = speed
        self.heading = heading
        self.source = source
    }
}

public struct RouteRef: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let code: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, code
    }
}

public struct BusTrip: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let source: String?
    public let status: String
    public let startedAt: Date?
    public let endedAt: Date?
    public let endReason: String?
    public let lastLocationAt: Date?
    public let mine: Bool?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case source, status, startedAt, endedAt, endReason, lastLocationAt, mine
    }

    public var isActive: Bool { status == "active" }
}

public struct Bus: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let number: String
    public let isActive: Bool?
    public let gpsSource: String?
    public let route: Ref<RouteRef>?
    public var location: BusFix?
    public var tracking: TrackingState
    public let trip: BusTrip?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case number, isActive, gpsSource, route, location, tracking, trip
    }

    public var routeName: String? { route?.value?.name }
}

/// `GET /transport/buses`.
public struct BusList: Decodable, Sendable {
    public let buses: [Bus]
    public let serverTime: Date?
}

public struct BusStop: Decodable, Sendable, Identifiable, Equatable, Hashable {
    public let id: String
    public let name: String
    public let lat: Double
    public let lng: Double
    public let sequence: Int
    public let scheduledTime: String?
    public let isCollege: Bool?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, lat, lng, sequence, scheduledTime, isCollege
    }
}

public struct BusRoute: Decodable, Sendable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let code: String?
    public let stops: [BusStop]
    /// Road polyline as `[lng, lat]` pairs (GeoJSON order) when configured.
    public let geometry: [[Double]]?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, code, stops, geometry
    }

    public var orderedStops: [BusStop] { stops.sorted { $0.sequence < $1.sequence } }

    /// The line to draw: the road geometry, or the stops in order when none is configured.
    public var path: [BusMath.LatLng] {
        if let geometry, geometry.count >= 2 {
            return geometry.compactMap { $0.count == 2 ? BusMath.LatLng(lat: $0[1], lng: $0[0]) : nil }
        }
        return orderedStops.map { BusMath.LatLng(lat: $0.lat, lng: $0.lng) }
    }

    public var hasRoadGeometry: Bool { (geometry?.count ?? 0) >= 2 }
}

public struct StopRef: Decodable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let sequence: Int?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, sequence
    }
}

/// ETA from the server (`computeEta`). When `status` is "unavailable" a
/// `reason` explains why; the app never fills in a time of its own.
public struct BusETA: Decodable, Sendable, Equatable {
    public let status: String
    public let reason: String?
    public let computedAt: Date?
    public let stop: StopRef?
    public let nextStop: StopRef?
    public let minutes: Int?
    public let arrivalAt: Date?
    public let distanceMeters: Int?
    public let method: String?
    /// high | medium | low
    public let confidence: String?
    public let approximateRoute: Bool?
    public let passed: Bool?

    public var isAvailable: Bool { status == "ok" && minutes != nil }
}

public struct RouteProgress: Decodable, Sendable, Equatable {
    public let fraction: Double
    public let offRoute: Bool
    public let passedSequences: [Int]
    public let alongMeters: Int?
}

public struct TravelledPoint: Decodable, Sendable, Equatable {
    public let lat: Double
    public let lng: Double
    public let at: Date?
}

/// `GET /transport/buses/:id`.
public struct BusDetail: Decodable, Sendable {
    public var bus: Bus
    public let route: BusRoute?
    public let progress: RouteProgress?
    public let eta: BusETA?
    public let myStop: String?
    public let travelled: [TravelledPoint]
    public let serverTime: Date?
}

/// `GET /transport/search?q=`.
public struct TransportSearchResult: Decodable, Sendable {
    public struct RouteHit: Decodable, Sendable, Identifiable {
        public let id: String
        public let name: String
        public let code: String?
        enum CodingKeys: String, CodingKey {
            case id = "_id"
            case name, code
        }
    }

    public struct StopHit: Decodable, Sendable, Identifiable {
        public let routeId: String
        public let routeName: String
        public let stopId: String
        public let name: String
        public let lat: Double
        public let lng: Double
        public let sequence: Int?
        public var id: String { "\(routeId):\(stopId)" }
    }

    public let buses: [Bus]
    public let routes: [RouteHit]
    public let stops: [StopHit]

    public var isEmpty: Bool { buses.isEmpty && routes.isEmpty && stops.isEmpty }
}

/// `GET /transport/me` — the viewer's assignment and, for staff, shareable buses.
public struct TransportMine: Decodable, Sendable {
    public struct Assignment: Decodable, Sendable {
        public let route: RouteRef?
        public let stop: BusStop?
    }

    public struct Shareable: Decodable, Sendable, Identifiable {
        public let id: String
        public let number: String
        public let gpsSource: String?
        public let route: String?
        enum CodingKeys: String, CodingKey {
            case id = "_id"
            case number, gpsSource, route
        }
    }

    public struct ActiveTrip: Decodable, Sendable {
        public let id: String
        public let status: String
        public let startedAt: Date?
        public let bus: BusNumberRef
        enum CodingKeys: String, CodingKey {
            case id = "_id"
            case status, startedAt, bus
        }
    }

    public struct BusNumberRef: Decodable, Sendable {
        public let id: String
        public let number: String
        enum CodingKeys: String, CodingKey {
            case id = "_id"
            case number
        }
    }

    public let assignment: Assignment?
    public let shareable: [Shareable]
    public let activeTrip: ActiveTrip?
}

/// Socket event `bus:location` (server/src/services/transport/ingest.js `livePayload`).
public struct BusLocationEvent: Decodable, Sendable, Equatable {
    public let busId: String
    public let lat: Double
    public let lng: Double
    public let at: Date
    public let accuracy: Double?
    public let speed: Double?
    public let heading: Double?
    public let source: String?
    public let tripId: String?

    public var fix: BusFix {
        BusFix(lat: lat, lng: lng, at: at, accuracy: accuracy, speed: speed, heading: heading, source: source)
    }
}

/// Socket event `bus:trip`.
public struct BusTripEvent: Decodable, Sendable {
    public let busId: String
    public let tripId: String
    public let status: String
}

/// `POST /transport/trips` response.
public struct StartTripResponse: Decodable, Sendable {
    public let trip: BusTrip
}

/// One phone fix for `POST /transport/trips/:id/locations` (1–20 per request).
public struct OutgoingFix: Encodable, Sendable, Equatable {
    public let lat: Double
    public let lng: Double
    public let timestamp: String
    public let accuracy: Double?
    public let speed: Double?
    public let heading: Double?

    public init(lat: Double, lng: Double, timestamp: Date, accuracy: Double?, speed: Double?, heading: Double?) {
        self.lat = lat
        self.lng = lng
        self.timestamp = VEXONJSON.formatISO(timestamp)
        // Core Location reports "unknown" as a negative value — send null instead.
        self.accuracy = accuracy.flatMap { $0 >= 0 ? $0 : nil }
        self.speed = speed.flatMap { $0 >= 0 ? $0 : nil }
        self.heading = heading.flatMap { (0...360).contains($0) ? $0 : nil }
    }
}

public struct TripLocationsBody: Encodable, Sendable {
    public let fixes: [OutgoingFix]
    public init(fixes: [OutgoingFix]) { self.fixes = Array(fixes.prefix(20)) }
}

/// `{ accepted, rejected: [{ index, code, reason }] }`.
public struct TripLocationsResult: Decodable, Sendable {
    public struct Rejection: Decodable, Sendable {
        public let index: Int
        public let code: String
        public let reason: String
    }
    public let accepted: Int
    public let rejected: [Rejection]
}
