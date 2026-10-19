package com.vexon.campus.ui

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.location.Location
import android.net.Uri
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ResolvableApiException
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationSettingsRequest
import com.google.android.gms.location.Priority
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.vexon.campus.core.Fix
import com.vexon.campus.core.FixSampler
import com.vexon.campus.core.GateQr
import com.vexon.campus.core.LocationRead
import com.vexon.campus.core.ReturnLocation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors
import kotlin.coroutines.resume

/* ── data: URI images (server-rendered QR codes) ────────────────── */

@Composable
fun DataImage(dataUri: String?, description: String, modifier: Modifier) {
    val bitmap: ImageBitmap? = remember(dataUri) {
        runCatching {
            val b64 = dataUri!!.substringAfter("base64,", missingDelimiterValue = "")
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size).asImageBitmap()
        }.getOrNull()
    }
    if (bitmap != null) Image(bitmap, description, modifier)
}

/** White rounded frame around a QR image. */
@Composable
fun QrImage(dataUri: String?, description: String) {
    Box(Modifier.clip(RoundedCornerShape(24.dp)).background(Color.White).padding(12.dp)) {
        DataImage(dataUri, description, Modifier.size(220.dp))
    }
}

fun Context.findActivity(): Activity? {
    var c = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}

fun openAppSettings(context: Context) {
    runCatching {
        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

/* ── QR scanner (CameraX + ML Kit) ──────────────────────────────── */

private const val DENIED_RETRY = "Camera permission is required to scan a QR code. Please allow camera access in your device settings and try again."
private const val BLOCKED = "Camera access is disabled for JNN. Please enable camera permission in Android Settings to scan QR codes."

@Composable
private fun Notice(title: String, text: String, content: @Composable () -> Unit = {}) {
    Column(
        Modifier.widthIn(max = 360.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(C.surface).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        H3(title)
        Small(text)
        content()
    }
}

@Composable
private fun Pill(text: String, size: Int = 18, weight: FontWeight = FontWeight.Bold) {
    Text(
        text, Modifier.clip(CircleShape).background(Color(0x99000000)).padding(horizontal = 14.dp, vertical = 6.dp),
        color = Color.White, fontSize = size.sp, fontWeight = weight, fontFamily = Jakarta, textAlign = TextAlign.Center,
    )
}

/**
 * Full-screen in-app QR scanner. Reports the raw scanned value once via
 * [onScanned] — it verifies nothing itself. The caller passes that value to the
 * same backend verification used for a manually typed code.
 */
@Composable
fun QrScanner(open: Boolean, onClose: () -> Unit, onScanned: (String) -> Unit, title: String = "Scan gate pass QR") {
    if (!open) return
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        ScannerBody(onClose, onScanned, title)
    }
}

@Composable
private fun ScannerBody(onClose: () -> Unit, onScanned: (String) -> Unit, title: String) {
    val context = LocalContext.current
    fun granted() = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    var permission by remember { mutableStateOf(if (granted()) "granted" else "undetermined") }
    var scanning by remember { mutableStateOf(true) }
    val gate = remember {
        GateQr.ScanGate { value ->
            scanning = false // stop the preview immediately — one scan, one backend request
            onScanned(value)
        }
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val activity = context.findActivity()
        permission = when {
            ok -> "granted"
            activity != null && !activity.shouldShowRequestPermissionRationale(Manifest.permission.CAMERA) -> "blocked"
            else -> "denied"
        }
    }
    // Ask only now — the user has just tapped "Scan QR code".
    LaunchedEffect(Unit) { if (permission == "undetermined") launcher.launch(Manifest.permission.CAMERA) }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (permission == "granted" && scanning) CameraPreview(onCode = { gate.handle(it) }, onError = { scanning = false })

        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
            when (permission) {
                "granted" -> if (scanning) {
                    Box(Modifier.align(Alignment.TopCenter).padding(top = 80.dp)) { Pill(title) }
                    androidx.compose.foundation.Canvas(Modifier.size(248.dp).semantics { contentDescription = "Scanning area" }) {
                        val l = 44.dp.toPx(); val w = 4.dp.toPx(); val r = CornerRadius(16.dp.toPx())
                        val s = size.width
                        listOf(Offset(0f, 0f), Offset(s - l, 0f), Offset(0f, s - l), Offset(s - l, s - l)).forEach { o ->
                            drawRoundRect(Color.White, o, Size(l, l), r, style = Stroke(w))
                        }
                    }
                    Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp)) { Pill("Align the QR code inside the frame", 14, FontWeight.SemiBold) }
                    Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(bottom = 16.dp)) {
                        Button("Close", onClose, Modifier.fillMaxWidth(), variant = Variant.Outline)
                    }
                } else Notice("Camera unavailable", "The camera could not be started. Close the scanner and try again, or enter the code manually.")
                "blocked" -> Notice("Camera access needed", BLOCKED) { Button("Open settings", { openAppSettings(context) }, Modifier.fillMaxWidth()) }
                "denied" -> Notice("Camera access needed", DENIED_RETRY) { Button("Allow camera", { launcher.launch(Manifest.permission.CAMERA) }, Modifier.fillMaxWidth()) }
            }
        }
        Box(
            Modifier.align(Alignment.TopEnd).padding(top = 44.dp, end = 20.dp).size(48.dp).clip(CircleShape).background(Color(0x8C000000))
                .clickable(onClick = onClose).semantics { contentDescription = "Close scanner" },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Rounded.Close, null, Modifier.size(24.dp), tint = Color.White) }
    }
}

