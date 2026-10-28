package com.vexon.campus.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.vexon.campus.BuildConfig
import com.vexon.campus.MainActivity
import com.vexon.campus.R
import com.vexon.campus.core.Api
import com.vexon.campus.core.ApiPath
import com.vexon.campus.core.Auth
import com.vexon.campus.core.QueryClient
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * Android push over Firebase Cloud Messaging.
 *
 * The device's FCM token is registered with the backend (POST /devices) for
 * the signed-in account and session; the backend sends data-only messages
 * through FCM HTTP v1 with its own service-account credentials (never shipped
 * in this app). Needs app/google-services.json at build time; without it push
 * is simply off and the app works normally (in-app notifications and live
 * updates are unaffected).
 *
 * Presentation:
 *  - one channel per kind of notification, so the user can tune each in
 *    Android settings; every channel pops up (heads-up) by default;
 *  - the text is hidden on the lock screen (VISIBILITY_PRIVATE with a neutral
 *    public version) — student names, chat text etc. never show there;
 *  - while the app is open, only urgent categories raise a system
 *    notification: the rest pop up in-app (ui/InAppBanner.kt) from the live socket.
 */
object Push {
    private const val TAG = "VexonPush"
    const val EXTRA_LINK = "vexon.link"
    const val EXTRA_NOTIFICATION_ID = "vexon.notificationId"

    /** Set by MainActivity: asks for POST_NOTIFICATIONS (Android 13+), re-checks NotificationGate, resolves with the result. */
    var permissionRequester: (suspend () -> Boolean)? = null

    /** True while an app screen is visible (kept by VexonApp's process lifecycle observer). */
    @Volatile var foreground: Boolean = false

    private data class Channel(val id: String, val name: String, val importance: Int, val description: String)

    private val CHANNELS = listOf(
        Channel("alerts", "Urgent alerts", NotificationManager.IMPORTANCE_HIGH, "Emergencies and gate-pass decisions"),
        Channel("classes", "Classes & reminders", NotificationManager.IMPORTANCE_HIGH, "Next-period reminders and substitute classes"),
        // "_popup": Android fixes a channel's importance once created, so the
        // heads-up versions of the old (silent) "messages" / "updates" need new ids.
        Channel("messages_popup", "Messages", NotificationManager.IMPORTANCE_HIGH, "New chat messages"),
        Channel("updates_popup", "Updates", NotificationManager.IMPORTANCE_HIGH, "Attendance, timetable, exams, events and announcements"),
    )
    private val LEGACY_CHANNELS = listOf("messages", "updates")

    /** Server category → channel. */
    fun channelFor(category: String?): String = when (category) {
        "sos", "gate_pass" -> "alerts"
        "reminder", "substitute" -> "classes"
        "chat" -> "messages_popup"
        else -> "updates_popup"
    }

