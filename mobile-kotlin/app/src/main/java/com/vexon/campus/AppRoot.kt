package com.vexon.campus

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.WifiOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vexon.campus.core.Auth
import com.vexon.campus.core.Connection
import com.vexon.campus.core.Legal
import com.vexon.campus.core.QueryClient
import com.vexon.campus.core.RefreshResult
import com.vexon.campus.core.Realtime
import com.vexon.campus.core.ServerConfig
import com.vexon.campus.core.id
import com.vexon.campus.nav.Nav
import com.vexon.campus.push.NotificationGate
import com.vexon.campus.push.Push
import com.vexon.campus.screens.NotificationsRequiredScreen
import com.vexon.campus.screens.OfflineLaunch
import com.vexon.campus.screens.RouteContent
import com.vexon.campus.screens.TermsAcceptanceScreen
import com.vexon.campus.ui.C
import com.vexon.campus.ui.DialogHost
import com.vexon.campus.ui.InAppBanner
import com.vexon.campus.ui.InAppBannerHost
import com.vexon.campus.ui.Jakarta
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext

/** Launch-wide state shared with MainActivity (splash + links from notifications). */
object AppState {
    val launchOffline = MutableStateFlow(false)
    val pendingLink = MutableStateFlow<String?>(null)

    /**
     * Restore the session from SecureStore once at launch. If the phone is offline
     * (or the server is down) we must not throw the user back to the login screen —
     * their saved session is still valid — so report "offline" and let them retry.
     */
    suspend fun restore() {
        launchOffline.value = false
        withContext(Dispatchers.IO) { ServerConfig.loadOverride() }
        when (Auth.refreshSession()) {
            RefreshResult.Offline -> {
                launchOffline.value = true
                return
            }
            else -> Unit
        }
        Auth.sessionChecked()
    }

    fun skipOffline() {
        launchOffline.value = false
        Auth.sessionChecked()
    }
}

@Composable
fun AppRoot() {
    val auth by Auth.state.collectAsState()
    val offline by AppState.launchOffline.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(Unit) { if (!auth.ready) AppState.restore() }

    if (offline) {
        OfflineLaunch(onRetry = { AppState.restore() }, onSkip = { AppState.skipOffline() })
        DialogHost()
        return
    }
    if (!auth.ready) {
        Box(Modifier.fillMaxSize().background(C.bg))
        return
    }

    val userId = auth.user.id
    // Notifications are mandatory once signed in; sign-in itself is never blocked.
    val notifications by NotificationGate.status.collectAsState()
    val notificationsOn = notifications == NotificationGate.Status.Granted
    // The current Terms and Conditions come first; the server refuses every
    // other API until they are accepted (core/Legal.kt).
    val termsPending = userId != null && Legal.termsRequired(auth.user)
    val blocked = userId != null && (termsPending || !notificationsOn)

    // Signed in ↔ out swaps the whole stack (the RN `(app)` group redirect).
    LaunchedEffect(userId) {
        if (userId != null) {
            Nav.resetSignedIn()
        } else {
            Realtime.disconnect()
            QueryClient.reset() // never show one account's cached data to the next
            Nav.resetSignedOut()
        }
    }

    // One socket per signed-in session.
    LaunchedEffect(userId) {
        if (userId == null) return@LaunchedEffect
        Realtime.connect(onUnauthorized = {
            when (Auth.refreshSession()) {
                is RefreshResult.Ok -> true
                RefreshResult.Expired -> { Auth.sessionExpired(); false }
                RefreshResult.Offline -> false
            }
        })
        Realtime.events.collect { event ->
            Realtime.LIVE_TAGS[event.name]?.let { QueryClient.invalidate(it) }
            InAppBanner.onEvent(event)
            // Coming back online: refetch everything that may have changed meanwhile.
            if (event.name == "connect") QueryClient.invalidate(Realtime.LIVE_TAGS.values.flatten().toSet())
        }
    }

    // Push registration, once notifications are allowed (again after a re-grant).
    LaunchedEffect(userId, notificationsOn) {
        if (userId != null && notificationsOn) Push.register(context.applicationContext)
    }

    // Tapping a push (or a vexon:// link) opens the matching screen once signed in.
    val pending by AppState.pendingLink.collectAsState()
    LaunchedEffect(pending, userId, blocked, Nav.stack.firstOrNull()?.route?.path) {
        val link = pending ?: return@LaunchedEffect
        if (userId != null && !blocked && Nav.stack.firstOrNull()?.route?.path == "/") {
            AppState.pendingLink.value = null
            Nav.push(link)
        }
    }

    BackHandler(enabled = !blocked && (Nav.canGoBack || Nav.tab != "index")) { Nav.back() }

    Box(Modifier.fillMaxSize().background(C.bg)) {
        // Back from the gate leaves the app (system default); the stack in Nav is kept for later.
        when {
            !blocked -> StackHost()
            termsPending -> TermsAcceptanceScreen()
            else -> notifications?.let { NotificationsRequiredScreen(it) }
        }
        ConnectionBanner(signedIn = userId != null)
        if (userId != null && !blocked) InAppBannerHost()
        DialogHost()
    }
}

/** Screens below the top stay composed (like a native stack) but are not laid out on screen. */
private val Hidden = Modifier.layout { measurable, constraints ->
    measurable.measure(constraints)
    layout(0, 0) {}
}

@Composable
private fun StackHost() {
    val settled = remember { mutableStateMapOf<Long, Boolean>() }
    val stack = Nav.stack
    stack.forEachIndexed { i, entry ->
        key(entry.id) {
            val top = i == stack.lastIndex
            val visible = top || (i == stack.lastIndex - 1 && settled[stack.last().id] != true)
            val anim = remember { Animatable(if (i == 0) 0f else 1f) }
            LaunchedEffect(Unit) {
                anim.animateTo(0f, tween(220))
                settled[entry.id] = true
            }
            Box(
                Modifier.fillMaxSize()
                    .then(if (visible) Modifier else Hidden)
                    .graphicsLayer { translationX = anim.value * size.width * 0.3f; alpha = 1f - anim.value }
                    // Touches on the top screen never fall through to the one below.
                    .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } },
            ) { RouteContent(entry.route) }
        }
    }
}

/** Thin banner while the server is unreachable; queries refetch when it comes back. */
@Composable
private fun ConnectionBanner(signedIn: Boolean) {
    val online by Connection.online.collectAsState()
    if (online || !signedIn) return
    Box(Modifier.fillMaxSize().statusBarsPadding().padding(top = 4.dp), contentAlignment = Alignment.TopCenter) {
        Row(
            Modifier.alpha(0.92f).clip(CircleShape).background(Color(0xFF1B1D3A)).padding(horizontal = 14.dp, vertical = 7.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(Icons.Rounded.WifiOff, null, Modifier.size(14.dp), tint = Color.White)
            Text("Offline — reconnecting…", color = Color.White, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 12.sp)
        }
    }
}
