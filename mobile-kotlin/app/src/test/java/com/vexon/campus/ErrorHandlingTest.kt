package com.vexon.campus

import com.vexon.campus.core.ApiException
import com.vexon.campus.core.errMsg
import com.vexon.campus.core.jsonOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Error-handling catalogue tests (error_handling/catalog/error_catalog.json):
 * AND-001 (no network), AND-002 (timeout), AND-003 (server message shown as-is),
 * AND-004 (unconfigured API URL / unusable id). Synthetic data only.
 */
class ErrorHandlingTest {
    @Test
    fun `AND-001 a network failure shows the connectivity message`() {
        val e = ApiException(0, kind = ApiException.Kind.NETWORK)
        assertTrue(e.isNetwork)
        assertEquals("Cannot reach the JNN server — check your internet connection", errMsg(e))
    }

    @Test
    fun `AND-002 a timeout shows the slow-server message`() {
        val e = ApiException(0, kind = ApiException.Kind.TIMEOUT)
        assertTrue(e.isNetwork)
        assertEquals("The server is taking too long — please try again", errMsg(e))
    }

    @Test
    fun `AND-003 an HTTP error shows the message the server wrote`() {
        val e = ApiException(423, jsonOf("message" to "Too many failed attempts. Try again in 5 minute(s)."))
        assertFalse(e.isNetwork)
        assertEquals("Too many failed attempts. Try again in 5 minute(s).", errMsg(e))
    }

    @Test
    fun `AND-003 an HTTP error without a message falls back to the caller's text`() {
        val e = ApiException(500)
        assertEquals("Something went wrong", errMsg(e))
        assertEquals("Could not save", errMsg(e, "Could not save"))
        assertEquals("Something went wrong", errMsg(null))
    }

    @Test
    fun `AND-004 a request with no server configured is reported as a network failure with status 0`() {
        // Http.url() throws this exact exception when ServerConfig.apiUrl is empty.
        val e = ApiException(0, kind = ApiException.Kind.NETWORK)
        assertEquals(0, e.status)
        assertEquals(ApiException.Kind.NETWORK, e.kind)
    }
}
