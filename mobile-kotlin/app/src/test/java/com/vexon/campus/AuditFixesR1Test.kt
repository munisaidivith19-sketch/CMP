package com.vexon.campus

import com.vexon.campus.core.ApiPath
import com.vexon.campus.core.oid
import com.vexon.campus.core.slug
import com.vexon.campus.push.IntentNonce
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** B11: intent extras need the app's nonce; ids are validated; API URLs are built per segment. */
class AuditFixesR1Test {
    private val base = "https://jnn.example.edu"
    private val id = "64f1a2b3c4d5e6f708192a3b"

    @Test
    fun onlyRealObjectIdsAreAccepted() {
        assertTrue(ApiPath.isObjectId(id))
        assertFalse(ApiPath.isObjectId(null))
        assertFalse(ApiPath.isObjectId(""))
        assertFalse(ApiPath.isObjectId(id.uppercase()))
        assertFalse(ApiPath.isObjectId(id + "0"))
        assertFalse(ApiPath.isObjectId("../../admin/users"))
        assertFalse(ApiPath.isObjectId("$id/../../x"))
        assertFalse(ApiPath.isObjectId("$id?x=1"))
        assertEquals(id, oid(id))
        assertEquals(ApiPath.INVALID, oid("abc"))
        assertEquals("cse-chapter", slug("cse-chapter"))
        assertEquals(ApiPath.INVALID, slug("../x"))
    }

    @Test
    fun urlsAreBuiltSegmentBySegment() {
        assertEquals("$base/api/notifications/$id/read", ApiPath.url(base, "/notifications/${oid(id)}/read").toString())
        // Query parameters are added as parameters, never pasted into the path.
        assertEquals("$base/api/gate-pass?status=approved&ids=a&ids=b", ApiPath.url(base, "/gate-pass", mapOf("status" to "approved", "ids" to listOf("a", "b"), "skip" to null)).toString())
        // A server URL with its own path keeps it.
        assertEquals("https://host.edu/campus/api/auth/me", ApiPath.url("https://host.edu/campus/", "/auth/me").toString())
    }

    @Test
    fun aHostileIdNeverChangesTheRequest() {
        // Rejected ids: no URL at all (Http refuses to send the request).
        assertNull(ApiPath.url(base, "/notifications/${oid("../../admin/users")}/read"))
        assertNull(ApiPath.url(base, "/gate-pass/${oid("$id?role=admin")}"))
        // Even unvalidated, a segment cannot climb, be empty or carry a backslash.
        assertNull(ApiPath.url(base, "/notifications/../admin"))
        assertNull(ApiPath.url(base, "/notifications//read"))
        assertNull(ApiPath.url(base, "/a\\b"))
        assertNull(ApiPath.url(base, "notifications"))
        assertNull(ApiPath.url("javascript:alert(1)", "/auth/me"))
        // "?" and "#" inside a segment are encoded, never a query or fragment.
        val u = ApiPath.url(base, "/search/a?b#c")!!
        assertEquals(listOf("api", "search", "a?b#c"), u.pathSegments)
        assertNull(u.query)
        assertNull(u.fragment)
    }

    @Test
    fun theIntentNonceIsRandomAndCheckedExactly() {
        val a = IntentNonce.generate()
        val b = IntentNonce.generate()
        assertEquals(64, a.length)
        assertTrue(a.matches(Regex("^[0-9a-f]{64}$")))
        assertNotEquals(a, b)
        assertTrue(IntentNonce.matches(a, a))
        assertFalse(IntentNonce.matches(a, null))
        assertFalse(IntentNonce.matches(a, ""))
        assertFalse(IntentNonce.matches(a, b))
        assertFalse(IntentNonce.matches(a, a.dropLast(1)))
        assertFalse(IntentNonce.matches("", ""))
    }
}
