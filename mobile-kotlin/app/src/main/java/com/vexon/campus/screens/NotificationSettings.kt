package com.vexon.campus.screens

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.NotificationsOff
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.vexon.campus.core.Api
import com.vexon.campus.core.errMsg
import com.vexon.campus.core.get
import com.vexon.campus.core.int
import com.vexon.campus.core.jsonOf
import com.vexon.campus.core.rememberMutation
import com.vexon.campus.core.strings
import com.vexon.campus.push.Push
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.RowCard
import com.vexon.campus.ui.Screen
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.Variant
import kotlinx.coroutines.launch

private val CATEGORY_LABELS = linkedMapOf(
    "chat" to ("Chat messages" to "New messages in your conversations"),
    "reminder" to ("Next-period reminders" to "Before each class you teach"),
    "student_entry" to ("Student campus entry" to "When a student of your class returns to campus"),
    "timetable" to ("Timetable changes" to "Changes to your periods"),
    "event" to ("Events" to "New and updated events"),
    "announcement" to ("Announcements" to "Announcements for you"),
    "transport" to ("College bus" to "Trip started, bus approaching your stop, delays"),
)

/**
 * Notification settings: the system permission (with a path to Android
 * settings when it was denied) and the optional categories. Safety and duty
 * notifications — SOS, gate-pass decisions, your own attendance, substitute
 * classes, exams — cannot be switched off.
 */
@Composable
fun NotificationSettingsScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val q = Api.notificationPrefs()
    val save = rememberMutation()
    var permission by remember { mutableStateOf(Push.permissionGranted(context)) }
    // Coming back from Android settings: re-read the permission.
    LifecycleResumeEffect(Unit) {
        permission = Push.permissionGranted(context)
        onPauseOrDispose {}
    }
    val role = me().role
    val teaches = role in setOf("faculty", "hod")

    fun update(disabled: List<String>? = null, minutes: Int? = null) = save.launch(onError = { Dialogs.alert("Could not save", errMsg(it)) }) {
        Api.updateNotificationPrefs(jsonOf(*listOfNotNull(disabled?.let { "disabled" to it }, minutes?.let { "reminderMinutes" to it }).toTypedArray()))
    }

    Screen {
        Header("Notifications", "Choose what reaches this phone", back = true)
        RowCard(Wide, background = if (permission) C.successSoft else C.warningSoft) {
            androidx.compose.material3.Icon(if (permission) Icons.Rounded.NotificationsActive else Icons.Rounded.NotificationsOff, null, tint = if (permission) C.emeraldText else C.amberText)
            Column(Modifier.weight(1f)) {
                Strong(if (permission) "Notifications are on" else "Notifications are off")
                Small(
                    when {
                        !Push.available(context) -> "Push is not configured in this build — you still see everything under Alerts."
                        permission -> "Urgent alerts can appear on top of other apps; the text stays hidden on the lock screen."
                        else -> "You still see everything under Alerts. Turn them on to be told when the app is closed."
                    }
                )
            }
        }
        if (!permission) {
            Button("Turn on notifications", {
                scope.launch {
                    val granted = Push.permissionRequester?.invoke() == true
                    permission = granted || Push.permissionGranted(context)
                    if (permission) Push.register(context.applicationContext)
                    else runCatching {
                        context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                }
            }, Wide)
        }
        Button("Android notification settings", {
            runCatching { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }, Wide, variant = Variant.Outline)

        val data = q.data
        when {
            data == null && q.error != null -> ErrorState(q.error) { q.refetch() }
            data == null -> Loading()
            else -> {
                val disabled = data["disabled"].strings
                val optional = data["optional"].strings
                Label("What to receive")
                Card(Wide, gap = 4.dp) {
                    CATEGORY_LABELS.filterKeys { it in optional && (teaches || it !in setOf("reminder", "student_entry")) }.forEach { (key, label) ->
                        val on = key !in disabled
                        androidx.compose.foundation.layout.Row(
                            Modifier.semantics { contentDescription = "${label.first}: ${if (on) "on" else "off"}" },
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Strong(label.first)
                                Small(label.second, color = C.muted)
                            }
                            Switch(
                                checked = on,
                                enabled = !save.isLoading,
                                onCheckedChange = { checked -> update(disabled = if (checked) disabled - key else disabled + key) },
                                colors = SwitchDefaults.colors(checkedTrackColor = C.primary),
                            )
                        }
                    }
                }
                if (teaches && "reminder" !in disabled) {
                    Label("Remind me before class")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(5, 10, 15, 20, 30).forEach { m -> Chip("$m min", (data["reminderMinutes"].int ?: 10) == m) { update(minutes = m) } }
                    }
                }
                Small("Emergency alerts, gate-pass decisions, your attendance, substitute classes and exam changes always arrive.", Wide, C.muted)
            }
        }
    }
}
