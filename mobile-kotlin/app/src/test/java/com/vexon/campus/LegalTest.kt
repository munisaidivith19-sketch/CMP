package com.vexon.campus

import com.vexon.campus.core.ApiException
import com.vexon.campus.core.ApiPath
import com.vexon.campus.core.Legal
import com.vexon.campus.core.bool
import com.vexon.campus.core.get
import com.vexon.campus.core.int
import com.vexon.campus.core.jsonOf
import com.vexon.campus.core.keyword
import com.vexon.campus.core.parseJson
import com.vexon.campus.core.str
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Terms and Conditions / Privacy Policy: profile entries, the acceptance gate and policy URLs. */
class LegalTest {
    @Test
    fun aboutTheAppHasExactlyTheThreeEntries() {
        assertEquals(listOf("About the App", "Terms and Conditions", "Privacy Policy"), Legal.ABOUT_ENTRIES.map { it.label })
        assertEquals(listOf("/about", "/terms", "/privacy-policy"), Legal.ABOUT_ENTRIES.map { it.path })
        assertTrue("no acceptance-history entry", Legal.ABOUT_ENTRIES.none { it.label.contains("history", ignoreCase = true) })
    }

    @Test
    fun termsRequiredFollowsOnlyTheServerFlag() {
        assertTrue(Legal.termsRequired(parseJson("""{"_id":"a","legal":{"termsRequired":true,"termsVersion":1}}""")))
        assertFalse(Legal.termsRequired(parseJson("""{"_id":"a","legal":{"termsRequired":false}}""")))
        assertFalse("unknown → the server decides (a 403 flips it)", Legal.termsRequired(parseJson("""{"_id":"a"}""")))
        assertFalse(Legal.termsRequired(parseJson("""{"_id":"a","legal":{"termsRequired":"true"}}""")))
        assertFalse(Legal.termsRequired(null))
    }

    @Test
    fun theGateResponseIsRecognised() {
        assertTrue(Legal.isTermsRequired(403, jsonOf("code" to "TERMS_ACCEPTANCE_REQUIRED")))
        assertFalse(Legal.isTermsRequired(403, jsonOf("code" to "POLICY_DENIED")))
        assertFalse(Legal.isTermsRequired(401, jsonOf("code" to "TERMS_ACCEPTANCE_REQUIRED")))
        assertTrue(Legal.isVersionChanged(ApiException(409, jsonOf("code" to "POLICY_VERSION_CHANGED"))))
        assertFalse(Legal.isVersionChanged(ApiException(409, jsonOf("code" to "OTHER"))))
    }

    @Test
    fun markingAndClearingTheRequirementKeepsTheRestOfTheUser() {
        val user = parseJson("""{"_id":"u1","name":"Asha","legal":{"termsRequired":false,"termsVersion":1,"privacyVersion":2}}""")
        val marked = Legal.withTermsRequired(user)
        assertTrue(Legal.termsRequired(marked))
        assertEquals("Asha", marked["name"].str)
        assertEquals(2, marked["legal"]["privacyVersion"].int)

        val accepted = Legal.withLegal(marked, jsonOf("termsRequired" to false, "termsVersion" to 1, "termsAcceptedVersion" to 1, "privacyVersion" to 2))
        assertFalse(Legal.termsRequired(accepted))
        assertEquals(1, accepted["legal"]["termsAcceptedVersion"].int)
        assertEquals("u1", accepted["_id"].str)

        // A user without a legal block can still be marked.
        assertTrue(Legal.termsRequired(Legal.withTermsRequired(parseJson("""{"_id":"u2"}"""))))
        assertNull(Legal.withTermsRequired(null))
    }

    @Test
    fun policyUrlsAcceptOnlyKnownKeywords() {
        assertEquals("http://10.0.2.2:5000/api/legal/policies/terms", ApiPath.url("http://10.0.2.2:5000", "/legal/policies/${keyword(Legal.TERMS)}").toString())
        assertEquals("http://10.0.2.2:5000/api/legal/policies/privacy", ApiPath.url("http://10.0.2.2:5000", "/legal/policies/${keyword(Legal.PRIVACY)}").toString())
        assertNull(ApiPath.url("http://10.0.2.2:5000", "/legal/policies/${keyword("../auth/me")}"))
    }

    @Test
    fun acceptanceBodyIsExplicitAndCarriesNoAccount() {
        // Mirrors Api.acceptTerms: the server takes the account from the session only.
        val body = jsonOf("policyId" to Legal.TERMS, "version" to 3, "agreed" to true)
        assertEquals("terms", body["policyId"].str)
        assertEquals(3, body["version"].int)
        assertTrue(body["agreed"].bool)
        assertNull(body["user"])
        assertEquals("I have read and agree to the Terms and Conditions.", Legal.CHECKBOX_LABEL)
    }

    @Test
    fun effectiveDatesAreCalendarDates() {
        assertEquals("22 October 2026", Legal.formatEffective("2026-10-22T00:00:00.000Z"))
        assertEquals("", Legal.formatEffective(null))
        assertEquals("", Legal.formatEffective("not a date"))
    }
}
