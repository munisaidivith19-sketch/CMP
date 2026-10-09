package com.vexon.campus

import com.vexon.campus.core.Omit
import com.vexon.campus.core.parseJson
import com.vexon.campus.nav.Route
import com.vexon.campus.screens.docBody
import com.vexon.campus.screens.eventDays
import com.vexon.campus.screens.statusOnDay
import com.vexon.campus.screens.isClassInCharge
import com.vexon.campus.screens.odLeaveCutoff
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime

class ParityTest {
    private fun at(hour: Int) = LocalDateTime.of(2026, 10, 9, hour, 0)

    @Test
    fun `OD leave cut-off mirrors the server rule`() {
        assertTrue("today is never allowed", odLeaveCutoff(LocalDate.of(2026, 10, 9), at(9))!!.danger)
        assertTrue("the past is never allowed", odLeaveCutoff(LocalDate.of(2026, 10, 8), at(9))!!.danger)
        assertFalse("tomorrow before 5 PM is allowed, with a reminder", odLeaveCutoff(LocalDate.of(2026, 10, 10), at(16))!!.danger)
        assertTrue("tomorrow after 5 PM is too late", odLeaveCutoff(LocalDate.of(2026, 10, 10), at(17))!!.danger)
        assertNull("two days ahead is always fine", odLeaveCutoff(LocalDate.of(2026, 10, 11), at(23)))
    }

    @Test
    fun `class in-charge needs section, year and semester on the account`() {
        assertTrue(isClassInCharge(parseJson("""{"role":"faculty","section":"A","inChargeYear":3,"inChargeSemester":5}""")))
        assertFalse(isClassInCharge(parseJson("""{"role":"faculty","section":"A"}""")))
        assertFalse(isClassInCharge(parseJson("""{"role":"hod","section":"A","inChargeYear":3,"inChargeSemester":5}""")))
    }

    @Test
    fun `only the stored attachment fields are sent`() {
        assertSame(Omit, docBody(null))
        val body = docBody(parseJson("""{"url":"/uploads/a.pdf","name":"a.pdf","mimeType":"application/pdf","size":10,"extra":"x"}""")) as Map<*, *>
        assertEquals(setOf("url", "name", "mimeType"), body.keys)
    }

    @Test
    fun `the OD leave notification link is understood`() {
        val r = Route("/attendance?tab=od-leave")
        assertEquals("/attendance", r.path)
        assertEquals("od-leave", r.q("tab"))
    }

    @Test
    fun `event days and per-day participant status`() {
        assertEquals(listOf("2026-10-10", "2026-10-11", "2026-10-12"), eventDays("2026-10-10T06:00:00Z", "2026-10-12T06:00:00Z").map { it.toString() })
        assertEquals(30, eventDays("2026-01-01T06:00:00Z", "2026-06-01T06:00:00Z").size)
        assertTrue(eventDays(null, null).isEmpty())
        val reg = parseJson("""{"status":"attended","attendanceDays":[{"date":"2026-10-10","attended":true},{"date":"2026-10-11","attended":false}]}""")
        assertEquals("attended", statusOnDay(reg, "2026-10-10"))
        assertEquals("absent", statusOnDay(reg, "2026-10-11"))
        assertEquals("pending", statusOnDay(parseJson("""{"status":"registered"}"""), "2026-10-10"))
        assertEquals("waitlisted", statusOnDay(parseJson("""{"status":"waitlisted"}"""), "2026-10-10"))
    }
}
