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
    /// Campus timezone for showing times (older servers omit it → Asia/Kolkata).
    public let timezone: String?
    public let canViewHistory: Bool?
    public let canViewReports: Bool?
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
    /// towards_college | towards_home (absent from older servers).
    public let direction: String?
    public let directionAssumed: Bool?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case source, status, startedAt, endedAt, endReason, lastLocationAt, mine, direction, directionAssumed
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
    /// The active trip's server-recorded journey (nil without a trip or from older servers).
    public let journey: TripJourney?
    /// The route the bus is actually following when it differs from `route` (a separate return route).
    public let journeyRoute: BusRoute?

    /// The route to draw on the map.
    public var mapRoute: BusRoute? { journeyRoute ?? route }
}

/// A journey ETA from the server (`stopEtas`). When `status` is not "ok", `reason`
/// says why and the app shows that instead of a time.
public struct JourneyETA: Decodable, Sendable, Equatable {
    public let status: String
    public let reason: String?
    public let minutes: Int?
    public let predictedArrivalAt: Date?
    /// history | recent_speed | assumed_speed
    public let method: String?
    /// high | medium | low
    public let confidence: String?
    public let approximate: Bool?

    public init(status: String, reason: String? = nil, minutes: Int? = nil, predictedArrivalAt: Date? = nil, method: String? = nil, confidence: String? = nil, approximate: Bool? = nil) {
        self.status = status
        self.reason = reason
        self.minutes = minutes
        self.predictedArrivalAt = predictedArrivalAt
        self.method = method
        self.confidence = confidence
        self.approximate = approximate
    }

    public var isAvailable: Bool { status == "ok" }
}

/// One planned stop of a trip, in travel order. `status`: upcoming | arrived | departed | not_recorded.
/// `actual*` times are RECORDED; `eta` is a PREDICTION — they are never mixed up.
public struct JourneyStop: Decodable, Sendable, Equatable, Identifiable {
    public let order: Int
    public let stopId: String
    public let name: String
    public let isCollege: Bool?
    public let status: String
    public let notRecordedReason: String?
    public let actualArrivalAt: Date?
    public let actualDepartureAt: Date?
    public let arrivalSource: String?
    public let departureSource: String?
    public let eta: JourneyETA?

    public init(order: Int, stopId: String, name: String, isCollege: Bool? = nil, status: String, notRecordedReason: String? = nil, actualArrivalAt: Date? = nil, actualDepartureAt: Date? = nil, arrivalSource: String? = nil, departureSource: String? = nil, eta: JourneyETA? = nil) {
        self.order = order
        self.stopId = stopId
        self.name = name
        self.isCollege = isCollege
        self.status = status
        self.notRecordedReason = notRecordedReason
        self.actualArrivalAt = actualArrivalAt
        self.actualDepartureAt = actualDepartureAt
        self.arrivalSource = arrivalSource
        self.departureSource = departureSource
        self.eta = eta
    }

    public var id: Int { order }
    public var isManual: Bool { arrivalSource == "manual" || departureSource == "manual" }
    public var hasRecordedTime: Bool { actualArrivalAt != nil || actualDepartureAt != nil }
}

public struct JourneyCollege: Decodable, Sendable, Equatable {
    public let order: Int
    public let name: String
    public let actualArrivalAt: Date?
    public let eta: JourneyETA?
}

/// `journey` in `GET /transport/buses/:id` and `GET /transport/trips/:id/journey`.
public struct TripJourney: Decodable, Sendable, Equatable {
    public let tripId: String
    public let status: String
    public let direction: String?
    public let directionAssumed: Bool?
    /// forward | return_route | reverse
    public let routeMode: String?
    public let tripStartedAt: Date?
    public let endedAt: Date?
    public let tracking: String?
    public let currentStop: JourneyStop?
    public let nextStop: JourneyStop?
    public let followingStop: JourneyStop?
    public let nextStopUncertain: Bool?
    public let uncertainReason: String?
    public let college: JourneyCollege?
    public let stops: [JourneyStop]

