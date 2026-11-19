package com.vexon.campus.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * The app's glass look, in one place.
 *
 * A glass surface is three things: a translucent fill that is a little brighter
 * at the top (light falling on it), a rim that is bright at the top-left and
 * fades towards the bottom-right, and the soft colour field behind it
 * ([AppBackdrop]). Android has no cheap, widely supported way to blur what is
 * behind a view, so nothing here blurs live content: the backdrop is already a
 * smooth gradient, which is what a blur of it would look like, and screens stay
 * smooth on old phones.
 *
 * Every colour reads [ThemeState], so surfaces follow light / dark mode.
 */
object Glass {
    private val darkPanel = Color(0xFF1E2C44)

    /** Card and row fill. */
    val fill: Brush
        get() = if (ThemeState.dark) Brush.verticalGradient(listOf(darkPanel.copy(alpha = 0.82f), darkPanel.copy(alpha = 0.62f)))
        else Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.86f), Color.White.copy(alpha = 0.66f)))

    /** Nearly opaque fill for surfaces that float over other content (tab bar, pop-ups, map panels). */
    val strongFill: Brush
        get() = if (ThemeState.dark) Brush.verticalGradient(listOf(darkPanel.copy(alpha = 0.97f), darkPanel.copy(alpha = 0.93f)))
        else Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.97f), Color.White.copy(alpha = 0.92f)))

    /** The light edge that makes a surface read as glass. */
    val rim: Brush
        get() = if (ThemeState.dark) Brush.linearGradient(listOf(Color.White.copy(alpha = 0.30f), Color.White.copy(alpha = 0.06f)))
        else Brush.linearGradient(listOf(Color.White, Color(0xFF1D6FEB).copy(alpha = 0.16f)))

    /** Highlight along the top of a coloured (gradient) surface. */
    val shine: Brush = Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.45f), Color.White.copy(alpha = 0.04f)))

    val shadow: Color get() = if (ThemeState.dark) Color.Black else Color(0xFF1D4E9E)
}

/**
 * Glass surface: fill, rim, and (for [elevation] > 0) a soft tinted shadow.
 * Only use [elevation] with [Glass.strongFill] — a shadow shows through a
 * translucent fill as a grey patch.
 */
fun Modifier.glass(
    shape: Shape = RoundedCornerShape(Radius.xl),
    fill: Brush = Glass.fill,
    rim: Brush = Glass.rim,
    elevation: Dp = 0.dp,
): Modifier = this
    .then(if (elevation > 0.dp) Modifier.shadow(elevation, shape, clip = false, ambientColor = Glass.shadow, spotColor = Glass.shadow) else Modifier)
    .clip(shape)
    .background(fill)
    .border(1.dp, rim, shape)

/** Shared motion: one feel for the whole app. */
object Motion {
    const val ENTER_MS = 300
    const val EXIT_MS = 200
    const val QUICK_MS = 180
    fun <T> press() = spring<T>(dampingRatio = 0.62f, stiffness = Spring.StiffnessMedium)
    fun <T> smooth() = tween<T>(ENTER_MS, easing = FastOutSlowInEasing)
}

private fun DrawScope.glow(color: Color, alpha: Float, center: Offset, radius: Float) {
    if (radius <= 0f) return
    drawCircle(Brush.radialGradient(listOf(color.copy(alpha = alpha), color.copy(alpha = 0f)), center, radius), radius, center)
}

/** The soft colour field behind every screen: three glows drawn in one pass (no blur, no bitmaps). */
@Composable
fun BoxScope.Backdrop() {
    val dark = ThemeState.dark
    Box(
        Modifier.matchParentSize().drawBehind {
            val w = size.width
            val h = size.height
            glow(Color(0xFF4396EF), if (dark) 0.34f else 0.30f, Offset(w * 0.05f, h * 0.04f), w * 0.95f)
            glow(Color(0xFF7C5CF6), if (dark) 0.22f else 0.15f, Offset(w * 1.02f, h * 0.36f), w * 0.85f)
            glow(Color(0xFF0EA5E9), if (dark) 0.18f else 0.16f, Offset(w * 0.10f, h * 1.0f), w * 0.90f)
        },
    )
}

/** Full-screen background + [Backdrop], for layouts that do not use `Screen`. */
@Composable
fun AppBackdrop(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(modifier.fillMaxSize().background(C.bg)) {
        Backdrop()
        content()
    }
}

/**
 * Fades and lifts content in the first time it is shown. The system's
 * "Remove animations" setting makes it instant.
 */
@Composable
fun Modifier.entrance(): Modifier {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) { progress.animateTo(1f, Motion.smooth()) }
    return this.graphicsLayer {
        alpha = progress.value
        translationY = (1f - progress.value) * 12.dp.toPx()
    }
}
