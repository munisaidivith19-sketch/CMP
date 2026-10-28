package com.vexon.campus.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChatBubble
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.vexon.campus.core.Auth
import com.vexon.campus.core.Realtime
import com.vexon.campus.core.get
import com.vexon.campus.core.id
import com.vexon.campus.core.list
import com.vexon.campus.core.sameId
import com.vexon.campus.core.str
import com.vexon.campus.core.text
import com.vexon.campus.nav.Nav
import com.vexon.campus.push.Push
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * The pop-up shown while the app is open. A system notification is not raised
 * in the foreground (push/Push.kt), so a new notification or chat message
 * arriving over the live socket slides in from the top here instead — unless
 * the user is already looking at it (that chat thread, or the Alerts tab).
 */
object InAppBanner {
    data class Banner(val key: Long, val title: String, val text: String?, val link: String, val chat: Boolean)

    val current = MutableStateFlow<Banner?>(null)
    private var nextKey = 0L

    /** Called for every live socket event (AppRoot). */
    fun onEvent(event: Realtime.Event) {
        val p = event.args.firstOrNull() ?: return
        val banner = when (event.name) {
            "notification" -> {
                // Already on the Alerts list: the new row is right there.
                if (Nav.tab == "notifications" && Nav.stack.size == 1) return
                Banner(nextKey++, p["title"].str ?: "New notification", p["message"].text, Push.safeLink(p["link"].str), p["category"].str == "chat")
            }
            "chat:message" -> {
                val conversation = p["conversationId"].str ?: return
                val message = p["message"]
                if (sameId(message["sender"], Auth.user.id)) return
                // Reading that conversation right now.
                if (Nav.stack.lastOrNull()?.route?.path == "/chat/$conversation") return
                val text = message["body"].text ?: if (message["attachments"].list.isNotEmpty()) "📎 Attachment" else null
                Banner(nextKey++, message["sender"]["name"].str ?: "New message", text, "/chat/$conversation", true)
            }
            else -> return
        }
        current.value = banner
    }

    fun dismiss() {
        current.value = null
    }
}

@Composable
fun InAppBannerHost() {
    val banner by InAppBanner.current.collectAsState()
    // Keep the last banner while it animates out.
    var shown by remember { mutableStateOf<InAppBanner.Banner?>(null) }
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(banner?.key) {
        val b = banner ?: return@LaunchedEffect
        shown = b
        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        delay(4_500)
        if (InAppBanner.current.value?.key == b.key) InAppBanner.dismiss()
    }
    Box(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 6.dp), contentAlignment = Alignment.TopCenter) {
        AnimatedVisibility(
            visible = banner != null,
            enter = slideInVertically { -it } + fadeIn(),
            exit = slideOutVertically { -it } + fadeOut(),
        ) {
            val b = shown ?: return@AnimatedVisibility
            Row(
                Modifier.fillMaxWidth().shadow(12.dp, RoundedCornerShape(20.dp)).clip(RoundedCornerShape(20.dp))
                    .background(C.surface).border(1.dp, C.border, RoundedCornerShape(20.dp))
                    .clickable { InAppBanner.dismiss(); Nav.push(b.link) }
                    .padding(horizontal = 14.dp, vertical = 12.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                IconTile(if (b.chat) Icons.Rounded.ChatBubble else Icons.Rounded.Notifications, if (b.chat) Grad.primary else Grad.amber, 38.dp)
                Column(Modifier.weight(1f)) {
                    Strong(b.title, maxLines = 1)
                    b.text?.let { Small(it, maxLines = 2) }
                }
                Icon(
                    Icons.Rounded.Close, "Dismiss", Modifier.size(28.dp).clip(RoundedCornerShape(14.dp)).clickable { InAppBanner.dismiss() }.padding(5.dp),
                    tint = C.muted,
                )
            }
        }
    }
}
