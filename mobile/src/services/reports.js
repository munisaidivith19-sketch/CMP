import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getApiUrl } from '../config';
import { store } from '../store';
import { loggedOut, setCredentials } from '../store/authSlice';
import { mobileHeaders, refreshSession } from './session';

/**
 * Download an attendance report PDF — the mobile twin of the web's
 * downloadAttendanceReport. The server generates and authorizes the document;
 * this only names the report and the class, saves what comes back, and opens
 * the system share sheet (Save to Files / Drive / a PDF viewer).
 *
 * The access token travels in the Authorization header, never in the URL, so
 * it cannot end up in server logs or link history.
 */
export async function downloadAttendanceReport(type, params = {}) {
  const query = new URLSearchParams({ format: 'pdf' });
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  });
  const url = `${getApiUrl()}/api/attendance/reports/${encodeURIComponent(type)}?${query}`;
  const target = `${FileSystem.cacheDirectory}attendance-${type}-${Date.now()}.pdf`;

  const send = () =>
    FileSystem.downloadAsync(url, target, {
      headers: {
        accept: 'application/pdf',
        ...mobileHeaders(),
        ...(store.getState().auth.accessToken ? { authorization: `Bearer ${store.getState().auth.accessToken}` } : {}),
      },
    });

  let res = await send();
  if (res.status === 401) {
    const session = await refreshSession();
    if (!session?.accessToken) {
      if (!session?.offline) store.dispatch(loggedOut());
      throw new Error('Your session has expired. Please sign in again.');
    }
    store.dispatch(setCredentials(session));
    res = await send();
  }

  if (res.status < 200 || res.status >= 300) {
    // Refusals are meaningful (a period not finished yet, a class outside your
    // scope) — the error body was written to the file, so surface its message.
    const body = await FileSystem.readAsStringAsync(res.uri).catch(() => '');
    await FileSystem.deleteAsync(res.uri, { idempotent: true }).catch(() => {});
    let message = 'Could not generate the report';
    try {
      message = JSON.parse(body).message || message;
    } catch {}
    throw new Error(message);
  }

  const disposition = res.headers?.['content-disposition'] || res.headers?.['Content-Disposition'] || '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || `attendance-${type}.pdf`;
  // Rename to the server's filename so it is saved under a meaningful name.
  const named = `${FileSystem.cacheDirectory}${name.replace(/[^\w.\- ]/g, '_')}`;
  await FileSystem.deleteAsync(named, { idempotent: true }).catch(() => {});
  await FileSystem.moveAsync({ from: res.uri, to: named });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(named, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: name });
  }
  return name;
}
