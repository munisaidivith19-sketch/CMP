import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { loggedOut, setCredentials } from '../features/authSlice';
import { setMaintenance } from '../features/uiSlice';
import { broadcastSession, markIdleLogout } from './sessionSync';
import { isCsrfRejection, readCsrfToken } from './csrfCookie';
import { apiErrorKind, reportClientError } from './errorReporter';

/** The double-submit CSRF token; every cookie-carrying write must echo it in X-CSRF-Token. */
export function getCsrfCookie() {
  if (typeof document === 'undefined') return null;
  // __Host-cc_csrf in production (preferred over a stale legacy cc_csrf), cc_csrf in development.
  return readCsrfToken(document.cookie);
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: '/api',
  credentials: 'include',
  prepareHeaders: (headers, { getState }) => {
    const token = getState().auth.accessToken;
    if (token) headers.set('authorization', `Bearer ${token}`);
    const csrf = getCsrfCookie();
    if (csrf) headers.set('x-csrf-token', csrf);
    return headers;
  },
});

// A single in-flight refresh shared by every request that hits a 401.
let refreshPromise = null;
export function refreshSession() {
  if (!refreshPromise) {
    const csrf = getCsrfCookie();
    const headers = csrf ? { 'x-csrf-token': csrf } : undefined;
    refreshPromise = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers })
      .then(async (r) => {
        if (r.ok) return r.json();
        // The server ended this session for inactivity: say so on the login page.
        const body = await r.json().catch(() => null);
        if (body?.reason === 'idle') markIdleLogout();
        return null;
      })
      .catch(() => null)
      .finally(() => {
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      });
  }
  return refreshPromise;
}

const NO_RETRY = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

/** Access tokens are short-lived: on a 401, refresh once and replay the request. */
const baseQueryWithReauth = async (args, api, extra) => {
  let result = await rawBaseQuery(args, api, extra);
  const url = typeof args === 'string' ? args : args.url;
  if (result.error?.status === 401 && !NO_RETRY.some((p) => url.startsWith(p))) {
    // Idle expiry is final — the session is revoked server-side, so there is
    // nothing to refresh. Sign out here and in every other tab.
    if (result.error.data?.reason === 'idle') {
      markIdleLogout();
      broadcastSession({ type: 'logout', reason: 'idle' });
      api.dispatch(loggedOut());
      return result;
    }
    const session = await refreshSession();
    if (session?.accessToken) {
      api.dispatch(setCredentials(session));
      result = await rawBaseQuery(args, api, extra);
    } else {
      api.dispatch(loggedOut());
    }
  }
  // A stale or missing CSRF cookie: /auth/refresh (CSRF-exempt) issues a
  // fresh token pair, then the write is replayed once with the new header.
  if (isCsrfRejection(result.error) && !NO_RETRY.some((p) => url.startsWith(p))) {
    const session = await refreshSession();
    if (session?.accessToken) {
      api.dispatch(setCredentials(session));
      result = await rawBaseQuery(args, api, extra);
    }
  }
  // Emergency maintenance: show the maintenance page instead of a broken screen.
  if (result.error?.status === 503 && result.error.data?.code === 'MAINTENANCE') {
    api.dispatch(setMaintenance(result.error.data.message));
  }
  // SOC: network failures and 5xx answers are reported (deduplicated, capped).
  // The report endpoint itself is never reported, so a failing report cannot loop.
  const kind = apiErrorKind(result.error);
  if (kind && !url.startsWith('/client-errors')) {
    reportClientError({
      kind,
      message: kind === 'network' ? `Request failed: ${result.error.error || result.error.status}` : `Server answered ${result.error.status}`,
      status: typeof result.error.status === 'number' ? result.error.status : undefined,
      endpoint: url,
      correlationId: result.meta?.response?.headers?.get?.('x-request-id') || undefined,
    });
  }
  return result;
};

