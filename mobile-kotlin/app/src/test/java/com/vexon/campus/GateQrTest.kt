package com.vexon.campus

import com.vexon.campus.core.GateQr
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Port of mobile/tests/gateQr.test.mjs — same cases, same expectations. */
class GateQrTest {
    @Test
    fun `exit and return QR payloads pass on the screen they belong to`() {
        assertNull(GateQr.scanProblem("CCGP:A4G5", "exit"))
        assertNull("case-insensitive prefix", GateQr.scanProblem("ccgp:5ag4", "exit"))
        assertNull(GateQr.scanProblem("CCRT:abcDEF123_-xyzXYZ789abcdef", "return"))
        assertEquals("CCGP:", GateQr.EXIT_PREFIX)
        assertEquals("CCRT:", GateQr.RETURN_PREFIX)
    }

    @Test
    fun `foreign QR codes are rejected as invalid`() {
        for (foreign in listOf("https://example.com/pay", "upi://pay?pa=shop@bank", "A4G5", "", null, "WIFI:S:x;;")) {
            assertEquals(foreign.toString(), "Invalid Gate Pass QR code.", GateQr.scanProblem(foreign, "exit"))
            assertEquals(foreign.toString(), "Invalid Gate Pass QR code.", GateQr.scanProblem(foreign, "return"))
        }
    }

    @Test
    fun `a QR scanned on the wrong screen is named, not sent`() {
        assertTrue(GateQr.scanProblem("CCRT:abcDEF123_-xyzXYZ789abcdef", "exit")!!.contains("return QR"))
        assertTrue(GateQr.scanProblem("CCGP:A4G5", "return")!!.contains("exit QR"))
    }

    @Test
    fun `the scan gate fires once per arming so repeated frames cannot cause duplicate requests`() {
        val sent = mutableListOf<String>()
        val gate = GateQr.ScanGate { sent += it }
        assertFalse(gate.fired)
        assertTrue(gate.handle("CCGP:A4G5"))
        repeat(25) { assertFalse(gate.handle("CCGP:A4G5")) }
        assertFalse("a different code after the first is ignored too", gate.handle("CCGP:ZZ99"))
        assertEquals("exactly one value delivered, unchanged", listOf("CCGP:A4G5"), sent)

        gate.reset()
        assertTrue("scan again works after reset", gate.handle("CCRT:tokentokentokentoken"))
        assertEquals(listOf("CCGP:A4G5", "CCRT:tokentokentokentoken"), sent)
    }

    @Test
    fun `empty detections are ignored and do not consume the single scan`() {
        val sent = mutableListOf<String>()
        val gate = GateQr.ScanGate { sent += it }
        assertFalse(gate.handle(""))
        assertFalse(gate.handle(null))
        assertFalse(gate.fired)
        assertTrue(gate.handle("CCGP:G54A"))
        assertEquals(listOf("CCGP:G54A"), sent)
    }

    @Test
    fun `the scanned value is passed through exactly`() {
        val sent = mutableListOf<String>()
        GateQr.ScanGate { sent += it }.handle("CCRT:AbC-dEf_123xYz789QrStUv")
        assertEquals("CCRT:AbC-dEf_123xYz789QrStUv", sent[0])
    }
}
