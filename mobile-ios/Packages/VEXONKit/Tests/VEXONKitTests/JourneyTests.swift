import Foundation
import Testing
@testable import VEXONKit

/// Journey payloads and display rules — the same wording and campus-clock times
/// as the web app and Android. All ids, names and coordinates are SYNTHETIC.
@Suite("Bus journeys")
struct JourneyTests {
    func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try VEXONJSON.decoder().decode(T.self, from: Data(json.utf8))
    }

    func date(_ iso: String) -> Date { VEXONJSON.parseDate(iso)! }

    @Test("Bus detail with a journey on a reverse run decodes; the map follows journeyRoute")
    func detailWithJourney() throws {
        let d = try decode(BusDetail.self, """
        {"bus":{"_id":"b1","number":"TEST-01","location":null,"tracking":"live",
                "trip":{"_id":"t1","status":"active","mine":true,"direction":"towards_home","directionAssumed":false}},
         "route":{"_id":"r1","name":"Test Route","stops":[{"_id":"a","name":"A","lat":13.0,"lng":80.2,"sequence":1},{"_id":"b","name":"B","lat":13.01,"lng":80.21,"sequence":2},{"_id":"c","name":"College","lat":13.02,"lng":80.22,"sequence":3,"isCollege":true}]},
         "journeyRoute":{"_id":"r2","name":"Test Return","stops":[{"_id":"c","name":"College","lat":13.02,"lng":80.22,"sequence":1},{"_id":"b","name":"B","lat":13.01,"lng":80.21,"sequence":2},{"_id":"a","name":"A","lat":13.0,"lng":80.2,"sequence":3}]},
         "progress":null,"eta":null,"myStop":null,"travelled":[],"serverTime":"2026-10-20T02:20:00.000Z",
         "journey":{"tripId":"t1","busId":"b1","status":"active","direction":"towards_home","directionAssumed":false,"routeId":"r2","routeMode":"return_route",
           "tripStartedAt":"2026-10-20T02:00:00.000Z","tripCompletedAt":null,"endedAt":null,"endReason":null,"durationMinutes":null,"tracking":"live",
           "currentStop":null,
           "nextStop":{"order":2,"stopId":"a","name":"A","isCollege":false,"status":"upcoming","actualArrivalAt":null,"actualDepartureAt":null,"arrivalSource":null,"departureSource":null,"predictedArrivalAt":"2026-10-20T02:26:00.000Z",
                       "eta":{"status":"ok","minutes":6,"predictedArrivalAt":"2026-10-20T02:26:00.000Z","method":"recent_speed","confidence":"medium","approximate":false}},
           "followingStop":null,"nextStopUncertain":false,"uncertainReason":null,
           "college":{"order":0,"name":"College","actualArrivalAt":null,"predictedArrivalAt":null,"eta":null},
           "stops":[
             {"order":0,"stopId":"c","name":"College","isCollege":true,"status":"departed","actualArrivalAt":"2026-10-20T02:01:00.000Z","actualDepartureAt":"2026-10-20T02:03:00.000Z","arrivalSource":"gps","departureSource":"manual","eta":null},
             {"order":1,"stopId":"b","name":"B","isCollege":false,"status":"not_recorded","notRecordedReason":"not_detected","actualArrivalAt":null,"actualDepartureAt":null,"eta":null},
             {"order":2,"stopId":"a","name":"A","isCollege":false,"status":"upcoming","actualArrivalAt":null,"actualDepartureAt":null,"eta":{"status":"ok","minutes":6,"predictedArrivalAt":"2026-10-20T02:26:00.000Z","method":"recent_speed","confidence":"medium","approximate":false}}
           ],"computedAt":"2026-10-20T02:20:00.000Z"}}
        """)
        let j = try #require(d.journey)
        #expect(d.bus.trip?.direction == "towards_home")
        #expect(d.mapRoute?.id == "r2")
        #expect(j.nextStop?.name == "A")
        #expect(j.stops[0].isManual)
        #expect(j.canChangeDirection == false, "a stop is already recorded")
        #expect(JourneyFormat.passedSequences(j, route: d.mapRoute) == [1, 2])
        #expect(JourneyFormat.mapPassed(d) == [1, 2])
        #expect(JourneyFormat.mapFraction(d) == nil, "base-route progress does not apply to a return route")
        #expect(JourneyFormat.etaLine(j.nextStop?.eta) == "about 6 min · 7:56 am")
    }

    @Test("Older servers: no journey, config without timezone, trip without direction")
    func olderServers() throws {
        let c = try decode(TransportConfig.self, #"{"mapStyleUrl":"","mapAttribution":"","studentVisibility":"all","liveSeconds":60,"staleSeconds":300,"canManage":false,"canShare":true}"#)
        #expect(c.timezone == nil)
        #expect(JourneyFormat.campusTime(date("2026-10-20T02:12:00.000Z"), tz: c.timezone) == "7:42 am")
        let t = try decode(BusTrip.self, #"{"_id":"t1","status":"active"}"#)
        #expect(t.direction == nil)
        #expect(JourneyFormat.passedSequences(nil, route: nil) == nil)
    }

    @Test("Times show on the campus clock whatever the phone zone")
    func campusClock() {
        #expect(JourneyFormat.campusTime(date("2026-10-20T02:12:00.000Z")) == "7:42 am")
        #expect(JourneyFormat.campusTime(date("2026-10-20T02:12:00.000Z"), tz: "UTC") == "2:12 am")
        #expect(JourneyFormat.campusTime(date("2026-10-20T07:30:00.000Z")) == "1:00 pm")
        #expect(JourneyFormat.campusTime(nil) == "")
        #expect(JourneyFormat.campusTime(date("2026-10-20T02:12:00.000Z"), tz: "Not/AZone") == "7:42 am", "an unknown zone falls back to campus time")
        // Day boundary: 18:45 UTC is already 00:15 the next day on campus.
        #expect(JourneyFormat.campusTime(date("2026-10-19T18:45:00.000Z")) == "12:15 am")
    }

    @Test("Direction says when it was assumed")
    func direction() {
        #expect(JourneyFormat.directionText("towards_home", assumed: false) == "Towards home")
        #expect(JourneyFormat.directionText("towards_college", assumed: true) == "Towards college (assumed)")
        #expect(JourneyFormat.directionText(nil, assumed: true) == "")
        #expect(JourneyFormat.opposite("towards_home") == "towards_college")
        #expect(JourneyFormat.opposite("towards_college") == "towards_home")
    }

    @Test("ETAs: approximate ones are marked; unavailable ones show the reason, never a time")
    func eta() {
        let at = date("2026-10-20T02:18:00.000Z")
        #expect(JourneyFormat.etaLine(JourneyETA(status: "ok", minutes: 6, predictedArrivalAt: at, approximate: false)) == "about 6 min · 7:48 am")
        #expect(JourneyFormat.etaLine(JourneyETA(status: "ok", minutes: 6, predictedArrivalAt: at, approximate: true)) == "~about 6 min · ~7:48 am")
        #expect(JourneyFormat.etaLine(JourneyETA(status: "ok", minutes: 0, predictedArrivalAt: at)) == "arriving now · 7:48 am")
        #expect(JourneyFormat.etaLine(JourneyETA(status: "unavailable", reason: "Tracking is offline")) == "Tracking is offline")
        #expect(JourneyFormat.etaLine(nil) == "")
    }

    @Test("Stop rows keep recorded times and predictions apart")
    func stopRows() {
        let arr = date("2026-10-20T02:12:00Z"), dep = date("2026-10-20T02:13:00Z")
        func s(_ status: String, _ a: Date? = nil, _ d: Date? = nil, reason: String? = nil, eta: JourneyETA? = nil) -> JourneyStop {
            JourneyStop(order: 0, stopId: "s1", name: "Synthetic Stop", status: status, notRecordedReason: reason, actualArrivalAt: a, actualDepartureAt: d, eta: eta)
        }
        #expect(JourneyFormat.stopLine(s("departed", arr, dep)) == "Arrived 7:42 am · left 7:43 am")
        #expect(JourneyFormat.stopLine(s("arrived", arr)) == "At the stop since 7:42 am")
        #expect(JourneyFormat.stopLine(s("not_recorded", reason: "not_detected")) == "Passed — arrival not detected")
        #expect(JourneyFormat.stopLine(s("not_recorded", reason: "before_tracking")) == "Passed before tracking started")
        #expect(JourneyFormat.stopLine(s("upcoming", eta: JourneyETA(status: "ok", minutes: 4, predictedArrivalAt: dep))).hasPrefix("Expected about 4 min"))
        #expect(JourneyFormat.stopLine(s("upcoming")) == "Upcoming")
    }

    @Test("History list and trip detail decode; only recorded times are shown")
    func history() throws {
        let list = try decode(HistoryTripList.self, """
        {"trips":[{"_id":"t1","bus":{"_id":"b1","number":"TEST-01"},"route":{"_id":"r1","name":"Test Route"},"direction":"towards_college","directionAssumed":false,
                   "status":"stopped","interrupted":true,"source":"phone","campusDate":"2026-10-20","tripStartedAt":"2026-10-19T18:45:00.000Z","tripCompletedAt":null,
                   "endedAt":"2026-10-19T19:50:00.000Z","endReason":"stopped","finalArrivalAt":null,"collegeArrivedAt":null,"durationMinutes":65,
                   "stopsPlanned":4,"stopsRecorded":2,"manualRecords":1,"hasJourney":true,"operator":{"name":"You","self":true}}],
         "total":21,"page":1,"limit":20,"timezone":"Asia/Kolkata","scope":"own"}
        """)
        let t = try #require(list.trips.first)
        #expect(list.hasMore)
        #expect(t.operator?.isSelf == true)
        #expect(JourneyFormat.campusDate(t.tripStartedAt, tz: list.timezone) == "20 Oct 2026", "00:15 on campus is already the 20th")
        #expect(JourneyFormat.tripStatus(t.status, interrupted: t.interrupted == true) == "Stopped early")
        #expect(JourneyFormat.durationText(t.durationMinutes) == "1 h 5 min")

        let d = try decode(HistoryTripDetail.self, """
        {"trip":{"_id":"t1","bus":{"_id":"b1","number":"TEST-01"},"route":null,"direction":"towards_home","status":"completed","journeyMinutes":42,"routeMode":"reverse","operator":null},
         "stops":[
           {"order":0,"name":"College","isCollege":true,"scheduledAt":null,"actualArrivalAt":"2026-10-20T02:12:00.000Z","actualDepartureAt":"2026-10-20T02:13:00.000Z",
            "arrivalSource":"manual","departureSource":"gps","notRecorded":null,"minutesFromPreviousStop":null,"dwellMinutes":1,"predictedArrivalAt":null,
            "predictionErrorMinutes":null,"delayMinutes":3.4,"arrival":{"_id":"e1","type":"arrival","source":"manual","reason":"GPS dropped","corrected":true},"departure":null},
           {"order":1,"name":"Stop B","isCollege":false,"actualArrivalAt":null,"actualDepartureAt":null,"notRecorded":"not_detected","arrival":null,"departure":null}
         ],"events":[],"timezone":"Asia/Kolkata"}
        """)
        #expect(d.trip.journeyMinutes == 42)
        #expect(d.stops[0].isManual && d.stops[0].isCorrected)
        #expect(JourneyFormat.historyStopLine(d.stops[0], tz: d.timezone) == "Arrived 7:42 am · left 7:43 am")
        #expect(JourneyFormat.historyStopLine(d.stops[1]) == "Arrival not detected")
        #expect(JourneyFormat.delayText(d.stops[0].delayMinutes) == "3 min late")
        #expect(JourneyFormat.delayText(-2) == "2 min early")
        #expect(JourneyFormat.delayText(1, tolerance: 5) == "on time")
        #expect(JourneyFormat.delayText(nil) == nil)
        #expect(JourneyFormat.durationText(120) == "2 h")
        #expect(JourneyFormat.durationText(nil) == "")
    }

    @Test("History request carries only the chosen filters")
    func historyQuery() {
        let e = API.transportHistory(range: "week", direction: nil, status: "interrupted", page: 2)
        #expect(e.path == "/transport/history/trips")
        #expect(e.query.map(\.name) == ["limit", "page", "range", "status"])
    }

    @Test("Starting a trip sends the direction; omitting it sends none")
    func startTripBody() throws {
        let withDir = try #require(API.startTrip(busId: "b1", direction: "towards_home").body)
        let json = try #require(String(data: try JSONEncoder().encode(withDir), encoding: .utf8))
        #expect(json.contains("\"direction\":\"towards_home\""))
        let without = try #require(API.startTrip(busId: "b1").body)
        let json2 = try #require(String(data: try JSONEncoder().encode(without), encoding: .utf8))
        #expect(!json2.contains("direction"))
    }
}