    public var isActive: Bool { status == "active" }
    /// The direction can still be corrected: active and no stop recorded yet.
    public var canChangeDirection: Bool { isActive && !stops.contains { $0.hasRecordedTime } }
}

// MARK: - Journey history (`/transport/history/*`)
// Managers, principal, dean, AO and chairman see every trip; people who share a
// bus see their own (`scope` = "own"). Only RECORDED times — no GPS tracks.

public struct HistoryNamedRef: Decodable, Sendable, Equatable {
    public let id: String
    public let name: String?
    public let number: String?
    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name, number
    }
}

public struct HistoryOperator: Decodable, Sendable, Equatable {
    public let name: String
    public let isSelf: Bool?
    enum CodingKeys: String, CodingKey {
        case name
        case isSelf = "self"
    }
}

/// One trip in the history list (and the header of a trip's detail).
public struct HistoryTrip: Decodable, Sendable, Equatable, Identifiable, Hashable {
    public let id: String
    public let bus: HistoryNamedRef?
    public let route: HistoryNamedRef?
    public let direction: String?
    public let directionAssumed: Bool?
    public let status: String
    public let interrupted: Bool?
    public let tripStartedAt: Date?
    public let endedAt: Date?
    public let collegeArrivedAt: Date?
    public let durationMinutes: Double?
    public let stopsPlanned: Int?
    public let stopsRecorded: Int?
    public let manualRecords: Int?
    public let `operator`: HistoryOperator?
    /// Detail only: measured first departure → arrival at the final stop.
    public let journeyMinutes: Double?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case bus, route, direction, directionAssumed, status, interrupted, tripStartedAt, endedAt, collegeArrivedAt,
             durationMinutes, stopsPlanned, stopsRecorded, manualRecords, `operator`, journeyMinutes
    }

    public static func == (a: HistoryTrip, b: HistoryTrip) -> Bool { a.id == b.id && a.status == b.status && a.stopsRecorded == b.stopsRecorded }
    public func hash(into h: inout Hasher) { h.combine(id) }
}

/// `GET /transport/history/trips`.
public struct HistoryTripList: Decodable, Sendable {
    public let trips: [HistoryTrip]
    public let total: Int
    public let page: Int
    public let limit: Int
    public let timezone: String?
    /// all | own
    public let scope: String?

    public var hasMore: Bool { page * limit < total }
}

public struct HistoryEventInfo: Decodable, Sendable, Equatable {
    public let source: String?
    public let reason: String?
    public let corrected: Bool?
}

/// One planned stop of a past trip with what was RECORDED there.
public struct HistoryStop: Decodable, Sendable, Equatable, Identifiable {
    public let order: Int
    public let name: String
    public let isCollege: Bool?
    public let actualArrivalAt: Date?
    public let actualDepartureAt: Date?
    public let arrivalSource: String?
    public let departureSource: String?
    /// Why no arrival was recorded: pending | not_detected | before_tracking.
    public let notRecorded: String?
    public let minutesFromPreviousStop: Double?
    public let dwellMinutes: Double?
    /// Against a real timetable only (positive = late).
    public let delayMinutes: Double?
    public let arrival: HistoryEventInfo?
    public let departure: HistoryEventInfo?

    public var id: Int { order }
    public var isManual: Bool { arrivalSource == "manual" || departureSource == "manual" }
    public var isCorrected: Bool { arrival?.corrected == true || departure?.corrected == true }
}

/// `GET /transport/history/trips/:id`.
public struct HistoryTripDetail: Decodable, Sendable {
    public let trip: HistoryTrip
    public let stops: [HistoryStop]
    public let timezone: String?
}

/// Socket event `bus:journey` — a stop arrival/departure (or trip end) was recorded.
public struct BusJourneyEvent: Decodable, Sendable {
    public let busId: String
    public let tripId: String
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
