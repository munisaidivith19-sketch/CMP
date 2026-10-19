/**
 * The bus marker — ALWAYS a bus shape (never a car or a map pin), with the
 * bus number and route name stacked ABOVE the icon. The same top-down bus
 * drawing (front = up) is used by the Android app (res/drawable/ic_bus_marker.xml),
 * so a rotation by the GPS heading points the bus the way it is driving.
 *
 * Built with DOM methods only (no HTML strings): bus numbers and route names
 * are text nodes, never markup.
 *
 * Status colour: live = brand red, stale = amber, offline = grey.
 */
import { reliableHeading } from './busGeo';

export const BUS_ICON_SIZE = 40;
export const STATUS_FILL = { live: '#cb0101', stale: '#d97706', offline: '#6b7280' };

const SVG_NS = 'http://www.w3.org/2000/svg';
const WINDOW = '#dbeafe';
const TYRE = '#1f2937';

// 40×40 top-down bus: wheels, body, windscreen (front, top), side windows, roof unit, rear bumper.
const SHAPES = [
  ['rect', { x: 6, y: 7, width: 3, height: 6, rx: 1, fill: TYRE }],
  ['rect', { x: 31, y: 7, width: 3, height: 6, rx: 1, fill: TYRE }],
  ['rect', { x: 6, y: 27, width: 3, height: 6, rx: 1, fill: TYRE }],
  ['rect', { x: 31, y: 27, width: 3, height: 6, rx: 1, fill: TYRE }],
  ['rect', { x: 8, y: 2, width: 24, height: 36, rx: 6, 'stroke-width': 2, stroke: '#ffffff', 'data-body': '1' }],
  ['path', { d: 'M11 6.5 Q20 3 29 6.5 L28 11 L12 11 Z', fill: WINDOW, stroke: TYRE, 'stroke-width': 0.8 }],
  ...[13.5, 19.5, 25.5].flatMap((y) => [
    ['rect', { x: 11, y, width: 3, height: 4, rx: 0.8, fill: WINDOW }],
    ['rect', { x: 26, y, width: 3, height: 4, rx: 0.8, fill: WINDOW }],
  ]),
  ['rect', { x: 16, y: 16, width: 8, height: 10, rx: 1.5, fill: 'rgba(255,255,255,0.35)' }],
  ['rect', { x: 12, y: 33, width: 16, height: 2.5, rx: 1, fill: 'rgba(0,0,0,0.25)' }],
];

/** The bus icon as an <svg> element (also used in the list and legend). */
export function busSvg(fill = STATUS_FILL.live, size = BUS_ICON_SIZE) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attrs] of SHAPES) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (attrs['data-body']) node.setAttribute('fill', fill);
    svg.appendChild(node);
  }
  return svg;
}

const span = (cls) => {
  const s = document.createElement('span');
  s.className = cls;
  return s;
};

/**
 * Build the marker element: [number] [route] stacked above the bus icon.
 * The caller anchors the element's bottom at the bus coordinate with an
 * offset of half the icon, so the ICON's centre sits exactly on the position.
 */
export function createBusMarkerElement(bus, onSelect) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'bus-marker';
  const label = span('bus-marker__label');
  label.append(span('bus-marker__number'), span('bus-marker__route'));
  const icon = span('bus-marker__icon');
  icon.appendChild(busSvg(STATUS_FILL.offline));
  icon.dataset.status = 'offline';
  el.append(label, icon);
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onSelect(bus._id);
  });
  updateBusMarkerElement(el, bus, 'offline', null);
  return el;
}

/** Refresh labels, colour, selection and rotation — no new element per update. */
export function updateBusMarkerElement(el, bus, status, location, selected = false) {
  el.querySelector('.bus-marker__number').textContent = bus.number;
  el.querySelector('.bus-marker__route').textContent = bus.route?.name || 'No route';
  const icon = el.querySelector('.bus-marker__icon');
  if (icon.dataset.status !== status) {
    icon.querySelector('[data-body]').setAttribute('fill', STATUS_FILL[status] || STATUS_FILL.offline);
    icon.dataset.status = status;
  }
  const heading = reliableHeading(location);
  // Rotate only with a reliable heading; otherwise keep the last orientation.
  const prev = Number(icon.dataset.rotation || 0);
  let next = prev;
  if (heading != null) next = prev + (((((heading - (prev % 360)) % 360) + 540) % 360) - 180);
  icon.dataset.rotation = String(next);
  icon.style.transform = `rotate(${next}deg)`;
  el.dataset.status = status;
  el.classList.toggle('bus-marker--selected', selected);
  el.setAttribute('aria-pressed', String(selected));
  el.setAttribute(
    'aria-label',
    `Bus ${bus.number}, route ${bus.route?.name || 'none'}, ${status === 'live' ? 'tracking live' : status === 'stale' ? 'last position is old' : 'tracking offline'}`
  );
}
