package com.vexon.campus

import com.vexon.campus.push.Push
import com.vexon.campus.screens.safeHttps
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Skill Wallet: notification links route into the app; only safe https links are opened. */
class SkillWalletTest {
    @Test
    fun skillWalletNotificationLinksOpenInTheApp() {
        assertEquals("/skill-wallet?tab=invitations", Push.safeLink("/skill-wallet?tab=invitations"))
        assertEquals("/skill-wallet/projects/abc123", Push.safeLink("/skill-wallet/projects/abc123"))
        assertEquals("/notifications", Push.safeLink("/skill-walletx"))
        assertEquals("/notifications", Push.safeLink("/skill-wallet/../admin"))
    }

    @Test
    fun onlyHttpsLinksWithAHostAreOpened() {
        assertEquals("https://github.com/vexon/repo", safeHttps("https://github.com/vexon/repo"))
        assertEquals("https://drive.google.com/drive/folders/x", safeHttps(" https://drive.google.com/drive/folders/x "))
        assertNull(safeHttps("http://github.com/a/b"))
        assertNull(safeHttps("javascript:alert(1)"))
        assertNull(safeHttps("data:text/html,x"))
        assertNull(safeHttps("https://user:pw@github.com/a/b"))
        assertNull(safeHttps("not a url"))
        assertNull(safeHttps(null))
    }
}
