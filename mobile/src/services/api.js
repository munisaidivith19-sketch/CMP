import { createApi, fetchBaseQuery, retry } from '@reduxjs/toolkit/query/react';
import { getApiUrl } from '../config';
import { loggedOut, setCredentials } from '../store/authSlice';
import { mobileHeaders, refreshSession } from './session';
import { setOnline } from './connection';

const NETWORK_ERRORS = ['FETCH_ERROR', 'TIMEOUT_ERROR'];

// Built per request so a server address changed on the login screen applies at once.
const rawBaseQuery = (args, api, extra) =>
  fetchBaseQuery({
    baseUrl: `${getApiUrl()}/api`,
    timeout: 20000,
    prepareHeaders: (headers, { getState }) => {
      const token = getState().auth.accessToken;
      if (token) headers.set('authorization', `Bearer ${token}`);
      Object.entries(mobileHeaders()).forEach(([k, v]) => headers.set(k, v));
      return headers;
    },
  })(args, api, extra);

const NO_RETRY = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password'];

/** Same behaviour as the web client: on 401, refresh once and replay. */
const authedQuery = async (args, api, extra) => {
  let result = await rawBaseQuery(args, api, extra);
  const url = typeof args === 'string' ? args : args.url;
  if (result.error?.status === 401 && !NO_RETRY.some((p) => url.startsWith(p))) {
    const session = await refreshSession();
    if (session?.accessToken) {
      api.dispatch(setCredentials(session));
      result = await rawBaseQuery(args, api, extra);
    } else if (!session?.offline) {
      api.dispatch(loggedOut());
    }
  }
  setOnline(!NETWORK_ERRORS.includes(result.error?.status));
  return result;
};

/**
 * Flaky mobile data: reads are retried (with backoff) when the network drops;
 * writes never are, so a slow "Save" can't be applied twice.
 */
