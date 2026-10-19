package com.vexon.campus.screens

import android.Manifest
import android.os.Build
import android.util.Log
import com.vexon.campus.BuildConfig
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CenterFocusStrong
import androidx.compose.material.icons.rounded.DirectionsBus
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.ZoomOutMap
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.vexon.campus.core.Api
import com.vexon.campus.core.BusMath
import com.vexon.campus.core.LocationRead
import com.vexon.campus.core.QueryClient
import com.vexon.campus.core.Realtime
import com.vexon.campus.core.bool
import com.vexon.campus.core.dbl
import com.vexon.campus.core.errMsg
import com.vexon.campus.core.get
import com.vexon.campus.core.id
import com.vexon.campus.core.int
import com.vexon.campus.core.list
import com.vexon.campus.core.rememberMutation
import com.vexon.campus.core.str
import com.vexon.campus.core.text
import com.vexon.campus.nav.Route
import com.vexon.campus.transport.BusMapController
import com.vexon.campus.transport.TripLocationService
import com.vexon.campus.ui.Badge
import com.vexon.campus.ui.Button
import com.vexon.campus.ui.C
import com.vexon.campus.ui.Card
import com.vexon.campus.ui.Chip
import com.vexon.campus.ui.Dialogs
import com.vexon.campus.ui.EmptyState
import com.vexon.campus.ui.ErrorState
import com.vexon.campus.ui.Header
import com.vexon.campus.ui.Input
import com.vexon.campus.ui.Label
import com.vexon.campus.ui.Loading
import com.vexon.campus.ui.Small
import com.vexon.campus.ui.Strong
import com.vexon.campus.ui.Tone
import com.vexon.campus.ui.Variant
import com.vexon.campus.ui.openAppSettings
import com.vexon.campus.ui.readFreshLocation
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import org.maplibre.android.MapLibre
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import java.time.Instant

private fun epochMs(v: JsonElement?): Long? = v.str?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

private val TRACKING_LABEL = mapOf(BusMath.Tracking.LIVE to ("Live" to Tone.Success), BusMath.Tracking.STALE to ("Position is old" to Tone.Warning), BusMath.Tracking.OFFLINE to ("Tracking offline" to Tone.Neutral))

/**
 * Live Bus Tracking (Android). Every bus the server lets this account see, at
 * its latest VALID position with its age — never an invented one. Positions
 * stream over the existing socket (re-subscribed after every reconnect).
 * Your own location is read once, only when you tap "My location".
 * Assigned staff can start a trip and share this phone's location while it runs.
 */
