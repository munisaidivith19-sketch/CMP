import Foundation

/// Collects phone fixes during an authorised trip and decides what to upload.
///
/// Rules (mirroring the server's ingestion limits in services/transport/config.js
/// so the phone does not send fixes the server will only reject):
///  * fixes coarser than `maxAccuracyMeters` or with invalid coordinates are dropped;
///  * fixes closer together than `minInterval` are dropped (server GPS_MIN_INTERVAL_MS);
///  * fixes older than `maxAge` are dropped instead of being sent late (server GPS_MAX_AGE_SECONDS);
///  * at most `maxBatch` (server limit: 20) are uploaded per request, oldest first;
///  * the queue is bounded so a long network outage cannot grow memory without limit.
public struct TripFixBuffer: Sendable {
    public let maxAccuracyMeters: Double
    public let minInterval: TimeInterval
    public let maxAge: TimeInterval
    public let maxBatch: Int
    public let capacity: Int

    public private(set) var pending: [OutgoingFixRecord] = []
    private var lastAcceptedAt: Date?

    public struct OutgoingFixRecord: Sendable, Equatable {
        public let at: Date
        public let fix: OutgoingFix
    }

    public init(maxAccuracyMeters: Double = 100, minInterval: TimeInterval = 2, maxAge: TimeInterval = 120, maxBatch: Int = 20, capacity: Int = 60) {
        self.maxAccuracyMeters = maxAccuracyMeters
        self.minInterval = minInterval
        self.maxAge = maxAge
        self.maxBatch = min(20, max(1, maxBatch))
        self.capacity = max(self.maxBatch, capacity)
    }

    public enum Decision: Equatable, Sendable {
        case queued
        case droppedInvalid
        case droppedInaccurate
        case droppedTooSoon
    }

    @discardableResult
    public mutating func add(lat: Double, lng: Double, at: Date, accuracy: Double?, speed: Double?, heading: Double?) -> Decision {
        guard BusMath.LatLng(lat: lat, lng: lng).isValid else { return .droppedInvalid }
        guard let accuracy, accuracy >= 0, accuracy <= maxAccuracyMeters else { return .droppedInaccurate }
        if let last = lastAcceptedAt, at.timeIntervalSince(last) < minInterval { return .droppedTooSoon }
        lastAcceptedAt = at
        pending.append(OutgoingFixRecord(at: at, fix: OutgoingFix(lat: lat, lng: lng, timestamp: at, accuracy: accuracy, speed: speed, heading: heading)))
        if pending.count > capacity { pending.removeFirst(pending.count - capacity) }
        return .queued
    }

    /// The next batch to upload (fresh fixes only, oldest first). Expired fixes are discarded.
    public mutating func nextBatch(now: Date) -> [OutgoingFix] {
        pending.removeAll { now.timeIntervalSince($0.at) > maxAge }
        return pending.prefix(maxBatch).map(\.fix)
    }

    /// Remove a batch after the server answered (accepted or rejected — either way it is done).
    public mutating func confirm(count: Int) {
        pending.removeFirst(min(count, pending.count))
    }

    public mutating func reset() {
        pending.removeAll()
        lastAcceptedAt = nil
    }
}
