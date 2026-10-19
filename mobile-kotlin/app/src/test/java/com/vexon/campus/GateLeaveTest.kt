package com.vexon.campus

import com.vexon.campus.core.GateLeave
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Leave-period text on the Security home "Students in / out / Left today" lists. */
class GateLeaveTest {
    private fun pass(s: String) = Json.parseToJsonElement(s)

    @Test
    fun `a normal pass shows its from and to days`() {
        assertEquals(
            "Mon, 12 Oct → Wed, 14 Oct",
            GateLeave.period(pass("""{"passType":"normal","fromDate":"2026-10-12T00:00:00.000Z","toDate":"2026-10-14T00:00:00.000Z"}""")),
        )
    }

    @Test
    fun `a same-day pass or a day scholar outing is one day`() {
        assertEquals("Mon, 12 Oct", GateLeave.period(pass("""{"fromDate":"2026-10-12T00:00:00.000Z","toDate":"2026-10-12T00:00:00.000Z"}""")))
        assertEquals(
            "Mon, 12 Oct",
            GateLeave.period(pass("""{"dayScholarOuting":true,"fromDate":"2026-10-12T00:00:00.000Z","toDate":"2026-10-13T00:00:00.000Z"}""")),
        )
    }

    @Test
    fun `an emergency pass shows exact leave and return times`() {
        val text = GateLeave.period(pass("""{"passType":"emergency","fromDate":"2026-10-12T00:00:00.000Z","toDate":"2026-10-12T00:00:00.000Z","leaveAt":"2026-10-12T06:30:00.000Z","expectedReturnAt":"2026-10-12T14:00:00.000Z"}""")).orEmpty()
        assertTrue(text, text.contains("12 Oct") && text.contains(" → ") && text.contains(":"))
    }

    @Test
    fun `no pass means no period, and missing dates never crash`() {
        assertNull(GateLeave.period(null))
        assertEquals("—", GateLeave.period(pass("""{"passType":"normal"}""")))
    }
}