@Composable
fun BusTrackingScreen(route: Route) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val cfg = Api.transportConfig()
    val list = Api.buses(pollMs = 60_000)
    val mine = Api.transportMe()
    var selected by rememberSaveable { mutableStateOf(route.q("bus").orEmpty()) }
    var stopId by rememberSaveable { mutableStateOf(route.q("stop").orEmpty()) }
    val effectiveStop = stopId.ifEmpty { mine.data["assignment"]["stop"].id.orEmpty() }
    val detail = Api.bus(selected, effectiveStop.ifEmpty { null }, skip = selected.isEmpty(), pollMs = 30_000)
    val live = remember { mutableStateMapOf<String, JsonElement>() }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var me by remember { mutableStateOf<Me?>(null) }
    val student = me?.pos
    var locating by remember { mutableStateOf(false) }
    var fitBoth by remember { mutableStateOf(false) }
    var locReadings by remember { mutableStateOf<List<BusMath.Reading>>(emptyList()) }
    var showReadings by remember { mutableStateOf(false) }
    var locMessage by remember { mutableStateOf<String?>(null) }
    var controller by remember { mutableStateOf<BusMapController?>(null) }
    var mapError by remember { mutableStateOf<String?>(null) }
    var mapKey by remember { mutableStateOf(0) }
    var query by rememberSaveable { mutableStateOf("") }
    val found = Api.transportSearch(query.trim(), skip = query.trim().isEmpty())
    val liveSeconds = cfg.data["liveSeconds"].int ?: 60
    val staleSeconds = cfg.data["staleSeconds"].int ?: 300

    LaunchedEffect(Unit) { while (true) { delay(10_000); now = System.currentTimeMillis() } }
    // Live positions: subscribe now and again after every reconnect; leave on exit.
    LaunchedEffect(Unit) {
        Realtime.emitWithAck("transport:subscribe", "all")
        var lastDetail = 0L
        Realtime.events.collect { e ->
            when (e.name) {
                "bus:location" -> e.args.firstOrNull()?.let { p ->
                    val id = p["busId"].str ?: return@let
                    live[id] = p
                    if (id == selected && System.currentTimeMillis() - lastDetail > 10_000) {
                        lastDetail = System.currentTimeMillis()
                        detail.refetch()
                    }
                }
                "bus:trip" -> QueryClient.invalidate("Transport")
                "connect" -> Realtime.emitWithAck("transport:subscribe", "all")
            }
        }
    }
    DisposableEffect(Unit) { onDispose { Realtime.emit("transport:unsubscribe", "all") } }

    val buses = list.data["buses"].list
    fun locOf(b: JsonElement): JsonElement? = live[b.id] ?: b["location"].takeIf { it != null && it["lat"] != null }
    fun pos(loc: JsonElement?): BusMath.LatLng? {
        val lat = loc["lat"].dbl ?: return null
        val lng = loc["lng"].dbl ?: return null
        return BusMath.LatLng(lat, lng)
    }
    fun tracking(loc: JsonElement?) = BusMath.freshness(epochMs(loc["at"]), now, liveSeconds, staleSeconds)

    // Feed the map.
    LaunchedEffect(controller, buses, live.toMap(), selected, now) {
        val c = controller ?: return@LaunchedEffect
        c.setBuses(buses.mapNotNull { b ->
            val loc = locOf(b)
            val p = pos(loc) ?: return@mapNotNull null // never place a bus without a real position
            BusMapController.BusView(b.id.orEmpty(), b["number"].str.orEmpty(), b["route"]["name"].text, p.lat, p.lng, tracking(loc), BusMath.reliableHeading(loc["heading"].dbl, loc["speed"].dbl), b.id == selected)
        })
    }
    val d = detail.data
    LaunchedEffect(controller, d, selected) {
        val c = controller ?: return@LaunchedEffect
        val r = if (selected.isEmpty()) null else d["route"]
        val geometry = r["geometry"].list.mapNotNull { pt -> val lng = pt[0].dbl; val lat = pt[1].dbl; if (lat != null && lng != null) BusMath.LatLng(lat, lng) else null }
        val stops = r["stops"].list
        val path = geometry.ifEmpty { stops.mapNotNull { s -> pos(s) } }
        val passed = d["progress"]["passedSequences"].list.mapNotNull { it.int }.toSet()
        val selStop = d["eta"]["stop"].id ?: effectiveStop
        c.setRoute(
            path,
            d["travelled"].list.mapNotNull { pos(it) },
            stops.map { s -> BusMapController.StopView(s.id.orEmpty(), "${s["sequence"].str}. ${s["name"].str}", s["lat"].dbl ?: 0.0, s["lng"].dbl ?: 0.0, s.id == selStop, (s["sequence"].int ?: 0) in passed) },
        )
    }
    LaunchedEffect(controller, me) { controller?.setStudent(me?.pos, me?.accuracy) }
    // First view: all buses (or the route) in frame.
    LaunchedEffect(controller, buses.isNotEmpty()) {
        val c = controller ?: return@LaunchedEffect
        c.fit(buses.mapNotNull { pos(locOf(it)) })
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.any { it }) scope.launch {
            locating = true
            try {
                locate(context, { me = it }, { locMessage = it }, { locReadings = it }) { m ->
                    // Frame the accuracy area (a rough fix stays zoomed out); "Me + bus" frames both.
                    val bus = if (fitBoth) buses.firstOrNull { it.id == selected }?.let { pos(locOf(it)) } else null
                    controller?.fit(if (bus != null) listOf(bus, m.pos) else BusMath.accuracyFrame(m.pos, m.accuracy))
                }
            } finally {
                locating = false
            }
        } else locMessage = "Location permission was denied. You can allow it in Settings to see yourself on the map."
    }
    fun myLocation(both: Boolean = false) {
        if (locating) return
        fitBoth = both
        locMessage = null
        // Asking for FINE again also offers the "approximate → precise" upgrade on Android 12+.
        permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }

    Column(Modifier.fillMaxSize().background(C.bg)) {
        Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { Header("Bus Tracking", "College buses at their latest GPS position", back = true) }
        when {
            cfg.data == null && cfg.error != null -> Box(Modifier.padding(16.dp)) { ErrorState(cfg.error) { cfg.refetch() } }
            cfg.data == null || list.data == null && list.error == null -> Loading()
            list.data == null -> Box(Modifier.padding(16.dp)) { ErrorState(list.error) { list.refetch() } }
            else -> {
                Box(Modifier.fillMaxWidth().weight(0.55f)) {
                    if (mapError != null) {
                        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                            Strong("The map could not be loaded")
                            Small(mapError, color = C.muted)
                            Button("Retry", { mapError = null; mapKey++ }, icon = Icons.Rounded.Refresh, small = true)
                        }
                    } else {
                        androidx.compose.runtime.key(mapKey) {
                            BusMapView(cfg.data["mapStyleUrl"].str.orEmpty(), { controller = it }, { mapError = it }, { id -> selected = id; stopId = "" }, { id -> stopId = id })
                        }
                    }
                    Row(Modifier.align(Alignment.BottomStart).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Button(if (locating) "Finding you…" else "My location", { myLocation() }, variant = Variant.Soft, icon = Icons.Rounded.MyLocation, small = true, loading = locating)
                        me?.takeIf { !locating }?.let { m ->
                            Badge("You: ${BusMath.accuracyText(m.accuracy)}", if (m.accuracy > BusMath.COARSE_FIX_M) Tone.Warning else Tone.Neutral, Modifier.align(Alignment.CenterVertically))
                        }
                        if (selected.isNotEmpty()) {
                            val bp = buses.firstOrNull { it.id == selected }?.let { pos(locOf(it)) }
                            Button("Bus", { controller?.fit(listOfNotNull(bp)) }, variant = Variant.Soft, icon = Icons.Rounded.CenterFocusStrong, small = true)
                            Button("Me + bus", { if (student == null) myLocation(both = true) else controller?.fit(listOfNotNull(bp, student)) }, variant = Variant.Soft, icon = Icons.Rounded.ZoomOutMap, small = true)
                        }
                    }
                }
                Column(Modifier.fillMaxWidth().weight(0.45f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (!Realtime.connected) Small("Live updates paused — reconnecting. Positions refresh when you are back online.", color = C.amberText)
                    locMessage?.let { msg ->
                        Small(msg, color = if (msg.startsWith("Location found")) C.muted else C.amberText)
                        when {
                            msg == APPROXIMATE_ONLY -> Button("Use precise location", { myLocation() }, variant = Variant.Outline, small = true)
                            !msg.startsWith("Location found") && !msg.contains("Settings") && !locating -> Button("Try again", { myLocation(fitBoth) }, variant = Variant.Outline, small = true)
                            msg.contains("Settings") -> Button("Open Settings", { openAppSettings(context) }, variant = Variant.Outline, small = true)
                        }
                    }
                    if (locReadings.isNotEmpty()) {
                        Small(
                            if (showReadings) "Hide location details" else "Location details (what your phone reported)",
                            color = C.muted,
                            modifier = Modifier.heightIn(min = 48.dp).clickable { showReadings = !showReadings }.padding(vertical = 12.dp),
                        )
                        if (showReadings) {
                            Small("Shown only to you — not sent to the server.", color = C.muted)
                            locReadings.forEach { r -> Small(BusMath.readingText(r), color = C.muted) }
                        }
                    }
                    TripSharing(mine)
                    Input(query, { query = it }, label = "Find a bus, route or stop")
                    if (query.isNotBlank()) SearchResults(found.data, buses) { busId, stop -> selected = busId; stopId = stop.orEmpty(); query = "" }
                    val sel = buses.firstOrNull { it.id == selected }
                    if (sel != null) BusDetail(sel, locOf(sel), d, tracking(locOf(sel)), now, effectiveStop, { stopId = it }, { selected = ""; stopId = "" })
                    else BusList(buses, ::locOf, ::tracking, now, { selected = it; stopId = "" }, { list.refetch() }, mine)
                }
            }
        }
    }
}

