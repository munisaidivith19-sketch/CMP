import Foundation
import Testing
@testable import VEXONKit

/// Decoding of payload shapes copied from the server controllers.
/// All ids, names and coordinates are SYNTHETIC TEST DATA.
@Suite("Decoding backend payloads")
struct DecodingTests {
    func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try VEXONJSON.decoder().decode(T.self, from: Data(json.utf8))
    }

    @Test("Dates with and without fractional seconds, and day keys")
    func dates() {
        #expect(VEXONJSON.parseDate("2026-10-16T08:30:00.000Z") != nil)
        #expect(VEXONJSON.parseDate("2026-10-16T08:30:00Z") != nil)
        #expect(VEXONJSON.parseDate("2026-10-16") != nil)
        #expect(VEXONJSON.parseDate("16/10/2026") == nil)
    }

    @Test("Unknown roles decode as .other instead of failing sign-in")
    func unknownRole() throws {
        let user = try decode(User.self, #"{"_id":"u1","name":"Test","role":"librarian"}"#)
        #expect(user.role == .other("librarian"))
        #expect(try decode(User.self, #"{"_id":"u1","name":"T","role":"club_admin"}"#).role == .clubAdmin)
    }

    @Test("Student attendance summary (studentSummary)")
    func attendanceSummary() throws {
        let s = try decode(AttendanceSummary.self, """
        {"range":{"from":null,"to":null},"threshold":75,
         "overall":{"presentPeriods":30,"odPeriods":1,"totalPeriods":40,"absentPeriods":10,"percentage":75,"canMiss":0,"mustAttend":0},
         "subjects":[{"_id":"s1","subject":{"_id":"s1","name":"Data Structures","code":"CS201","semester":3},
                      "totalPeriods":40,"presentPeriods":30,"odPeriods":1,"absentPeriods":10,"percentage":75,
                      "lastMarked":"2026-10-15T00:00:00.000Z"}],
         "belowThreshold":[]}
        """)
        #expect(s.overall.percentage == 75)
        #expect(s.subjects.first?.subject.display == "CS201 · Data Structures")
    }

    @Test("Timetable slots with populated and bare references")
    func timetable() throws {
        let t = try decode(TimetableResponse.self, """
        {"slots":[
          {"_id":"a","dayOfWeek":"monday","period":2,"startTime":"10:00","endTime":"10:50","subject":{"_id":"s1","name":"Maths","code":"MA101"},"faculty":{"_id":"f1","name":"Test Faculty"},"section":"A","department":"CSE"},
          {"_id":"b","dayOfWeek":"monday","period":1,"startTime":"09:00","endTime":"09:50","subject":"s2","faculty":"f2","section":"A","department":"CSE"},
          {"_id":"c","dayOfWeek":"tuesday","period":3,"startTime":"11:00","endTime":"11:15","isBreak":true,"breakLabel":"Tea Break","section":"A","department":"CSE"}
        ],"needsSection":false}
        """)
        #expect(t.byDay[.monday]?.map(\.id) == ["b", "a"])
        #expect(t.byDay[.tuesday]?.first?.title == "Tea Break")
        #expect(t.slots[1].subject?.id == "s2")
    }

    @Test("Bus list: route populated or bare id, location may be null")
    func busList() throws {
        let list = try decode(BusList.self, """
        {"buses":[
          {"_id":"b1","number":"TEST-01","isActive":true,"gpsSource":"phone","route":{"_id":"r1","name":"Test Route North","code":"TRN"},
           "location":{"lat":12.9,"lng":77.5,"at":"2026-10-16T08:00:00.000Z","accuracy":8,"speed":7.5,"heading":90,"source":"phone"},
           "tracking":"live","trip":{"_id":"t1","bus":"b1","route":"r1","source":"phone","status":"active","startedAt":"2026-10-16T07:30:00.000Z","endedAt":null,"endReason":null,"lastLocationAt":null,"mine":false}},
          {"_id":"b2","number":"TEST-02","route":"r2","location":null,"tracking":"offline","trip":null}
        ],"serverTime":"2026-10-16T08:00:05.000Z"}
        """)
        #expect(list.buses.count == 2)
        #expect(list.buses[0].routeName == "Test Route North")
        #expect(list.buses[0].trip?.isActive == true)
        #expect(list.buses[1].route?.id == "r2")
        #expect(list.buses[1].routeName == nil)
        #expect(list.buses[1].location == nil)
        #expect(list.buses[1].tracking == .offline)
    }

    @Test("Bus detail with an unavailable ETA keeps the server's reason")
    func busDetailUnavailableEta() throws {
        let d = try decode(BusDetail.self, """
        {"bus":{"_id":"b1","number":"TEST-01","route":{"_id":"r1","name":"Test Route"},"location":null,"tracking":"offline","trip":null},
         "route":{"_id":"r1","name":"Test Route","code":null,
                  "stops":[{"_id":"s2","name":"Stop B","lat":12.91,"lng":77.51,"sequence":2},{"_id":"s1","name":"Stop A","lat":12.90,"lng":77.50,"sequence":1,"scheduledTime":"07:40"}],
                  "geometry":null},
         "progress":null,
         "eta":{"computedAt":"2026-10-16T08:00:00.000Z","status":"unavailable","reason":"No GPS position has been received for this bus"},
         "myStop":null,"travelled":[],"serverTime":"2026-10-16T08:00:00.000Z"}
        """)
        #expect(d.eta?.isAvailable == false)
        #expect(BusMath.etaText(d.eta) == "No GPS position has been received for this bus")
        #expect(d.route?.orderedStops.map(\.name) == ["Stop A", "Stop B"])
        #expect(d.route?.hasRoadGeometry == false)
        #expect(d.route?.path.first == BusMath.LatLng(lat: 12.90, lng: 77.50))
    }

    @Test("Road geometry is [lng, lat] (GeoJSON order)")
    func geometryOrder() throws {
        let r = try decode(BusRoute.self, """
        {"_id":"r1","name":"T","stops":[],"geometry":[[77.5,12.9],[77.6,13.0]]}
        """)
        #expect(r.path == [BusMath.LatLng(lat: 12.9, lng: 77.5), BusMath.LatLng(lat: 13.0, lng: 77.6)])
    }

    @Test("Socket bus:location payload")
    func busLocationEvent() throws {
        let e = try decode(BusLocationEvent.self, """
        {"busId":"b1","lat":12.9,"lng":77.5,"at":"2026-10-16T08:00:00.000Z","accuracy":null,"speed":null,"heading":null,"source":"tracker","tripId":null}
        """)
        #expect(e.fix.heading == nil)
        #expect(e.tripId == nil)
    }

    @Test("Notifications page and chat payloads")
    func notificationsAndChat() throws {
        let n = try decode(NotificationsPage.self, """
        {"items":[{"_id":"n1","type":"system","title":"Bus trip started","message":"TEST-01 is on its way","link":"/bus-tracking","read":false,"category":"transport","createdAt":"2026-10-16T07:30:00.000Z"}],
         "unread":1,"total":21,"page":1,"limit":20,"pages":2}
        """)
        #expect(n.hasMore)
        #expect(n.items.first?.read == false)

        let convs = try decode([Conversation].self, """
        [{"_id":"c1","type":"private","participants":[{"_id":"me","name":"Me"},{"_id":"p2","name":"Test Friend","online":true}],
          "lastMessage":{"body":"hi","sender":{"_id":"p2","name":"Test Friend"},"sentAt":"2026-10-16T07:00:00.000Z"},"unreadCount":3}]
        """)
        #expect(convs.first?.title(myId: "me") == "Test Friend")
        #expect(convs.first?.unreadCount == 3)

        let page = try decode(MessagesPage.self, """
        {"messages":[{"_id":"m1","conversation":"c1","sender":{"_id":"p2","name":"Test Friend","role":"student"},"body":"hello","createdAt":"2026-10-16T07:00:00.000Z"}],
         "pagination":{"total":1,"page":1,"limit":40,"pages":1}}
        """)
        #expect(page.messages.first?.sender.value?.name == "Test Friend")
    }

    @Test("Validation error body exposes field messages")
    func validationErrors() {
        let error = APIError.from(status: 422, body: Data(#"{"message":"Choose a valid subcategory","errors":[{"field":"subCategory","message":"Choose a valid subcategory"}]}"#.utf8))
        guard case .validation = error else { Issue.record("expected validation"); return }
        #expect(error.fieldErrors["subCategory"] == "Choose a valid subcategory")
        #expect(APIError.from(status: 503, body: Data()).userMessage == "The server had a problem. Please try again shortly.")
        #expect(APIError.from(status: 409, body: Data(#"{"message":"This trip is no longer active","code":"trip_not_active"}"#.utf8)).body?.code == "trip_not_active")
    }
}
