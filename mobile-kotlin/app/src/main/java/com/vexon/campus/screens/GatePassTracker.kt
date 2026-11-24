package com.vexon.campus.screens

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DoorFront
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vexon.campus.core.Fmt
import com.vexon.campus.core.get
import com.vexon.campus.core.str
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Grad
import com.vexon.campus.ui.IconTile
import com.vexon.campus.ui.Jakarta
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.rememberReducedMotion
import kotlinx.serialization.json.JsonElement

/*
 * Home-screen tracker for the student's current gate pass: every stage the
 * request goes through (parent OTP, faculty, HOD, principal, gate exit,
 * return), which are done, which one it is waiting on, and where it stopped
 * if it was rejected. Tapping it opens the Gate pass page.
 *
 * Progress comes from the pass status (a stage is done once the status is past
 * it, so a pass approved in one go still shows every earlier stage done) and
 * the stage times stored on the pass.
 */

private data class TrackStep(val short: String, val waiting: String)

private val NORMAL = listOf(
    TrackStep("Sent", "Request sent"),
    TrackStep("Parent", "Waiting for your parent's OTP confirmation"),
    TrackStep("Faculty", "Waiting for faculty approval"),
    TrackStep("HOD", "Waiting for HOD approval"),
    TrackStep("Principal", "Waiting for Principal approval"),
    TrackStep("Exit", "Approved — show this QR at the gate when you leave"),
    TrackStep("Return", "You are out — check in at the gate when you return"),
)

/** Index of the stage the pass is waiting on (== steps.size when finished). */
private fun normalRank(status: String?, outing: Boolean) = when (status) {
    "pending_faculty" -> 1
    "parent_verified" -> 2
    "pending_hod" -> 3
    "pending_principal" -> 4
    "approved" -> 5
    "active" -> 6
    "completed" -> if (outing) 6 else 7
    else -> 0
}

private fun emergencySteps(authority: String) = listOf(
    TrackStep("Sent", "Request sent"),
    TrackStep(authority.lowercase().replaceFirstChar { it.uppercase() }.let { if (it.length <= 3) it.uppercase() else it }, "Waiting for $authority approval"),
    TrackStep("Exit", "Approved — show your code at the gate when you leave"),
    TrackStep("Return", "You are out — check in at the gate when you return"),
)

private fun emergencyRank(status: String?) = when (status) {
    "pending_authority" -> 1
    "approved" -> 2
    "active" -> 3
    "completed" -> 4
    else -> 0
}

/** Which step a rejection stopped at. */
private fun rejectedIndex(pass: JsonElement, emergency: Boolean): Int = if (emergency) 1 else when (pass["rejectedStage"].str) {
    "faculty" -> 2
    "hod" -> 3
    "principal" -> 4
    else -> 2
}

private enum class Dot { Done, Current, Todo, Failed }

