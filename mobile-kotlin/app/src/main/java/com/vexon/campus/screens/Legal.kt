package com.vexon.campus.screens

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Policy
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.vexon.campus.BuildConfig
import com.vexon.campus.core.Api
import com.vexon.campus.core.Legal
import com.vexon.campus.core.get
import com.vexon.campus.core.int
import com.vexon.campus.core.str
import com.vexon.campus.nav.Nav
import com.vexon.campus.ui.Body
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.H2
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.InfoRow
import com.vexon.campus.ui.MarkdownText
import com.vexon.campus.ui.QueryContent
import com.vexon.campus.ui.RowCard
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.SectionTitle
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.Variant
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