/** The viewer's own position and how accurate the phone says it is. */
private data class Me(val pos: BusMath.LatLng, val accuracy: Float)

/**
 * Read the phone's position accurately: fresh readings only (never a cached
 * last-known one), listening up to 20 s for the GPS to lock and stopping as
 * soon as a fix is within 20 m; mock locations are refused. The result is shown
 * with its real accuracy, and a rough estimate is called one.
 */
private suspend fun locate(
    context: android.content.Context,
    set: (Me?) -> Unit,
    message: (String) -> Unit,
    readings: (List<BusMath.Reading>) -> Unit,
    fit: (Me) -> Unit,
) {
    set(null) // the previous position is not "now" any more
    val seen = ArrayList<BusMath.Reading>()
    readings(emptyList())
    val precise = com.vexon.campus.ui.hasPreciseLocation(context)
    if (BuildConfig.DEBUG) Log.d(LOC_TAG, "requesting a fresh high-accuracy position (precise permission: $precise)")
    val r = readFreshLocation(context, com.vexon.campus.core.ReturnLocation.SAMPLE_MS) { fix, now ->
        // Every raw reading is recorded (and logged in debug builds); invalid ones are dropped
        // before the sampler, so a bad reading can neither be chosen nor end listening early.
        val rd = BusMath.reading(fix, now)
        seen += rd
        if (seen.size > 10) seen.removeAt(0)
        readings(seen.toList())
        if (BuildConfig.DEBUG) Log.d(LOC_TAG, "reading lat=${fix.latitude} lng=${fix.longitude} acc=${fix.accuracy}m age=${rd.ageMs}ms provider=${fix.provider} altitude=${fix.hasAltitude} mocked=${fix.mocked} → ${rd.verdict} (${rd.source})")
        rd.verdict != "invalid"
    }
    val state = BusMath.myLocationState(r, precise)
    if (BuildConfig.DEBUG) Log.d(LOC_TAG, "result $r → $state")
    message(BusMath.myLocationMessage(r, precise))
    if (r is LocationRead.Ok && (state == BusMath.MyLocation.AVAILABLE || state == BusMath.MyLocation.APPROXIMATE)) {
        val me = Me(BusMath.LatLng(r.fix.latitude, r.fix.longitude), r.fix.accuracy)
        set(me)
        fit(me)
    }
}

