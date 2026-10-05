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
import com.vexon.campus.push.Push
import com.vexon.campus.ui.VexonTheme
import kotlinx.coroutines.CompletableDeferred

class MainActivity : ComponentActivity() {
    private var permissionResult: CompletableDeferred<Boolean>? = null
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        permissionResult?.complete(granted)
        permissionResult = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Keep the splash until the saved session has been checked (or found offline).
        installSplashScreen().setKeepOnScreenCondition { !Auth.state.value.ready && !AppState.launchOffline.value }
        super.onCreate(savedInstanceState)
        // The app is always drawn with the light theme, so keep dark system-bar icons
        // even when the phone is in dark mode (otherwise they turn white on white).
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
        )

        Push.permissionRequester = {
            CompletableDeferred<Boolean>().also {
                permissionResult = it
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }.await()
        }
        handleLink(intent)
        setContent { VexonTheme { AppRoot() } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    /** Notification taps (extra) and vexon:// deep links open the matching screen. */
    private fun handleLink(intent: Intent?) {
        val link = intent?.getStringExtra(Push.EXTRA_LINK)
            ?: intent?.data?.takeIf { it.scheme == "vexon" }?.let { uri ->
                "/" + listOfNotNull(uri.host, uri.path?.trim('/')).filter { it.isNotEmpty() }.joinToString("/") +
                    (uri.query?.let { "?$it" } ?: "")
            }
        if (link != null && link.startsWith("/")) AppState.pendingLink.value = link
    }

    override fun onDestroy() {
        Push.permissionRequester = null
        super.onDestroy()
    }
}