const baseQuery = retry(authedQuery, {
  maxRetries: 2,
  retryCondition: (error, _args, { attempt, baseQueryApi }) =>
    baseQueryApi.type === 'query' && attempt <= 2 && NETWORK_ERRORS.includes(error?.status),
});

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  refetchOnFocus: true,
  refetchOnReconnect: true,
  tagTypes: ['Me', 'Dashboard', 'User', 'Club', 'Event', 'Announcement', 'Discussion', 'Notification', 'Session', 'Chat', 'Attendance', 'Correction', 'Timetable', 'GatePass', 'LostFound', 'StaffAttendance', 'ChatRequest', 'Admin'],
  endpoints: (b) => ({
    // ── Auth / account ────────────────────────────────
    login: b.mutation({ query: (body) => ({ url: '/auth/login', method: 'POST', body }) }),
    forgotPassword: b.mutation({ query: (body) => ({ url: '/auth/forgot-password', method: 'POST', body }) }),
    changePassword: b.mutation({ query: (body) => ({ url: '/auth/change-password', method: 'POST', body }), invalidatesTags: ['Session'] }),
    getMe: b.query({ query: () => '/auth/me', providesTags: ['Me'] }),
    getSessions: b.query({ query: () => '/auth/sessions', providesTags: ['Session'] }),
    revokeSession: b.mutation({ query: (id) => ({ url: `/auth/sessions/${id}`, method: 'DELETE' }), invalidatesTags: ['Session'] }),
    revokeOtherSessions: b.mutation({ query: () => ({ url: '/auth/sessions/revoke-others', method: 'POST' }), invalidatesTags: ['Session'] }),
    getLoginHistory: b.query({ query: (params) => ({ url: '/auth/login-history', params }), providesTags: ['Session'] }),
    registerPushToken: b.mutation({ query: (token) => ({ url: '/auth/push-token', method: 'POST', body: { token } }) }),
    updateMe: b.mutation({ query: (body) => ({ url: '/users/me', method: 'PUT', body }), invalidatesTags: ['Me', 'User'] }),

    // ── Dashboard / search / uploads ──────────────────
    getDashboard: b.query({ query: () => '/dashboard', providesTags: ['Dashboard'] }),
    search: b.query({ query: (q) => ({ url: '/search', params: { q } }) }),
    uploadImage: b.mutation({
      query: (asset) => {
        const body = new FormData();
        body.append('file', { uri: asset.uri, name: asset.fileName || 'photo.jpg', type: asset.mimeType || 'image/jpeg' });
        return { url: '/uploads?kind=image', method: 'POST', body };
      },
    }),
    getUsers: b.query({ query: (params) => ({ url: '/users', params }), providesTags: ['User'] }),
    getUser: b.query({ query: (id) => `/users/${id}`, providesTags: ['User'] }),

    // ── Announcements / events / clubs / discussions ──
    getAnnouncements: b.query({ query: (params) => ({ url: '/announcements', params }), providesTags: ['Announcement'] }),
    getEvents: b.query({ query: (params) => ({ url: '/events', params }), providesTags: ['Event'] }),
    getEvent: b.query({ query: (id) => `/events/${id}`, providesTags: ['Event'] }),
    registerEvent: b.mutation({ query: (id) => ({ url: `/events/${id}/register`, method: 'POST' }), invalidatesTags: ['Event', 'Dashboard'] }),
    cancelRegistration: b.mutation({ query: (id) => ({ url: `/events/${id}/register`, method: 'DELETE' }), invalidatesTags: ['Event', 'Dashboard'] }),
    getClubs: b.query({ query: (params) => ({ url: '/clubs', params }), providesTags: ['Club'] }),
    getClub: b.query({ query: (id) => `/clubs/${id}`, providesTags: ['Club'] }),
    joinClub: b.mutation({ query: ({ id, message }) => ({ url: `/clubs/${id}/join`, method: 'POST', body: { message } }), invalidatesTags: ['Club'] }),
    cancelJoin: b.mutation({ query: (id) => ({ url: `/clubs/${id}/join`, method: 'DELETE' }), invalidatesTags: ['Club'] }),
    leaveClub: b.mutation({ query: (id) => ({ url: `/clubs/${id}/leave`, method: 'POST' }), invalidatesTags: ['Club', 'Dashboard', 'Me'] }),
    getDiscussions: b.query({ query: (params) => ({ url: '/discussions', params }), providesTags: ['Discussion'] }),
    getDiscussion: b.query({ query: (id) => `/discussions/${id}`, providesTags: (_r, _e, id) => [{ type: 'Discussion', id }] }),
    createDiscussion: b.mutation({ query: (body) => ({ url: '/discussions', method: 'POST', body }), invalidatesTags: ['Discussion'] }),
    addReply: b.mutation({ query: ({ id, body }) => ({ url: `/discussions/${id}/replies`, method: 'POST', body: { body } }), invalidatesTags: (_r, _e, { id }) => [{ type: 'Discussion', id }] }),
    upvoteDiscussion: b.mutation({ query: (id) => ({ url: `/discussions/${id}/upvote`, method: 'POST' }), invalidatesTags: (_r, _e, id) => [{ type: 'Discussion', id }, 'Discussion'] }),

    // ── Notifications ─────────────────────────────────
    getNotifications: b.query({ query: (params) => ({ url: '/notifications', params }), providesTags: ['Notification'] }),
    markNotificationRead: b.mutation({ query: (id) => ({ url: `/notifications/${id}/read`, method: 'PATCH' }), invalidatesTags: ['Notification'] }),
    markAllNotificationsRead: b.mutation({ query: () => ({ url: '/notifications/read-all', method: 'PATCH' }), invalidatesTags: ['Notification'] }),

    // ── Chat ──────────────────────────────────────────
    getConversations: b.query({ query: (params) => ({ url: '/chat/conversations', params }), providesTags: ['Chat'] }),
    getConversation: b.query({ query: (id) => `/chat/conversations/${id}`, providesTags: ['Chat'] }),
    getChatUnread: b.query({ query: () => '/chat/unread', providesTags: ['Chat'] }),
    createConversation: b.mutation({ query: (body) => ({ url: '/chat/conversations', method: 'POST', body }), invalidatesTags: ['Chat'] }),
    getMessages: b.query({ query: ({ id, ...params }) => ({ url: `/chat/conversations/${id}/messages`, params }), keepUnusedDataFor: 0 }),
    sendMessage: b.mutation({ query: ({ id, ...body }) => ({ url: `/chat/conversations/${id}/messages`, method: 'POST', body }) }),
    deleteMessage: b.mutation({ query: ({ id, msgId }) => ({ url: `/chat/conversations/${id}/messages/${msgId}`, method: 'DELETE' }) }),
    getGroupRequests: b.query({ query: (params) => ({ url: '/chat/requests', params }), providesTags: ['ChatRequest'] }),
    reviewGroupRequest: b.mutation({ query: ({ id, ...body }) => ({ url: `/chat/requests/${id}`, method: 'PATCH', body }), invalidatesTags: ['ChatRequest', 'Chat', 'Notification'] }),

    // ── Timetable / attendance ────────────────────────
    getTimetable: b.query({ query: () => '/timetable', providesTags: ['Timetable'] }),
    getCurrentClass: b.query({ query: () => '/timetable/current', providesTags: ['Timetable'] }),
    getMyAttendance: b.query({ query: (params) => ({ url: '/attendance/my', params }), providesTags: ['Attendance'] }),
    getAttendanceRecords: b.query({ query: (params) => ({ url: '/attendance/records', params }), providesTags: ['Attendance'] }),
    getCorrections: b.query({ query: (params) => ({ url: '/attendance/corrections', params }), providesTags: ['Correction'] }),
    requestCorrection: b.mutation({ query: (body) => ({ url: '/attendance/corrections', method: 'POST', body }), invalidatesTags: ['Correction'] }),
    getSubjects: b.query({ query: (params) => ({ url: '/subjects', params }) }),
    getRoster: b.query({ query: (params) => ({ url: '/attendance/roster', params }), providesTags: ['Attendance'], keepUnusedDataFor: 0 }),
    markClassAttendance: b.mutation({ query: (body) => ({ url: '/attendance/mark', method: 'POST', body }), invalidatesTags: ['Attendance', 'StaffAttendance'] }),
    getAttendanceSummary: b.query({ query: (params) => ({ url: '/attendance/summary', params }), providesTags: ['Attendance', 'StaffAttendance'] }),
    getSummaryStudents: b.query({ query: (params) => ({ url: '/attendance/summary/students', params }), providesTags: ['Attendance'] }),
    getSummaryFaculty: b.query({ query: (params) => ({ url: '/attendance/summary/faculty', params }), providesTags: ['StaffAttendance'] }),
    getFacultyRoster: b.query({ query: (params) => ({ url: '/attendance/faculty/roster', params }), providesTags: ['StaffAttendance'], keepUnusedDataFor: 0 }),
    markFacultyAttendance: b.mutation({ query: (body) => ({ url: '/attendance/faculty/mark', method: 'POST', body }), invalidatesTags: ['StaffAttendance'] }),
    createAdminUser: b.mutation({ query: (body) => ({ url: '/admin/users', method: 'POST', body }), invalidatesTags: ['Admin', 'User'] }),

    // ── Gate pass ─────────────────────────────────────
    getGatePasses: b.query({ query: (params) => ({ url: '/gate-pass', params }), providesTags: ['GatePass'] }),
    getGatePass: b.query({ query: (id) => `/gate-pass/${id}`, providesTags: ['GatePass'] }),
    getGatePassQr: b.query({ query: (id) => `/gate-pass/${id}/qr`, providesTags: ['GatePass'], keepUnusedDataFor: 0 }),
    createGatePass: b.mutation({ query: (body) => ({ url: '/gate-pass', method: 'POST', body }), invalidatesTags: ['GatePass'] }),
    cancelGatePass: b.mutation({ query: (id) => ({ url: `/gate-pass/${id}/cancel`, method: 'PATCH' }), invalidatesTags: ['GatePass'] }),

    // ── Lost & found ──────────────────────────────────
    getLostFound: b.query({ query: (params) => ({ url: '/lost-found', params }), providesTags: ['LostFound'] }),
    getLostFoundItem: b.query({ query: (id) => `/lost-found/${id}`, providesTags: ['LostFound'] }),
    getLostFoundMatches: b.query({ query: (id) => `/lost-found/${id}/matches`, providesTags: ['LostFound'] }),
    reportLostFound: b.mutation({ query: (body) => ({ url: '/lost-found', method: 'POST', body }), invalidatesTags: ['LostFound'] }),
    closeLostFound: b.mutation({ query: (id) => ({ url: `/lost-found/${id}/status`, method: 'PATCH', body: { status: 'closed' } }), invalidatesTags: ['LostFound'] }),
  }),
});

