package com.vexon.campus.push

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Notifications are mandatory for a signed-in JNN user: without them the main
 * app is replaced by the "Notifications Required" screen (AppRoot). Sign-in,
 * the offline launch screen and the server setting stay reachable, so nobody
 * is locked out of recovering their account.
 *
 * "Allowed" means the app-level switch is on (areNotificationsEnabled) and,
 * on Android 13+, the POST_NOTIFICATIONS runtime permission is granted.
 * Individual channels can still be tuned in Android settings.
 *
 * The status is re-read on every activity resume (MainActivity), so coming
 * back from Settings, or a revoke while the app was in the background, is
 * picked up without a restart. The system dialog is only ever shown from an
 * explicit tap, never on render.
 */
object NotificationGate {
    enum class Status {
        /** Notifications are on: the app opens normally. */
        Granted,
        /** Android 13+ will still show the system dialog. */
        CanRequest,
        /** No system dialog is available (pre-13, switched off, or denied for good): only Settings helps. */
        SettingsOnly,
    }

    private const val PREFS = "vexon.notificationGate"
    private const val KEY_ASKED = "asked"

    private val _status = MutableStateFlow<Status?>(null)
    /** Null until MainActivity's first check. */
    val status: StateFlow<Status?> = _status

    /**
     * The gate's decision. `askedBefore` is needed because
     * shouldShowRequestPermissionRationale is false both before the first
     * request and after a permanent denial.
     */
    fun decide(sdk: Int, notificationsEnabled: Boolean, runtimeGranted: Boolean, askedBefore: Boolean, showRationale: Boolean): Status = when {
        notificationsEnabled && (sdk < 33 || runtimeGranted) -> Status.Granted
        sdk < 33 -> Status.SettingsOnly // no runtime permission: switched off in Settings
        runtimeGranted -> Status.SettingsOnly // permission granted, app notifications switched off
        !askedBefore || showRationale -> Status.CanRequest
        else -> Status.SettingsOnly
    }

    /** Whether tapping "Enable" should show the system dialog (Android 13+, permission not granted). */
    fun canPrompt(sdk: Int, runtimeGranted: Boolean): Boolean = sdk >= 33 && !runtimeGranted

    fun refresh(activity: Activity) {
        val sdk = Build.VERSION.SDK_INT
        _status.value = decide(
            sdk = sdk,
            notificationsEnabled = NotificationManagerCompat.from(activity).areNotificationsEnabled(),
            runtimeGranted = Push.permissionGranted(activity),
            askedBefore = askedBefore(activity),
            showRationale = sdk >= 33 && activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS),
        )
    }

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun askedBefore(context: Context): Boolean = prefs(context).getBoolean(KEY_ASKED, false)

    fun markAsked(context: Context) = prefs(context).edit { putBoolean(KEY_ASKED, true) }

    /**
     * Opens this app's notification settings (falling back to its app-info
     * page). Returns false when neither could be opened. Opening Settings
     * proves nothing — the status is re-read when the app resumes.
     */
    fun openSettings(context: Context): Boolean {
        val intents = listOf(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
        )
        return intents.any { intent ->
            runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess
        }
    }
}
