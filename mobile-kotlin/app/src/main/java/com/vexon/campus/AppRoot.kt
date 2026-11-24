package com.vexon.campus

import com.vexon.campus.core.E2e
import kotlinx.coroutines.launch
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBars
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.vexon.campus.ui.AppBackdrop
import com.vexon.campus.ui.Glass
import com.vexon.campus.ui.Motion
import com.vexon.campus.ui.glass
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
import com.vexon.campus.core.get
import com.vexon.campus.core.bool
import com.vexon.campus.core.Auth
import com.vexon.campus.core.Connection
import com.vexon.campus.core.QueryClient
import com.vexon.campus.core.RefreshResult
import com.vexon.campus.core.Realtime
import com.vexon.campus.core.ServerConfig
import com.vexon.campus.core.id
import com.vexon.campus.nav.Nav
import com.vexon.campus.push.NotificationGate
import com.vexon.campus.push.Push
import com.vexon.campus.screens.PasswordChangeRequiredScreen
import com.vexon.campus.screens.NotificationsRequiredScreen
import com.vexon.campus.screens.OfflineLaunch
import com.vexon.campus.screens.RouteContent
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
        withContext(Dispatchers.IO) { ServerConfig.loadOverride() }
        when (Auth.refreshSession()) {
            RefreshResult.Offline -> {
                launchOffline.value = true
                return
            }
            else -> Unit
        }
        // Order matters: "Try again" runs inside the offline screen's own coroutine scope, and
        // clearing the flag removes that screen and cancels this coroutine. Mark the session
        // checked first, so the app never ends up on a blank screen with nothing left to finish it.
        Auth.sessionChecked()
        launchOffline.value = false
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
        AppBackdrop {}
        return
    }

    val userId = auth.user.id
    // Notifications are mandatory once signed in; sign-in itself is never blocked.
    val notifications by NotificationGate.status.collectAsState()
    val notificationsOn = notifications == NotificationGate.Status.Granted
    // A new account chooses its own password first; the server refuses every other API until then.
    val passwordPending = userId != null && auth.user["mustChangePassword"].bool
    val blocked = userId != null && (passwordPending || !notificationsOn)

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
        // Register this phone for end-to-end encrypted chat, so others can send it encrypted messages.
        E2e.scope.launch { runCatching { E2e.ensureDevice() } }
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

    val online by Connection.online.collectAsState()
    val offlineBar = userId != null && !online
    Column(Modifier.fillMaxSize().background(C.bg)) {
        // The offline pill has a row of its own under the status bar and the app moves
        // down for it, so it never sits on top of a title or a header button.
        AnimatedVisibility(offlineBar, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) { ConnectionBanner() }
        Box(Modifier.weight(1f).fillMaxWidth().then(if (offlineBar) Modifier.consumeWindowInsets(WindowInsets.statusBars) else Modifier)) {
            // Back from the gate leaves the app (system default); the stack in Nav is kept for later.
            val gate = when {
                !blocked -> 0
                passwordPending -> 1
                else -> 2
            }
            Crossfade(gate, animationSpec = tween(Motion.ENTER_MS), label = "gate") { g ->
                when (g) {
                    0 -> StackHost()
                    1 -> PasswordChangeRequiredScreen()
                    else -> notifications?.let { NotificationsRequiredScreen(it) }
                }
            }
            if (userId != null && !blocked) InAppBannerHost()
            DialogHost()
        }
    }
}

/** What [StackHost] showed last, to tell a "back" from any other change of the stack. */
private class StackMemory {
    var last: List<Nav.Entry> = emptyList()
    /** The screen that was just popped: kept on top while it slides away. */
    var leaving by mutableStateOf<Nav.Entry?>(null)
}

/** Screens below the top stay composed (like a native stack) but are not laid out on screen. */
private val Hidden = Modifier.layout { measurable, constraints ->
    measurable.measure(constraints)
    layout(0, 0) {}
}

/**
 * The navigation stack. A new screen slides in from the right over the one
 * below; going back slides the top screen away to reveal the one below, which
 * was kept alive (scroll position, typed text) the whole time. With the
 * system's "Remove animations" setting both are instant.
 */
@Composable
private fun StackHost() {
    val settled = remember { mutableStateMapOf<Long, Boolean>() }
    val memory = remember { StackMemory() }
    val stack = Nav.stack.toList()

    // A plain "back" (the old top removed, everything under it unchanged) animates out.
    val before = memory.last
    val poppedTop = before.lastOrNull()
    if (poppedTop != null && stack.isNotEmpty() && before.size == stack.size + 1 &&
        before.dropLast(1).map { it.id } == stack.map { it.id }
    ) {
        memory.leaving = poppedTop
    } else if (memory.leaving != null && before.map { it.id } != stack.map { it.id }) {
        memory.leaving = null // the stack changed again: stop the old animation
    }
    memory.last = stack

    val leaving = memory.leaving
    val shown = if (leaving != null) stack + leaving else stack
    shown.forEachIndexed { i, entry ->
        key(entry.id) {
            val isLeaving = leaving != null && entry.id == leaving.id
            val top = !isLeaving && i == stack.lastIndex
            val visible = isLeaving || top || (i == stack.lastIndex - 1 && settled[stack.last().id] != true)
            val root = i == 0
            // 1 = fully off to the right and transparent, 0 = in place.
            val anim = remember { Animatable(1f) }
            LaunchedEffect(isLeaving) {
                if (isLeaving) {
                    anim.animateTo(1f, tween(Motion.EXIT_MS, easing = FastOutLinearInEasing))
                    if (memory.leaving?.id == entry.id) memory.leaving = null
                } else {
                    anim.animateTo(0f, tween(Motion.ENTER_MS, easing = FastOutSlowInEasing))
                    settled[entry.id] = true
                }
            }
            Box(
                Modifier.fillMaxSize()
                    .then(if (visible) Modifier else Hidden)
                    // The first screen (tabs, sign-in) only fades in; the others also slide.
                    .graphicsLayer { translationX = if (root) 0f else anim.value * size.width * 0.25f; alpha = 1f - anim.value }
                    // Touches on the top screen never fall through to the one below.
                    .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } },
            ) { RouteContent(entry.route) }
        }
    }
}

/** Thin pill while the server is unreachable; queries refetch when it comes back. */
@Composable
private fun ConnectionBanner() {
    Box(Modifier.fillMaxWidth().statusBarsPadding().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        Row(
            Modifier.glass(CircleShape, fill = Glass.strongFill).padding(horizontal = 14.dp, vertical = 7.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(Icons.Rounded.WifiOff, null, Modifier.size(14.dp), tint = C.warningText)
            Text("Offline — reconnecting…", color = C.ink, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 12.sp, maxLines = 1)
        }
    }
}
