package com.vexon.campus

import com.vexon.campus.core.Journey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Journey display rules — the same wording and campus-clock times as the web app. Synthetic data only. */
class JourneyTest {
    private fun stop(status: String, arr: String? = null, dep: String? = null, reason: String? = null, eta: Journey.Eta? = null) =
        Journey.Stop(0, "s1", "Synthetic Stop", status, arr, dep, reason, eta)

    @Test fun timesShowOnTheCampusClockWhateverThePhoneZone() {
        assertEquals("7:42 am", Journey.campusTime("2026-10-20T02:12:00.000Z"))
        assertEquals("2:12 am", Journey.campusTime("2026-10-20T02:12:00.000Z", "UTC"))
        assertEquals("", Journey.campusTime(null))
        assertEquals("", Journey.campusTime("not a time"))
        assertEquals("an unknown zone falls back to campus time", "7:42 am", Journey.campusTime("2026-10-20T02:12:00.000Z", "Not/AZone"))
    }

    @Test fun dayBoundary1845UtcIsAfterMidnightOnCampus() {
        assertEquals("12:15 am", Journey.campusTime("2026-10-19T18:45:00.000Z"))
    }

    @Test fun directionSaysWhenItWasAssumed() {
        assertEquals("Towards home", Journey.directionText("towards_home", false))
        assertEquals("Towards college (assumed)", Journey.directionText("towards_college", true))
        assertEquals("", Journey.directionText(null, true))
    }

    @Test fun etaMarksApproximateAndShowsReasonWhenUnavailable() {
        val at = "2026-10-20T02:18:00.000Z"
        assertEquals("about 6 min · 7:48 am", Journey.etaLine(Journey.Eta(true, 6, at, false, "recent_speed", "medium", null)))
        assertEquals("~about 6 min · ~7:48 am", Journey.etaLine(Journey.Eta(true, 6, at, true, "assumed_speed", "low", null)))
        assertEquals("arriving now · 7:48 am", Journey.etaLine(Journey.Eta(true, 0, at, false, null, null, null)))
        assertEquals("Tracking is offline", Journey.etaLine(Journey.Eta(false, null, null, false, null, null, "Tracking is offline")))
    }

    @Test fun stopRowsKeepRecordedAndPredictedApart() {
        assertEquals("Arrived 7:42 am · left 7:43 am", Journey.stopLine(stop("departed", "2026-10-20T02:12:00Z", "2026-10-20T02:13:00Z")))
        assertEquals("At the stop since 7:42 am", Journey.stopLine(stop("arrived", "2026-10-20T02:12:00Z")))
        assertEquals("Passed — arrival not detected", Journey.stopLine(stop("not_recorded", reason = "not_detected")))
        assertEquals("Passed before tracking started", Journey.stopLine(stop("not_recorded", reason = "before_tracking")))
        assertTrue(Journey.stopLine(stop("upcoming", eta = Journey.Eta(true, 4, "2026-10-20T02:13:00Z", false, null, null, null))).startsWith("Expected about 4 min"))
        assertEquals("Upcoming", Journey.stopLine(stop("upcoming")))
    }

    @Test fun historyShowsRecordedTimesOnTheCampusCalendar() {
        assertEquals("20 Oct 2026", Journey.campusDate("2026-10-19T18:45:00.000Z"))
        assertEquals("19 Oct 2026", Journey.campusDate("2026-10-19T18:15:00.000Z"))
        assertEquals("Arrived 7:42 am · left 7:43 am", Journey.historyStopLine("2026-10-20T02:12:00Z", "2026-10-20T02:13:00Z", null))
        assertEquals("Arrived 7:42 am", Journey.historyStopLine("2026-10-20T02:12:00Z", null, null))
        assertEquals("Arrival not detected", Journey.historyStopLine(null, null, "not_detected"))
        assertEquals("Not reached yet", Journey.historyStopLine(null, null, "pending"))
        assertEquals("Passed before tracking started", Journey.historyStopLine(null, null, "before_tracking"))
    }

    @Test fun historyStatusDurationAndDelay() {
        assertEquals("Stopped early", Journey.tripStatus("stopped", interrupted = true))
        assertEquals("Ended — no GPS", Journey.tripStatus("timeout"))
        assertEquals("42 min", Journey.durationText(42.4))
        assertEquals("1 h 5 min", Journey.durationText(65.0))
        assertEquals("2 h", Journey.durationText(120.0))
        assertEquals("", Journey.durationText(null))
        assertEquals("3 min late", Journey.delayText(3.4))
        assertEquals("2 min early", Journey.delayText(-2.0))
        assertEquals("on time", Journey.delayText(1.0, 5))
        assertEquals(null, Journey.delayText(null))
    }

    @Test fun passedStopsMatchTheDrawnRouteById() {
        val stops = listOf(
            Journey.Stop(0, "a", "A", "departed", null, null, null, null),
            Journey.Stop(1, "b", "B", "not_recorded", null, null, null, null),
            Journey.Stop(2, "c", "C", "upcoming", null, null, null, null),
        )
        // A reverse run: the route's own sequence numbers are the other way round.
        assertEquals(setOf(2, 3), Journey.passedSequences(stops, listOf("c" to 1, "b" to 2, "a" to 3)))
    }
}
