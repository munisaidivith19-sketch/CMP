package com.vexon.campus

import com.vexon.campus.push.NotificationGate
import com.vexon.campus.push.NotificationGate.Status
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Notifications are mandatory: who gets in, who sees the dialog, who is sent to Settings. */
class NotificationGateTest {
    private fun decide(sdk: Int, enabled: Boolean, granted: Boolean, asked: Boolean = false, rationale: Boolean = false) =
        NotificationGate.decide(sdk, enabled, granted, asked, rationale)

    @Test
    fun alreadyGrantedOpensTheApp() {
        assertEquals(Status.Granted, decide(sdk = 34, enabled = true, granted = true, asked = true))
        assertEquals(Status.Granted, decide(sdk = 33, enabled = true, granted = true))
        // Before Android 13 there is no runtime permission: the app switch alone decides.
        assertEquals(Status.Granted, decide(sdk = 29, enabled = true, granted = true))
    }

    @Test
    fun neverAskedShowsTheExplanationThenTheDialog() {
        assertEquals(Status.CanRequest, decide(sdk = 34, enabled = false, granted = false, asked = false))
    }

    @Test
    fun firstDenialCanStillAskAgain() {
        // Android 13+ sets the rationale flag after one "Don't allow".
        assertEquals(Status.CanRequest, decide(sdk = 34, enabled = false, granted = false, asked = true, rationale = true))
    }

    @Test
    fun permanentDenialOnlyOffersSettings() {
        assertEquals(Status.SettingsOnly, decide(sdk = 34, enabled = false, granted = false, asked = true, rationale = false))
    }

    @Test
    fun switchedOffInSettingsIsBlockedEvenWithThePermission() {
        // Revoked later / app notifications turned off while the runtime permission stays granted.
        assertEquals(Status.SettingsOnly, decide(sdk = 34, enabled = false, granted = true, asked = true))
        // A stored "asked" flag never counts as permission.
        assertEquals(Status.SettingsOnly, decide(sdk = 34, enabled = false, granted = true, asked = false))
    }

    @Test
    fun beforeAndroid13OnlySettingsCanTurnThemBackOn() {
        assertEquals(Status.SettingsOnly, decide(sdk = 26, enabled = false, granted = true))
        assertEquals(Status.SettingsOnly, decide(sdk = 32, enabled = false, granted = true, asked = true, rationale = true))
    }

    @Test
    fun enabledSwitchWithoutRuntimePermissionIsNotEnoughOnAndroid13() {
        assertEquals(Status.CanRequest, decide(sdk = 33, enabled = true, granted = false))
    }

    @Test
    fun theSystemDialogIsOnlyOfferedWhereItExists() {
        assertTrue(NotificationGate.canPrompt(sdk = 33, runtimeGranted = false))
        assertFalse(NotificationGate.canPrompt(sdk = 33, runtimeGranted = true))
        assertFalse(NotificationGate.canPrompt(sdk = 32, runtimeGranted = true))
        assertFalse(NotificationGate.canPrompt(sdk = 26, runtimeGranted = false))
    }

    @Test
    fun grantingAfterAReturnFromSettingsLetsTheUserIn() {
        val before = decide(sdk = 34, enabled = false, granted = false, asked = true)
        val after = decide(sdk = 34, enabled = true, granted = true, asked = true)
        assertEquals(Status.SettingsOnly, before)
        assertEquals(Status.Granted, after)
    }
}