private const val APPROXIMATE_ONLY = BusMath.APPROXIMATE_PERMISSION
private const val LOC_TAG = "VexonMyLocation"

/** MapLibre MapView with its lifecycle tied to the screen; no work continues after leaving. */
@Composable
private fun BusMapView(styleUrl: String, onReady: (BusMapController) -> Unit, onError: (String) -> Unit, onBus: (String) -> Unit, onStop: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val mapView = remember {
        MapLibre.getInstance(context)
        MapView(context).apply { onCreate(null) }
    }
    var controller by remember { mutableStateOf<BusMapController?>(null) }
    DisposableEffect(lifecycle, mapView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        mapView.addOnDidFailLoadingMapListener { msg -> onError(msg ?: "The map style could not be loaded") }
        mapView.getMapAsync { map ->
            map.uiSettings.isRotateGesturesEnabled = false
            map.uiSettings.isTiltGesturesEnabled = false
            map.setStyle(Style.Builder().fromUri(styleUrl)) { style ->
                val c = BusMapController(context, map, style, onBus, onStop)
                controller = c
                onReady(c)
            }
        }
        onDispose {
            lifecycle.removeObserver(observer)
            controller?.dispose()
            mapView.onPause()
            mapView.onStop()
            mapView.onDestroy()
        }
    }
    AndroidView(factory = { mapView }, modifier = Modifier.fillMaxSize().semantics { contentDescription = "Live bus map" })
}

