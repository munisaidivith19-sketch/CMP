package com.vexon.campus.ui

import android.provider.Settings
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/* ── Liquid glass look (login and the full-screen gates)  ─────────────────────────────────────────────────────
 * Liquid glass without live blur: the colour field behind is already soft, so
 * a translucent fill + bright rim + a sheen on the upper half reads as glass,
 * keeps text crisp (the fill stays ≥ 86% opaque under the text) and costs
 * nothing on old phones. All motion is transform/alpha only, and the system's
 * "Remove animations" setting turns it off.
 */

/** True when the phone's animator scale is 0 ("Remove animations"). */
@Composable
fun rememberReducedMotion(): Boolean {
    val context = LocalContext.current
    return remember {
        runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
    }
}

/** Fade + lift in, [delayMs] after the screen appears. */
@Composable
fun Modifier.rise(delayMs: Int, calm: Boolean): Modifier {
    val p = remember { Animatable(if (calm) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!calm) {
            delay(delayMs.toLong())
            p.animateTo(1f, spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessLow))
        }
    }
    return graphicsLayer {
        alpha = p.value.coerceIn(0f, 1f)
        translationY = (1f - p.value) * 18.dp.toPx()
        val s = 0.97f + 0.03f * p.value
        scaleX = s
        scaleY = s
    }
}

/** Slowly drifting colour blobs. Only the draw phase reads the animation: no recomposition per frame. */
@Composable
fun BoxScope.LiquidBackdrop(calm: Boolean) {
    val dark = ThemeState.dark
    val drift = if (calm) null else rememberInfiniteTransition(label = "liquid")
    val t = drift?.animateFloat(0f, 1f, infiniteRepeatable(tween(14_000, easing = LinearEasing), RepeatMode.Reverse), label = "t")
    Box(
        Modifier.matchParentSize().drawBehind {
            val k = t?.value ?: 0.5f
            val w = size.width
            val h = size.height
            fun blob(color: Color, a: Float, x: Float, y: Float, r: Float) {
                val c = Offset(x, y)
                drawCircle(Brush.radialGradient(listOf(color.copy(alpha = a), color.copy(alpha = 0f)), c, r), r, c)
            }
            blob(Color(0xFF4396EF), if (dark) 0.42f else 0.38f, w * (0.10f + 0.12f * k), h * (0.08f + 0.04f * k), w * 0.95f)
            blob(Color(0xFF7C5CF6), if (dark) 0.30f else 0.22f, w * (1.00f - 0.10f * k), h * (0.34f + 0.06f * k), w * 0.80f)
            blob(Color(0xFF0EA5E9), if (dark) 0.26f else 0.24f, w * (0.05f + 0.15f * k), h * (0.96f - 0.05f * k), w * 0.95f)
            blob(Color(0xFF22D3EE), if (dark) 0.14f else 0.14f, w * (0.80f - 0.20f * k), h * (0.70f + 0.04f * k), w * 0.55f)
        },
    )
}

/** Glass surface with a liquid sheen across its upper half. */
fun Modifier.liquidGlass(shape: Shape): Modifier = this
    .shadow(8.dp, shape, clip = false, ambientColor = Glass.shadow.copy(alpha = 0.18f), spotColor = Glass.shadow.copy(alpha = 0.18f))
    .clip(shape)
    .background(
        if (ThemeState.dark) Brush.verticalGradient(listOf(Color(0xF21E2C44), Color(0xE6152033)))
        else Brush.verticalGradient(listOf(Color(0xF7FFFFFF), Color(0xE6FFFFFF))),
    )
    .drawBehind {
        drawRect(Brush.verticalGradient(listOf(Color.White.copy(alpha = if (ThemeState.dark) 0.08f else 0.55f), Color.Transparent), endY = size.height * 0.45f))
    }
    .border(
        1.2.dp,
        Brush.linearGradient(
            if (ThemeState.dark) listOf(Color.White.copy(alpha = 0.34f), Color.White.copy(alpha = 0.05f), Color(0xFF7EB6F7).copy(alpha = 0.25f))
            else listOf(Color.White, Color(0xFF1D6FEB).copy(alpha = 0.12f), Color.White.copy(alpha = 0.9f)),
        ),
        shape,
    )

/** Pill-shaped gradient button with a glossy top edge and spring press feedback. */
@Composable
fun LiquidButton(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    arrow: Boolean = icon == null,
) {
    val shape = RoundedCornerShape(50)
    val active = enabled && !loading
    Box(
        modifier.fillMaxWidth().heightIn(min = 54.dp)
            .alpha(if (enabled) 1f else 0.5f)
            .pressable(if (active) onClick else null, 0.965f)
            .shadow(if (active) 6.dp else 0.dp, shape, clip = false, ambientColor = Color(0xFF1D6FEB), spotColor = Color(0xFF1D6FEB))
            .clip(shape)
            .background(Brush.linearGradient(Grad.primary))
            .drawBehind {
                drawRect(Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.28f), Color.Transparent), endY = size.height * 0.55f))
            }
            .border(1.dp, Glass.shine, shape)
            .semantics { role = Role.Button },
        contentAlignment = Alignment.Center,
    ) {
        Crossfade(loading, animationSpec = tween(Motion.QUICK_MS), label = "signin") { busy ->
            if (busy) CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.5.dp)
            else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (icon != null) Icon(icon, null, Modifier.size(19.dp), tint = Color.White)
                Text(title, color = Color.White, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 1)
                if (enabled && arrow) Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, Modifier.size(18.dp), tint = Color.White)
            }
        }
    }
}

/** Secondary pill: glass fill, readable ink text, same press feel as [LiquidButton]. */
@Composable
fun LiquidGlassButton(title: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null) {
    val shape = RoundedCornerShape(50)
    Row(
        modifier.fillMaxWidth().heightIn(min = 52.dp)
            .alpha(if (enabled) 1f else 0.5f)
            .pressable(if (enabled) onClick else null, 0.965f)
            .clip(shape)
            .background(C.glass(if (ThemeState.dark) 0.55f else 0.85f))
            .border(1.dp, Glass.rim, shape)
            .semantics { role = Role.Button },
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(19.dp), tint = C.ink)
        Text(title, color = C.ink, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1)
    }
}

/** Secondary text on liquid screens: white in night mode, soft ink by day. */
val liquidTextSoft: Color get() = if (ThemeState.dark) Color.White else C.soft