/** Back camera preview bound to the screen's lifecycle (released on close / background) + ML Kit QR analysis. */
@Composable
private fun CameraPreview(onCode: (String) -> Unit, onError: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()) }

    DisposableEffect(lifecycleOwner) {
        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        future.addListener({
            try {
                val p = future.get().also { provider = it }
                val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                analysis.setAnalyzer(executor) { proxy ->
                    @SuppressLint("UnsafeOptInUsageError")
                    val media = proxy.image
                    if (media == null) {
                        proxy.close(); return@setAnalyzer
                    }
                    scanner.process(InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees))
                        .addOnSuccessListener { codes -> codes.firstOrNull { !it.rawValue.isNullOrEmpty() }?.rawValue?.let(onCode) }
                        .addOnCompleteListener { proxy.close() }
                }
                p.unbindAll()
                p.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (e: Exception) {
                onError()
            }
        }, ContextCompat.getMainExecutor(context))
        onDispose {
            provider?.unbindAll()
            scanner.close()
            executor.shutdown()
        }
    }
    AndroidView({ previewView }, Modifier.fillMaxSize())
}

/* ── Location (return-to-campus check) ──────────────────────────── */

/** Monotonic fix time; falls back to the wall-clock fix time when a provider leaves it unset. */
private fun Location.elapsedMs(): Long =
    if (elapsedRealtimeNanos > 0) elapsedRealtimeNanos / 1_000_000
    else SystemClock.elapsedRealtime() - (System.currentTimeMillis() - time)

private fun Location.toFix() = Fix(
    latitude, longitude, if (hasAccuracy()) accuracy else Float.NaN, elapsedMs(),
    if (Build.VERSION.SDK_INT >= 31) isMock else @Suppress("DEPRECATION") isFromMockProvider,
    provider, hasAltitude(),
)

