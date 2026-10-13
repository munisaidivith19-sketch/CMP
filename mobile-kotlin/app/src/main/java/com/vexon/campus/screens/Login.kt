package com.vexon.campus.screens

import androidx.compose.foundation.Image
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
import com.vexon.campus.nav.Nav
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

    Screen {
        // Light/dark switch in the top-right corner, as on every other screen.
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { ThemeToggle() }
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Image(painterResource(R.drawable.jnn_logo), "JNN logo", Modifier.size(84.dp))
            H1("Welcome back 👋")
            Small("Sign in with your college email to continue.", align = TextAlign.Center)
        }
        Card(Modifier.fillMaxWidth(), gap = 14.dp) {
            if (Auth.state.collectAsState().value.sessionEnded && lockedInfo == null) {
                Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0x1AF59E0B)).border(1.dp, Color(0x40F59E0B), RoundedCornerShape(10.dp)).padding(10.dp)) {
                    Small("You were signed out because your session ended or was revoked. Please sign in again.", color = C.warningText)
                }
            }
            lockedInfo?.let { info ->
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0x1AEF4444))
                        .border(1.dp, Color(0x40EF4444), RoundedCornerShape(12.dp)).padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(Icons.Rounded.Shield, null, Modifier.size(18.dp), tint = C.danger)
                        Strong("Account Temporarily Locked", color = C.danger)
                    }
                    Small(info, color = C.danger)
                }
            }
            val left = remaining
            if (lockedInfo == null && left != null && left > 0) {
                Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0x1AF59E0B)).border(1.dp, Color(0x40F59E0B), RoundedCornerShape(10.dp)).padding(10.dp)) {
                    Small("⚠️ Invalid credentials. $left attempt${if (left > 1) "s" else ""} remaining before temporary lockout.", color = C.warningText)
                }
            }
            Input(
                email, { email = it }, label = "College email", placeholder = "you@campus.edu", error = emailError,
                keyboardType = KeyboardType.Email, enabled = lockedInfo == null, imeAction = ImeAction.Next,
            )
            Input(
                password, { password = it }, label = "Password", placeholder = "••••••••", error = passwordError,
                keyboardType = KeyboardType.Password, password = !show, enabled = lockedInfo == null, imeAction = ImeAction.Go, onSubmit = ::submit,
                trailing = {
                    Icon(
                        if (show) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                        if (show) "Hide password" else "Show password",
                        Modifier.size(18.dp).clickable { show = !show }, tint = C.muted,
                    )
                },
            )
            if (error.isNotEmpty() && lockedInfo == null) Small(error, color = C.danger)
            Button(if (lockedInfo != null) "Locked" else "Sign in", ::submit, Modifier.fillMaxWidth(), loading = login.isLoading, enabled = lockedInfo == null)
            // Passwords are reset by the Class In-Charge or an Admin — there is no email reset.
            Small(PASSWORD_HELP, Modifier.align(Alignment.CenterHorizontally).padding(4.dp), C.muted)
        }
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
        Column(
            Modifier.fillMaxSize().statusBarsPadding().padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        ) {
            Box(Modifier.size(72.dp).clip(RoundedCornerShape(26.dp)).background(C.primarySoft), contentAlignment = Alignment.Center) {
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
