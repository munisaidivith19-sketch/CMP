package com.vexon.campus.transport

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.vexon.campus.MainActivity
import com.vexon.campus.R
import com.vexon.campus.core.ApiException
import com.vexon.campus.core.Http
import com.vexon.campus.core.QueryClient
import com.vexon.campus.core.get
import com.vexon.campus.core.oid
import com.vexon.campus.core.str
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Shares this phone's location for ONE active bus trip the user started —
 * nothing before the trip, nothing after it.
 *
 * - Runs as a foreground service (type "location") with a persistent
 *   notification and a Stop action, started from the Bus Tracking screen
 *   while the app is open — so only "while in use" location permission is
 *   needed, never background location.
 * - Sends batched fixes every ~5 s; keeps at most 20 while offline. The server
 *   validates every fix (accuracy, age, plausibility) and owns the trip.
 * - Stops itself when the server says the trip is no longer active (ended,
 *   stopped by a manager, or timed out), when access is refused, or when the
 *   location permission is revoked. Mock locations are never sent.
 */
class TripLocationService : Service() {
    data class State(val tripId: String, val busNumber: String, val lastSentAt: Long? = null, val problem: String? = null)

    companion object {
        private const val EXTRA_TRIP = "tripId"
        private const val EXTRA_BUS = "busNumber"
        private const val ACTION_STOP = "com.vexon.campus.transport.STOP_SHARING"
        private const val CHANNEL = "trip_sharing"
        private const val NOTIFICATION_ID = 4711
        private const val SEND_EVERY_MS = 5_000L
        private const val MAX_BUFFER = 20

        /** The tracking-active indicator the screen shows (null = not sharing). */
        val state = MutableStateFlow<State?>(null)

        fun start(context: Context, tripId: String, busNumber: String) {
            val intent = Intent(context, TripLocationService::class.java).putExtra(EXTRA_TRIP, tripId).putExtra(EXTRA_BUS, busNumber)
            ContextCompat.startForegroundService(context, intent)
        }

        /** Stop sharing on this phone (the screen ends the trip on the server first). */
        fun stop(context: Context) {
            context.stopService(Intent(context, TripLocationService::class.java))
            state.value = null
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val buffer = ArrayDeque<Map<String, Any?>>()
    private var tripId: String? = null
    private var callback: LocationCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            val id = tripId
            scope.launch {
                if (id != null) runCatching { Http.request("POST", "/transport/trips/${oid(id)}/stop", body = mapOf("reason" to "completed")) }
                QueryClient.invalidate("Transport")
                shutdown()
            }
            return START_NOT_STICKY
        }
        val id = intent?.getStringExtra(EXTRA_TRIP) ?: return START_NOT_STICKY.also { stopSelf() }
        val bus = intent.getStringExtra(EXTRA_BUS) ?: "bus"
        tripId = id
        ensureChannel()
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(bus), if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
        } catch (e: Exception) {
            // Not allowed now (e.g. permission revoked): never share without the visible notice.
            shutdown()
            return START_NOT_STICKY
        }
        state.value = State(id, bus)
        startUpdates()
        scope.launch { sendLoop(id) }
        // Not restarted by the system after being killed: sharing always begins from the screen.
        return START_NOT_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun startUpdates() {
        val client = LocationServices.getFusedLocationProviderClient(this)
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, SEND_EVERY_MS).setMinUpdateIntervalMillis(3_000).build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) = result.locations.forEach(::offer)
        }
        callback = cb
        try {
            client.requestLocationUpdates(request, cb, Looper.getMainLooper())
                .addOnFailureListener { problem("Location is unavailable") }
        } catch (e: SecurityException) {
            problem("Location permission was revoked — sharing stopped")
            shutdown()
        }
    }

    private fun offer(loc: Location) {
        val mocked = if (Build.VERSION.SDK_INT >= 31) loc.isMock else @Suppress("DEPRECATION") loc.isFromMockProvider
        if (mocked) return
        buffer.addLast(
            mapOf(
                "lat" to loc.latitude,
                "lng" to loc.longitude,
                "timestamp" to loc.time,
                "accuracy" to loc.accuracy.toDouble(),
                "speed" to if (loc.hasSpeed()) loc.speed.toDouble() else null,
                "heading" to if (loc.hasBearing()) loc.bearing.toDouble() else null,
            )
        )
        while (buffer.size > MAX_BUFFER) buffer.removeFirst()
    }

    private suspend fun sendLoop(id: String) {
        while (scope.isActive) {
            delay(SEND_EVERY_MS)
            if (buffer.isEmpty()) continue
            val batch = buffer.toList()
            try {
                Http.request("POST", "/transport/trips/${oid(id)}/locations", body = mapOf("fixes" to batch))
                repeat(batch.size) { if (buffer.isNotEmpty()) buffer.removeFirst() }
                state.value = state.value?.copy(lastSentAt = System.currentTimeMillis(), problem = null)
            } catch (e: ApiException) {
                when {
                    e.isNetwork -> problem("No network — will send when back online")
                    // The trip ended (completed, stopped by a manager, timed out) or access was removed.
                    e.status in listOf(403, 404, 409) -> {
                        problem(e.data["message"].str ?: "The trip has ended")
                        QueryClient.invalidate("Transport")
                        shutdown()
                        return
                    }
                    else -> {
                        buffer.clear() // the server rejected these fixes; do not resend them
                        problem(e.data["message"].str ?: "A location update was rejected")
                    }
                }
            }
        }
    }

    private fun problem(text: String) {
        state.value = state.value?.copy(problem = text)
    }

    private fun shutdown() {
        callback?.let { runCatching { LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(it) } }
        callback = null
        state.value = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        callback?.let { runCatching { LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(it) } }
        callback = null
        state.value = null
        scope.cancel()
        super.onDestroy()
    }

    private fun ensureChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Bus trip sharing", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while this phone shares a bus's location"
            })
        }
    }

    private fun notification(bus: String): Notification {
        val open = PendingIntent.getActivity(
            this, 1,
            com.vexon.campus.push.Push.appIntent(this, "/transport").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(this, 2, Intent(this, TripLocationService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Sharing location for bus $bus")
            .setContentText("Only during this trip. Tap Stop when the trip ends.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(open)
            .addAction(0, "Stop trip", stop)
            .build()
    }
}