fun hasPreciseLocation(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

fun hasAnyLocation(context: Context) = hasPreciseLocation(context) ||
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

private fun hasPlayServices(context: Context) =
    runCatching { GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS }.getOrDefault(false)

fun isLocationOn(context: Context): Boolean {
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
    return LocationManagerCompat.isLocationEnabled(lm)
}

fun openLocationSettings(context: Context) {
    runCatching { context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        .onFailure { openAppSettings(context) }
}

private fun highAccuracyRequest(sampleMs: Long) =
    LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000)
        .setMinUpdateIntervalMillis(500)
        .setMaxUpdateAgeMillis(0) // never a cached position
        .setDurationMillis(sampleMs + 2_000) // the OS stops it even if we were never called back
        .build()

/**
 * When Play services can fix the device's location settings with its in-app
 * dialog (Location off, or Google Location Accuracy off on phones like Redmi /
 * MIUI that then fall back to slow GPS-only fixes), the request to launch;
 * null when settings are already fine or cannot be fixed in-app.
 */
suspend fun locationSettingsResolution(context: Context): IntentSenderRequest? {
    if (!hasPlayServices(context)) return null
    return try {
        LocationServices.getSettingsClient(context)
            .checkLocationSettings(LocationSettingsRequest.Builder().addLocationRequest(highAccuracyRequest(ReturnLocation.SAMPLE_MS)).setAlwaysShow(true).build())
            .await()
        null
    } catch (e: ResolvableApiException) {
        IntentSenderRequest.Builder(e.resolution).build()
    } catch (e: Exception) {
        null // not resolvable here: reading the location reports what is wrong
    }
}

/**
 * Fresh high-accuracy fixes for up to [sampleMs], keeping the most precise one
 * that is still fresh — never a cached last-known position. Uses Play services'
 * fused provider, or the platform GPS / network providers on devices without
 * it. Every failure is reported as its own [LocationRead]; listening always
 * stops before this returns or when the caller is cancelled.
 */
suspend fun readFreshLocation(
    context: Context,
    sampleMs: Long = ReturnLocation.SAMPLE_MS,
    /** Optional: sees every raw reading (monotonic now) first; returning false drops it. Null = all readings considered. */
    onReading: ((Fix, Long) -> Boolean)? = null,
): LocationRead {
    if (!hasAnyLocation(context)) return LocationRead.PermissionDenied
    if (!isLocationOn(context)) return LocationRead.ServicesOff
    return if (hasPlayServices(context)) fusedRead(context, sampleMs, onReading) else platformRead(context, sampleMs, onReading)
}

/**
 * Runs [start] — which begins listening and returns how to stop — and settles
 * exactly once, on the main thread: when a reading is good enough, when
 * [sampleMs] runs out, on a provider failure, or on cancellation.
 */
private suspend fun listen(
    sampleMs: Long,
    onReading: ((Fix, Long) -> Boolean)?,
    start: (offer: (Location) -> Unit, fail: (LocationRead) -> Unit) -> (() -> Unit),
): LocationRead = withContext(Dispatchers.Main) {
    suspendCancellableCoroutine { cont ->
        val sampler = FixSampler()
        val handler = Handler(Looper.getMainLooper())
        var stop: (() -> Unit)? = null
        var finished = false
        fun finish(failure: LocationRead? = null) {
            if (finished) return
            finished = true
            handler.removeCallbacksAndMessages(null)
            runCatching { stop?.invoke() }
            if (cont.isActive) cont.resume(failure ?: sampler.result(SystemClock.elapsedRealtime()))
        }
        val offer: (Location) -> Unit = { loc ->
            if (!finished) {
                val fix = loc.toFix()
                val now = SystemClock.elapsedRealtime()
                if (onReading?.invoke(fix, now) != false && sampler.offer(fix, now)) finish()
            }
        }
        handler.postDelayed({ finish() }, sampleMs)
        try {
            stop = start(offer) { failure -> handler.post { finish(failure) } }
            if (finished) runCatching { stop?.invoke() } // settled before `stop` was known
        } catch (e: SecurityException) {
            finish(LocationRead.PermissionDenied)
        } catch (e: Exception) {
            finish(LocationRead.Unavailable)
        }
        // Cancellation (screen left) can come from any thread: stop on the main thread.
        cont.invokeOnCancellation { handler.post { finish() } }
    }
}

@SuppressLint("MissingPermission")
private suspend fun fusedRead(context: Context, sampleMs: Long, onReading: ((Fix, Long) -> Boolean)?): LocationRead {
    val client = LocationServices.getFusedLocationProviderClient(context)
    return listen(sampleMs, onReading) { offer, fail ->
        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) = result.locations.forEach(offer)
        }
        client.requestLocationUpdates(highAccuracyRequest(sampleMs), callback, Looper.getMainLooper())
            // The request is asynchronous: its failure arrives here, never as an exception.
            .addOnFailureListener { e -> fail(if (e is SecurityException) LocationRead.PermissionDenied else LocationRead.Unavailable) }
        val stop: () -> Unit = { client.removeLocationUpdates(callback) }
        stop
    }
}

@SuppressLint("MissingPermission")
private suspend fun platformRead(context: Context, sampleMs: Long, onReading: ((Fix, Long) -> Boolean)?): LocationRead {
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return LocationRead.Unavailable
    // GPS needs precise permission; the network provider works with approximate.
    val providers = buildList {
        if (hasPreciseLocation(context) && lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) add(LocationManager.GPS_PROVIDER)
        if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) add(LocationManager.NETWORK_PROVIDER)
    }
    if (providers.isEmpty()) return LocationRead.Unavailable
    return listen(sampleMs, onReading) { offer, _ ->
        // Every method implemented: before Android 11 the platform calls them all and has no defaults.
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) = offer(location)
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
            @Suppress("OVERRIDE_DEPRECATION")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        providers.forEach { lm.requestLocationUpdates(it, 500L, 0f, listener, Looper.getMainLooper()) }
        val stop: () -> Unit = { lm.removeUpdates(listener) }
        stop
    }
}

