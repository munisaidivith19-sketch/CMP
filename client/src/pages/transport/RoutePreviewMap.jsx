import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_VIEW, boundsOf, routeLine, stopFeatures } from './busGeo';
import { roundCoord } from './coordPaste';

// Same-origin worker (strict CSP), as on the live bus map.
maplibregl.setWorkerUrl(workerUrl);

const EMPTY = { type: 'FeatureCollection', features: [] };

/** A numbered stop pin: green start, dark end, white in between; the selected stop gets a ring. */
function pinElement(number, role, selected) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = String(number);
  el.setAttribute('aria-label', `Stop ${number} — drag to move`);
  const bg = role === 'start' ? '#16a34a' : role === 'end' ? '#1b1d3a' : '#ffffff';
  Object.assign(el.style, {
    width: '24px',
    height: '24px',
    borderRadius: '9999px',
    border: '2.5px solid #6c5dd3',
    background: bg,
    color: role === 'stop' ? '#1b1d3a' : '#ffffff',
    font: '700 11px/1 system-ui, sans-serif',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'grab',
    boxShadow: selected ? '0 0 0 4px rgba(245, 158, 11, 0.85)' : '0 1px 3px rgba(0,0,0,0.35)',
    padding: '0',
  });
  return el;
}

/**
 * Route map for the route editor: the road geometry (solid) or, without one,
 * straight stop-to-stop lines (dashed, labelled approximate), plus the stops.
 *
 * Editing (when the handlers are given): clicking the map calls
 * onPlace(lat, lng); dragging a stop pin calls onMove(formIndex, lat, lng);
 * clicking a pin calls onSelect(formIndex). The map only reports positions —
 * the form decides which stop they belong to.
 */
export default function RoutePreviewMap({ styleUrl, attribution, stops, geometry, onMapError, onPlace, onMove, onSelect, selected = null, hint }) {
  const container = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  // Edits made on the map itself must not re-zoom the map under the pointer.
  const skipFit = useRef(false);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const errorRef = useRef(onMapError);
  errorRef.current = onMapError;
  const handlers = useRef({});
  handlers.current = { onPlace, onMove, onSelect };
  const editable = Boolean(onPlace || onMove);

  useEffect(() => {
    const m = new maplibregl.Map({
      container: container.current,
      style: styleUrl,
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      // The style already carries the required credit; collapse it to the (i) button.
      attributionControl: { compact: true },
    });
    m.once('load', () => {
      const a = container.current?.querySelector('.maplibregl-ctrl-attrib');
      a?.classList.remove('maplibregl-compact-show');
      a?.removeAttribute('open');
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    let loaded = false;
    m.on('load', () => {
      loaded = true;
      m.addSource('preview-line', { type: 'geojson', data: EMPTY });
      m.addSource('preview-stops', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'preview-road', type: 'line', source: 'preview-line', filter: ['!', ['get', 'approx']], paint: { 'line-color': '#6c5dd3', 'line-width': 5, 'line-opacity': 0.85 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({ id: 'preview-approx', type: 'line', source: 'preview-line', filter: ['get', 'approx'], paint: { 'line-color': '#6c5dd3', 'line-width': 3, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } });
      m.addLayer({
        id: 'preview-stop-labels',
        type: 'symbol',
        source: 'preview-stops',
        layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': '#1b1d3a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      });
      setReady(true);
    });
    m.on('click', (e) => {
      // Clicks on a pin select that stop instead (handled on the pin).
      if (e.originalEvent?.target?.closest?.('.maplibregl-marker')) return;
      if (!handlers.current.onPlace) return;
      skipFit.current = true;
      handlers.current.onPlace(roundCoord(e.lngLat.lat), roundCoord(e.lngLat.lng));
    });
    m.on('error', (e) => {
      if (!loaded) errorRef.current?.(e?.error?.message || 'The map could not be loaded');
    });
    return () => {
      markers.current.forEach((mk) => mk.remove());
      markers.current = [];
      m.remove();
      map.current = null;
    };
  }, [styleUrl, attribution]);

  useEffect(() => {
    const m = map.current;
    if (m && ready) m.getCanvas().style.cursor = editable ? 'crosshair' : '';
  }, [ready, editable]);

  // The form's order IS the travel order (sequences are renumbered on save).
  const ordered = (stops || [])
    .map((s, i) => ({ ...s, sequence: i + 1, formIndex: i }))
    .filter((s) => String(s.lat ?? '').trim() !== '' && String(s.lng ?? '').trim() !== '' && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)))
    .map((s) => ({ ...s, lat: Number(s.lat), lng: Number(s.lng) }));
  const { points, exact } = routeLine({ geometry, stops: ordered });
  const key = `${exact}:${points.length}:${points[0]?.lat},${points[0]?.lng}:${points[points.length - 1]?.lat}:${ordered.map((s) => `${s.formIndex}@${s.lat},${s.lng},${s.name}`).join('|')}`;

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.getSource('preview-line')?.setData(points.length >= 2 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) }, properties: { approx: !exact } } : EMPTY);
    m.getSource('preview-stops')?.setData(stopFeatures(ordered));

    markers.current.forEach((mk) => mk.remove());
    markers.current = ordered.map((s, i) => {
      const role = i === 0 ? 'start' : i === ordered.length - 1 ? 'end' : 'stop';
      const el = pinElement(s.sequence, ordered.length < 2 ? 'stop' : role, s.formIndex === selected);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handlers.current.onSelect?.(s.formIndex);
      });
      const mk = new maplibregl.Marker({ element: el, draggable: Boolean(handlers.current.onMove) }).setLngLat([s.lng, s.lat]).addTo(m);
      mk.on('dragend', () => {
        const p = mk.getLngLat();
        skipFit.current = true;
        handlers.current.onMove?.(s.formIndex, roundCoord(p.lat), roundCoord(p.lng));
      });
      return mk;
    });

    if (skipFit.current) {
      skipFit.current = false;
    } else {
      const b = boundsOf([...points, ...ordered]);
      if (b) {
        m.fitBounds(b, { padding: 40, maxZoom: fitted.current ? 15 : 16, duration: fitted.current ? 600 : 0 });
        fitted.current = true;
      }
    }
    // `key` captures everything drawn; the arrays are rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, selected]);

  return (
    <div className="relative h-80 w-full overflow-hidden rounded-2xl border border-white/20">
      <div ref={container} className="h-full w-full" role="img" aria-label={exact ? 'Map of the road route and its stops' : 'Map of the stops joined by straight lines'} />
      {hint && (
        <p className="pointer-events-none absolute left-2 top-2 z-10 max-w-[75%] rounded-lg bg-primary-600/95 px-2 py-1 text-[11px] font-semibold text-white shadow-sm" role="status" aria-live="polite">
          {hint}
        </p>
      )}
      {!exact && ordered.length >= 2 && (
        <p className="pointer-events-none absolute bottom-2 left-2 z-10 max-w-[70%] rounded-lg bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm">
          Approximate path — straight lines between stops, not the road
        </p>
      )}
    </div>
  );
}
