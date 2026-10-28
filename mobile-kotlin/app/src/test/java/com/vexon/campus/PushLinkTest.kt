package com.vexon.campus

import com.vexon.campus.push.Push
import org.junit.Assert.assertEquals
import org.junit.Test

/** Notification taps open only known app screens, on the right channel. */
class PushLinkTest {
    @Test
    fun knownScreensOpenAsIs() {
        assertEquals("/attendance", Push.safeLink("/attendance"))
        assertEquals("/gate-pass/abc123", Push.safeLink("/gate-pass/abc123"))
        assertEquals("/chat/abc", Push.safeLink("/chat/abc"))
        assertEquals("/attendance?tab=staff", Push.safeLink("/attendance?tab=staff"))
        assertEquals("/transport?bus=abc&stop=def", Push.safeLink("/transport?bus=abc&stop=def"))
    }

    @Test
    fun anythingElseFallsBackToTheNotificationList() {
        assertEquals("/notifications", Push.safeLink(null))
        assertEquals("/notifications", Push.safeLink(""))
        assertEquals("/notifications", Push.safeLink("https://evil.example/login"))
        assertEquals("/notifications", Push.safeLink("//evil.example"))
        assertEquals("/notifications", Push.safeLink("/admin/users"))
        assertEquals("/notifications", Push.safeLink("/attendance/../admin"))
        assertEquals("/notifications", Push.safeLink("/attendancex"))
    }

    @Test
    fun categoriesMapToTheirPopUpChannels() {
        assertEquals("alerts", Push.channelFor("sos"))
        assertEquals("alerts", Push.channelFor("gate_pass"))
        assertEquals("classes", Push.channelFor("reminder"))
        assertEquals("classes", Push.channelFor("substitute"))
        assertEquals("messages_popup", Push.channelFor("chat"))
        assertEquals("updates_popup", Push.channelFor("attendance"))
        assertEquals("updates_popup", Push.channelFor(null))
    }
}
