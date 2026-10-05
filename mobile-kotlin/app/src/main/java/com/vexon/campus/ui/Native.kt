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
import android.os.Build
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
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
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.vexon.campus.core.GateQr
import kotlinx.coroutines.suspendCancellableCoroutine
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
        Modifier.widthIn(max = 360.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Color.White).padding(20.dp),
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

data class Fix(val latitude: Double, val longitude: Double, val accuracy: Float, val timestamp: Long, val mocked: Boolean)

private fun Location.toFix() = Fix(
    latitude, longitude, if (hasAccuracy()) accuracy else 9999f, time,
    if (Build.VERSION.SDK_INT >= 31) isMock else @Suppress("DEPRECATION") isFromMockProvider,
)

/**
 * Fresh high-accuracy fixes for a few seconds, keeping the most precise one —
 * never a cached last-known position. Stops listening as soon as it returns.
 */
@SuppressLint("MissingPermission")
suspend fun bestFreshFix(context: Context, sampleMs: Long = 12_000, goodEnoughM: Float = 20f): Fix? {
    val client = LocationServices.getFusedLocationProviderClient(context)
    return suspendCancellableCoroutine { cont ->
        var best: Fix? = null
        var finished = false
        lateinit var callback: LocationCallback
        val handler = android.os.Handler(Looper.getMainLooper())
        fun finish() {
            if (finished) return
            finished = true
            client.removeLocationUpdates(callback)
            handler.removeCallbacksAndMessages(null)
            if (cont.isActive) cont.resume(best)
        }
        callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.locations.forEach { loc ->
                    val fix = loc.toFix()
                    if (fix.accuracy < (best?.accuracy ?: Float.POSITIVE_INFINITY)) best = fix
                    if (fix.accuracy <= goodEnoughM) finish()
                }
            }
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000).setMinUpdateIntervalMillis(500).setMaxUpdateAgeMillis(0).build()
        try {
            client.requestLocationUpdates(request, callback, Looper.getMainLooper())
            handler.postDelayed({ finish() }, sampleMs)
        } catch (e: Exception) {
            finished = true
            if (cont.isActive) cont.resume(null)
        }
        cont.invokeOnCancellation { if (!finished) { finished = true; client.removeLocationUpdates(callback); handler.removeCallbacksAndMessages(null) } }
    }
}