export const {
  useLoginMutation,
  useForgotPasswordMutation,
  useChangePasswordMutation,
  useGetMeQuery,
  useGetSessionsQuery,
  useRevokeSessionMutation,
  useRevokeOtherSessionsMutation,
  useGetLoginHistoryQuery,
  useRegisterPushTokenMutation,
  useUpdateMeMutation,
  useGetDashboardQuery,
  useSearchQuery,
  useUploadImageMutation,
  useGetUsersQuery,
  useGetUserQuery,
  useGetAnnouncementsQuery,
  useGetEventsQuery,
  useGetEventQuery,
  useRegisterEventMutation,
  useCancelRegistrationMutation,
  useGetClubsQuery,
  useGetClubQuery,
  useJoinClubMutation,
  useCancelJoinMutation,
  useLeaveClubMutation,
  useGetDiscussionsQuery,
  useGetDiscussionQuery,
  useCreateDiscussionMutation,
  useAddReplyMutation,
  useUpvoteDiscussionMutation,
  useGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useGetConversationsQuery,
  useGetConversationQuery,
  useGetChatUnreadQuery,
  useCreateConversationMutation,
  useGetMessagesQuery,
  useLazyGetMessagesQuery,
  useSendMessageMutation,
  useDeleteMessageMutation,
  useGetTimetableQuery,
  useGetCurrentClassQuery,
  useGetMyAttendanceQuery,
  useGetAttendanceRecordsQuery,
  useGetCorrectionsQuery,
  useRequestCorrectionMutation,
  useGetSubjectsQuery,
  useGetRosterQuery,
  useMarkClassAttendanceMutation,
  useGetAttendanceSummaryQuery,
  useGetSummaryStudentsQuery,
  useGetSummaryFacultyQuery,
  useGetFacultyRosterQuery,
  useMarkFacultyAttendanceMutation,
  useCreateAdminUserMutation,
  useGetGroupRequestsQuery,
  useReviewGroupRequestMutation,
  useGetGatePassesQuery,
  useGetGatePassQuery,
  useGetGatePassQrQuery,
  useCreateGatePassMutation,
  useCancelGatePassMutation,
  useGetLostFoundQuery,
  useGetLostFoundItemQuery,
  useGetLostFoundMatchesQuery,
  useReportLostFoundMutation,
  useCloseLostFoundMutation,
} = api;

export const errMsg = (err, fallback = 'Something went wrong') =>
  err?.data?.message ||
  (err?.status === 'FETCH_ERROR'
    ? 'Cannot reach the Vexon server — check your internet connection'
    : err?.status === 'TIMEOUT_ERROR'
      ? 'The server is taking too long — please try again'
      : err?.error || fallback);
