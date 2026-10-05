package com.vexon.campus

import com.vexon.campus.core.Fmt
import com.vexon.campus.core.Omit
import com.vexon.campus.core.bool
import com.vexon.campus.core.describeConversation
import com.vexon.campus.core.get
import com.vexon.campus.core.id
import com.vexon.campus.core.int
import com.vexon.campus.core.jsonOf
import com.vexon.campus.core.list
import com.vexon.campus.core.merge
import com.vexon.campus.core.num
import com.vexon.campus.core.parseJson
import com.vexon.campus.core.sameId
import com.vexon.campus.core.str
import com.vexon.campus.core.text
import com.vexon.campus.nav.Route
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

/** Behaviour the Kotlin port must share with the JavaScript helpers it replaces. */
class PortingTest {
    /* utils/format.js */

    @Test
    fun `to12h matches the JS helper`() {
        assertEquals("9:05 AM", Fmt.to12h("09:05"))
        assertEquals("12:00 PM", Fmt.to12h("12:00"))
        assertEquals("12:30 AM", Fmt.to12h("00:30"))
        assertEquals("1:45 PM", Fmt.to12h("13:45"))
        assertEquals("bad", Fmt.to12h("bad"))
        assertEquals("", Fmt.to12h(null as String?))
    }

    @Test
    fun `titleCase matches the JS helper`() {
        assertEquals("Pending Faculty", Fmt.titleCase("pending_faculty"))
        assertEquals("Lab Manual", Fmt.titleCase("lab-manual"))
        assertEquals("", Fmt.titleCase(null))
    }

    @Test
    fun `class days are calendar dates, never shifted by time zone`() {
        assertEquals("Mon, 06 May", Fmt.classDay("2024-05-06T00:00:00.000Z"))
        assertEquals("Monday, 06 May", Fmt.classDay("2024-05-06", "EEEE, dd MMM"))
        assertEquals("", Fmt.classDay(null as String?))
    }

    @Test
    fun `distance strings match date-fns formatDistanceToNowStrict`() {
        val now = ZonedDateTime.now(ZoneId.systemDefault())
        assertEquals("1 minute", Fmt.distanceStrict(now.minusSeconds(65)))
        assertEquals("3 hours", Fmt.distanceStrict(now.minusHours(3)))
        assertEquals("2 days", Fmt.distanceStrict(now.minusDays(2)))
    }

    @Test
    fun `ISO instants from the server parse`() {
        val d = Fmt.parse("2024-05-06T10:15:00.000Z")!!
        assertEquals(java.time.Instant.parse("2024-05-06T10:15:00Z"), d.toInstant())
        assertNull(Fmt.parse(""))
    }

    @Test
    fun `numbers display like JS template strings`() {
        assertEquals("80", num(80.0))
        assertEquals("82.5", num(82.5))
        assertEquals("66.67", num(66.666666))
        assertEquals("—", num(null as Double?))
    }

    /* JSON access (how the screens read API responses) */

    @Test
    fun `missing keys and JSON null read as null`() {
        val j = parseJson("""{"a":{"b":3},"n":null,"s":"","list":[1,null,2],"t":true}""")
        assertEquals(3, j["a"]["b"].int)
        assertNull(j["n"])
        assertNull(j["missing"]["deeper"].str)
        assertNull(j["s"].text)
        assertEquals(2, j["list"].list.size)
        assertTrue(j["t"].bool)
        assertFalse(j["missing"].bool)
    }

    @Test
    fun `ids work for populated and bare references`() {
        val j = parseJson("""{"student":{"_id":"u1","name":"A"},"createdBy":"u1"}""")
        assertEquals("u1", j["student"].id)
        assertEquals("u1", j["createdBy"].id)
        assertTrue(sameId(j["student"], j["createdBy"]))
        assertFalse(sameId(j["student"], "u2"))
    }

    @Test
    fun `request bodies drop omitted keys like JS undefined`() {
        val body = jsonOf("a" to 1, "b" to Omit, "c" to listOf("x"), "d" to mapOf("e" to true))
        assertEquals("""{"a":1,"c":["x"],"d":{"e":true}}""", body.toString())
        assertEquals("""{"a":1,"b":2}""", parseJson("""{"a":1,"b":1}""").merge(parseJson("""{"b":2}""")).toString())
    }

    @Test
    fun `conversation title is the other participant`() {
        val me = parseJson("""{"_id":"me"}""")
        val conv = parseJson("""{"type":"private","participants":[{"_id":"me","name":"Me"},{"_id":"x","name":"Other"}]}""")
        assertEquals("Other", describeConversation(conv, me).title)
        assertTrue(describeConversation(parseJson("""{"type":"group","name":"CSE-A"}"""), me).group)
    }

    /* Notification links → routes (same paths as the web app) */

    @Test
    fun `notification links parse into routes`() {
        val r = Route("/gate-pass/abc123")
        assertEquals("/gate-pass/abc123", r.path)
        assertEquals(listOf("gate-pass", "abc123"), r.segments)

        val q = Route("/alumni?tab=events&id=e1")
        assertEquals("/alumni", q.path)
        assertEquals("events", q.q("tab"))
        assertEquals("e1", q.q("id"))

        assertEquals("/", Route("/").path)
        assertEquals("/clubs/robotics", Route("/clubs/robotics/").path)
        assertEquals("a b", Route("/search?q=a%20b").q("q"))
        assertNull(Route("/alumni?tab=").q("tab"))
    }
}
