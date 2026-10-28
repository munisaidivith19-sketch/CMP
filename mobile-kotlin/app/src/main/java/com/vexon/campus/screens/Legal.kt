package com.vexon.campus.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Policy
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.vexon.campus.BuildConfig
import com.vexon.campus.core.Api
import com.vexon.campus.core.Auth
import com.vexon.campus.core.Legal
import com.vexon.campus.core.QueryClient
import com.vexon.campus.core.errMsg
import com.vexon.campus.core.get
import com.vexon.campus.core.int
import com.vexon.campus.core.rememberMutation
import com.vexon.campus.core.str
import com.vexon.campus.nav.Nav
import com.vexon.campus.ui.Body
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.InfoRow
import com.vexon.campus.ui.MarkdownText
import com.vexon.campus.ui.QueryContent
import com.vexon.campus.ui.RowCard
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.SectionTitle
import com.vexon.campus.ui.Sheet
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.Variant
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement

/* ── Terms and Conditions / Privacy Policy / About the App ─────────── */

/** The profile's "About the App" section: exactly the three entries in [Legal.ABOUT_ENTRIES]. */
@Composable
fun AboutTheAppSection() {
    SectionTitle("About the App")
    Legal.ABOUT_ENTRIES.forEach { entry ->
        val icon = when (entry.path) {
            "/terms" -> Icons.Rounded.Description
            "/privacy-policy" -> Icons.Rounded.Policy
            else -> Icons.Rounded.Info
        }
        RowCard(Wide, onClick = { Nav.push(entry.path) }) {
            Icon(icon, null, Modifier.size(20.dp), tint = C.primary)
            Strong(entry.label, Modifier.weight(1f))
        }
    }
}

/** One policy's published text, version and effective date. Rendered as plain text (MarkdownText), never HTML. */
@Composable
private fun PolicyBody(doc: JsonElement) {
    Card(Wide, gap = 10.dp) {
        H2(doc["title"].str, Modifier.semantics { heading() })
        Small("Version ${doc["version"].int ?: "—"} · Effective ${Legal.formatEffective(doc["effectiveAt"].str)}", color = C.muted)
        MarkdownText(doc["content"].str)
    }
}

@Composable
fun PolicyScreen(policyId: String) {
    val q = Api.legalPolicy(policyId)
    Screen(refreshing = q.isFetching, onRefresh = { q.refetch() }) {
        Header(if (policyId == Legal.TERMS) "Terms and Conditions" else "Privacy Policy", back = true, titleMaxLines = 2)
        QueryContent(q) { PolicyBody(it) }
    }
}

@Composable
fun AboutAppScreen() {
    Screen {
        Header("About the App", back = true)
        Card(Wide, gap = 8.dp) {
            H2(Legal.APP_NAME)
            Body(
                "${Legal.APP_NAME} is the campus platform of ${Legal.INSTITUTION}. It brings attendance, timetables, announcements, events and clubs, " +
                    "gate passes, hostel and transport information, complaints, chat and study tools together for students, faculty and staff on the web, Android and iOS."
            )
        }
        Card(Wide) {
            InfoRow("Application", Legal.APP_NAME)
            InfoRow("Version", "${BuildConfig.VERSION_NAME} (Android)")
            InfoRow("Institution", Legal.INSTITUTION)
            // Not shown as a link until the College confirms its official address.
            InfoRow("Official website", "To be announced by the College")
        }
        Button("Terms and Conditions", { Nav.push("/terms") }, Wide, variant = Variant.Outline, icon = Icons.Rounded.Description)
        Button("Privacy Policy", { Nav.push("/privacy-policy") }, Wide, variant = Variant.Outline, icon = Icons.Rounded.Policy)
    }
}

/**
 * Shown by AppRoot instead of the app while the server says the current Terms
 * must be accepted. The box is never ticked for the user; the server records
 * the acceptance and enforces it on every API.
 */
@Composable
fun TermsAcceptanceScreen() {
    val terms = Api.legalPolicy(Legal.TERMS)
    var agreed by rememberSaveable { mutableStateOf(false) }
    var declined by rememberSaveable { mutableStateOf(false) }
    var showPrivacy by remember { mutableStateOf(false) }
    var signingOut by remember { mutableStateOf(false) }
    val accept = rememberMutation()
    val scope = rememberCoroutineScope()
    val updated = Auth.user["legal"]["termsAcceptedVersion"].int != null

    fun signOut() {
        signingOut = true
        scope.launch { try { signOutThisDevice() } finally { signingOut = false } }
    }

    if (declined) {
        Screen {
            Header("You have not accepted the Terms", titleMaxLines = 2)
            Card(Wide, gap = 8.dp) {
                Body("${Legal.APP_NAME} can only be used after accepting its Terms and Conditions. Your account and your information are not changed or deleted — you can come back and accept at any time, or sign out now.")
            }
            Button("Review the Terms again", { declined = false }, Wide, variant = Variant.Outline)
            Button("Sign out", { signOut() }, Wide, variant = Variant.Danger, icon = Icons.AutoMirrored.Rounded.Logout, loading = signingOut)
        }
        return
    }

    Screen(refreshing = terms.isFetching, onRefresh = { terms.refetch() }) {
        Header("Terms and Conditions", titleMaxLines = 2)
        Body(
            if (updated) "The Terms and Conditions have been updated. Please read and accept the new version to keep using ${Legal.APP_NAME}."
            else "Before you start, please read and accept the Terms and Conditions. Acceptance is required to use ${Legal.APP_NAME}."
        )
        QueryContent(terms) { PolicyBody(it) }
        Button("Read the Privacy Policy", { showPrivacy = true }, Wide, variant = Variant.Outline, icon = Icons.Rounded.Policy)
        Small("The Privacy Policy explains how your information is used. Accepting the Terms does not, by itself, give consent to every kind of processing described there.", Wide, C.muted)

        Card(Wide) {
            Row(
                Modifier.toggleable(value = agreed, enabled = terms.data != null, role = Role.Checkbox, onValueChange = { agreed = it }),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                // The row handles the tap and announces the state; the box itself is decorative.
                Checkbox(checked = agreed, onCheckedChange = null, enabled = terms.data != null, colors = CheckboxDefaults.colors(checkedColor = C.primary))
                Strong(Legal.CHECKBOX_LABEL, Modifier.weight(1f))
            }
        }
        Button("Accept and continue", {
            val version = terms.data["version"].int ?: return@Button
            accept.launch(onError = { e ->
                if (Legal.isVersionChanged(e)) {
                    agreed = false
                    terms.refetch()
                    Dialogs.alert("The Terms were updated", "Please read the new version before accepting.")
                } else Dialogs.alert("Could not record your acceptance", errMsg(e))
            }) {
                Auth.setLegal(Api.acceptTerms(version))
                QueryClient.refetchActive()
            }
        }, Wide, loading = accept.isLoading, enabled = agreed && terms.data != null)
        if (!agreed) Small("Tick the box above to continue.", Wide, C.muted, TextAlign.Center)
        Button("Decline", { declined = true }, Wide, variant = Variant.Ghost)
    }

    if (showPrivacy) {
        Sheet(null, onClose = { showPrivacy = false }) {
            QueryContent(Api.legalPolicy(Legal.PRIVACY)) { PolicyBody(it) }
        }
    }
}
