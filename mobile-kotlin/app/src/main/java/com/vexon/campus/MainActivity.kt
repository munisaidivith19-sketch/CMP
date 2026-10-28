package com.vexon.campus

import android.Manifest
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.vexon.campus.core.Auth
import com.vexon.campus.push.IntentNonce
import com.vexon.campus.push.NotificationGate
import com.vexon.campus.push.Push
import androidx.compose.runtime.DisposableEffect
import com.vexon.campus.ui.ThemeState
import com.vexon.campus.ui.VexonTheme
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private var permissionResult: CompletableDeferred<Boolean>? = null
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        NotificationGate.refresh(this)
        permissionResult?.complete(granted)
        permissionResult = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Keep the splash until the saved session has been checked (or found offline).
        installSplashScreen().setKeepOnScreenCondition { !Auth.state.value.ready && !AppState.launchOffline.value }
        super.onCreate(savedInstanceState)
        // Light/dark follows the phone's setting unless the user picked one with
        // the top-right switch; load that choice before the first frame.
        ThemeState.init(this)

        Push.permissionRequester = {
            CompletableDeferred<Boolean>().also {
                permissionResult = it
                NotificationGate.markAsked(this)
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }.await()
        }
        // Decide the notification gate before the first frame (re-read on every resume).
        NotificationGate.refresh(this)
        handleLink(intent)
        setContent {
            VexonTheme {
                // System-bar icons must contrast with the app's background in each mode.
                val dark = ThemeState.dark
                DisposableEffect(dark) {
                    val style = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                    enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                    onDispose {}
                }
                AppRoot()
            }
        }
    }

    /** Back from Settings, or notifications revoked while away: re-check the mandatory permission. */
    override fun onResume() {
        super.onResume()
        NotificationGate.refresh(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    /**
     * Notification taps (extras) and vexon:// deep links open the matching screen.
     * MainActivity is exported, so link / notificationId extras are honoured only
     * from the app's own PendingIntents (Push.appIntent, carrying this install's
     * nonce); from anywhere else they are ignored.
     */
    private fun handleLink(intent: Intent?) {
        val (trustedLink, notificationId) = Push.trustedExtras(intent, IntentNonce.get(this))
        val link = trustedLink
            ?: intent?.data?.takeIf { it.scheme == "vexon" }?.let { uri ->
                "/" + listOfNotNull(uri.host, uri.path?.trim('/')).filter { it.isNotEmpty() }.joinToString("/") +
                    (uri.query?.let { "?$it" } ?: "")
            }
        // Only known app screens; each one re-checks access with the server when it loads.
        if (link != null) AppState.pendingLink.value = Push.safeLink(link)
        // Opening a notification from the shade marks it read (a validated id only).
        notificationId?.takeIf { Auth.user != null }?.let { id ->
            com.vexon.campus.core.QueryClient.scope.launch { runCatching { com.vexon.campus.core.Api.markNotificationRead(id) } }
        }
    }

    override fun onDestroy() {
        Push.permissionRequester = null
        super.onDestroy()
    }
}
