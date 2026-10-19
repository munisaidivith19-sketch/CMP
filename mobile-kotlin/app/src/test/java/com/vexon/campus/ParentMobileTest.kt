package com.vexon.campus

import com.vexon.campus.core.ParentMobile
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Faculty-edited parent OTP number — same rules as the server's normalizeIndianMobile. */
class ParentMobileTest {
    @Test
    fun `valid Indian mobiles in common formats are accepted`() {
        for (n in listOf("9876543210", "+91 98765 43210", "919876543210", "09876543210", "98765-43210", "6123456789")) {
            assertTrue(n, ParentMobile.isValid(n))
        }
    }

    @Test
    fun `invalid numbers are rejected`() {
        for (n in listOf("", null, "12345", "0000000000", "5123456789", "98765abcde", "+1 415 555 0100", "98765432101")) {
            assertFalse(n.toString(), ParentMobile.isValid(n))
        }
    }

    @Test
    fun `the registered number written differently is not an edit`() {
        assertFalse(ParentMobile.differs("+91 98765 43210", "9876543210"))
        assertTrue(ParentMobile.differs("9123456780", "9876543210"))
    }
}
