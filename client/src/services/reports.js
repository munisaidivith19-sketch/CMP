import { store } from '../app/store';
import { loggedOut, setCredentials } from '../features/authSlice';
import { refreshSession } from './api';

/**
 * Download an attendance report PDF.
 *
 * The document is generated and authorized entirely on the server — this only
 * names the report and the class, and saves whatever the server returns. The
 * filename comes from the response's Content-Disposition, so the client never
 * invents one either. RTK Query is bypassed because it cannot carry a binary
 * body.
 */
export async function downloadAttendanceReport(type, params = {}) {
  const query = new URLSearchParams({ format: 'pdf' });
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  });

  const send = () =>
    fetch(`/api/attendance/reports/${type}?${query}`, {
      credentials: 'include',
      headers: {
        accept: 'application/pdf',
        ...(store.getState().auth.accessToken ? { authorization: `Bearer ${store.getState().auth.accessToken}` } : {}),
      },
    });

  let res = await send();
  if (res.status === 401) {
    const session = await refreshSession();
    if (!session?.accessToken) {
      store.dispatch(loggedOut());
      throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
    }
    store.dispatch(setCredentials(session));
    res = await send();
  }

  if (!res.ok) {
    // Report refusals are meaningful (a period that has not finished yet, a
    // class outside the user's scope) — surface the server's own message.
    const data = await res.json().catch(() => null);
    throw Object.assign(new Error(data?.message || 'Could not generate the report'), { status: res.status });
  }

  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : `attendance-${type}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handed to the browser.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return a.download;
}

/**
 * Export achievements list to CSV or PDF for Principal / HOD / Admin.
 */
export async function exportAchievementsFile(params = {}, format = 'csv') {
  const query = new URLSearchParams({ format });
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  });

  const send = () =>
    fetch(`/api/achievements/export?${query}`, {
      credentials: 'include',
      headers: {
        accept: format === 'pdf' ? 'application/pdf' : 'text/csv',
        ...(store.getState().auth.accessToken ? { authorization: `Bearer ${store.getState().auth.accessToken}` } : {}),
      },
    });

  let res = await send();
  if (res.status === 401) {
    const session = await refreshSession();
    if (!session?.accessToken) {
      store.dispatch(loggedOut());
      throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
    }
    store.dispatch(setCredentials(session));
    res = await send();
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw Object.assign(new Error(data?.message || 'Could not export achievements'), { status: res.status });
  }

  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : `achievements-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return a.download;
}

/**
 * Export institutional user profiles directory to PDF for Principal and Admin only.
 */
export async function downloadProfilesPdf() {
  const send = () =>
    fetch('/api/users/export-pdf', {
      credentials: 'include',
      headers: {
        accept: 'application/pdf',
        ...(store.getState().auth.accessToken ? { authorization: `Bearer ${store.getState().auth.accessToken}` } : {}),
      },
    });

  let res = await send();
  if (res.status === 401) {
    const session = await refreshSession();
    if (!session?.accessToken) {
      store.dispatch(loggedOut());
      throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
    }
    store.dispatch(setCredentials(session));
    res = await send();
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw Object.assign(new Error(data?.message || 'Only Principal and Admin can download the profile directory'), { status: res.status });
  }

  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : 'CampusConnect_Profiles_Directory.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return a.download;
}

/**
 * Export Master Timetable to PDF for HODs.
 */
export async function downloadMasterTimetablePdf(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'all') {
      query.set(k, String(v));
    }
  });

  const send = () =>
    fetch(`/api/timetable/master/pdf?${query}`, {
      credentials: 'include',
      headers: {
        accept: 'application/pdf',
        ...(store.getState().auth.accessToken ? { authorization: `Bearer ${store.getState().auth.accessToken}` } : {}),
      },
    });

  let res = await send();
  if (res.status === 401) {
    const session = await refreshSession();
    if (!session?.accessToken) {
      store.dispatch(loggedOut());
      throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
    }
    store.dispatch(setCredentials(session));
    res = await send();
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw Object.assign(new Error(data?.message || 'Could not export master timetable PDF'), { status: res.status });
  }

  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : 'Master_Timetable.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return a.download;
}

/**
 * Export Faculty Availability Schedule to PDF for HODs.
 */
export async function downloadFacultyAvailabilityPdf(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'all') {
      query.set(k, String(v));
    }
  });

  const send = () =>
    fetch(`/api/timetable/faculty-availability/pdf?${query}`, {
      credentials: 'include',
      headers: {
        accept: 'application/pdf',
        ...(store.getState().auth.accessToken ? { authorization: `Bearer ${store.getState().auth.accessToken}` } : {}),
      },
    });

  let res = await send();
  if (res.status === 401) {
    const session = await refreshSession();
    if (!session?.accessToken) {
      store.dispatch(loggedOut());
      throw Object.assign(new Error('Your session has expired. Please sign in again.'), { status: 401 });
    }
    store.dispatch(setCredentials(session));
    res = await send();
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw Object.assign(new Error(data?.message || 'Could not export faculty availability PDF'), { status: res.status });
  }

  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : 'Faculty_Availability.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return a.download;
}

