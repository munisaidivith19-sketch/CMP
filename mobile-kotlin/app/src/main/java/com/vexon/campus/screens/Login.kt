package com.vexon.campus.screens

import androidx.compose.foundation.Image
import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.HelpOutline
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.vexon.campus.ui.Glass
import com.vexon.campus.ui.LiquidBackdrop
import com.vexon.campus.ui.LiquidButton
import com.vexon.campus.ui.liquidGlass
import com.vexon.campus.ui.rememberReducedMotion
import com.vexon.campus.ui.rise
import com.vexon.campus.ui.Jakarta
import com.vexon.campus.ui.Motion
import com.vexon.campus.ui.ThemeState
import com.vexon.campus.ui.pressable
import kotlinx.coroutines.delay
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import com.vexon.campus.ui.entrance
import com.vexon.campus.ui.glass
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.MarkEmailRead
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.vexon.campus.R
import com.vexon.campus.core.Api
import com.vexon.campus.core.ApiException
import com.vexon.campus.core.Auth
import com.vexon.campus.core.bool
import com.vexon.campus.core.errMsg
import com.vexon.campus.core.get
import com.vexon.campus.core.int
import com.vexon.campus.core.rememberMutation
import com.vexon.campus.core.str
import com.vexon.campus.ui.Backdrop
import com.vexon.campus.ui.ThemeToggle
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.Grad
import com.vexon.campus.ui.H1
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.H3
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.Variant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val EMAIL = Regex("^\\S+@\\S+\\.\\S+$")

@Composable
fun LoginScreen() {
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    var emailError by remember { mutableStateOf<String?>(null) }
    var passwordError by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf("") }
    var lockedInfo by remember { mutableStateOf<String?>(null) }
    var remaining by remember { mutableStateOf<Int?>(null) }
    val login = rememberMutation()

    fun submit() {
        emailError = when {
            email.isBlank() -> "Email is required"
            !EMAIL.matches(email.trim()) -> "Enter a valid email"
            else -> null
        }
        passwordError = if (password.isEmpty()) "Password is required" else null
        if (emailError != null || passwordError != null) return
        error = ""
        login.launch(onError = { e ->
            val data = (e as? ApiException)?.data
            if ((e as? ApiException)?.status == 423 || data["locked"].bool) {
                lockedInfo = data["message"].str ?: "Account temporarily locked due to multiple failed sign-in attempts."
                remaining = null
            } else {
                data["remainingAttempts"].int?.let { remaining = it }
                error = errMsg(e, "Sign in failed")
            }
        }) {
            val session = Api.login(email.trim(), password)
            lockedInfo = null
            remaining = null
            withContext(Dispatchers.IO) { Auth.saveRefreshToken(session["refreshToken"].str) }
            Auth.setCredentials(session)
        }
    }

    val sessionEnded = Auth.state.collectAsState().value.sessionEnded
    val calm = rememberReducedMotion()
    // Night mode: plain white text on the login screen (labels, subtitle, help); hints slightly dimmer than typed text.
    val dark = ThemeState.dark
    val textSoft = if (dark) Color.White else C.soft
    val hint = if (dark) Color.White.copy(alpha = 0.62f) else C.muted
    Box(Modifier.fillMaxSize().background(C.bg)) {
        LiquidBackdrop(calm)
        BoxWithConstraints(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
        // Centred on tall screens, scrolls on small ones / with the keyboard open.
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).heightIn(min = maxHeight).padding(horizontal = 20.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            // Light/dark switch in the top-right corner, as on every other screen.
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { ThemeToggle() }
            Spacer(Modifier.weight(1f))
            LogoOrb(Modifier.rise(0, calm))
            Spacer(Modifier.height(16.dp))
            Column(Modifier.rise(70, calm), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    BRAND_NAME, color = C.primary600, fontFamily = Jakarta, fontWeight = FontWeight.ExtraBold,
                    fontSize = 16.sp, letterSpacing = 1.4.sp, lineHeight = 22.sp, textAlign = TextAlign.Center,
                    modifier = Modifier.semantics { heading() },
                )
                Spacer(Modifier.height(8.dp))
                Box(Modifier.size(width = 40.dp, height = 3.dp).clip(CircleShape).background(Brush.horizontalGradient(Grad.primary)))
            }
            Spacer(Modifier.height(22.dp))
            Column(
                Modifier.fillMaxWidth().widthIn(max = 460.dp).rise(140, calm).liquidGlass(RoundedCornerShape(32.dp)).padding(horizontal = 20.dp, vertical = 22.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    H2("Welcome back")
                    Text("Sign in with your college email to continue.", color = textSoft, fontFamily = Jakarta, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp)
                }
                if (sessionEnded && lockedInfo == null) {
                    Notice(Icons.Rounded.Info, "You were signed out because your session ended or was revoked. Please sign in again.", C.warningText, C.warning)
                }
                lockedInfo?.let { info ->
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(C.dangerSoft)
                            .border(1.dp, C.dangerBorder, RoundedCornerShape(16.dp)).padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Icon(Icons.Rounded.Shield, null, Modifier.size(18.dp), tint = C.dangerText)
                            Strong("Account Temporarily Locked", color = C.dangerText)
                        }
                        Small(info, color = C.dangerText)
                    }
                }
                val left = remaining
                if (lockedInfo == null && left != null && left > 0) {
                    Notice(Icons.Rounded.WarningAmber, "Invalid credentials. $left attempt${if (left > 1) "s" else ""} remaining before temporary lockout.", C.warningText, C.warning)
                }
                Input(
                    email, { email = it }, label = "College email", placeholder = "yourname@jnn.edu.in", error = emailError,
                    keyboardType = KeyboardType.Email, enabled = lockedInfo == null, imeAction = ImeAction.Next,
                    labelColor = textSoft, placeholderColor = hint,
                )
                Input(
                    password, { password = it }, label = "Password", placeholder = "••••••••", error = passwordError,
                    keyboardType = KeyboardType.Password, password = !show, enabled = lockedInfo == null, imeAction = ImeAction.Go, onSubmit = ::submit,
                    labelColor = textSoft, placeholderColor = hint,
                    trailing = {
                        Box(Modifier.size(44.dp).clip(CircleShape).clickable { show = !show }, contentAlignment = Alignment.Center) {
                            Icon(
                                if (show) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                                if (show) "Hide password" else "Show password",
                                Modifier.size(20.dp), tint = textSoft,
                            )
                        }
                    },
                )
                AnimatedVisibility(error.isNotEmpty() && lockedInfo == null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                    Small(error, color = C.dangerText)
                }
                LiquidButton(if (lockedInfo != null) "Locked" else "Sign in", ::submit, loading = login.isLoading, enabled = lockedInfo == null)
            }
            Spacer(Modifier.height(18.dp))
            // Passwords are reset by the Class In-Charge or an Admin — there is no email reset.
            Row(
                Modifier.widthIn(max = 460.dp).rise(210, calm).clip(RoundedCornerShape(18.dp)).background(C.glass(0.55f)).padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.AutoMirrored.Rounded.HelpOutline, null, Modifier.size(18.dp), tint = C.primary600)
                Small(PASSWORD_HELP, Modifier.weight(1f, fill = false), textSoft)
            }
            Spacer(Modifier.weight(1.4f))
        }
        }
    }
}

