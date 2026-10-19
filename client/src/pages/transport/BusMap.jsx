import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BUS_ICON_SIZE, createBusMarkerElement, updateBusMarkerElement } from './busMarker';
import { accuracyCircle, boundsOf, easeOut, freshnessOf, lerpPosition, remainingPath } from './busGeo';
import { accuracyBounds, showsDot, syncUserMarker } from './myLocation';

// The worker is bundled to a same-origin file (strict CSP: no blob:, no remote script).
maplibregl.setWorkerUrl(workerUrl);

const EMPTY = { type: 'FeatureCollection', features: [] };
const line = (pts) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lng, p.lat]) }, properties: {} });
const COMPACT_BELOW_ZOOM = 12;

/**
 * The live bus map (MapLibre GL). Purely presentational: it draws what it is
 * given and reports clicks. One marker element per bus, re-used and animated
 * between valid fixes; the student's position is a separate blue dot.
 *
 * `fit` = { kind: 'all' | 'bus' | 'student' | 'both', nonce } re-centres on demand.
 */
export default function BusMap({ styleUrl, attribution, thresholds, buses, locations, selectedId, onSelect, route, travelled, selectedStopId, onSelectStop, student, fit, onMapError }) {
  const container = useRef(null);
  const map = useRef(null);
  const markers = useRef(new Map()); // busId → { marker, el, pos, frame }
  const studentMarker = useRef(null);
  const [ready, setReady] = useState(false);
  const callbacks = useRef({ onSelect, onSelectStop, onMapError });
  callbacks.current = { onSelect, onSelectStop, onMapError };

  // Create the map once.
  useEffect(() => {
    const m = new maplibregl.Map({
      container: container.current,
      style: styleUrl,
      center: [78.9629, 20.5937], // until the buses / route are known
      zoom: 4,
      attributionControl: { compact: true, customAttribution: attribution },
      cooperativeGestures: false,
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    let loaded = false;
    m.on('load', () => {
      loaded = true;
      m.addSource('route-remaining', { type: 'geojson', data: EMPTY });
      m.addSource('route-travelled', { type: 'geojson', data: EMPTY });
      m.addSource('stops', { type: 'geojson', data: EMPTY });
      // The area the viewer's position is accurate to (drawn under everything).
      m.addSource('me-accuracy', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'me-accuracy', type: 'fill', source: 'me-accuracy', paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.12, 'fill-outline-color': '#2563eb' } });
      m.addLayer({ id: 'route-travelled', type: 'line', source: 'route-travelled', paint: { 'line-color': '#94a3b8', 'line-width': 4, 'line-dasharray': [1.5, 1.5] }, layout: { 'line-cap': 'round' } });
      m.addLayer({ id: 'route-remaining', type: 'line', source: 'route-remaining', paint: { 'line-color': '#6c5dd3', 'line-width': 5, 'line-opacity': 0.85 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({
        id: 'stops',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 9, 6],
          'circle-color': ['case', ['get', 'selected'], '#cb0101', ['get', 'passed'], '#cbd5e1', '#ffffff'],
          'circle-stroke-color': '#6c5dd3',
          'circle-stroke-width': 2.5,
        },
      });
      m.addLayer({
        id: 'stop-labels',
        type: 'symbol',
        source: 'stops',
        minzoom: 12,
        layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': '#1b1d3a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      });
      m.on('click', 'stops', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) callbacks.current.onSelectStop?.(id);
      });
      m.on('mouseenter', 'stops', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'stops', () => (m.getCanvas().style.cursor = ''));
      setReady(true);
    });
    m.on('error', (e) => {
      // A style / network failure before the map ever loaded = the map is unavailable.
      if (!loaded) callbacks.current.onMapError?.(e?.error?.message || 'The map could not be loaded');
    });
    const compact = () => container.current?.classList.toggle('bus-map--compact', m.getZoom() < COMPACT_BELOW_ZOOM);
    m.on('zoomend', compact);
    compact();
    const all = markers.current;
    return () => {
      all.forEach((x) => cancelAnimationFrame(x.frame));
      all.clear();
      studentMarker.current = null;
      m.remove();
      map.current = null;
    };
  }, [styleUrl, attribution]);

  // Bus markers: create once per bus, animate to each new valid position.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set();
    for (const bus of buses) {
      const loc = locations[bus._id] || bus.location;
      if (!loc) continue; // never place a bus without a real position
      const id = String(bus._id);
      seen.add(id);
      const status = freshnessOf(loc.at, thresholds);
      let entry = markers.current.get(id);
      if (!entry) {
        const el = createBusMarkerElement(bus, (busId) => callbacks.current.onSelect(busId));
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, BUS_ICON_SIZE / 2] }).setLngLat([loc.lng, loc.lat]).addTo(m);
        entry = { marker, el, pos: { lat: loc.lat, lng: loc.lng }, frame: 0, at: loc.at };
        markers.current.set(id, entry);
      } else if (entry.at !== loc.at) {
        // Smooth move from where the marker is now to the new fix.
        cancelAnimationFrame(entry.frame);
        const from = { ...entry.pos };
        const to = { lat: loc.lat, lng: loc.lng };
        const start = performance.now();
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const duration = reduce ? 0 : 1000;
        const step = (t) => {
          const k = duration ? Math.min(1, (t - start) / duration) : 1;
          entry.pos = lerpPosition(from, to, easeOut(k));
          entry.marker.setLngLat([entry.pos.lng, entry.pos.lat]);
          if (k < 1) entry.frame = requestAnimationFrame(step);
        };
        entry.frame = requestAnimationFrame(step);
        entry.at = loc.at;
      }
      updateBusMarkerElement(entry.el, bus, status, loc, String(selectedId) === id);
      entry.el.style.zIndex = String(selectedId) === id ? '2' : '1';
    }
    for (const [id, entry] of markers.current) {
      if (!seen.has(id)) {
        cancelAnimationFrame(entry.frame);
        entry.marker.remove();
        markers.current.delete(id);
      }
    }
  }, [buses, locations, selectedId, thresholds]);

  // Route lines and stops of the selected bus.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const path = route ? (route.geometry?.length >= 2 ? route.geometry.map(([lng, lat]) => ({ lat, lng })) : route.stops.map((s) => ({ lat: s.lat, lng: s.lng }))) : [];
    const pos = selectedId ? locations[selectedId] || buses.find((b) => String(b._id) === String(selectedId))?.location : null;
    m.getSource('route-remaining')?.setData(path.length >= 2 ? line(remainingPath(path, pos)) : EMPTY);
    m.getSource('route-travelled')?.setData(travelled?.length >= 2 ? line(travelled) : EMPTY);
    const passed = new Set(route?.passedSequences || []);
    m.getSource('stops')?.setData({
      type: 'FeatureCollection',
      features: (route?.stops || []).map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { id: String(s._id), name: `${s.sequence}. ${s.name}`, selected: String(s._id) === String(selectedStopId), passed: passed.has(s.sequence) },
      })),
    });
  }, [ready, route, travelled, selectedStopId, selectedId, locations, buses]);

  // The student's own position — a blue dot, only when they asked for it.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (ready) m.getSource('me-accuracy')?.setData(student && Number.isFinite(student.accuracy) ? accuracyCircle(student.lat, student.lng, student.accuracy) : EMPTY);
    // Exactly one "you" marker (never a bus marker), created once and moved after.
    // A city-level (IP) estimate gets only its shaded area — no dot pretending to be you.
    studentMarker.current = syncUserMarker(studentMarker.current, showsDot(student) ? student : null, (fix) => {
      const el = document.createElement('div');
      el.className = 'student-dot';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Your location');
      return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([fix.lng, fix.lat]).addTo(m);
    });
  }, [student, ready]);

  // Re-centre on request.
  useEffect(() => {
    const m = map.current;
    if (!m || !fit) return;
    const busPos = selectedId ? locations[selectedId] || buses.find((b) => String(b._id) === String(selectedId))?.location : null;
    if (fit.kind === 'student') {
      // Frame the whole accuracy area: street level for a precise fix, zoomed
      // out for a rough estimate — a coarse position never looks exact.
      if (student) m.fitBounds(accuracyBounds(student), { padding: 50, maxZoom: 17, duration: 800 });
      return;
    }
    let pts = [];
    if (fit.kind === 'bus') pts = [busPos];
    else if (fit.kind === 'both') pts = [busPos, student];
    else pts = [...buses.map((b) => locations[b._id] || b.location), ...(route?.stops || [])];
    const b = boundsOf(pts);
    if (!b) return;
    if (pts.filter(Boolean).length === 1) m.flyTo({ center: [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2], zoom: Math.max(m.getZoom(), 15), essential: true });
    else m.fitBounds(b, { padding: 70, maxZoom: 15, duration: 800 });
    // fit.nonce changes on every request; the rest is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  return <div ref={container} className="h-full w-full" role="application" aria-label="Live bus map" />;
}
