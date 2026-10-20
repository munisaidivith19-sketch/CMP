import Foundation

/// Display rules for server-recorded bus journeys — the same wording as the web
/// app (client/src/pages/transport/journeyFormat.js) and Android (core/Journey.kt).
///
/// The server decides direction, next stop, recorded arrival / departure times
/// and ETAs; the app only shows them. Times are shown on the CAMPUS clock
/// (Asia/Kolkata unless the server says otherwise), whatever zone the phone is
/// set to. Recorded and predicted times are never mixed up.
public enum JourneyFormat {
    public static let campusTimeZone = "Asia/Kolkata"
    public static let directions = ["towards_college", "towards_home"]

    static func zone(_ tz: String?) -> TimeZone {
        tz.flatMap { TimeZone(identifier: $0) } ?? TimeZone(identifier: campusTimeZone)!
    }

    /// "7:42 am" on the campus clock; "" for no time.
    public static func campusTime(_ date: Date?, tz: String? = nil) -> String {
        guard let date else { return "" }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone(tz)
        let c = cal.dateComponents([.hour, .minute], from: date)
        let h = c.hour ?? 0, m = c.minute ?? 0
        let h12 = h % 12 == 0 ? 12 : h % 12
        return "\(h12):\(m < 10 ? "0" : "")\(m) \(h < 12 ? "am" : "pm")"
    }

    public static func directionLabel(_ direction: String?) -> String {
        switch direction {
        case "towards_college": return "Towards college"
        case "towards_home": return "Towards home"
        default: return ""
        }
    }

    public static func directionText(_ direction: String?, assumed: Bool) -> String {
        let label = directionLabel(direction)
        return !label.isEmpty && assumed ? "\(label) (assumed)" : label
    }

    /// The other direction, for "wrong direction? switch".
    public static func opposite(_ direction: String?) -> String {
        direction == "towards_home" ? "towards_college" : "towards_home"
    }

    /// "about 6 min · 7:48 am" (marked "~" when approximate), or the server's reason when unavailable.
    public static func etaLine(_ eta: JourneyETA?, tz: String? = nil) -> String {
        guard let eta else { return "" }
        guard eta.isAvailable else { return eta.reason ?? "ETA unavailable" }
        let m = eta.minutes ?? 0
        let mins = m <= 0 ? "arriving now" : "about \(m) min"
        let p = eta.approximate == true ? "~" : ""
        return "\(p)\(mins) · \(p)\(campusTime(eta.predictedArrivalAt, tz: tz))"
    }

    public static func methodText(_ method: String?) -> String? {
        switch method {
        case "history": return "from earlier recorded trips"
        case "recent_speed": return "from the bus’s recent speed"
        case "assumed_speed": return "assumed average speed — approximate"
        default: return nil
        }
    }

    /// What a stop row says, keeping recorded and predicted times apart.
    public static func stopLine(_ s: JourneyStop, tz: String? = nil) -> String {
        switch s.status {
        case "departed":
            if s.actualDepartureAt != nil {
                return "Arrived \(campusTime(s.actualArrivalAt, tz: tz)) · left \(campusTime(s.actualDepartureAt, tz: tz))"
            }
            return "Arrived \(campusTime(s.actualArrivalAt, tz: tz))"
        case "arrived":
            return "At the stop since \(campusTime(s.actualArrivalAt, tz: tz))"
        case "not_recorded":
            return s.notRecordedReason == "before_tracking" ? "Passed before tracking started" : "Passed — arrival not detected"
        default:
            return s.eta != nil ? "Expected \(etaLine(s.eta, tz: tz))" : "Upcoming"
        }
    }

    /// Stops already behind the bus, as sequences of the route drawn on the map (matched by stop id).
    public static func passedSequences(_ journey: TripJourney?, route: BusRoute?) -> Set<Int>? {
        guard let journey, !journey.stops.isEmpty, let route, !route.stops.isEmpty else { return nil }
        let done = Set(journey.stops.filter { ["departed", "arrived", "not_recorded"].contains($0.status) }.map(\.stopId))
        return Set(route.stops.filter { done.contains($0.id) }.map(\.sequence))
    }

    // MARK: History

    /// "20 Oct 2026" on the campus calendar; "" for no time.
    public static func campusDate(_ date: Date?, tz: String? = nil) -> String {
        guard let date else { return "" }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone(tz)
        let c = cal.dateComponents([.year, .month, .day], from: date)
        let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        let d = c.day ?? 1
        return "\(d < 10 ? "0" : "")\(d) \(months[max(0, min(11, (c.month ?? 1) - 1))]) \(c.year ?? 0)"
    }

    /// Trip status as the history shows it (same labels as web and Android).
    public static func tripStatus(_ status: String?, interrupted: Bool = false) -> String {
        switch status {
        case "active": return "In progress"
        case "completed": return "Completed"
        case "stopped": return interrupted ? "Stopped early" : "Ended"
        case "timeout": return "Ended — no GPS"
        default: return status ?? ""
        }
    }

    /// "42 min" / "1 h 5 min"; "" when unknown.
    public static func durationText(_ minutes: Double?) -> String {
        guard let minutes, minutes.isFinite, minutes >= 0 else { return "" }
        let m = Int(minutes.rounded())
        return m < 60 ? "\(m) min" : "\(m / 60) h\(m % 60 > 0 ? " \(m % 60) min" : "")"
    }

    /// "3 min late" / "2 min early" / "on time" against a real timetable; nil when there is none.
    public static func delayText(_ minutes: Double?, tolerance: Int = 0) -> String? {
        guard let minutes, minutes.isFinite else { return nil }
        let m = Int(minutes.rounded())
        if abs(m) <= tolerance { return "on time" }
        return m > 0 ? "\(m) min late" : "\(-m) min early"
    }

    /// One stop of a past trip: RECORDED times only, or why none was recorded.
    public static func historyStopLine(_ s: HistoryStop, tz: String? = nil) -> String {
        if let a = s.actualArrivalAt {
            if let d = s.actualDepartureAt { return "Arrived \(campusTime(a, tz: tz)) · left \(campusTime(d, tz: tz))" }
            return "Arrived \(campusTime(a, tz: tz))"
        }
        switch s.notRecorded {
        case "pending": return "Not reached yet"
        case "before_tracking": return "Passed before tracking started"
        default: return "Arrival not detected"
        }
    }

    /// Passed stops to mark on the map: from the journey when there is one, else the server's route progress.
    public static func mapPassed(_ d: BusDetail?) -> Set<Int> {
        guard let d else { return [] }
        return passedSequences(d.journey, route: d.mapRoute) ?? Set(d.progress?.passedSequences ?? [])
    }

    /// Travelled/remaining split of the drawn line. `progress` is measured along the
    /// assigned route forwards, so it only applies when the trip runs that route forwards.
    public static func mapFraction(_ d: BusDetail?) -> Double? {
        guard let d else { return nil }
        guard d.journeyRoute == nil, d.journey?.routeMode == nil || d.journey?.routeMode == "forward" else { return nil }
        return d.progress?.fraction
    }
}