const val BRAND_NAME = "J.N.N INSTITUTE OF ENGINEERING"

/** The logo in a glass orb with a specular highlight. */
@Composable
private fun LogoOrb(modifier: Modifier = Modifier) {
    Box(modifier.size(112.dp).liquidGlass(CircleShape), contentAlignment = Alignment.Center) {
        // Highlight: a soft white band across the top, like light on a drop of water (drawn under the logo).
        val shine = if (ThemeState.dark) 0.35f else 0.9f
        Box(
            Modifier.matchParentSize().drawBehind {
                drawOval(
                    Brush.verticalGradient(listOf(Color.White.copy(alpha = shine), Color.White.copy(alpha = 0f)), startY = size.height * 0.03f, endY = size.height * 0.12f),
                    topLeft = Offset(size.width * 0.26f, size.height * 0.03f),
                    size = androidx.compose.ui.geometry.Size(size.width * 0.48f, size.height * 0.09f),
                )
            },
        )
        Image(painterResource(R.drawable.jnn_logo), "J.N.N Institute of Engineering logo", Modifier.size(100.dp).clip(CircleShape))
    }
}

/** Small tinted notice with an icon (meaning is never colour alone). */
@Composable
private fun Notice(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, fg: Color, tint: Color) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(tint.copy(alpha = 0.12f))
            .border(1.dp, tint.copy(alpha = 0.35f), RoundedCornerShape(16.dp)).padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, null, Modifier.size(18.dp), tint = fg)
        Small(text, Modifier.weight(1f), fg)
    }
}

const val PASSWORD_HELP = "Forgot your password? Contact your Class In-Charge or Admin to reset your password."

/** Email password reset is retired; an old deep link to it just shows who resets passwords. */
@Composable
fun ForgotPasswordScreen() {
    Screen {
        Header("Reset password", back = true)
        Card(Modifier.fillMaxWidth(), gap = 14.dp) {
            EmptyState(Icons.Rounded.MarkEmailRead, "Contact your Class In-Charge or Admin", PASSWORD_HELP)
        }
    }
}

/** Shown at launch when the saved session could not be checked because the server is unreachable. */
@Composable
fun OfflineLaunch(onRetry: suspend () -> Unit, onSkip: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize().background(C.bg)) {
        Backdrop()
        // Scrolls when the text is large or the phone is small, so nothing is cut off.
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(28.dp).entrance(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        ) {
            Box(Modifier.size(76.dp).glass(RoundedCornerShape(26.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.CloudOff, null, Modifier.size(32.dp), tint = C.primary)
            }
            H2("Can’t reach JNN", align = TextAlign.Center)
            Small("Check your mobile data or Wi-Fi. You are still signed in — we’ll pick up where you left off.", align = TextAlign.Center)
            Button("Try again", {
                busy = true
                scope.launch { onRetry(); busy = false }
            }, Modifier.fillMaxWidth(), icon = Icons.Rounded.Refresh, loading = busy)
            Button("Go to sign in", onSkip, variant = Variant.Ghost)
        }
    }
}
