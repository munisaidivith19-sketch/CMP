package com.vexon.campus

import com.vexon.campus.core.BusMath
import com.vexon.campus.core.BusMath.LatLng
import com.vexon.campus.core.BusMath.Tracking
import com.vexon.campus.core.BusMath.MyLocation as L
import com.vexon.campus.core.LocationRead as R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Bus-map rules. TEST DATA ONLY: synthetic coordinates near 13.000 N, 80.000 E. */
class BusMathTest {
    @Test
    fun markerMovesSmoothlyAndNeverOvershoots() {
        val a = LatLng(13.0, 80.0)
        val b = LatLng(13.01, 80.02)
        assertEquals(a, BusMath.lerp(a, b, 0.0))
        assertEquals(b, BusMath.lerp(a, b, 1.0))
        assertEquals(b, BusMath.lerp(a, b, 5.0))
        val mid = BusMath.lerp(a, b, 0.5)
        assertEquals(13.005, mid.lat, 1e-9)
        assertEquals(80.01, mid.lng, 1e-9)
        assertEquals(1.0, BusMath.easeOut(1.0), 1e-9)
    }

    @Test
    fun rotationIsShortAndOnlyFromAReliableHeading() {
        assertEquals(20.0, BusMath.shortestTurn(350.0, 10.0), 1e-9)
        assertEquals(-20.0, BusMath.shortestTurn(10.0, 350.0), 1e-9)
        assertEquals(90.0, BusMath.reliableHeading(90.0, 8.0)!!, 1e-9)
        assertNull("parked: heading is noise", BusMath.reliableHeading(90.0, 0.5))
        assertNull(BusMath.reliableHeading(null, 8.0))
    }

    @Test
    fun oldFixesAreNeverShownAsLive() {
        val now = 1_800_000_000_000L
        assertEquals(Tracking.OFFLINE, BusMath.freshness(null, now))
        assertEquals(Tracking.LIVE, BusMath.freshness(now - 30_000, now))
        assertEquals(Tracking.STALE, BusMath.freshness(now - 120_000, now))
        assertEquals(Tracking.OFFLINE, BusMath.freshness(now - 900_000, now))
        assertEquals("2 min ago", BusMath.agoText(now - 125_000, now))
        assertEquals("never", BusMath.agoText(null, now))
    }

    @Test
    fun myLocationAccuracyIsShownHonestly() {
        assertEquals("± 12 m", BusMath.accuracyText(12f))
        assertEquals("± 2.4 km", BusMath.accuracyText(2400f))
        val ring = BusMath.circle(LatLng(13.0, 80.0), 100.0)
        assertEquals(ring.first().lat, ring.last().lat, 1e-9)
        // Every ring point is ~100 m from the centre (TEST DATA: synthetic point).
        val north = ring[0]
        assertEquals(13.0 + 100.0 / 111195.0, north.lat, 1e-5)
    }

    private fun ok(lat: Double, lng: Double, acc: Float, mocked: Boolean = false) =
        com.vexon.campus.core.LocationRead.Ok(com.vexon.campus.core.Fix(lat, lng, acc, 0L, mocked))

    @Test
    fun myLocationStatesAreExplicitAndNeverInventAPosition() {
        assertEquals(L.AVAILABLE, BusMath.myLocationState(ok(13.0001, 80.0002, 12f), true))
        assertEquals("Location found. Accuracy: about 12 m.", BusMath.myLocationMessage(ok(13.0001, 80.0002, 12f), true))
        // Approximate: a coarse reading, or any reading with only approximate permission.
        assertEquals(L.APPROXIMATE, BusMath.myLocationState(ok(13.0, 80.0, 1500f), true))
        assertEquals(L.APPROXIMATE, BusMath.myLocationState(ok(13.0, 80.0, 12f), false))
        assertEquals(BusMath.APPROXIMATE_PERMISSION, BusMath.myLocationMessage(ok(13.0, 80.0, 12f), false))
        // Invalid / mocked readings are never drawn.
        assertEquals(L.INVALID, BusMath.myLocationState(ok(0.0, 0.0, 10f), true))
        assertEquals(L.INVALID, BusMath.myLocationState(ok(95.0, 80.0, 10f), true))
        assertEquals(L.INVALID, BusMath.myLocationState(ok(13.0, 200.0, 10f), true))
        assertEquals(L.INVALID, BusMath.myLocationState(ok(13.0, 80.0, Float.NaN), true))
        assertEquals(L.INVALID, BusMath.myLocationState(ok(13.0, 80.0, 10f, mocked = true), true))
        // Failures: each has its own state and message.
        assertEquals(L.PERMISSION_DENIED, BusMath.myLocationState(R.PermissionDenied, true))
        assertEquals(L.TIMEOUT, BusMath.myLocationState(R.Timeout, true))
        assertEquals(L.TIMEOUT, BusMath.myLocationState(R.Stale, true))
        assertEquals(true, BusMath.myLocationMessage(R.Stale, true).contains("old location reading"))
        assertEquals(L.UNAVAILABLE, BusMath.myLocationState(R.ServicesOff, true))
        assertEquals(true, BusMath.myLocationMessage(R.ServicesOff, true).contains("switched off"))
        assertEquals(L.UNAVAILABLE, BusMath.myLocationState(R.Unavailable, true))
    }

