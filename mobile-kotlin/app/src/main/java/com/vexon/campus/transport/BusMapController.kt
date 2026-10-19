package com.vexon.campus.transport

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.graphics.PointF
import android.view.animation.DecelerateInterpolator
import com.vexon.campus.core.BusMath
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.geojson.Polygon
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

/**
 * Draws the live bus map on a MapLibre map. One GeoJSON source holds every
 * bus; a symbol layer shows each as the BUS icon (coloured by tracking state,
 * rotated only with a reliable heading) with "number / route" above it. Bus
 * positions glide between valid fixes with a single shared animator; nothing
 * is re-created per update. The student's position is a separate blue dot.
 */
class BusMapController(
    context: Context,
    private val map: MapLibreMap,
    private val style: Style,
    private val onBus: (String) -> Unit,
    private val onStop: (String) -> Unit,
) {
    data class BusView(val id: String, val number: String, val route: String?, val lat: Double, val lng: Double, val tracking: BusMath.Tracking, val heading: Double?, val selected: Boolean)

    private class Moving(var from: BusMath.LatLng, var to: BusMath.LatLng, var pos: BusMath.LatLng)

    private val positions = HashMap<String, Moving>()
    private val rotation = HashMap<String, Double>()
    private var views: List<BusView> = emptyList()
    private val animator = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 1000
        interpolator = DecelerateInterpolator()
        addUpdateListener { a ->
            val t = (a.animatedValue as Float).toDouble()
            positions.values.forEach { m -> m.pos = BusMath.lerp(m.from, m.to, t) }
            render()
        }
    }

    init {
        val px = (40 * context.resources.displayMetrics.density).toInt()
        style.addImage("bus-live", BusIcon.bitmap(BusIcon.LIVE, px))
        style.addImage("bus-stale", BusIcon.bitmap(BusIcon.STALE, px))
        style.addImage("bus-offline", BusIcon.bitmap(BusIcon.OFFLINE, px))
        listOf("me-accuracy", "route-remaining", "route-travelled", "stops", "buses", "me").forEach { style.addSource(GeoJsonSource(it, FeatureCollection.fromFeatures(emptyList()))) }
        // The area the viewer's position is accurate to.
        style.addLayer(FillLayer("me-accuracy", "me-accuracy").withProperties(
            PropertyFactory.fillColor(Color.parseColor("#2563EB")), PropertyFactory.fillOpacity(0.12f), PropertyFactory.fillOutlineColor(Color.parseColor("#2563EB")),
        ))
        style.addLayer(LineLayer("route-travelled", "route-travelled").withProperties(
            PropertyFactory.lineColor(Color.parseColor("#94A3B8")), PropertyFactory.lineWidth(4f), PropertyFactory.lineDasharray(arrayOf(1.5f, 1.5f)),
        ))
        style.addLayer(LineLayer("route-remaining", "route-remaining").withProperties(
            PropertyFactory.lineColor(Color.parseColor("#6C5DD3")), PropertyFactory.lineWidth(5f), PropertyFactory.lineOpacity(0.85f),
            PropertyFactory.lineCap(Property.LINE_CAP_ROUND), PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
        ))
        style.addLayer(CircleLayer("stops", "stops").withProperties(
            PropertyFactory.circleRadius(Expression.switchCase(Expression.get("selected"), Expression.literal(9f), Expression.literal(6f))),
            PropertyFactory.circleColor(Expression.switchCase(
                Expression.get("selected"), Expression.color(Color.parseColor("#CB0101")),
                Expression.get("passed"), Expression.color(Color.parseColor("#CBD5E1")),
                Expression.color(Color.WHITE),
            )),
            PropertyFactory.circleStrokeColor(Color.parseColor("#6C5DD3")), PropertyFactory.circleStrokeWidth(2.5f),
        ))
        style.addLayer(SymbolLayer("stop-labels", "stops").withProperties(
            PropertyFactory.textField(Expression.get("name")), PropertyFactory.textSize(12f), PropertyFactory.textOffset(arrayOf(0f, 1.3f)),
            PropertyFactory.textAnchor(Property.TEXT_ANCHOR_TOP), PropertyFactory.textOptional(true),
            PropertyFactory.textColor(Color.parseColor("#1B1D3A")), PropertyFactory.textHaloColor(Color.WHITE), PropertyFactory.textHaloWidth(1.5f),
        ).apply { minZoom = 12f })
        style.addLayer(CircleLayer("me", "me").withProperties(
            PropertyFactory.circleRadius(8f), PropertyFactory.circleColor(Color.parseColor("#2563EB")),
            PropertyFactory.circleStrokeColor(Color.WHITE), PropertyFactory.circleStrokeWidth(3f),
        ))
        style.addLayer(SymbolLayer("buses", "buses").withProperties(
            PropertyFactory.iconImage(Expression.get("icon")),
            PropertyFactory.iconRotate(Expression.get("rotation")),
            PropertyFactory.iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_MAP),
            PropertyFactory.iconAllowOverlap(true),
            PropertyFactory.iconIgnorePlacement(true),
            // Zoomed out: the number only; closer in: number above the route name.
            PropertyFactory.textField(Expression.step(Expression.zoom(), Expression.get("number"), Expression.stop(12, Expression.get("label")))),
            PropertyFactory.textSize(12f),
            PropertyFactory.textAnchor(Property.TEXT_ANCHOR_BOTTOM),
            PropertyFactory.textOffset(arrayOf(0f, -1.9f)),
            PropertyFactory.textColor(Color.parseColor("#1B1D3A")),
            PropertyFactory.textHaloColor(Color.WHITE),
            PropertyFactory.textHaloWidth(2f),
            // Overlapping labels of nearby buses drop out instead of piling up; the icons stay.
            PropertyFactory.textAllowOverlap(false),
            PropertyFactory.symbolSortKey(Expression.get("sort")),
        ))
        map.addOnMapClickListener { latLng ->
            val pt: PointF = map.projection.toScreenLocation(latLng)
            val bus = map.queryRenderedFeatures(pt, "buses").firstOrNull()?.getStringProperty("id")
            if (bus != null) {
                onBus(bus)
                return@addOnMapClickListener true
            }
            val stop = map.queryRenderedFeatures(pt, "stops").firstOrNull()?.getStringProperty("id")
            if (stop != null) {
                onStop(stop)
                return@addOnMapClickListener true
            }
            false
        }
    }

    /** New list of buses: start / continue gliding each one to its latest valid position. */
    fun setBuses(next: List<BusView>) {
        views = next
        val ids = next.map { it.id }.toSet()
        positions.keys.retainAll(ids)
        var moved = false
        next.forEach { b ->
            val target = BusMath.LatLng(b.lat, b.lng)
            val m = positions[b.id]
            if (m == null) positions[b.id] = Moving(target, target, target)
            else if (m.to != target) {
                m.from = m.pos
                m.to = target
                moved = true
            }
            b.heading?.let { h ->
                val prev = rotation[b.id] ?: h
                rotation[b.id] = prev + BusMath.shortestTurn(prev, h)
            }
        }
        if (moved) animator.start() else render()
    }

    private fun render() {
        val features = views.mapNotNull { b ->
            val pos = positions[b.id]?.pos ?: return@mapNotNull null
            Feature.fromGeometry(Point.fromLngLat(pos.lng, pos.lat)).apply {
                addStringProperty("id", b.id)
                addStringProperty("number", b.number)
                addStringProperty("label", BusMath.markerLabel(b.number, b.route))
                addStringProperty("icon", when (b.tracking) { BusMath.Tracking.LIVE -> "bus-live"; BusMath.Tracking.STALE -> "bus-stale"; else -> "bus-offline" })
                addNumberProperty("rotation", rotation[b.id] ?: 0.0)
                addNumberProperty("sort", if (b.selected) 0 else 1)
            }
        }
        style.getSourceAs<GeoJsonSource>("buses")?.setGeoJson(FeatureCollection.fromFeatures(features))
    }

    data class StopView(val id: String, val name: String, val lat: Double, val lng: Double, val selected: Boolean, val passed: Boolean)

    fun setRoute(path: List<BusMath.LatLng>, travelled: List<BusMath.LatLng>, stops: List<StopView>) {
        fun line(pts: List<BusMath.LatLng>) =
            if (pts.size >= 2) FeatureCollection.fromFeature(Feature.fromGeometry(LineString.fromLngLats(pts.map { Point.fromLngLat(it.lng, it.lat) })))
            else FeatureCollection.fromFeatures(emptyList())
        style.getSourceAs<GeoJsonSource>("route-remaining")?.setGeoJson(line(path))
        style.getSourceAs<GeoJsonSource>("route-travelled")?.setGeoJson(line(travelled))
        style.getSourceAs<GeoJsonSource>("stops")?.setGeoJson(FeatureCollection.fromFeatures(stops.map { s ->
            Feature.fromGeometry(Point.fromLngLat(s.lng, s.lat)).apply {
                addStringProperty("id", s.id)
                addStringProperty("name", s.name)
                addBooleanProperty("selected", s.selected)
                addBooleanProperty("passed", s.passed)
            }
        }))
    }

    /**
     * The viewer's blue dot and, around it, the circle its accuracy covers. A
     * city-level estimate (BusMath.showsDot false) gets only the shaded area.
     */
    fun setStudent(pos: BusMath.LatLng?, accuracyMeters: Float? = null) {
        val dot = pos != null && (accuracyMeters == null || BusMath.showsDot(accuracyMeters))
        style.getSourceAs<GeoJsonSource>("me")?.setGeoJson(
            if (!dot || pos == null) FeatureCollection.fromFeatures(emptyList()) else FeatureCollection.fromFeature(Feature.fromGeometry(Point.fromLngLat(pos.lng, pos.lat)))
        )
        style.getSourceAs<GeoJsonSource>("me-accuracy")?.setGeoJson(
            if (pos == null || accuracyMeters == null) FeatureCollection.fromFeatures(emptyList())
            else FeatureCollection.fromFeature(Feature.fromGeometry(Polygon.fromLngLats(listOf(BusMath.circle(pos, accuracyMeters.toDouble()).map { Point.fromLngLat(it.lng, it.lat) }))))
        )
    }

    /** Centre on one point, or fit several (bus + student, or all buses). */
    fun fit(points: List<BusMath.LatLng>) {
        if (points.isEmpty()) return
        if (points.size == 1) {
            map.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(points[0].lat, points[0].lng), maxOf(map.cameraPosition.zoom, 15.0)), 800)
            return
        }
        val b = LatLngBounds.Builder().apply { points.forEach { include(LatLng(it.lat, it.lng)) } }.build()
        runCatching { map.animateCamera(CameraUpdateFactory.newLatLngBounds(b, 140), 800) }
    }

    fun dispose() {
        animator.cancel()
        animator.removeAllUpdateListeners()
    }
}
