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
import androidx.compose.runtime.DisposableEffect
import com.vexon.campus.ui.ThemeState
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
        // Light/dark follows the phone's setting unless the user picked one with
        // the top-right switch; load that choice before the first frame.
        ThemeState.init(this)

        Push.permissionRequester = {
            CompletableDeferred<Boolean>().also {
                permissionResult = it
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }.await()
        }
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
