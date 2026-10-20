import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_VIEW, boundsOf, routeLine, stopFeatures } from './busGeo';

// Same-origin worker (strict CSP), as on the live bus map.
maplibregl.setWorkerUrl(workerUrl);

const EMPTY = { type: 'FeatureCollection', features: [] };

/**
 * Route preview for the route editor: the road geometry (solid) or, without
 * one, straight stop-to-stop lines (dashed, labelled approximate), plus the
 * ordered stops with the start and end marked. Display only — it never
 * changes the route.
 */
export default function RoutePreviewMap({ styleUrl, attribution, stops, geometry, onMapError }) {
  const container = useRef(null);
  const map = useRef(null);
  const [ready, setReady] = useState(false);
  const errorRef = useRef(onMapError);
  errorRef.current = onMapError;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: container.current,
      style: styleUrl,
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      attributionControl: { compact: true, customAttribution: attribution },
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
        id: 'preview-stops',
        type: 'circle',
        source: 'preview-stops',
        paint: {
          'circle-radius': ['case', ['!=', ['get', 'role'], 'stop'], 8, 6],
          'circle-color': ['case', ['==', ['get', 'role'], 'start'], '#16a34a', ['==', ['get', 'role'], 'end'], '#1b1d3a', '#ffffff'],
          'circle-stroke-color': '#6c5dd3',
          'circle-stroke-width': 2.5,
        },
      });
      m.addLayer({
        id: 'preview-stop-labels',
        type: 'symbol',
        source: 'preview-stops',
        layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': '#1b1d3a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      });
      setReady(true);
    });
    m.on('error', (e) => {
      if (!loaded) errorRef.current?.(e?.error?.message || 'The map could not be loaded');
    });
    return () => {
      m.remove();
      map.current = null;
    };
  }, [styleUrl, attribution]);

  // The form's order IS the travel order (sequences are renumbered on save).
  const ordered = (stops || [])
    .map((s, i) => ({ ...s, sequence: i + 1 }))
    .filter((s) => String(s.lat ?? '').trim() !== '' && String(s.lng ?? '').trim() !== '' && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)))
    .map((s) => ({ ...s, lat: Number(s.lat), lng: Number(s.lng) }));
  const { points, exact } = routeLine({ geometry, stops: ordered });
  const key = `${exact}:${points.length}:${points[0]?.lat},${points[0]?.lng}:${points[points.length - 1]?.lat}:${ordered.map((s) => `${s.lat},${s.lng},${s.name}`).join('|')}`;

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.getSource('preview-line')?.setData(points.length >= 2 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) }, properties: { approx: !exact } } : EMPTY);
    m.getSource('preview-stops')?.setData(stopFeatures(ordered));
    const b = boundsOf([...points, ...ordered]);
    if (b) m.fitBounds(b, { padding: 40, maxZoom: 15, duration: 600 });
    // `key` captures everything drawn; the arrays are rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);

  return (
    <div className="relative h-72 w-full overflow-hidden rounded-2xl border border-white/20">
      <div ref={container} className="h-full w-full" role="img" aria-label={exact ? 'Map preview of the road route and its stops' : 'Map preview of the stops joined by straight lines'} />
      {!exact && ordered.length >= 2 && (
        <p className="pointer-events-none absolute left-2 top-2 z-10 max-w-[70%] rounded-lg bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-700 shadow" role="status">
          Approximate path — straight lines between stops, not the road
        </p>
      )}
    </div>
  );
}