@Composable
private fun SearchResults(data: JsonElement?, buses: List<JsonElement>, pick: (String, String?) -> Unit) {
    if (data == null) return
    Card(Modifier.fillMaxWidth(), gap = 4.dp) {
        data["buses"].list.forEach { b -> Small("🚌 ${b["number"].str} · ${b["route"]["name"].text ?: "No route"}", Modifier.fillMaxWidth().clickable { pick(b.id.orEmpty(), null) }.padding(6.dp)) }
        data["routes"].list.forEach { r ->
            val bus = buses.firstOrNull { it["route"].id == r.id }
            Small("Route ${r["name"].str}${if (bus != null) " · ${bus["number"].str}" else " · no bus assigned"}", Modifier.fillMaxWidth().clickable(enabled = bus != null) { pick(bus?.id.orEmpty(), null) }.padding(6.dp))
        }
        data["stops"].list.forEach { s ->
            val bus = buses.firstOrNull { it["route"].id == s["routeId"].str }
            Small("Stop ${s["name"].str} · ${s["routeName"].str}", Modifier.fillMaxWidth().clickable(enabled = bus != null) { pick(bus?.id.orEmpty(), s["stopId"].str) }.padding(6.dp))
        }
        if (data["buses"].list.isEmpty() && data["routes"].list.isEmpty() && data["stops"].list.isEmpty()) Small("Nothing matches.", color = C.muted)
    }
}

@Composable
private fun BusList(buses: List<JsonElement>, locOf: (JsonElement) -> JsonElement?, tracking: (JsonElement?) -> BusMath.Tracking, now: Long, select: (String) -> Unit, refresh: () -> Unit, mine: com.vexon.campus.core.Query) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Label("Buses (${buses.size})", Modifier.weight(1f))
        Button("Refresh", refresh, variant = Variant.Soft, icon = Icons.Rounded.Refresh, small = true)
    }
    if (buses.isEmpty()) Card(Modifier.fillMaxWidth()) { EmptyState(Icons.Rounded.DirectionsBus, "No buses to show", "No college buses are available to you yet.") }
    buses.forEach { b ->
        val loc = locOf(b)
        val (label, tone) = TRACKING_LABEL.getValue(tracking(loc))
        Card(Modifier.fillMaxWidth(), onClick = { select(b.id.orEmpty()) }) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Strong(b["number"].str)
                    Small("${b["route"]["name"].text ?: "No route"} · ${BusMath.agoText(epochMs(loc["at"]), now)}", color = C.muted)
                }
                Badge(label, tone)
            }
        }
    }
    mine.data["assignment"]["route"]["name"].text?.let { r -> Small("Your route: $r${mine.data["assignment"]["stop"]["name"].text?.let { " · your stop: $it" } ?: ""}", color = C.muted) }
}

@Composable
private fun BusDetail(bus: JsonElement, loc: JsonElement?, d: JsonElement?, tracking: BusMath.Tracking, now: Long, stopId: String, pickStop: (String) -> Unit, back: () -> Unit) {
    val (label, tone) = TRACKING_LABEL.getValue(tracking)
    val eta = d["eta"]
    Card(Modifier.fillMaxWidth(), gap = 8.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Strong(bus["number"].str)
                Small(bus["route"]["name"].text ?: "No route assigned", color = C.muted)
            }
            Badge(label, tone)
        }
        Small("Last GPS update: ${BusMath.agoText(epochMs(loc["at"]), now)}")
        val speed = loc["speed"].dbl
        if (tracking == BusMath.Tracking.LIVE && speed != null) Small("Speed: ${(speed * 3.6).toInt()} km/h")
        eta["nextStop"]["name"].text?.let { Small("Next stop: $it") }
        Box(Modifier.fillMaxWidth().background(if (eta["status"].str == "ok") C.successSoft else C.glass(0.5f)).padding(10.dp)) {
            Column {
                Small("ETA to ${eta["stop"]["name"].text ?: if (stopId.isNotEmpty()) "the selected stop" else "the next stop"}", color = C.muted)
                Strong(BusMath.etaText(eta["status"].str == "ok", eta["minutes"].int, eta["confidence"].str, eta["reason"].str))
                if (eta["status"].str == "ok") Small(
                    "${if (eta["method"].str == "schedule") "From the timetable" else "From recent speed"} · ${eta["confidence"].str} confidence" +
                        if (eta["approximateRoute"].bool) " · approximate road distance" else "",
                    color = C.muted,
                )
            }
        }
        if (tracking != BusMath.Tracking.LIVE && loc != null) Small("Shown where it was last reported — it may have moved.", color = C.amberText)
        val passed = d["progress"]["passedSequences"].list.mapNotNull { it.int }.toSet()
        val selStop = eta["stop"].id ?: stopId
        if (d["route"]["stops"].list.isNotEmpty()) {
            Label("Stops")
            d["route"]["stops"].list.forEach { s ->
                val seq = s["sequence"].int ?: 0
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable { pickStop(s.id.orEmpty()) }.padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Badge("$seq", if (seq in passed) Tone.Neutral else Tone.Primary)
                    Small(s["name"].str, Modifier.weight(1f), color = if (s.id == selStop) C.primary else if (seq in passed) C.muted else androidx.compose.ui.graphics.Color.Unspecified)
                    s["scheduledTime"].text?.let { Small(it, color = C.muted) }
                }
            }
        }
        Button("Show all buses", back, variant = Variant.Outline, small = true)
    }
}