    private val URGENT = setOf("sos", "gate_pass", "reminder", "substitute")

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        LEGACY_CHANNELS.forEach { if (manager.getNotificationChannel(it) != null) manager.deleteNotificationChannel(it) }
        for (c in CHANNELS) {
            if (manager.getNotificationChannel(c.id) != null) continue
            manager.createNotificationChannel(
                NotificationChannel(c.id, c.name, c.importance).apply {
                    description = c.description
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
                    if (c.importance >= NotificationManager.IMPORTANCE_HIGH) {
                        enableVibration(true)
                        vibrationPattern = longArrayOf(0, 200, 150, 200)
                    }
                }
            )
        }
    }

    private fun firebaseReady(context: Context): Boolean =
        BuildConfig.PUSH_ENABLED && runCatching { FirebaseApp.getApps(context).isNotEmpty() || FirebaseApp.initializeApp(context) != null }.getOrDefault(false)

    fun permissionGranted(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Whether push can work at all in this build (Firebase configured). */
    fun available(context: Context): Boolean = firebaseReady(context)

    /**
     * This device's FCM token, or null when push is unavailable (no Firebase
     * config, no Play services) or the user declined the permission. Declining
     * never breaks the app — it simply works without push.
     */
    suspend fun getPushToken(context: Context, askPermission: Boolean = true): String? {
        ensureChannels(context)
        if (!firebaseReady(context)) return null
        val granted = permissionGranted(context) || (askPermission && permissionRequester?.invoke() == true)
        if (!granted) return null
        return try {
            FirebaseMessaging.getInstance().token.await()
        } catch (e: Exception) {
            Log.w(TAG, "Could not get an FCM token")
            null
        }
    }

    /**
     * Register this device with the backend for the signed-in account. Never
     * shows the system dialog: NotificationGate explains and asks first.
     */
    suspend fun register(context: Context) {
        val token = getPushToken(context, askPermission = false) ?: return
        runCatching { Api.registerDevice(token) }
    }

    /** FCM rotated the token: re-register it if someone is signed in. */
    fun onTokenRefreshed(token: String) {
        if (Auth.user == null) return
        QueryClient.scope.launch { runCatching { Api.registerDevice(token) } }
    }

    // Screens a notification may open; anything else opens the notification list.
    private val ALLOWED = listOf(
        "/attendance", "/gate-pass", "/chat", "/announcements", "/events", "/timetable", "/exams", "/notifications",
        "/sos", "/holidays", "/complaints", "/lost-found", "/discussions", "/clubs", "/achievements", "/alumni", "/od-leave",
        "/transport", "/skill-wallet",
    )

    /** A safe in-app route for a notification link (protected screens re-check access when they load). */
    fun safeLink(link: String?): String {
        val l = link?.trim().orEmpty()
        if (!l.startsWith("/") || l.startsWith("//") || l.contains("..")) return "/notifications"
        return if (ALLOWED.any { l == it || l.startsWith("$it/") || l.startsWith("$it?") }) l else "/notifications"
    }

    /**
     * The intent the app's own (immutable) PendingIntents open MainActivity
     * with: a safe link, a valid notification id, and this install's nonce —
     * MainActivity ignores link / notificationId extras without it.
     */
    fun appIntent(context: Context, link: String, notificationId: String? = null): Intent =
        Intent(context, MainActivity::class.java).apply {
            putExtra(EXTRA_LINK, safeLink(link))
            notificationId?.takeIf { ApiPath.isObjectId(it) }?.let { putExtra(EXTRA_NOTIFICATION_ID, it) }
            putExtra(IntentNonce.EXTRA, IntentNonce.get(context))
        }

    /** The link / notification id extras of `intent`, only when it came from the app itself. */
    fun trustedExtras(intent: Intent?, nonce: String): Pair<String?, String?> {
        if (intent == null || !IntentNonce.matches(nonce, intent.getStringExtra(IntentNonce.EXTRA))) return null to null
        return intent.getStringExtra(EXTRA_LINK) to intent.getStringExtra(EXTRA_NOTIFICATION_ID)?.takeIf { ApiPath.isObjectId(it) }
    }

    fun show(context: Context, title: String?, text: String?, link: String?, category: String? = null, notificationId: String? = null) {
        ensureChannels(context)
        if (!permissionGranted(context)) return
        val urgent = category in URGENT
        // In the open app the live socket already shows it; only urgent ones also pop up.
        if (foreground && !urgent) return
        val target = safeLink(link)
        val intent = appIntent(context, target, notificationId).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(context, (notificationId ?: target + title).hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val channel = channelFor(category)
        // What the lock screen shows instead of the real text.
        val public = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("VEXON")
            .setContentText("New notification")
            .build()
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(Color.parseColor("#CB0101"))
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            // Pre-Android 8 heads-up comes from the priority (8+ from the channel).
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setCategory(if (category == "chat") NotificationCompat.CATEGORY_MESSAGE else if (category == "reminder") NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(public)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify((notificationId ?: "$title|$text").hashCode(), notification) }
    }
}

/**
 * Receives the backend's FCM data messages (title, body, link, category,
 * notificationId), in the foreground and in the background alike.
 */
class VexonMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val title = data["title"] ?: message.notification?.title
        val text = data["body"] ?: data["message"] ?: message.notification?.body
        Push.show(this, title, text, data["link"], data["category"], data["notificationId"])
    }

    override fun onNewToken(token: String) {
        Push.onTokenRefreshed(token)
    }
}