@Composable
fun GatePassTracker(pass: JsonElement, onOpen: () -> Unit) {
    val emergency = isEmergency(pass)
    val outing = isOuting(pass)
    val status = pass["status"].str
    val rejected = status == "rejected"
    val steps = if (emergency) emergencySteps(AUTHORITY_LABELS[pass["emergencyAuthority"].str] ?: "authority")
    else if (outing) NORMAL.dropLast(1) else NORMAL
    val failedAt = if (rejected) rejectedIndex(pass, emergency) else -1
    val rank = when {
        rejected -> failedAt
        emergency -> emergencyRank(status)
        else -> normalRank(status, outing)
    }
    val dots = steps.indices.map { i ->
        when {
            i == failedAt -> Dot.Failed
            i < rank -> Dot.Done
            i == rank -> Dot.Current
            else -> Dot.Todo
        }
    }
    val headline = when {
        rejected -> "Rejected at ${steps[failedAt].short}" + (pass["rejectedReason"].str?.let { ": $it" } ?: "")
        rank >= steps.size -> "Completed"
        else -> steps[rank].waiting
    }
    val calm = rememberReducedMotion()
    val pulse = if (calm || rejected || rank >= steps.size) null else rememberInfiniteTransition(label = "gpPulse")
        .animateFloat(0f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart), label = "p")

    Card(Modifier.fillMaxWidth(), onClick = onOpen, gap = 14.dp) {
      Column(
        Modifier.fillMaxWidth().clearAndSetSemantics {
            contentDescription = "Gate pass ${passTitle(pass)}: $headline. Done ${dots.count { it == Dot.Done }} of ${steps.size} steps. Opens Gate pass."
        },
        verticalArrangement = Arrangement.spacedBy(14.dp),
      ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconTile(Icons.Rounded.DoorFront, if (rejected) Grad.rose else Grad.cyan, 40.dp)
            Column(Modifier.weight(1f)) {
                Text("GATE PASS TRACKING", color = C.soft, fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.8.sp)
                Strong(passTitle(pass), maxLines = 1)
                Small("Requested ${Fmt.timeAgo(pass["createdAt"])}", color = C.muted)
            }
            Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, Modifier.size(20.dp), tint = C.primary)
        }

        // The stepper: dots joined by a line that fills up to the current stage.
        Row(Modifier.fillMaxWidth()) {
            steps.forEachIndexed { i, step ->
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.fillMaxWidth().height(26.dp), contentAlignment = Alignment.Center) {
                        // Connectors to the neighbours (left half / right half).
                        val leftOn = i > 0 && dots[i] != Dot.Todo
                        val rightOn = i < steps.lastIndex && (dots[i + 1] == Dot.Done || dots[i + 1] == Dot.Current || dots[i + 1] == Dot.Failed)
                        val on = C.success
                        val off = C.border
                        Box(
                            Modifier.fillMaxWidth().height(3.dp).drawBehind {
                                val y = size.height / 2
                                val mid = size.width / 2
                                if (i > 0) drawLine(if (leftOn) on else off, androidx.compose.ui.geometry.Offset(0f, y), androidx.compose.ui.geometry.Offset(mid, y), size.height)
                                if (i < steps.lastIndex) drawLine(if (rightOn) on else off, androidx.compose.ui.geometry.Offset(mid, y), androidx.compose.ui.geometry.Offset(size.width, y), size.height)
                            },
                        )
                        StepDot(dots[i], if (dots[i] == Dot.Current) pulse?.value else null)
                    }
                    Text(
                        step.short, fontFamily = Jakarta, fontSize = 10.sp, maxLines = 1, textAlign = TextAlign.Center,
                        fontWeight = if (dots[i] == Dot.Current || dots[i] == Dot.Failed) FontWeight.Bold else FontWeight.SemiBold,
                        color = when (dots[i]) {
                            Dot.Current -> C.primary600
                            Dot.Failed -> C.dangerText
                            Dot.Done -> C.ink
                            Dot.Todo -> C.muted
                        },
                    )
                }
            }
        }

        // Where it stands now, in words (meaning is never colour alone).
        val tone = if (rejected) C.danger else if (rank >= steps.size) C.success else C.primary
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(tone.copy(alpha = 0.12f))
                .border(1.dp, tone.copy(alpha = 0.28f), RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(tone))
            Small(headline, Modifier.weight(1f), if (rejected) C.dangerText else C.ink, maxLines = 2)
        }
      }

        // Approved and not yet scanned at the gate: the QR / code right here, until
        // security scans it (the pass then turns "active" and this disappears).
        if (status == "approved") {
            KeepScreenBright()
            if (emergency) EmergencyApprovedCode(pass) else PassQr(pass)
        }
    }
}

/** Full brightness while a gate QR is on screen; the phone's own setting comes back afterwards. */
@Composable
private fun KeepScreenBright() {
    val activity = androidx.compose.ui.platform.LocalContext.current as? android.app.Activity ?: return
    androidx.compose.runtime.DisposableEffect(activity) {
        val window = activity.window
        val before = window.attributes.screenBrightness
        window.attributes = window.attributes.apply { screenBrightness = 1f }
        onDispose { window.attributes = window.attributes.apply { screenBrightness = before } }
    }
}

@Composable
private fun StepDot(dot: Dot, pulse: Float?) {
    val size = 22.dp
    when (dot) {
        Dot.Done -> Box(Modifier.size(size).clip(CircleShape).background(Brush.linearGradient(Grad.emerald)), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Check, null, Modifier.size(14.dp), tint = Color.White)
        }
        Dot.Failed -> Box(Modifier.size(size).clip(CircleShape).background(Brush.linearGradient(Grad.rose)), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Close, null, Modifier.size(14.dp), tint = Color.White)
        }
        Dot.Current -> Box(
            Modifier.size(size).drawBehind {
                // A soft ring that grows and fades: "in progress". Drawn only, no relayout.
                val p = pulse ?: 0f
                if (pulse != null) drawCircle(Color(0xFF1D6FEB).copy(alpha = 0.35f * (1f - p)), radius = this.size.minDimension / 2 * (1f + 0.7f * p))
            },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(size).clip(CircleShape).background(Brush.linearGradient(Grad.primary)).border(1.dp, Color.White.copy(alpha = 0.6f), CircleShape), contentAlignment = Alignment.Center) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(Color.White))
            }
        }
        Dot.Todo -> Box(Modifier.size(size).clip(CircleShape).background(C.surface).border(2.dp, C.border, CircleShape))
    }
}