const TAGS = [
  'Me', 'Dashboard', 'User', 'Club', 'Event', 'Announcement', 'Discussion', 'Report', 'Notification', 'Admin',
  'Session', 'Chat', 'ChatMessages', 'Attendance', 'Correction', 'Timetable', 'Subject', 'GatePass', 'LostFound', 'Analytics',
  'ChatRequest', 'StaffAttendance', 'Complaint', 'StudyMaterial', 'AssistantConversation', 'Holiday',
  'Security', 'ClassStudents', 'ODLeave',
  'AlumniProfile', 'MentorshipRequest', 'MentorshipSlot', 'MentorshipSession', 'AlumniJob', 'JobApplication', 'AlumniEvent', 'Chapter', 'ChapterPost', 'AlumniInvite', 'AlumniImport', 'AlumniAnalytics', 'Achievement',
  'SOSAlert', 'Exam', 'Cover', 'Transport',
];

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: TAGS,
  refetchOnFocus: false,
  endpoints: (b) => ({
    // ── Auth ──────────────────────────────────────────
    login: b.mutation({ query: (body) => ({ url: '/auth/login', method: 'POST', body }) }),
    // SOC client error reports (errorReporter.js) — any signed-in role.
    reportClientError: b.mutation({ query: (body) => ({ url: '/client-errors', method: 'POST', body }) }),
    register: b.mutation({ query: (body) => ({ url: '/auth/register', method: 'POST', body }) }),
    // `{ reason: 'idle' }` when the inactivity timer signs the user out (audit only).
    logout: b.mutation({ query: (body) => ({ url: '/auth/logout', method: 'POST', ...(body ? { body } : {}) }) }),
    // Web idle rule: reported user activity — sent only after real interaction, at most every 30 s.
    reportActivity: b.mutation({ query: () => ({ url: '/auth/activity', method: 'POST' }) }),
    // One check when a tab comes back into view: is this session still alive?
    verifySession: b.query({ query: () => '/auth/me', keepUnusedDataFor: 0 }),
    changePassword: b.mutation({ query: (body) => ({ url: '/auth/change-password', method: 'POST', body }), invalidatesTags: ['Session'] }),
    getSessions: b.query({ query: () => '/auth/sessions', providesTags: ['Session'] }),
    revokeSession: b.mutation({ query: (id) => ({ url: `/auth/sessions/${id}`, method: 'DELETE' }), invalidatesTags: ['Session'] }),
    revokeOtherSessions: b.mutation({ query: () => ({ url: '/auth/sessions/revoke-others', method: 'POST' }), invalidatesTags: ['Session'] }),
    getLoginHistory: b.query({ query: (params) => ({ url: '/auth/login-history', params }), providesTags: ['Session'] }),

    // ── Dashboard / search / uploads ──────────────────
    getDashboard: b.query({ query: () => '/dashboard', providesTags: ['Dashboard'] }),
    search: b.query({ query: (params) => ({ url: '/search', params }) }),
    uploadFile: b.mutation({
      query: (arg) => {
        if (typeof FormData !== 'undefined' && arg instanceof FormData) {
          return { url: '/uploads?kind=document', method: 'POST', body: arg };
        }
        const { file, kind = 'image' } = arg || {};
        const body = new FormData();
        body.append('file', file);
        return { url: `/uploads?kind=${kind}`, method: 'POST', body };
      },
    }),

    // ── Users ─────────────────────────────────────────
    getUsers: b.query({ query: (params) => ({ url: '/users', params }), providesTags: ['User'] }),
    // Which People filters this account may use, and their options — the
    // server derives them from the role, so the UI never offers a filter that
    // could only be refused.
    getPeopleFilters: b.query({ query: () => '/users/people-filters', providesTags: ['User'] }),
    getUser: b.query({ query: (id) => `/users/${id}`, providesTags: (_r, _e, id) => [{ type: 'User', id }] }),
    updateMe: b.mutation({
      query: (body) => ({ url: '/users/me', method: 'PUT', body }),
      invalidatesTags: ['User', 'Dashboard'],
    }),
    uploadAvatar: b.mutation({
      query: (file) => {
        const body = new FormData();
        body.append('file', file);
        return { url: '/users/me/avatar', method: 'PUT', body };
      },
      invalidatesTags: ['User'],
    }),

    // ── Clubs ─────────────────────────────────────────
    getClubs: b.query({ query: (params) => ({ url: '/clubs', params }), providesTags: ['Club'] }),
    getClub: b.query({ query: (id) => `/clubs/${id}`, providesTags: ['Club'] }),
    createClub: b.mutation({ query: (body) => ({ url: '/clubs', method: 'POST', body }), invalidatesTags: ['Club', 'Admin'] }),
    updateClub: b.mutation({ query: ({ id, ...body }) => ({ url: `/clubs/${id}`, method: 'PUT', body }), invalidatesTags: ['Club'] }),
    deleteClub: b.mutation({ query: (id) => ({ url: `/clubs/${id}`, method: 'DELETE' }), invalidatesTags: ['Club', 'Admin'] }),
    reviewClub: b.mutation({
      query: ({ id, ...body }) => ({ url: `/clubs/${id}/review`, method: 'PATCH', body }),
      invalidatesTags: ['Club', 'Admin'],
    }),
    joinClub: b.mutation({
      query: ({ id, message }) => ({ url: `/clubs/${id}/join`, method: 'POST', body: { message } }),
      invalidatesTags: ['Club'],
    }),
    cancelJoin: b.mutation({ query: (id) => ({ url: `/clubs/${id}/join`, method: 'DELETE' }), invalidatesTags: ['Club'] }),
    leaveClub: b.mutation({
      query: (id) => ({ url: `/clubs/${id}/leave`, method: 'POST' }),
      invalidatesTags: ['Club', 'Dashboard', 'Me'],
    }),
    getClubRequests: b.query({ query: (id) => `/clubs/${id}/requests`, providesTags: ['Club'] }),
    handleClubRequest: b.mutation({
      query: ({ id, userId, action }) => ({ url: `/clubs/${id}/requests/${userId}/${action}`, method: 'POST' }),
      invalidatesTags: ['Club'],
    }),
    removeClubMember: b.mutation({
      query: ({ id, userId }) => ({ url: `/clubs/${id}/members/${userId}`, method: 'DELETE' }),
      invalidatesTags: ['Club'],
    }),
    setClubMemberRole: b.mutation({
      query: ({ id, userId, makeAdmin }) => ({ url: `/clubs/${id}/members/${userId}/role`, method: 'PATCH', body: { makeAdmin } }),
      invalidatesTags: ['Club'],
    }),

    // ── Events ────────────────────────────────────────
    getEvents: b.query({ query: (params) => ({ url: '/events', params }), providesTags: ['Event'] }),
    getEvent: b.query({ query: (id) => `/events/${id}`, providesTags: ['Event'] }),
    getFacultyCoordinators: b.query({ query: () => '/events/faculty-coordinators', providesTags: ['User'] }),
    createEvent: b.mutation({ query: (body) => ({ url: '/events', method: 'POST', body }), invalidatesTags: ['Event', 'Dashboard'] }),
    updateEvent: b.mutation({
      query: ({ id, ...body }) => ({ url: `/events/${id}`, method: 'PUT', body }),
      invalidatesTags: ['Event', 'Dashboard'],
    }),
    deleteEvent: b.mutation({ query: (id) => ({ url: `/events/${id}`, method: 'DELETE' }), invalidatesTags: ['Event', 'Dashboard'] }),
    registerEvent: b.mutation({
      query: (id) => ({ url: `/events/${id}/register`, method: 'POST' }),
      invalidatesTags: ['Event', 'Dashboard'],
    }),
    cancelRegistration: b.mutation({
      query: (id) => ({ url: `/events/${id}/register`, method: 'DELETE' }),
      invalidatesTags: ['Event', 'Dashboard'],
    }),
    getParticipants: b.query({ query: (id) => `/events/${id}/participants`, providesTags: ['Event'] }),
    markAttendance: b.mutation({
      query: ({ id, userId, attended, date, confirmOverwrite }) => ({
        url: `/events/${id}/attendance/${userId}`,
        method: 'PATCH',
        body: { attended, date, ...(confirmOverwrite ? { confirmOverwrite: true } : {}) },
      }),
      invalidatesTags: ['Event', 'Attendance'],
    }),

    // ── Announcements ─────────────────────────────────
    getAnnouncements: b.query({ query: (params) => ({ url: '/announcements', params }), providesTags: ['Announcement'] }),
    createAnnouncement: b.mutation({
      query: (body) => ({ url: '/announcements', method: 'POST', body }),
      invalidatesTags: ['Announcement', 'Dashboard'],
    }),
    updateAnnouncement: b.mutation({
      query: ({ id, ...body }) => ({ url: `/announcements/${id}`, method: 'PUT', body }),
      invalidatesTags: ['Announcement', 'Dashboard'],
    }),
    deleteAnnouncement: b.mutation({
      query: (id) => ({ url: `/announcements/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Announcement', 'Dashboard'],
    }),
    togglePinAnnouncement: b.mutation({
      query: (id) => ({ url: `/announcements/${id}/pin`, method: 'PATCH' }),
      invalidatesTags: ['Announcement', 'Dashboard'],
    }),

    // ── Student achievements ──
    getAchievements: b.query({ query: (params) => ({ url: '/achievements', params }), providesTags: ['Achievement'] }),
    getAchievementsDashboard: b.query({ query: () => '/achievements/dashboard', providesTags: ['Achievement'] }),
    getAchievement: b.query({ query: (id) => `/achievements/${id}`, providesTags: ['Achievement'] }),
    getStudentAchievements: b.query({ query: (id) => `/achievements/student/${id}`, providesTags: ['Achievement'] }),
    getAchievementStats: b.query({ query: () => '/achievements/stats', providesTags: ['Achievement'] }),
    searchAchievementStudents: b.query({ query: (params) => ({ url: '/achievements/students', params }) }),
    createAchievement: b.mutation({
      query: (body) => ({ url: '/achievements', method: 'POST', body }),
      invalidatesTags: ['Achievement', 'Announcement', 'Notification'],
    }),
    updateAchievement: b.mutation({
      query: ({ id, ...body }) => ({ url: `/achievements/${id}`, method: 'PUT', body }),
      invalidatesTags: ['Achievement', 'Notification'],
    }),
    deleteAchievement: b.mutation({
      query: (id) => ({ url: `/achievements/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Achievement', 'Announcement'],
    }),
    restoreAchievement: b.mutation({
      query: (id) => ({ url: `/achievements/${id}/restore`, method: 'POST' }),
      invalidatesTags: ['Achievement'],
    }),
    toggleFeaturedAchievement: b.mutation({
      query: (id) => ({ url: `/achievements/${id}/feature`, method: 'PATCH' }),
      invalidatesTags: ['Achievement'],
    }),
    congratulateAchievement: b.mutation({
      query: (id) => ({ url: `/achievements/${id}/congratulate`, method: 'POST' }),
      invalidatesTags: ['Achievement'],
    }),
    requestAchievementHide: b.mutation({
      query: ({ id, reason }) => ({ url: `/achievements/${id}/hide-request`, method: 'POST', body: { reason } }),
      invalidatesTags: ['Achievement'],
    }),
    resolveAchievementHide: b.mutation({
      query: ({ id, reqId, action }) => ({ url: `/achievements/${id}/hide-request/${reqId}`, method: 'PATCH', body: { action } }),
      invalidatesTags: ['Achievement'],
    }),

    // ── Discussions ───────────────────────────────────
    getDiscussions: b.query({ query: (params) => ({ url: '/discussions', params }), providesTags: ['Discussion'] }),
    getDiscussion: b.query({ query: (id) => `/discussions/${id}`, providesTags: (_r, _e, id) => [{ type: 'Discussion', id }] }),
    createDiscussion: b.mutation({
      query: (body) => ({ url: '/discussions', method: 'POST', body }),
      invalidatesTags: ['Discussion', 'Dashboard'],
    }),
    deleteDiscussion: b.mutation({
      query: (id) => ({ url: `/discussions/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Discussion', 'Dashboard'],
    }),
    addReply: b.mutation({
      query: ({ id, body }) => ({ url: `/discussions/${id}/replies`, method: 'POST', body: { body } }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Discussion', id }, 'Discussion'],
    }),
    deleteReply: b.mutation({
      query: ({ id, replyId }) => ({ url: `/discussions/${id}/replies/${replyId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Discussion', id }],
    }),
    upvoteDiscussion: b.mutation({
      query: (id) => ({ url: `/discussions/${id}/upvote`, method: 'POST' }),
      invalidatesTags: (_r, _e, id) => [{ type: 'Discussion', id }, 'Discussion'],
    }),
    upvoteReply: b.mutation({
      query: ({ id, replyId }) => ({ url: `/discussions/${id}/replies/${replyId}/upvote`, method: 'POST' }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Discussion', id }],
    }),
    moderateDiscussion: b.mutation({
      query: ({ id, action }) => ({ url: `/discussions/${id}/moderate/${action}`, method: 'PATCH' }),
      invalidatesTags: ['Discussion'],
    }),

    // ── Reports ───────────────────────────────────────
    createReport: b.mutation({ query: (body) => ({ url: '/reports', method: 'POST', body }) }),
    getReports: b.query({ query: (params) => ({ url: '/reports', params }), providesTags: ['Report'] }),
    resolveReport: b.mutation({
      query: ({ id, ...body }) => ({ url: `/reports/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Report', 'Discussion', 'Admin'],
    }),

    // ── Notifications ─────────────────────────────────
    getNotifications: b.query({
      query: (params) => ({ url: '/notifications', params }),
      providesTags: ['Notification'],
    }),
    markNotificationRead: b.mutation({
      query: (id) => ({ url: `/notifications/${id}/read`, method: 'PATCH' }),
      invalidatesTags: ['Notification', 'Dashboard'],
    }),
    markAllNotificationsRead: b.mutation({
      query: () => ({ url: '/notifications/read-all', method: 'PATCH' }),
      invalidatesTags: ['Notification', 'Dashboard'],
    }),
    deleteNotification: b.mutation({
      query: (id) => ({ url: `/notifications/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Notification'],
    }),

    // ── Admin ─────────────────────────────────────────
    getAnalytics: b.query({ query: () => '/admin/analytics', providesTags: ['Admin'] }),
    getAdminUsers: b.query({ query: (params) => ({ url: '/admin/users', params }), providesTags: ['Admin'] }),
    updateAdminUser: b.mutation({
      query: ({ id, ...body }) => ({ url: `/admin/users/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Admin', 'User'],
    }),
    getActivity: b.query({ query: (params) => ({ url: '/admin/activity', params }), providesTags: ['Admin'] }),
    createAdminUser: b.mutation({ query: (body) => ({ url: '/admin/users', method: 'POST', body }), invalidatesTags: ['Admin', 'User'] }),
    deleteAdminUser: b.mutation({
      query: (id) => ({ url: `/admin/users/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Admin', 'User'],
    }),
    // Authorized reset (Admin: any non-admin account; Class In-Charge: own students). No current password.
    resetUserPassword: b.mutation({
      query: ({ id, ...body }) => ({ url: `/users/${id}/reset-password`, method: 'POST', body }),
      invalidatesTags: ['Security'],
    }),
    // Admin → Security & Logs (admin only on the server).
    getSecuritySummary: b.query({ query: () => '/admin/security/summary', providesTags: ['Security'], keepUnusedDataFor: 0 }),
    getSecurityLogs: b.query({ query: (params) => ({ url: '/admin/security/logs', params }), providesTags: ['Security'], keepUnusedDataFor: 0 }),
    getSecurityOtps: b.query({ query: (params) => ({ url: '/super-admin/security/otps', params }), keepUnusedDataFor: 0 }), // Super Admin only

    // ── Admin → Role Assignments & Class In-Charge Handover / Swap ──
    getRoleAssignmentsOverview: b.query({
      query: () => '/admin/role-assignments/overview',
      providesTags: ['Admin', 'User'],
    }),
    assignClassInCharge: b.mutation({
      query: (body) => ({ url: '/admin/role-assignments/assign-class-in-charge', method: 'POST', body }),
      invalidatesTags: ['Admin', 'User', 'ClassStudents'],
    }),
    swapClassInCharge: b.mutation({
      query: (body) => ({ url: '/admin/role-assignments/swap-class-in-charge', method: 'POST', body }),
      invalidatesTags: ['Admin', 'User', 'ClassStudents'],
    }),
    unassignClassInCharge: b.mutation({
      query: (body) => ({ url: '/admin/role-assignments/unassign-class-in-charge', method: 'POST', body }),
      invalidatesTags: ['Admin', 'User', 'ClassStudents'],
    }),
    setDepartmentHod: b.mutation({
      query: (body) => ({ url: '/admin/role-assignments/set-hod', method: 'POST', body }),
      invalidatesTags: ['Admin', 'User', 'ClassStudents', 'Dashboard'],
    }),
    demoteDepartmentHod: b.mutation({
      query: (body) => ({ url: '/admin/role-assignments/demote-hod', method: 'POST', body }),
      invalidatesTags: ['Admin', 'User', 'ClassStudents', 'Dashboard'],
    }),

    // ── Class In-Charge: students of their own class ──
    getClassStudents: b.query({ query: () => '/class-students', providesTags: ['ClassStudents'] }),
    createClassStudent: b.mutation({ query: (body) => ({ url: '/class-students', method: 'POST', body }), invalidatesTags: ['ClassStudents'] }),
    // One student of the Class In-Charge's class (with mobiles), and editing it.
    getClassStudent: b.query({ query: (id) => `/class-students/${id}`, providesTags: ['ClassStudents'] }),
    updateClassStudent: b.mutation({
      query: ({ id, ...body }) => ({ url: `/class-students/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['ClassStudents', 'Attendance', 'User'],
    }),

    // ── Chat ──────────────────────────────────────────
    getConversations: b.query({ query: (params) => ({ url: '/chat/conversations', params }), providesTags: ['Chat'] }),
    getConversation: b.query({ query: (id) => `/chat/conversations/${id}`, providesTags: (_r, _e, id) => [{ type: 'Chat', id }] }),
    getChatUnread: b.query({ query: () => '/chat/unread', providesTags: ['Chat'] }),
    createConversation: b.mutation({ query: (body) => ({ url: '/chat/conversations', method: 'POST', body }), invalidatesTags: ['Chat'] }),
    getMessages: b.query({
      query: ({ id, ...params }) => ({ url: `/chat/conversations/${id}/messages`, params }),
      providesTags: (_r, _e, { id }) => [{ type: 'ChatMessages', id }],
    }),
    sendMessage: b.mutation({ query: ({ id, ...body }) => ({ url: `/chat/conversations/${id}/messages`, method: 'POST', body }) }),
    editMessage: b.mutation({ query: ({ id, msgId, body }) => ({ url: `/chat/conversations/${id}/messages/${msgId}`, method: 'PATCH', body: { body } }) }),
    deleteMessage: b.mutation({ query: ({ id, msgId }) => ({ url: `/chat/conversations/${id}/messages/${msgId}`, method: 'DELETE' }) }),
    markConversationRead: b.mutation({ query: (id) => ({ url: `/chat/conversations/${id}/read`, method: 'PATCH' }), invalidatesTags: ['Chat'] }),
    searchMessages: b.query({ query: (q) => ({ url: '/chat/search', params: { q } }) }),
    addChatMembers: b.mutation({
      query: ({ id, userIds }) => ({ url: `/chat/conversations/${id}/members`, method: 'POST', body: { userIds } }),
      invalidatesTags: ['Chat'],
    }),
    getGroupRequests: b.query({ query: (params) => ({ url: '/chat/requests', params }), providesTags: ['ChatRequest'] }),
    reviewGroupRequest: b.mutation({
      query: ({ id, ...body }) => ({ url: `/chat/requests/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['ChatRequest', 'Chat', 'Notification'],
    }),
    leaveConversation: b.mutation({
      query: ({ id, userId }) => ({ url: `/chat/conversations/${id}/members/${userId}`, method: 'DELETE' }),
      invalidatesTags: ['Chat'],
    }),
    // Group admin (the creator) only: rename / delete a group.
    updateGroup: b.mutation({ query: ({ id, ...body }) => ({ url: `/chat/conversations/${id}`, method: 'PATCH', body }), invalidatesTags: ['Chat'] }),
    deleteGroup: b.mutation({ query: (id) => ({ url: `/chat/conversations/${id}`, method: 'DELETE' }), invalidatesTags: ['Chat'] }),
    toggleGroupAdmin: b.mutation({
      query: ({ id, userId }) => ({ url: `/chat/conversations/${id}/admins/${userId}`, method: 'PATCH' }),
      invalidatesTags: ['Chat'],
    }),
    // HOD group builder: every student of one class in the HOD's department.
    getGroupClass: b.query({ query: (params) => ({ url: '/chat/group-class', params }), providesTags: ['User'] }),

    // ── Attendance ────────────────────────────────────
    getMyAttendance: b.query({ query: (params) => ({ url: '/attendance/my', params }), providesTags: ['Attendance'] }),
    getAttendanceRecords: b.query({ query: (params) => ({ url: '/attendance/records', params }), providesTags: ['Attendance'] }),
    getAttendanceTrends: b.query({ query: (params) => ({ url: '/attendance/trends', params }), providesTags: ['Attendance'] }),
    getRoster: b.query({ query: (params) => ({ url: '/attendance/roster', params }), providesTags: ['Attendance'] }),
    markClassAttendance: b.mutation({
      query: (body) => ({ url: '/attendance/mark', method: 'POST', body }),
      // Also refreshes staff attendance: taking a class marks the faculty present for the day.
      invalidatesTags: ['Attendance', 'Analytics', 'StaffAttendance'],
    }),
    getAttendanceSessions: b.query({ query: (params) => ({ url: '/attendance/sessions', params }), providesTags: ['Attendance'] }),
    getLowAttendance: b.query({ query: (params) => ({ url: '/attendance/low', params }), providesTags: ['Attendance'] }),
    // "My Classes": the signed-in faculty member's own subject/section list and
    // the attendance of one of those exact classes.
    getMyClassOptions: b.query({ query: () => '/attendance/my-classes/options', providesTags: ['Attendance', 'Timetable'] }),
    getMyClassAttendance: b.query({ query: (params) => ({ url: '/attendance/my-classes', params }), providesTags: ['Attendance'] }),
    getReportOptions: b.query({ query: (params) => ({ url: '/attendance/reports/options', params }), providesTags: ['Attendance', 'Timetable'] }),
    // "Our Class": the complete attendance of the faculty member's Class In-Charge class.
    getOurClassAttendance: b.query({ query: (params) => ({ url: '/attendance/our-class', params }), providesTags: ['Attendance'] }),
    // The report Period dropdown, derived from the authorized class's timetable for a date.
    getReportPeriods: b.query({ query: (params) => ({ url: '/attendance/reports/periods', params }), providesTags: ['Attendance', 'Timetable'] }),
    getAttendanceReport: b.query({
      query: ({ type, ...params }) => ({ url: `/attendance/reports/${type}`, params }),
      providesTags: ['Attendance'],
    }),
    notifyLowAttendanceStudent: b.mutation({
      query: ({ id, message }) => ({ url: `/attendance/notify/${id}`, method: 'POST', body: { message } }),
    }),
    getStudentAttendance: b.query({ query: ({ id, ...params }) => ({ url: `/attendance/student/${id}`, params }), providesTags: ['Attendance'] }),
    getSubjectAttendance: b.query({ query: ({ id, ...params }) => ({ url: `/attendance/subject/${id}`, params }), providesTags: ['Attendance'] }),
    getCorrections: b.query({ query: (params) => ({ url: '/attendance/corrections', params }), providesTags: ['Correction'] }),
    requestCorrection: b.mutation({ query: (body) => ({ url: '/attendance/corrections', method: 'POST', body }), invalidatesTags: ['Correction'] }),
    reviewCorrection: b.mutation({
      query: ({ id, ...body }) => ({ url: `/attendance/corrections/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Correction', 'Attendance'],
    }),
    // ── OD / Leave Requests ──────────────────────────────
    getMyODLeaveRequests: b.query({ query: (params) => ({ url: '/attendance/od-leave/my', params }), providesTags: ['ODLeave'] }),
    getPendingODLeaveReviews: b.query({ query: (params) => ({ url: '/attendance/od-leave/reviews', params }), providesTags: ['ODLeave'] }),
    createODLeaveRequest: b.mutation({ query: (body) => ({ url: '/attendance/od-leave', method: 'POST', body }), invalidatesTags: ['ODLeave', 'Attendance'] }),
    reviewODLeaveRequest: b.mutation({
      query: ({ id, ...body }) => ({ url: `/attendance/od-leave/${id}/review`, method: 'PATCH', body }),
      invalidatesTags: ['ODLeave', 'Attendance'],
    }),
    cancelODLeaveRequest: b.mutation({
      query: (id) => ({ url: `/attendance/od-leave/${id}/cancel`, method: 'PATCH' }),
      invalidatesTags: ['ODLeave', 'Attendance'],
    }),
    getAttendanceSummary: b.query({ query: (params) => ({ url: '/attendance/summary', params }), providesTags: ['Attendance', 'StaffAttendance'] }),
    getSummaryStudents: b.query({ query: (params) => ({ url: '/attendance/summary/students', params }), providesTags: ['Attendance'] }),
    getAttendanceBreakdown: b.query({ query: (params) => ({ url: '/attendance/summary/breakdown', params }), providesTags: ['Attendance', 'StaffAttendance'] }),
    getSummaryFaculty: b.query({ query: (params) => ({ url: '/attendance/summary/faculty', params }), providesTags: ['StaffAttendance'] }),
    getFacultyRoster: b.query({ query: (params) => ({ url: '/attendance/faculty/roster', params }), providesTags: ['StaffAttendance'] }),
    markFacultyAttendance: b.mutation({
      query: (body) => ({ url: '/attendance/faculty/mark', method: 'POST', body }),
      invalidatesTags: ['StaffAttendance'],
    }),

    // ── Holidays (create / edit / delete: Principal only, enforced server-side) ──
    getHolidays: b.query({ query: (params) => ({ url: '/holidays', params }), providesTags: ['Holiday'] }),
    getHolidayOptions: b.query({ query: () => '/holidays/options' }),
    createHoliday: b.mutation({ query: (body) => ({ url: '/holidays', method: 'POST', body }), invalidatesTags: ['Holiday', 'Attendance', 'Timetable'] }),
    updateHoliday: b.mutation({ query: ({ id, ...body }) => ({ url: `/holidays/${id}`, method: 'PUT', body }), invalidatesTags: ['Holiday', 'Attendance', 'Timetable'] }),
    deleteHoliday: b.mutation({ query: (id) => ({ url: `/holidays/${id}`, method: 'DELETE' }), invalidatesTags: ['Holiday', 'Attendance', 'Timetable'] }),

    // ── Timetable / subjects ──────────────────────────
    getTimetable: b.query({ query: (params) => ({ url: '/timetable', params }), providesTags: ['Timetable'] }),
    getMasterTimetable: b.query({ query: (params) => ({ url: '/timetable/master', params }), providesTags: ['Timetable'] }),
    getFacultyAvailability: b.query({ query: (params) => ({ url: '/timetable/faculty-availability', params }), providesTags: ['Timetable'] }),
    getCurrentClass: b.query({ query: () => '/timetable/current', providesTags: ['Timetable'] }),
    getTimetableFacultyOptions: b.query({ query: () => '/timetable/faculty-options', providesTags: ['User'] }),
    // "My Schedule": always the authenticated user's own teaching periods.
    getMySchedule: b.query({ query: (params) => ({ url: '/timetable/my-schedule', params }), providesTags: ['Timetable'] }),

    // ── Exam timetable (manage: HOD own scope / COE campus-wide, enforced server-side) ──
    // A published exam blocks overlapping attendance periods, so every change
    // also refreshes the attendance views.
    getExams: b.query({ query: (params) => ({ url: '/exams', params }), providesTags: ['Exam'] }),
    getExamOptions: b.query({ query: (params) => ({ url: '/exams/options', params }), providesTags: ['Exam'] }),
    createExams: b.mutation({ query: (body) => ({ url: '/exams', method: 'POST', body }), invalidatesTags: ['Exam', 'Attendance'] }),
    updateExam: b.mutation({ query: ({ id, ...body }) => ({ url: `/exams/${id}`, method: 'PUT', body }), invalidatesTags: ['Exam', 'Attendance'] }),
    publishExam: b.mutation({ query: (id) => ({ url: `/exams/${id}/publish`, method: 'PATCH' }), invalidatesTags: ['Exam', 'Attendance'] }),
    cancelExam: b.mutation({ query: ({ id, reason }) => ({ url: `/exams/${id}/cancel`, method: 'PATCH', body: { reason } }), invalidatesTags: ['Exam', 'Attendance'] }),

    // ── College buses (scoped per viewer server-side) ──
    getTransportConfig: b.query({ query: () => '/transport/config', providesTags: ['Transport'] }),
    getBuses: b.query({ query: () => '/transport/buses', providesTags: ['Transport'] }),
    getBus: b.query({ query: ({ id, stopId }) => ({ url: `/transport/buses/${id}`, params: stopId ? { stopId } : undefined }), providesTags: ['Transport'] }),
    searchTransport: b.query({ query: (q) => ({ url: '/transport/search', params: { q } }) }),
    getTransportMe: b.query({ query: () => '/transport/me', providesTags: ['Transport'] }),
    getTransportRoutes: b.query({ query: (params) => ({ url: '/transport/routes', params }), providesTags: ['Transport'] }),
    createBusRoute: b.mutation({ query: (body) => ({ url: '/transport/routes', method: 'POST', body }), invalidatesTags: ['Transport'] }),
    updateBusRoute: b.mutation({ query: ({ id, ...body }) => ({ url: `/transport/routes/${id}`, method: 'PUT', body }), invalidatesTags: ['Transport'] }),
    createBus: b.mutation({ query: (body) => ({ url: '/transport/buses', method: 'POST', body }), invalidatesTags: ['Transport'] }),
    updateBus: b.mutation({ query: ({ id, ...body }) => ({ url: `/transport/buses/${id}`, method: 'PUT', body }), invalidatesTags: ['Transport'] }),
    getTransportAssignments: b.query({ query: (params) => ({ url: '/transport/assignments', params }), providesTags: ['Transport'] }),
    setTransportAssignment: b.mutation({ query: (body) => ({ url: '/transport/assignments', method: 'PUT', body }), invalidatesTags: ['Transport'] }),
    deleteTransportAssignment: b.mutation({ query: (id) => ({ url: `/transport/assignments/${id}`, method: 'DELETE' }), invalidatesTags: ['Transport'] }),
    pickTransportPeople: b.query({ query: (params) => ({ url: '/transport/people', params }) }),
    stopBusTrip: b.mutation({ query: (id) => ({ url: `/transport/trips/${id}/stop`, method: 'POST', body: { reason: 'stopped' } }), invalidatesTags: ['Transport'] }),

    // ── Staff attendance, cover and monitoring (scoped server-side) ──
    getStaffReport: b.query({ query: (params) => ({ url: '/attendance/staff-report', params }), providesTags: ['Attendance', 'StaffAttendance', 'Cover'] }),
    getLowMonitor: b.query({ query: (params) => ({ url: '/attendance/low-monitor', params }), providesTags: ['Attendance'] }),
    getCover: b.query({ query: (params) => ({ url: '/staff/cover', params }), providesTags: ['Cover', 'StaffAttendance'] }),
    getAvailableSubstitutes: b.query({ query: (params) => ({ url: '/staff/cover/available', params }), providesTags: ['Cover'] }),
    assignCover: b.mutation({ query: (body) => ({ url: '/staff/cover', method: 'POST', body }), invalidatesTags: ['Cover', 'Attendance'] }),
    cancelCover: b.mutation({ query: ({ id, reason }) => ({ url: `/staff/cover/${id}`, method: 'DELETE', body: { reason } }), invalidatesTags: ['Cover', 'Attendance'] }),
    getEarlyExits: b.query({ query: (params) => ({ url: '/staff/early-exits', params }), providesTags: ['Cover'] }),
    requestEarlyExit: b.mutation({ query: (body) => ({ url: '/staff/early-exits', method: 'POST', body }), invalidatesTags: ['Cover', 'Attendance'] }),
    decideEarlyExit: b.mutation({ query: ({ id, ...body }) => ({ url: `/staff/early-exits/${id}/decision`, method: 'PATCH', body }), invalidatesTags: ['Cover', 'Attendance'] }),
    recordDeparture: b.mutation({ query: (id) => ({ url: `/staff/early-exits/${id}/departure`, method: 'PATCH' }), invalidatesTags: ['Cover'] }),
    cancelEarlyExit: b.mutation({ query: (id) => ({ url: `/staff/early-exits/${id}/cancel`, method: 'PATCH' }), invalidatesTags: ['Cover'] }),

    // ── Study materials ────────────────────────────────
    getStudyMaterials: b.query({ query: (params) => ({ url: '/study-materials', params }), providesTags: ['StudyMaterial'] }),
    getStudyMaterial: b.query({ query: (id) => `/study-materials/${id}`, providesTags: ['StudyMaterial'] }),
    getMyTeachingAssignments: b.query({ query: () => '/study-materials/my-assignments' }),
    getStudyMaterialStatus: b.query({ query: (params) => ({ url: '/study-materials/status', params }), providesTags: ['StudyMaterial'] }),
    uploadStudyMaterial: b.mutation({ query: (body) => ({ url: '/study-materials', method: 'POST', body }), invalidatesTags: ['StudyMaterial'] }),
    updateStudyMaterial: b.mutation({ query: ({ id, ...body }) => ({ url: `/study-materials/${id}`, method: 'PUT', body }), invalidatesTags: ['StudyMaterial'] }),
    deleteStudyMaterial: b.mutation({ query: (id) => ({ url: `/study-materials/${id}`, method: 'DELETE' }), invalidatesTags: ['StudyMaterial'] }),

    // ── JNN Study Assistant (chat itself streams via services/studyAssistant.js) ──
    getAssistantConversations: b.query({ query: () => '/ai/study-assistant/conversations', providesTags: ['AssistantConversation'] }),
    getAssistantConversation: b.query({ query: (id) => `/ai/study-assistant/conversations/${id}`, keepUnusedDataFor: 0 }),
    sendAssistantMessage: b.mutation({
      query: (body) => ({ url: '/ai/study-assistant/chat', method: 'POST', body }),
      invalidatesTags: ['AssistantConversation'],
    }),
    deleteAssistantConversation: b.mutation({
      query: (id) => ({ url: `/ai/study-assistant/conversations/${id}`, method: 'DELETE' }),
      invalidatesTags: ['AssistantConversation'],
    }),
    getMyPeriods: b.query({ query: () => '/attendance/my-periods', providesTags: ['Attendance', 'Timetable'] }),
    getSubjects: b.query({ query: (params) => ({ url: '/subjects', params }), providesTags: ['Subject'] }),
    createSubject: b.mutation({ query: (body) => ({ url: '/subjects', method: 'POST', body }), invalidatesTags: ['Subject'] }),
    updateSubject: b.mutation({ query: ({ id, ...body }) => ({ url: `/subjects/${id}`, method: 'PUT', body }), invalidatesTags: ['Subject', 'Timetable'] }),
    deleteSubject: b.mutation({ query: (id) => ({ url: `/subjects/${id}`, method: 'DELETE' }), invalidatesTags: ['Subject', 'Timetable'] }),
    createSlot: b.mutation({ query: (body) => ({ url: '/timetable', method: 'POST', body }), invalidatesTags: ['Timetable'] }),
    updateSlot: b.mutation({ query: ({ id, ...body }) => ({ url: `/timetable/${id}`, method: 'PUT', body }), invalidatesTags: ['Timetable'] }),
    deleteSlot: b.mutation({ query: (id) => ({ url: `/timetable/${id}`, method: 'DELETE' }), invalidatesTags: ['Timetable'] }),

    // ── Gate pass ─────────────────────────────────────
    getGatePasses: b.query({ query: (params) => ({ url: '/gate-pass', params }), providesTags: ['GatePass'] }),
    getGatePass: b.query({ query: (id) => `/gate-pass/${id}`, providesTags: ['GatePass'] }),
    getGatePassQr: b.query({ query: (id) => `/gate-pass/${id}/qr`, providesTags: ['GatePass'], keepUnusedDataFor: 0 }),
    getGateDashboard: b.query({ query: (params) => ({ url: '/gate-pass/dashboard', params }), providesTags: ['GatePass'] }),
    getSecurityDashboard: b.query({ query: () => '/gate-pass/dashboard/security', providesTags: ['GatePass'] }),
    createGatePass: b.mutation({ query: (body) => ({ url: '/gate-pass', method: 'POST', body }), invalidatesTags: ['GatePass'] }),
    facultyReviewGatePass: b.mutation({ query: ({ id, ...body }) => ({ url: `/gate-pass/${id}/faculty-review`, method: 'PATCH', body }), invalidatesTags: ['GatePass'] }),
    getParentOtp: b.query({ query: (id) => `/gate-pass/${id}/parent-otp`, keepUnusedDataFor: 0 }),
    // `mobile` + `reason` are optional: the faculty's edited number when the registered one is not reachable.
    requestParentOtp: b.mutation({
      query: (arg) => {
        const { id, mobile, reason } = typeof arg === 'string' ? { id: arg } : arg;
        return { url: `/gate-pass/${id}/parent-otp`, method: 'POST', body: mobile ? { mobile, reason } : {} };
      },
    }),
    verifyParentOtp: b.mutation({ query: ({ id, otp }) => ({ url: `/gate-pass/${id}/parent-otp/verify`, method: 'POST', body: { otp } }), invalidatesTags: ['GatePass'] }),
    getDevOtps: b.query({ query: () => '/dev/otp', keepUnusedDataFor: 0 }),
    hodReviewGatePass: b.mutation({ query: ({ id, ...body }) => ({ url: `/gate-pass/${id}/hod-review`, method: 'PATCH', body }), invalidatesTags: ['GatePass'] }),
    principalReviewGatePass: b.mutation({ query: ({ id, ...body }) => ({ url: `/gate-pass/${id}/principal-review`, method: 'PATCH', body }), invalidatesTags: ['GatePass'] }),
    massApproveGatePass: b.mutation({ query: (body) => ({ url: '/gate-pass/mass-approve', method: 'POST', body }), invalidatesTags: ['GatePass'] }),
    cancelGatePass: b.mutation({ query: (id) => ({ url: `/gate-pass/${id}/cancel`, method: 'PATCH' }), invalidatesTags: ['GatePass'] }),
    revokeGatePass: b.mutation({ query: ({ id, reason }) => ({ url: `/gate-pass/${id}/revoke`, method: 'PATCH', body: { reason } }), invalidatesTags: ['GatePass'] }),
    verifyGatePass: b.mutation({ query: (code) => ({ url: '/gate-pass/verify', method: 'POST', body: { code } }) }),
    recordGateOut: b.mutation({ query: ({ id, code }) => ({ url: `/gate-pass/${id}/out`, method: 'PATCH', body: { code } }), invalidatesTags: ['GatePass'] }),
    createEmergencyGatePass: b.mutation({ query: (body) => ({ url: '/gate-pass/emergency', method: 'POST', body }), invalidatesTags: ['GatePass'] }),
    // Day scholar same-day Outing.
    createDayScholarOuting: b.mutation({ query: (body) => ({ url: '/gate-pass/outing', method: 'POST', body }), invalidatesTags: ['GatePass'] }),
    emergencyReviewGatePass: b.mutation({ query: ({ id, ...body }) => ({ url: `/gate-pass/${id}/emergency-review`, method: 'PATCH', body }), invalidatesTags: ['GatePass'] }),
    recordGateIn: b.mutation({ query: ({ id, code }) => ({ url: `/gate-pass/${id}/in`, method: 'PATCH', body: { code } }), invalidatesTags: ['GatePass'] }),
    verifyReturnCredential: b.mutation({ query: (code) => ({ url: '/gate-pass/return/verify', method: 'POST', body: { code } }) }),
    verifyReturnLocation: b.mutation({ query: ({ id, ...reading }) => ({ url: `/gate-pass/${id}/return-location/verify`, method: 'POST', body: reading }), invalidatesTags: ['GatePass'] }),
    adminReturnOverride: b.mutation({ query: ({ id, reason }) => ({ url: `/gate-pass/${id}/return-override`, method: 'PATCH', body: { reason } }), invalidatesTags: ['GatePass'] }),
    getReturnCredential: b.query({ query: (id) => `/gate-pass/${id}/return-credential`, providesTags: ['GatePass'], keepUnusedDataFor: 0 }),
    // Bulk approval ("Bind") groups.
    getClassToday: b.query({ query: () => '/attendance/our-class/today', providesTags: ['Attendance'], keepUnusedDataFor: 30 }),
    getBindGroups: b.query({ query: (params) => ({ url: '/gate-pass/bind-groups', params }), providesTags: ['GatePass'] }),
    createBindGroup: b.mutation({ query: (body) => ({ url: '/gate-pass/bind-groups', method: 'POST', body }), invalidatesTags: ['GatePass'] }),
    deleteBindGroup: b.mutation({ query: (id) => ({ url: `/gate-pass/bind-groups/${id}`, method: 'DELETE' }), invalidatesTags: ['GatePass'] }),
    bindGatePass: b.mutation({ query: ({ id, groupId }) => ({ url: `/gate-pass/${id}/bind`, method: 'POST', body: { groupId } }), invalidatesTags: ['GatePass'] }),
    unbindGatePass: b.mutation({ query: (id) => ({ url: `/gate-pass/${id}/bind`, method: 'DELETE' }), invalidatesTags: ['GatePass'] }),
    submitBindGroup: b.mutation({ query: (id) => ({ url: `/gate-pass/bind-groups/${id}/submit`, method: 'POST' }), invalidatesTags: ['GatePass'] }),
    hodReviewBindGroup: b.mutation({ query: ({ id, ...body }) => ({ url: `/gate-pass/bind-groups/${id}/hod-review`, method: 'PATCH', body }), invalidatesTags: ['GatePass'] }),
    principalReviewBindGroup: b.mutation({ query: ({ id, ...body }) => ({ url: `/gate-pass/bind-groups/${id}/principal-review`, method: 'PATCH', body }), invalidatesTags: ['GatePass'] }),
    rejectBindMember: b.mutation({ query: ({ id, passId, reason }) => ({ url: `/gate-pass/bind-groups/${id}/members/${passId}/reject`, method: 'PATCH', body: { reason } }), invalidatesTags: ['GatePass'] }),

    // ── Complaints ────────────────────────────────────
    getComplaints: b.query({ query: (params) => ({ url: '/complaints', params }), providesTags: ['Complaint'] }),
    getComplaint: b.query({ query: (id) => `/complaints/${id}`, providesTags: ['Complaint'] }),
    getComplaintDashboard: b.query({ query: (params) => ({ url: '/complaints/dashboard', params }), providesTags: ['Complaint'] }),
    createComplaint: b.mutation({ query: (body) => ({ url: '/complaints', method: 'POST', body }), invalidatesTags: ['Complaint'] }),
    authorityUpdateComplaint: b.mutation({ query: ({ id, ...body }) => ({ url: `/complaints/${id}/authority-update`, method: 'PATCH', body }), invalidatesTags: ['Complaint'] }),
    markComplaintNotResolved: b.mutation({ query: (id) => ({ url: `/complaints/${id}/not-resolved`, method: 'PATCH' }), invalidatesTags: ['Complaint'] }),
    markComplaintResolved: b.mutation({ query: (id) => ({ url: `/complaints/${id}/resolved`, method: 'PATCH' }), invalidatesTags: ['Complaint'] }),
    cancelComplaint: b.mutation({ query: (id) => ({ url: `/complaints/${id}/cancel`, method: 'PATCH' }), invalidatesTags: ['Complaint'] }),

    // ── Lost & found ──────────────────────────────────
    getLostFound: b.query({ query: (params) => ({ url: '/lost-found', params }), providesTags: ['LostFound'] }),
    getLostFoundItem: b.query({ query: (id) => `/lost-found/${id}`, providesTags: ['LostFound'] }),
    getLostFoundMatches: b.query({ query: (id) => `/lost-found/${id}/matches`, providesTags: ['LostFound'] }),
    reportLostFound: b.mutation({ query: (body) => ({ url: '/lost-found', method: 'POST', body }), invalidatesTags: ['LostFound'] }),
    updateLostFound: b.mutation({ query: ({ id, ...body }) => ({ url: `/lost-found/${id}`, method: 'PUT', body }), invalidatesTags: ['LostFound'] }),
    deleteLostFound: b.mutation({ query: (id) => ({ url: `/lost-found/${id}`, method: 'DELETE' }), invalidatesTags: ['LostFound'] }),
    setLostFoundStatus: b.mutation({
      query: ({ id, ...body }) => ({ url: `/lost-found/${id}/status`, method: 'PATCH', body }),
      invalidatesTags: ['LostFound'],
    }),

    // ── Advanced analytics ────────────────────────────
    getStudentAnalytics: b.query({ query: (params) => ({ url: '/analytics/student', params }), providesTags: ['Analytics'] }),
    getFacultyAnalytics: b.query({ query: (params) => ({ url: '/analytics/faculty', params }), providesTags: ['Analytics'] }),
    getDepartmentAnalytics: b.query({ query: (params) => ({ url: '/analytics/department', params }), providesTags: ['Analytics'] }),
    getCollegeAnalytics: b.query({ query: (params) => ({ url: '/analytics/college', params }), providesTags: ['Analytics'] }),
    getGateAnalytics: b.query({ query: (params) => ({ url: '/analytics/gate', params }), providesTags: ['Analytics'] }),
    getClubAnalytics: b.query({ query: ({ id, ...params }) => ({ url: `/analytics/club/${id}`, params }), providesTags: ['Analytics'] }),

    // ── Alumni Network ────────────────────────────────
    getAlumni: b.query({
      query: (params) => ({ url: '/alumni', params }),
      providesTags: ['AlumniProfile'],
    }),
    getAlumniFilters: b.query({
      query: () => '/alumni/filters',
      providesTags: ['AlumniProfile'],
    }),
    getAlumniProfile: b.query({
      query: (userId) => `/alumni/${userId}`,
      providesTags: (r, e, id) => [{ type: 'AlumniProfile', id }],
    }),
    getMyAlumniProfile: b.query({
      query: () => '/alumni/me',
      providesTags: ['AlumniProfile', 'Me'],
    }),
    upsertAlumniProfile: b.mutation({
      query: (body) => ({ url: '/alumni/me', method: 'PUT', body }),
      invalidatesTags: ['AlumniProfile', 'Me'],
    }),
    verifyAlumniProfile: b.mutation({
      query: (id) => ({ url: `/alumni/${id}/verify`, method: 'PATCH' }),
      invalidatesTags: ['AlumniProfile', 'AlumniAnalytics'],
    }),
    rejectAlumniProfile: b.mutation({
      query: ({ id, reason }) => ({ url: `/alumni/${id}/reject`, method: 'POST', body: { reason } }),
      invalidatesTags: ['AlumniProfile', 'AlumniAnalytics'],
    }),

    // Mentorship
    getMentorshipRequests: b.query({
      query: (params) => ({ url: '/mentorship-requests', params }),
      providesTags: ['MentorshipRequest'],
    }),
    getMentorshipRequest: b.query({
      query: (id) => `/mentorship-requests/${id}`,
      providesTags: (r, e, id) => [{ type: 'MentorshipRequest', id }],
    }),
    createMentorshipRequest: b.mutation({
      query: (body) => ({ url: '/mentorship-requests', method: 'POST', body }),
      invalidatesTags: ['MentorshipRequest', 'AlumniProfile'],
    }),
    respondMentorshipRequest: b.mutation({
      query: ({ id, ...body }) => ({ url: `/mentorship-requests/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['MentorshipRequest', 'AlumniProfile'],
    }),
    cancelMentorshipRequest: b.mutation({
      query: ({ id, reason }) => ({ url: `/mentorship-requests/${id}/cancel`, method: 'PATCH', body: { reason } }),
      invalidatesTags: ['MentorshipRequest', 'AlumniProfile'],
    }),
    completeMentorship: b.mutation({
      query: (id) => ({ url: `/mentorship-requests/${id}/complete`, method: 'PATCH' }),
      invalidatesTags: ['MentorshipRequest', 'AlumniProfile'],
    }),
    rateMentorship: b.mutation({
      query: ({ id, ...body }) => ({ url: `/mentorship-requests/${id}/rate`, method: 'PATCH', body }),
      invalidatesTags: ['MentorshipRequest', 'AlumniProfile'],
    }),
    updateMentorshipGoals: b.mutation({
      query: ({ id, goals }) => ({ url: `/mentorship-requests/${id}/goals`, method: 'PATCH', body: { goals } }),
      invalidatesTags: ['MentorshipRequest'],
    }),
    getSlots: b.query({
      query: (params) => ({ url: '/mentorship/slots', params }),
      providesTags: ['MentorshipSlot'],
    }),
    createSlots: b.mutation({
      query: (body) => ({ url: '/mentorship/slots', method: 'POST', body }),
      invalidatesTags: ['MentorshipSlot'],
    }),
    deleteMentorshipSlot: b.mutation({
      query: (id) => ({ url: `/mentorship/slots/${id}`, method: 'DELETE' }),
      invalidatesTags: ['MentorshipSlot'],
    }),
    bookSession: b.mutation({
      query: (body) => ({ url: '/mentorship/sessions', method: 'POST', body }),
      invalidatesTags: ['MentorshipSlot', 'MentorshipSession', 'MentorshipRequest'],
    }),
    getMentorshipSessions: b.query({
      query: (params) => ({ url: '/mentorship/sessions', params }),
      providesTags: ['MentorshipSession'],
    }),
    rescheduleSession: b.mutation({
      query: ({ id, slot }) => ({ url: `/mentorship/sessions/${id}/reschedule`, method: 'PATCH', body: { slot } }),
      invalidatesTags: ['MentorshipSlot', 'MentorshipSession'],
    }),
    cancelSession: b.mutation({
      query: ({ id, reason }) => ({ url: `/mentorship/sessions/${id}/cancel`, method: 'PATCH', body: { reason } }),
      invalidatesTags: ['MentorshipSlot', 'MentorshipSession'],
    }),
    completeSession: b.mutation({
      query: ({ id, outcome }) => ({ url: `/mentorship/sessions/${id}/complete`, method: 'PATCH', body: { outcome } }),
      invalidatesTags: ['MentorshipSession', 'MentorshipRequest'],
    }),
    updateSessionNotes: b.mutation({
      query: ({ id, ...body }) => ({ url: `/mentorship/sessions/${id}/notes`, method: 'PATCH', body }),
      invalidatesTags: ['MentorshipSession'],
    }),
    messageMentor: b.mutation({
      query: (id) => ({ url: `/mentorship/requests/${id}/message`, method: 'POST' }),
      invalidatesTags: ['Chat'],
    }),

    // Jobs
    getAlumniJobs: b.query({
      query: (params) => ({ url: '/alumni/jobs', params }),
      providesTags: ['AlumniJob'],
    }),
    getAlumniJob: b.query({
      query: (id) => `/alumni/jobs/${id}`,
      providesTags: (r, e, id) => [{ type: 'AlumniJob', id }],
    }),
    createAlumniJob: b.mutation({
      query: (body) => ({ url: '/alumni/jobs', method: 'POST', body }),
      invalidatesTags: ['AlumniJob', 'AlumniAnalytics'],
    }),
    updateAlumniJob: b.mutation({
      query: ({ id, ...body }) => ({ url: `/alumni/jobs/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['AlumniJob'],
    }),
    closeAlumniJob: b.mutation({
      query: (id) => ({ url: `/alumni/jobs/${id}/close`, method: 'PATCH' }),
      invalidatesTags: ['AlumniJob'],
    }),
    reopenAlumniJob: b.mutation({
      query: (id) => ({ url: `/alumni/jobs/${id}/reopen`, method: 'PATCH' }),
      invalidatesTags: ['AlumniJob'],
    }),
    removeAlumniJob: b.mutation({
      query: ({ id, reason }) => ({ url: `/alumni/jobs/${id}`, method: 'DELETE', body: { reason } }),
      invalidatesTags: ['AlumniJob', 'AlumniAnalytics'],
    }),
    applyToJob: b.mutation({
      query: ({ id, ...body }) => ({ url: `/alumni/jobs/${id}/apply`, method: 'POST', body }),
      invalidatesTags: ['AlumniJob', 'JobApplication', 'AlumniAnalytics'],
    }),
    getJobApplications: b.query({
      query: (id) => `/alumni/jobs/${id}/applications`,
      providesTags: ['JobApplication'],
    }),
    getMyApplications: b.query({
      query: () => '/alumni/job-applications/mine',
      providesTags: ['JobApplication'],
    }),
    updateApplication: b.mutation({
      query: ({ id, ...body }) => ({ url: `/alumni/job-applications/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['JobApplication', 'AlumniJob', 'AlumniAnalytics'],
    }),
    withdrawApplication: b.mutation({
      query: (id) => ({ url: `/alumni/job-applications/${id}/withdraw`, method: 'PATCH' }),
      invalidatesTags: ['JobApplication', 'AlumniJob', 'AlumniAnalytics'],
    }),

    // Events
    getAlumniEvents: b.query({
      query: (params) => ({ url: '/alumni/events', params }),
      providesTags: ['AlumniEvent'],
    }),
    getAlumniEvent: b.query({
      query: (id) => `/alumni/events/${id}`,
      providesTags: (r, e, id) => [{ type: 'AlumniEvent', id }],
    }),
    createAlumniEvent: b.mutation({
      query: (body) => ({ url: '/alumni/events', method: 'POST', body }),
      invalidatesTags: ['AlumniEvent', 'AlumniAnalytics'],
    }),
    updateAlumniEvent: b.mutation({
      query: ({ id, ...body }) => ({ url: `/alumni/events/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['AlumniEvent'],
    }),
    approveAlumniEvent: b.mutation({
      query: (id) => ({ url: `/alumni/events/${id}/approve`, method: 'POST' }),
      invalidatesTags: ['AlumniEvent', 'AlumniAnalytics'],
    }),
    rejectAlumniEvent: b.mutation({
      query: ({ id, reason }) => ({ url: `/alumni/events/${id}/reject`, method: 'POST', body: { reason } }),
      invalidatesTags: ['AlumniEvent', 'AlumniAnalytics'],
    }),
    cancelAlumniEvent: b.mutation({
      query: ({ id, reason }) => ({ url: `/alumni/events/${id}/cancel`, method: 'POST', body: { reason } }),
      invalidatesTags: ['AlumniEvent', 'AlumniAnalytics'],
    }),
    rsvpEvent: b.mutation({
      query: (id) => ({ url: `/alumni/events/${id}/rsvp`, method: 'POST' }),
      invalidatesTags: ['AlumniEvent', 'AlumniAnalytics'],
    }),
    cancelRsvp: b.mutation({
      query: (id) => ({ url: `/alumni/events/${id}/rsvp`, method: 'DELETE' }),
      invalidatesTags: ['AlumniEvent', 'AlumniAnalytics'],
    }),
    getAttendees: b.query({
      query: (id) => `/alumni/events/${id}/attendees`,
      providesTags: ['AlumniEvent'],
    }),
    checkInAttendee: b.mutation({
      query: ({ id, userId }) => ({ url: `/alumni/events/${id}/checkin`, method: 'POST', body: { userId } }),
      invalidatesTags: ['AlumniEvent', 'AlumniAnalytics'],
    }),

    // Chapters
    getChapters: b.query({
      query: (params) => ({ url: '/alumni/chapters', params }),
      providesTags: ['Chapter'],
    }),
    getChapter: b.query({
      query: (slug) => `/alumni/chapters/${slug}`,
      providesTags: (r, e, slug) => [{ type: 'Chapter', id: slug }],
    }),
    createChapter: b.mutation({
      query: (body) => ({ url: '/alumni/chapters', method: 'POST', body }),
      invalidatesTags: ['Chapter', 'AlumniAnalytics'],
    }),
    updateChapter: b.mutation({
      query: ({ slug, ...body }) => ({ url: `/alumni/chapters/${slug}`, method: 'PATCH', body }),
      invalidatesTags: ['Chapter'],
    }),
    archiveChapter: b.mutation({
      query: (slug) => ({ url: `/alumni/chapters/${slug}`, method: 'DELETE' }),
      invalidatesTags: ['Chapter', 'AlumniAnalytics'],
    }),
    joinChapter: b.mutation({
      query: (slug) => ({ url: `/alumni/chapters/${slug}/join`, method: 'POST' }),
      invalidatesTags: ['Chapter', 'AlumniAnalytics'],
    }),
    leaveChapter: b.mutation({
      query: (slug) => ({ url: `/alumni/chapters/${slug}/join`, method: 'DELETE' }),
      invalidatesTags: ['Chapter', 'AlumniAnalytics'],
    }),
    approveChapterMember: b.mutation({
      query: ({ slug, userId, status }) => ({ url: `/alumni/chapters/${slug}/members/${userId}`, method: 'PATCH', body: { status } }),
      invalidatesTags: ['Chapter'],
    }),
    getChapterMembers: b.query({
      query: (slug) => `/alumni/chapters/${slug}/members`,
      providesTags: ['Chapter'],
    }),
    getChapterPosts: b.query({
      query: ({ slug, ...params }) => ({ url: `/alumni/chapters/${slug}/posts`, params }),
      providesTags: ['ChapterPost'],
    }),
    createChapterPost: b.mutation({
      query: ({ slug, ...body }) => ({ url: `/alumni/chapters/${slug}/posts`, method: 'POST', body }),
      invalidatesTags: ['ChapterPost', 'Chapter', 'AlumniAnalytics'],
    }),
    deletePost: b.mutation({
      query: (id) => ({ url: `/alumni/chapters/posts/${id}`, method: 'DELETE' }),
      invalidatesTags: ['ChapterPost', 'Chapter'],
    }),
    pinPost: b.mutation({
      query: (id) => ({ url: `/alumni/chapters/posts/${id}/pin`, method: 'PATCH' }),
      invalidatesTags: ['ChapterPost'],
    }),
    likePost: b.mutation({
      query: (id) => ({ url: `/alumni/chapters/posts/${id}/like`, method: 'POST' }),
      invalidatesTags: ['ChapterPost'],
    }),
    getComments: b.query({
      query: (postId) => `/alumni/chapters/posts/${postId}/comments`,
      providesTags: ['ChapterPost'],
    }),
    addComment: b.mutation({
      query: ({ postId, body }) => ({ url: `/alumni/chapters/posts/${postId}/comments`, method: 'POST', body: { body } }),
      invalidatesTags: ['ChapterPost'],
    }),
    deleteComment: b.mutation({
      query: (id) => ({ url: `/alumni/chapters/comments/${id}`, method: 'DELETE' }),
      invalidatesTags: ['ChapterPost'],
    }),

    // Import & Invites
    previewImport: b.mutation({
      query: (formData) => ({ url: '/alumni/import/preview', method: 'POST', body: formData }),
      invalidatesTags: ['AlumniImport'],
    }),
    commitImport: b.mutation({
      query: ({ batchId, sendEmails }) => ({ url: `/alumni/import/${batchId}/commit`, method: 'POST', body: { sendEmails } }),
      invalidatesTags: ['AlumniImport', 'AlumniInvite', 'AlumniProfile', 'AlumniAnalytics'],
    }),
    getImports: b.query({
      query: () => '/alumni/import',
      providesTags: ['AlumniImport'],
    }),
    getImportBatch: b.query({
      query: (id) => `/alumni/import/${id}`,
      providesTags: ['AlumniImport'],
    }),
    getInvites: b.query({
      query: (params) => ({ url: '/alumni/invites', params }),
      providesTags: ['AlumniInvite'],
    }),
    resendInvite: b.mutation({
      query: (id) => ({ url: `/alumni/invites/${id}/resend`, method: 'POST' }),
      invalidatesTags: ['AlumniInvite'],
    }),
    revokeInvite: b.mutation({
      query: (id) => ({ url: `/alumni/invites/${id}/revoke`, method: 'PATCH' }),
      invalidatesTags: ['AlumniInvite'],
    }),
    getPublicClaim: b.query({
      query: (token) => `/auth/alumni-claim/${token}`,
    }),
    submitPublicClaim: b.mutation({
      query: ({ token, ...body }) => ({ url: `/auth/alumni-claim/${token}`, method: 'POST', body }),
      invalidatesTags: ['Me', 'AlumniProfile'],
    }),

    // Analytics
    getAlumniAnalytics: b.query({
      query: (params) => ({ url: '/alumni/analytics', params }),
      providesTags: ['AlumniAnalytics'],
    }),
    getAlumniDashboard: b.query({
      query: () => '/alumni/dashboard',
      providesTags: ['AlumniProfile', 'MentorshipRequest', 'MentorshipSession', 'AlumniJob', 'AlumniEvent', 'ChapterPost'],
    }),

    // ── Campus SOS ──
    getHostelSummary: b.query({ query: () => '/hostel/summary', providesTags: ['GatePass'] }),
    getHostelStudents: b.query({ query: (params) => ({ url: '/hostel/students', params }), providesTags: ['GatePass'] }),
    getSOSAlerts: b.query({ query: (params) => ({ url: '/sos', params }), providesTags: ['SOSAlert'] }),
    createSOSAlert: b.mutation({ query: (body) => ({ url: '/sos', method: 'POST', body }), invalidatesTags: ['SOSAlert'] }),
    ackSOSAlert: b.mutation({ query: (id) => ({ url: `/sos/${id}/ack`, method: 'PATCH' }), invalidatesTags: ['SOSAlert'] }),
    resolveSOSAlert: b.mutation({ query: ({ id, ...body }) => ({ url: `/sos/${id}/resolve`, method: 'PATCH', body }), invalidatesTags: ['SOSAlert'] }),
  }),
});

export const {
  useLoginMutation,
  useRegisterMutation,
  useLogoutMutation,
  useChangePasswordMutation,
  useGetDashboardQuery,
  useSearchQuery,
  useUploadFileMutation,
  useGetUsersQuery,
  useGetUserQuery,
  useUpdateMeMutation,
  useUploadAvatarMutation,
  useGetClubsQuery,
  useGetClubQuery,
  useCreateClubMutation,
  useUpdateClubMutation,
  useDeleteClubMutation,
  useReviewClubMutation,
  useJoinClubMutation,
  useCancelJoinMutation,
  useLeaveClubMutation,
  useGetClubRequestsQuery,
  useHandleClubRequestMutation,
  useRemoveClubMemberMutation,
  useSetClubMemberRoleMutation,
  useGetEventsQuery,
  useGetEventQuery,
  useGetFacultyCoordinatorsQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
  useRegisterEventMutation,
  useCancelRegistrationMutation,
  useGetParticipantsQuery,
  useMarkAttendanceMutation,
  useGetAnnouncementsQuery,
  useCreateAnnouncementMutation,
  useUpdateAnnouncementMutation,
  useDeleteAnnouncementMutation,
  useTogglePinAnnouncementMutation,
  useGetAchievementsQuery,
  useGetAchievementsDashboardQuery,
  useGetAchievementQuery,
  useGetStudentAchievementsQuery,
  useGetAchievementStatsQuery,
  useSearchAchievementStudentsQuery,
  useCreateAchievementMutation,
  useUpdateAchievementMutation,
  useDeleteAchievementMutation,
  useRestoreAchievementMutation,
  useToggleFeaturedAchievementMutation,
  useCongratulateAchievementMutation,
  useRequestAchievementHideMutation,
  useResolveAchievementHideMutation,
  useGetDiscussionsQuery,
  useGetDiscussionQuery,
  useCreateDiscussionMutation,
  useDeleteDiscussionMutation,
  useAddReplyMutation,
  useDeleteReplyMutation,
  useUpvoteDiscussionMutation,
  useUpvoteReplyMutation,
  useModerateDiscussionMutation,
  useCreateReportMutation,
  useGetReportsQuery,
  useResolveReportMutation,
  useGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useDeleteNotificationMutation,
  useGetAnalyticsQuery,
  useGetAdminUsersQuery,
  useResetUserPasswordMutation,
  useGetSecuritySummaryQuery,
  useGetSecurityLogsQuery,
  useGetSecurityOtpsQuery,
  useGetRoleAssignmentsOverviewQuery,
  useAssignClassInChargeMutation,
  useSwapClassInChargeMutation,
  useUnassignClassInChargeMutation,
  useSetDepartmentHodMutation,
  useDemoteDepartmentHodMutation,
  useGetClassStudentsQuery,
  useGetClassStudentQuery,
  useUpdateClassStudentMutation,
  useCreateClassStudentMutation,
  useUpdateAdminUserMutation,
  useGetActivityQuery,
  useCreateAdminUserMutation,
  useDeleteAdminUserMutation,
  useGetGroupRequestsQuery,
  useReviewGroupRequestMutation,
  useGetAttendanceSummaryQuery,
  useGetSummaryStudentsQuery,
  useGetAttendanceBreakdownQuery,
  useGetSummaryFacultyQuery,
  useGetFacultyRosterQuery,
  useMarkFacultyAttendanceMutation,
  useGetSessionsQuery,
  useRevokeSessionMutation,
  useRevokeOtherSessionsMutation,
  useGetLoginHistoryQuery,
  useGetConversationsQuery,
  useGetConversationQuery,
  useGetChatUnreadQuery,
  useCreateConversationMutation,
  useGetMessagesQuery,
  useLazyGetMessagesQuery,
  useSendMessageMutation,
  useEditMessageMutation,
  useDeleteMessageMutation,
  useMarkConversationReadMutation,
  useSearchMessagesQuery,
  useAddChatMembersMutation,
  useUpdateGroupMutation,
  useDeleteGroupMutation,
  useToggleGroupAdminMutation,
  useGetGroupClassQuery,
  useLeaveConversationMutation,
  useGetMyAttendanceQuery,
  useGetAttendanceRecordsQuery,
  useGetAttendanceTrendsQuery,
  useGetRosterQuery,
  useMarkClassAttendanceMutation,
  useGetAttendanceSessionsQuery,
  useGetLowAttendanceQuery,
  useNotifyLowAttendanceStudentMutation,
  useGetStudentAttendanceQuery,
  useGetSubjectAttendanceQuery,
  useGetCorrectionsQuery,
  useRequestCorrectionMutation,
  useReviewCorrectionMutation,
  useGetMyODLeaveRequestsQuery,
  useGetPendingODLeaveReviewsQuery,
  useCreateODLeaveRequestMutation,
  useReviewODLeaveRequestMutation,
  useCancelODLeaveRequestMutation,
  useGetTimetableQuery,
  useGetHostelSummaryQuery,
  useGetHostelStudentsQuery,
  useGetMasterTimetableQuery,
  useGetFacultyAvailabilityQuery,
  useGetCurrentClassQuery,
  useGetTimetableFacultyOptionsQuery,
  useGetStudyMaterialsQuery,
  useGetStudyMaterialStatusQuery,
  useGetStudyMaterialQuery,
  useGetMyTeachingAssignmentsQuery,
  useUploadStudyMaterialMutation,
  useUpdateStudyMaterialMutation,
  useDeleteStudyMaterialMutation,
  useGetAssistantConversationsQuery,
  useLazyGetAssistantConversationQuery,
  useSendAssistantMessageMutation,
  useDeleteAssistantConversationMutation,
  useGetMyPeriodsQuery,
  useGetSubjectsQuery,
  useCreateSubjectMutation,
  useUpdateSubjectMutation,
  useDeleteSubjectMutation,
  useCreateSlotMutation,
  useUpdateSlotMutation,
  useDeleteSlotMutation,
  useGetGatePassesQuery,
  useGetGatePassQuery,
  useGetGatePassQrQuery,
  useGetGateDashboardQuery,
  useAdminReturnOverrideMutation,
  useGetClassTodayQuery,
  useGetBindGroupsQuery,
  useCreateBindGroupMutation,
  useDeleteBindGroupMutation,
  useBindGatePassMutation,
  useUnbindGatePassMutation,
  useSubmitBindGroupMutation,
  useHodReviewBindGroupMutation,
  usePrincipalReviewBindGroupMutation,
  useRejectBindMemberMutation,
  useGetSecurityDashboardQuery,
  useCreateGatePassMutation,
  useFacultyReviewGatePassMutation,
  useHodReviewGatePassMutation,
  useGetParentOtpQuery,
  useVerifyReturnCredentialMutation,
  useGetReturnCredentialQuery,
  useVerifyReturnLocationMutation,
  useRequestParentOtpMutation,
  useVerifyParentOtpMutation,
  useGetDevOtpsQuery,
  usePrincipalReviewGatePassMutation,
  useMassApproveGatePassMutation,
  useCancelGatePassMutation,
  useRevokeGatePassMutation,
  useVerifyGatePassMutation,
  useRecordGateOutMutation,
  useCreateEmergencyGatePassMutation,
  useCreateDayScholarOutingMutation,
  useEmergencyReviewGatePassMutation,
  useRecordGateInMutation,
  useGetComplaintsQuery,
  useGetComplaintQuery,
  useGetComplaintDashboardQuery,
  useCreateComplaintMutation,
  useAuthorityUpdateComplaintMutation,
  useMarkComplaintNotResolvedMutation,
  useMarkComplaintResolvedMutation,
  useCancelComplaintMutation,
  useGetLostFoundQuery,
  useGetLostFoundItemQuery,
  useGetLostFoundMatchesQuery,
  useReportLostFoundMutation,
  useUpdateLostFoundMutation,
  useDeleteLostFoundMutation,
  useSetLostFoundStatusMutation,
  useGetStudentAnalyticsQuery,
  useGetFacultyAnalyticsQuery,
  useGetDepartmentAnalyticsQuery,
  useGetCollegeAnalyticsQuery,
  useGetGateAnalyticsQuery,
  useGetClubAnalyticsQuery,
  useGetPeopleFiltersQuery,
  useGetMyScheduleQuery,
  useGetExamsQuery,
  useGetExamOptionsQuery,
  useCreateExamsMutation,
  useUpdateExamMutation,
  usePublishExamMutation,
  useCancelExamMutation,
  useGetTransportConfigQuery,
  useGetBusesQuery,
  useGetBusQuery,
  useSearchTransportQuery,
  useGetTransportMeQuery,
  useGetTransportRoutesQuery,
  useCreateBusRouteMutation,
  useUpdateBusRouteMutation,
  useCreateBusMutation,
  useUpdateBusMutation,
  useGetTransportAssignmentsQuery,
  useSetTransportAssignmentMutation,
  useDeleteTransportAssignmentMutation,
  usePickTransportPeopleQuery,
  useStopBusTripMutation,
  useGetStaffReportQuery,
  useGetLowMonitorQuery,
  useGetCoverQuery,
  useGetAvailableSubstitutesQuery,
  useAssignCoverMutation,
  useCancelCoverMutation,
  useGetEarlyExitsQuery,
  useRequestEarlyExitMutation,
  useDecideEarlyExitMutation,
  useRecordDepartureMutation,
  useCancelEarlyExitMutation,
  useGetMyClassOptionsQuery,
  useGetMyClassAttendanceQuery,
  useGetReportOptionsQuery,
  useGetAttendanceReportQuery,
  useGetOurClassAttendanceQuery,
  useGetReportPeriodsQuery,

  // ── Alumni Network ──────────────────────────────────
  useGetAlumniQuery,
  useGetAlumniFiltersQuery,
  useGetAlumniProfileQuery,
  useGetMyAlumniProfileQuery,
  useUpsertAlumniProfileMutation,
  useVerifyAlumniProfileMutation,
  useRejectAlumniProfileMutation,
  useGetMentorshipRequestsQuery,
  useGetMentorshipRequestQuery,
  useCreateMentorshipRequestMutation,
  useRespondMentorshipRequestMutation,
  useCancelMentorshipRequestMutation,
  useCompleteMentorshipMutation,
  useRateMentorshipMutation,
  useUpdateMentorshipGoalsMutation,
  useGetSlotsQuery,
  useCreateSlotsMutation,
  useDeleteMentorshipSlotMutation,
  useBookSessionMutation,
  useGetMentorshipSessionsQuery,
  useRescheduleSessionMutation,
  useCancelSessionMutation,
  useCompleteSessionMutation,
  useUpdateSessionNotesMutation,
  useMessageMentorMutation,
  useGetAlumniJobsQuery,
  useGetAlumniJobQuery,
  useCreateAlumniJobMutation,
  useUpdateAlumniJobMutation,
  useCloseAlumniJobMutation,
  useReopenAlumniJobMutation,
  useRemoveAlumniJobMutation,
  useApplyToJobMutation,
  useGetJobApplicationsQuery,
  useGetMyApplicationsQuery,
  useUpdateApplicationMutation,
  useWithdrawApplicationMutation,
  useGetAlumniEventsQuery,
  useGetAlumniEventQuery,
  useCreateAlumniEventMutation,
  useUpdateAlumniEventMutation,
  useApproveAlumniEventMutation,
  useRejectAlumniEventMutation,
  useCancelAlumniEventMutation,
  useRsvpEventMutation,
  useCancelRsvpMutation,
  useGetAttendeesQuery,
  useCheckInAttendeeMutation,
  useGetChaptersQuery,
  useGetChapterQuery,
  useCreateChapterMutation,
  useUpdateChapterMutation,
  useArchiveChapterMutation,
  useJoinChapterMutation,
  useLeaveChapterMutation,
  useApproveChapterMemberMutation,
  useGetChapterMembersQuery,
  useGetChapterPostsQuery,
  useCreateChapterPostMutation,
  useDeletePostMutation,
  usePinPostMutation,
  useLikePostMutation,
  useGetCommentsQuery,
  useAddCommentMutation,
  useDeleteCommentMutation,
  usePreviewImportMutation,
  useCommitImportMutation,
  useGetImportsQuery,
  useGetImportBatchQuery,
  useGetInvitesQuery,
  useResendInviteMutation,
  useRevokeInviteMutation,
  useGetPublicClaimQuery,
  useSubmitPublicClaimMutation,
  useGetAlumniAnalyticsQuery,
  useGetAlumniDashboardQuery,
  useGetHolidaysQuery,
  useGetHolidayOptionsQuery,
  useCreateHolidayMutation,
  useUpdateHolidayMutation,
  useDeleteHolidayMutation,
  useGetSOSAlertsQuery,
  useCreateSOSAlertMutation,
  useAckSOSAlertMutation,
  useResolveSOSAlertMutation,
} = api;