    @Test
    fun staleReadingsNeverBeatAFreshOne() {
        // TEST DATA: an old ±10 m cached fix, then a fresh ±45 m one (monotonic ms).
        val s = com.vexon.campus.core.FixSampler()
        s.offer(com.vexon.campus.core.Fix(13.3, 80.3, 10f, 0L, false), 3_600_000L)
        s.offer(com.vexon.campus.core.Fix(13.0001, 80.0001, 45f, 3_600_000L, false), 3_600_000L)
        val r = s.result(3_600_500L) as com.vexon.campus.core.LocationRead.Ok
        assertEquals(13.0001, r.fix.latitude, 1e-9)
    }

    @Test
    fun rootCauseCityLevelNetworkEstimateIsAnAreaNotYourPosition() {
        // TEST DATA: no GPS fix, only a network estimate at a synthetic hub-city point, ±25 km.
        val net = com.vexon.campus.core.Fix(16.0, 80.5, 25_000f, 1_000L, false, provider = "network")
        val read = R.Ok(net)
        assertEquals(L.APPROXIMATE, BusMath.myLocationState(read, true))
        assertEquals(false, BusMath.showsDot(net.accuracy))
        assertEquals(true, BusMath.myLocationMessage(read, true).contains("hub city"))
        assertEquals("Mobile network / IP estimate", BusMath.sourceOf(net))
        // A real satellite fix is drawn as a dot and named as GPS.
        val gps = com.vexon.campus.core.Fix(13.0001, 80.0001, 6f, 1_000L, false, provider = "gps", hasAltitude = true)
        assertEquals(true, BusMath.showsDot(gps.accuracy))
        assertEquals("Satellite GPS", BusMath.sourceOf(gps))
        assertEquals("Satellite GPS (likely) · provider: fused", BusMath.sourceOf(gps.copy(provider = "fused")))
    }

    @Test
    fun everyRawReadingIsRecordedWithAVerdict() {
        // TEST DATA (monotonic ms): an hour-old cached fix, a 0,0 fix, and a fresh one.
        val now = 3_600_000L
        val old = BusMath.reading(com.vexon.campus.core.Fix(13.5, 80.5, 10f, 0L, false, "fused"), now)
        val zero = BusMath.reading(com.vexon.campus.core.Fix(0.0, 0.0, 10f, now, false, "fused"), now)
        val fresh = BusMath.reading(com.vexon.campus.core.Fix(13.0001, 80.0001, 15f, now - 500, false, "gps"), now)
        assertEquals("stale", old.verdict)
        assertEquals("invalid", zero.verdict)
        assertEquals("fresh", fresh.verdict)
        assertEquals(3_600_000L, old.ageMs)
        assertEquals("13.00010, 80.00010 · ± 15 m · 0 s old\nSatellite GPS · fresh", BusMath.readingText(fresh))
        assertEquals(true, BusMath.readingText(old).endsWith("rejected: old reading"))
    }

    @Test
    fun zoomFramesTheAccuracyArea() {
        val span = { pts: List<LatLng> -> pts.maxOf { it.lat } - pts.minOf { it.lat } }
        val precise = BusMath.accuracyFrame(LatLng(13.0, 80.0), 8f)
        val rough = BusMath.accuracyFrame(LatLng(13.0, 80.0), 3000f)
        assertEquals(2 * 60.0 / 111195.0, span(precise), 1e-5) // a ±8 m fix is framed at ±60 m
        assertEquals(true, span(rough) > 40 * span(precise))
    }

    @Test
    fun labelsAndEtaText() {
        assertEquals("TST-1\nTest Route", BusMath.markerLabel("TST-1", "Test Route"))
        assertEquals("TST-1", BusMath.markerLabel("TST-1", null))
        assertEquals("Tracking is offline", BusMath.etaText(false, null, null, "Tracking is offline"))
        assertEquals("About 4 min", BusMath.etaText(true, 4, "high", null))
        assertEquals("About 4 min (approximate)", BusMath.etaText(true, 4, "low", null))
        assertEquals("Arriving now", BusMath.etaText(true, 0, "high", null))
    }

    @Test
    fun mapOpensOnChennaiAtCityLevel() {
        // Chennai (not swapped lat/lng), city level — not the whole world.
        assertEquals(13.08, BusMath.DEFAULT_CENTER.lat, 0.05)
        assertEquals(80.27, BusMath.DEFAULT_CENTER.lng, 0.05)
        assertTrue(BusMath.DEFAULT_ZOOM in 10.0..12.0)
    }
}
