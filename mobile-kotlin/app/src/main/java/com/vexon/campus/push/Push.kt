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
import com.vexon.campus.core.Http
import com.vexon.campus.core.Http.await
import com.vexon.campus.core.get
import com.vexon.campus.core.jsonOf
import com.vexon.campus.core.parseJson
import com.vexon.campus.core.str
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

/**
 * Push notifications (port of services/push.js). The backend sends through
 * Expo's push service and only accepts Expo push tokens, so — exactly like
 * expo-notifications does internally — the device's FCM token is exchanged for
 * an Expo token at exp.host. Needs app/google-services.json and an EAS project id;
 * without them pushes are simply disabled.
 */
object Push {
    private const val TAG = "VexonPush"
    const val CHANNEL_ID = "default"
    const val EXTRA_LINK = "vexon.link"

    /** Set by MainActivity: asks for POST_NOTIFICATIONS (Android 13+) and resolves with the result. */
    var permissionRequester: (suspend () -> Boolean)? = null

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "JNN", NotificationManager.IMPORTANCE_HIGH).apply {
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 200, 150, 200)
                enableLights(true)
                lightColor = Color.parseColor("#1D6FEB")
            }
        )
    }

    private fun firebaseReady(context: Context): Boolean =
        BuildConfig.PUSH_ENABLED && runCatching { FirebaseApp.getApps(context).isNotEmpty() || FirebaseApp.initializeApp(context) != null }.getOrDefault(false)

    private fun deviceId(context: Context): String {
        val prefs = context.getSharedPreferences("vexon_push", Context.MODE_PRIVATE)
        return prefs.getString("deviceId", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("deviceId", it).apply() }
    }

    /**
     * Ask for permission and return this device's Expo push token, or null when
     * pushes are unavailable (no Firebase config, emulator without Play services,
     * permission denied, no EAS project id).
     */
    suspend fun getPushToken(context: Context, askPermission: Boolean = true): String? {
        ensureChannel(context)
        if (!firebaseReady(context)) return null
        val granted = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED ||
            (askPermission && permissionRequester?.invoke() == true)
        if (!granted) return null
        val projectId = BuildConfig.EAS_PROJECT_ID
        if (projectId.isBlank()) {
            Log.w(TAG, "No EAS projectId configured — push notifications disabled")
            return null
        }
        return try {
            val fcm = FirebaseMessaging.getInstance().token.await()
            val body = jsonOf(
                "type" to "fcm",
                "deviceId" to deviceId(context).lowercase(),
                "development" to false,
                "appId" to context.packageName,
                "deviceToken" to fcm,
                "projectId" to projectId,
            )
            val request = Request.Builder()
                .url("https://exp.host/--/api/v2/push/getExpoPushToken")
                .post(body.toString().toRequestBody("application/json".toMediaType()))
                .build()
            Http.client.newCall(request).await().use { res ->
                val text = withContext(Dispatchers.IO) { res.body?.string().orEmpty() }
                if (!res.isSuccessful) null else parseJson(text)["data"]["expoPushToken"].str
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not get a push token: ${e.message}")
            null
        }
    }

    /** Register this device with the backend's single notification service. */
    suspend fun register(context: Context) {
        val token = getPushToken(context) ?: return
        runCatching { Api.registerPushToken(token) }
    }

    /** Web-style links from notifications map 1:1 onto app routes. */
    fun linkFrom(data: String?): String? = parseJson(data ?: "")["link"].str?.takeIf { it.startsWith("/") }

    fun show(context: Context, title: String?, text: String?, link: String?) {
        ensureChannel(context)
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (link != null) putExtra(EXTRA_LINK, link)
        }
        val pending = PendingIntent.getActivity(context, (link ?: title ?: "").hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(Color.parseColor("#CB0101"))
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            NotificationManagerCompat.from(context).notify(System.currentTimeMillis().toInt(), notification)
        }
    }

    internal val tokenRefreshed = CompletableDeferred<Unit>()
}

/**
 * Receives Expo's FCM messages. Expo sends data messages whose `title` and
 * `message` are the visible text and whose `body` is the JSON `data` (with the
 * web-style `link` the notification opens). Shown as banners while the app is
 * open too, like the Expo handler (`shouldShowBanner: true`).
 */
class VexonMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val title = message.notification?.title ?: data["title"]
        val text = message.notification?.body ?: data["message"]
        Push.show(this, title, text, Push.linkFrom(data["body"]))
    }

    override fun onNewToken(token: String) {
        // The Expo token is derived from the FCM token; it is re-registered on next launch.
    }
}
