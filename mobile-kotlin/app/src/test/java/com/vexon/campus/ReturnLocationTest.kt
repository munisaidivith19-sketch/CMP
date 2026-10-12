package com.vexon.campus

import com.vexon.campus.core.ApiException
import com.vexon.campus.core.Fix
import com.vexon.campus.core.FixSampler
import com.vexon.campus.core.LocationRead
import com.vexon.campus.core.ReturnLocation
import com.vexon.campus.core.dbl
import com.vexon.campus.core.get
import com.vexon.campus.core.jsonOf
import com.vexon.campus.core.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReturnLocationTest {
    private fun fix(accuracy: Float, at: Long, mocked: Boolean = false) = Fix(13.26, 80.10, accuracy, at, mocked)
    private val maxAge = ReturnLocation.MAX_FIX_AGE_MS

    @Test
    fun `keeps the most precise fresh fix and stops once it is good enough`() {
        val s = FixSampler()
        assertFalse(s.offer(fix(300f, 1_000), 1_000))
        assertFalse(s.offer(fix(60f, 3_000), 3_000))
        assertFalse(s.offer(fix(90f, 4_000), 4_000))
        assertEquals(60f, (s.result(5_000) as LocationRead.Ok).fix.accuracy)
        assertTrue("20 m or better ends the sample early", s.offer(fix(12f, 6_000), 6_000))
        assertEquals(12f, (s.result(6_000) as LocationRead.Ok).fix.accuracy)
    }

    @Test
    fun `cached or old readings are never sent`() {
        val s = FixSampler()
        assertFalse(s.offer(fix(5f, 0), maxAge + 1_000))
        assertEquals(LocationRead.Stale, s.result(maxAge + 1_000))
    }

    @Test
    fun `a fix that aged out while sampling is stale, and a newer one replaces it`() {
        val s = FixSampler()
        s.offer(fix(25f, 0), 0)
        assertEquals(LocationRead.Stale, s.result(maxAge + 1))
        s.offer(fix(45f, maxAge + 1), maxAge + 1)
        assertEquals(45f, (s.result(maxAge + 2) as LocationRead.Ok).fix.accuracy)
    }

    @Test
    fun `nothing at all is a timeout, and a reading without accuracy is ignored`() {
        assertEquals(LocationRead.Timeout, FixSampler().result(30_000))
        val s = FixSampler()
        s.offer(fix(Float.NaN, 1_000), 1_000)
        assertFalse(s.result(1_000) is LocationRead.Ok)
    }

    @Test
    fun `each device problem has its own message, never a blanket turn-on-GPS`() {
        val reads = listOf(LocationRead.ServicesOff, LocationRead.Unavailable, LocationRead.Timeout, LocationRead.Stale, LocationRead.PermissionDenied)
        val messages = reads.map(ReturnLocation::problem) + ReturnLocation.problem(LocationRead.Ok(fix(10f, 0, mocked = true)))
        assertEquals(messages.size, messages.toSet().size)
        messages.forEach { assertFalse(it, Regex("turn on (location )?\\(?gps", RegexOption.IGNORE_CASE).containsMatchIn(it)) }
    }

    private fun rejected(code: String, message: String = "server says $code") =
        ApiException(422, jsonOf("message" to message, "errors" to listOf(jsonOf("code" to code, "message" to message))))

    @Test
    fun `server rejections and network failures are worded from what happened`() {
        val f = fix(87.4f, 0)
        assertEquals(ReturnLocation.NETWORK, ReturnLocation.verifyProblem(ApiException(0, kind = ApiException.Kind.NETWORK), f, true))
        assertEquals(ReturnLocation.NETWORK, ReturnLocation.verifyProblem(ApiException(0, kind = ApiException.Kind.TIMEOUT), f, true))
        assertEquals("server says outside_geofence", ReturnLocation.verifyProblem(rejected("outside_geofence"), f, true))
        assertEquals("server says stale_location", ReturnLocation.verifyProblem(rejected("stale_location"), f, true))
        assertTrue(ReturnLocation.verifyProblem(rejected("low_accuracy"), f, true).contains("±87 m"))
        assertEquals(ReturnLocation.FAILED, ReturnLocation.verifyProblem(ApiException(500, jsonOf("message" to "MongoServerError")), f, true))
    }

    @Test
    fun `approximate permission is told apart from a merely imprecise fix`() {
        val coarse = fix(2_000f, 0)
        assertEquals(ReturnLocation.APPROXIMATE, ReturnLocation.verifyProblem(rejected("low_accuracy"), coarse, true))
        assertEquals(ReturnLocation.APPROXIMATE, ReturnLocation.verifyProblem(rejected("low_accuracy"), fix(80f, 0), false))
        assertTrue(ReturnLocation.needsPrecise(rejected("low_accuracy"), fix(80f, 0), false))
        assertFalse(ReturnLocation.needsPrecise(rejected("low_accuracy"), fix(80f, 0), true))
    }

    @Test
    fun `the body is the raw reading, its time from the monotonic age, and the send time`() {
        // Fix taken 4 s ago on the monotonic clock; the wall clock may be anything.
        val body = ReturnLocation.body(fix(14f, 96_000), nowElapsedMs = 100_000, nowWallMs = 1_700_000_000_000)
        assertEquals(setOf("latitude", "longitude", "accuracy", "timestamp", "sentAt"), body.keys)
        assertEquals(1_700_000_000_000 - 4_000, body["timestamp"].long)
        assertEquals(1_700_000_000_000, body["sentAt"].long)
        assertEquals(14.0, body["accuracy"].dbl!!, 0.001)
    }
}
