/**
 * Reads a stop's position from pasted text: "13.08271, 80.27069", degrees /
 * minutes / seconds (13°04'57.8"N 80°16'14.5"E), a geo: URI, or a full Google
 * Maps link. Returns { lat, lng }, { error } when the text looks like a position
 * we cannot use, or null when it is not a position at all (an ordinary number).
 */

const DECIMALS = 6; // about 10 cm

const round = (n) => Number(n.toFixed(DECIMALS));

function valid(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: 'Those numbers are not a position on the map (latitude must be −90 to 90, longitude −180 to 180).' };
  return { lat: round(lat), lng: round(lng) };
}

const NUM = '[-+]?\\d{1,3}(?:\\.\\d+)?';
const PAIR = new RegExp(`^\\s*\\(?\\s*(${NUM})\\s*[,;\\s]\\s*(${NUM})\\s*\\)?\\s*$`);

/** 13°04'57.8"N 80°16'14.5"E (also with ′ ″ marks, spaces, or decimal minutes). */
function parseDms(text) {
  const part = /(\d{1,3}(?:\.\d+)?)\s*°\s*(?:(\d{1,2}(?:\.\d+)?)\s*['′’]\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*(?:["″”]|''|′′)\s*)?([NSEW])/gi;
  const found = [...text.matchAll(part)];
  if (found.length !== 2) return null;
  let lat;
  let lng;
  for (const [, d, m, s, hemi] of found) {
    let v = Number(d) + Number(m || 0) / 60 + Number(s || 0) / 3600;
    const h = hemi.toUpperCase();
    if (h === 'S' || h === 'W') v = -v;
    if (h === 'N' || h === 'S') lat = v;
    else lng = v;
  }
  if (lat === undefined || lng === undefined) return { error: 'Need one north/south and one east/west value.' };
  return valid(lat, lng);
}

/** The pinned place in a Google Maps (or similar) link. */
function parseLink(text) {
  let url;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl' || host === 'goo.gl') {
    return { error: 'Short share links (maps.app.goo.gl) cannot be read here. Open the link, then copy the coordinates or the full address-bar link.' };
  }
  const full = decodeURIComponent(url.href);
  const pair = (s) => {
    const m = s && s.match(new RegExp(`(${NUM})\\s*,\\s*(${NUM})`));
    return m ? valid(Number(m[1]), Number(m[2])) : null;
  };
  // A dropped pin / place: !3d<lat>!4d<lng> is the place itself (the @ part is only the view centre).
  const pin = full.match(new RegExp(`!3d(${NUM})!4d(${NUM})`));
  if (pin) return valid(Number(pin[1]), Number(pin[2]));
  for (const key of ['q', 'query', 'll', 'destination', 'center', 'daddr']) {
    const hit = pair(url.searchParams.get(key));
    if (hit) return hit;
  }
  const place = full.match(new RegExp(`/(?:place|search|dir)/(?:[^/]*/)*?(${NUM})\\s*,\\s*(${NUM})`));
  if (place) return valid(Number(place[1]), Number(place[2]));
  const at = full.match(new RegExp(`@(${NUM}),(${NUM})`));
  if (at) return valid(Number(at[1]), Number(at[2]));
  if (/google\.|goo\.gl|openstreetmap\.org|bing\.com\/maps/.test(host)) {
    return { error: 'No coordinates found in that link. In Google Maps, right-click (or long-press) the exact spot and copy the numbers instead.' };
  }
  return null;
}

export function parseCoordinates(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const geo = t.match(new RegExp(`^geo:(${NUM}),(${NUM})`, 'i'));
  if (geo) return valid(Number(geo[1]), Number(geo[2]));
  if (/^https?:\/\//i.test(t)) return parseLink(t);
  if (/°/.test(t)) return parseDms(t);
  const m = t.match(PAIR);
  if (m) return valid(Number(m[1]), Number(m[2]));
  return null;
}

/** Map clicks and drags: the same precision as pasted values. */
export const roundCoord = round;