/**
 * Trip sharing for staff assigned to a bus. Starting needs location permission
 * (while in use) and shows a persistent notification for the whole trip;
 * sharing stops when the trip ends here, from the notification, or on the server.
 */
@Composable
private fun TripSharing(mine: com.vexon.campus.core.Query) {
    val context = LocalContext.current
    val shareable = mine.data["shareable"].list.filter { it["gpsSource"].str == "phone" }
    val active = mine.data["activeTrip"]
    val sharing by TripLocationService.state.collectAsState()
    val save = rememberMutation()
    var pending by remember { mutableStateOf<JsonElement?>(null) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val bus = pending ?: return@rememberLauncherForActivityResult
        pending = null
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] != true) {
            Dialogs.alert("Precise location needed", "Bus sharing needs precise location while the trip runs. Allow it in Settings to share this bus.")
            return@rememberLauncherForActivityResult
        }
        save.launch(onError = { Dialogs.alert("Could not start the trip", errMsg(it)) }) {
            val res = Api.startBusTrip(bus.id.orEmpty())
            TripLocationService.start(context, res["trip"].id.orEmpty(), bus["number"].str.orEmpty())
        }
    }
    if (shareable.isEmpty() && active == null && sharing == null) return
    Card(Modifier.fillMaxWidth(), gap = 8.dp, background = if (sharing != null) C.successSoft else C.card) {
        Strong(if (sharing != null) "Sharing location for ${sharing?.busNumber}" else "Share a bus’s location")
        when {
            sharing != null -> {
                Small(sharing?.problem ?: sharing?.lastSentAt?.let { "Last sent ${BusMath.agoText(it, System.currentTimeMillis())}" } ?: "Waiting for the first GPS fix…")
                Button("End trip", {
                    val id = sharing?.tripId ?: return@Button
                    save.launch(onError = { Dialogs.alert("Could not end the trip", errMsg(it)) }) {
                        runCatching { Api.stopBusTrip(id) }
                        TripLocationService.stop(context)
                    }
                }, variant = Variant.Danger, small = true, loading = save.isLoading)
            }
            active != null -> {
                Small("A trip for ${active["bus"]["number"].str} is open but this phone is not sharing (the app was closed).", color = C.amberText)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button("Resume sharing", {
                        pending = null
                        TripLocationService.start(context, active.id.orEmpty(), active["bus"]["number"].str.orEmpty())
                    }, small = true)
                    Button("End trip", { save.launch(onError = { Dialogs.alert("Could not end the trip", errMsg(it)) }) { Api.stopBusTrip(active.id.orEmpty()) } }, variant = Variant.Outline, small = true, loading = save.isLoading)
                }
            }
            else -> {
                Small("Only during a trip you start. Stops when you end the trip.", color = C.muted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    shareable.forEach { b ->
                        Chip("Start ${b["number"].str}", false) {
                            pending = b
                            val perms = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                            if (Build.VERSION.SDK_INT >= 33) perms += Manifest.permission.POST_NOTIFICATIONS
                            permission.launch(perms.toTypedArray())
                        }
                    }
                }
            }
        }
    }
}
