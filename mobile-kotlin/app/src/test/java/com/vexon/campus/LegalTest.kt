package com.vexon.campus

import com.vexon.campus.core.ApiPath
import com.vexon.campus.core.Legal
import com.vexon.campus.core.keyword
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Terms and Conditions / Privacy Policy: profile entries and policy URLs. */
class LegalTest {
    @Test
    fun aboutTheAppHasExactlyTheThreeEntries() {
        assertEquals(listOf("About the App", "Terms and Conditions", "Privacy Policy"), Legal.ABOUT_ENTRIES.map { it.label })
        assertEquals(listOf("/about", "/terms", "/privacy-policy"), Legal.ABOUT_ENTRIES.map { it.path })
        assertTrue("no acceptance-history entry", Legal.ABOUT_ENTRIES.none { it.label.contains("history", ignoreCase = true) })
    }

    @Test
    fun policyUrlsAcceptOnlyKnownKeywords() {
        assertEquals("http://10.0.2.2:5000/api/legal/policies/terms", ApiPath.url("http://10.0.2.2:5000", "/legal/policies/${keyword(Legal.TERMS)}").toString())
        assertEquals("http://10.0.2.2:5000/api/legal/policies/privacy", ApiPath.url("http://10.0.2.2:5000", "/legal/policies/${keyword(Legal.PRIVACY)}").toString())
        assertNull(ApiPath.url("http://10.0.2.2:5000", "/legal/policies/${keyword("../auth/me")}"))
    }

    @Test
    fun effectiveDatesAreCalendarDates() {
        assertEquals("22 October 2026", Legal.formatEffective("2026-10-22T00:00:00.000Z"))
        assertEquals("", Legal.formatEffective(null))
        assertEquals("", Legal.formatEffective("not a date"))
    }
}
