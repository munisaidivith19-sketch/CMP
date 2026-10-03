import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { loggedOut, setCredentials } from '../features/authSlice';

const rawBaseQuery = fetchBaseQuery({
  baseUrl: '/api',
  credentials: 'include',
  prepareHeaders: (headers, { getState }) => {
    const token = getState().auth.accessToken;
    if (token) headers.set('authorization', `Bearer ${token}`);
    return headers;
  },
});

// A single in-flight refresh shared by every request that hits a 401.
let refreshPromise = null;
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .finally(() => {
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      });
  }
  return refreshPromise;
}

const NO_RETRY = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password'];

/** Access tokens are short-lived: on a 401, refresh once and replay the request. */
const baseQueryWithReauth = async (args, api, extra) => {
  let result = await rawBaseQuery(args, api, extra);
  const url = typeof args === 'string' ? args : args.url;
  if (result.error?.status === 401 && !NO_RETRY.some((p) => url.startsWith(p))) {
    const session = await refreshSession();
    if (session?.accessToken) {
      api.dispatch(setCredentials(session));
      result = await rawBaseQuery(args, api, extra);
    } else {
      api.dispatch(loggedOut());
    }
  }
  return result;
};

const TAGS = [
  'Me', 'Dashboard', 'User', 'Club', 'Event', 'Announcement', 'Discussion', 'Report', 'Notification', 'Admin',
  'Session', 'Chat', 'ChatMessages', 'Attendance', 'Correction', 'Timetable', 'Subject', 'GatePass', 'LostFound', 'Analytics',
  'ChatRequest', 'StaffAttendance', 'Complaint', 'StudyMaterial', 'AssistantConversation',
];

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: TAGS,
  refetchOnFocus: false,
  endpoints: (b) => ({
    // ── Auth ──────────────────────────────────────────
    login: b.mutation({ query: (body) => ({ url: '/auth/login', method: 'POST', body }) }),
    register: b.mutation({ query: (body) => ({ url: '/auth/register', method: 'POST', body }) }),
    logout: b.mutation({ query: () => ({ url: '/auth/logout', method: 'POST' }) }),
    changePassword: b.mutation({ query: (body) => ({ url: '/auth/change-password', method: 'POST', body }), invalidatesTags: ['Session'] }),
    forgotPassword: b.mutation({ query: (body) => ({ url: '/auth/forgot-password', method: 'POST', body }) }),
    resetPassword: b.mutation({ query: (body) => ({ url: '/auth/reset-password', method: 'POST', body }) }),
    getSessions: b.query({ query: () => '/auth/sessions', providesTags: ['Session'] }),
    revokeSession: b.mutation({ query: (id) => ({ url: `/auth/sessions/${id}`, method: 'DELETE' }), invalidatesTags: ['Session'] }),
    revokeOtherSessions: b.mutation({ query: () => ({ url: '/auth/sessions/revoke-others', method: 'POST' }), invalidatesTags: ['Session'] }),
    getLoginHistory: b.query({ query: (params) => ({ url: '/auth/login-history', params }), providesTags: ['Session'] }),

    // ── Dashboard / search / uploads ──────────────────
    getDashboard: b.query({ query: () => '/dashboard', providesTags: ['Dashboard'] }),
    search: b.query({ query: (params) => ({ url: '/search', params }) }),
    uploadFile: b.mutation({
      query: ({ file, kind = 'image' }) => {
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
      query: ({ id, userId, attended }) => ({ url: `/events/${id}/attendance/${userId}`, method: 'PATCH', body: { attended } }),
      invalidatesTags: ['Event'],
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
    // HOD group builder: every student of one class in the HOD's department.
    getGroupClass: b.query({ query: (params) => ({ url: '/chat/group-class', params }), providesTags: ['User'] }),

    // ── Attendance ────────────────────────────────────
    getMyAttendance: b.query({ query: (params) => ({ url: '/attendance/my', params }), providesTags: ['Attendance'] }),
    getAttendanceRecords: b.query({ query: (params) => ({ url: '/attendance/records', params }), providesTags: ['Attendance'] }),
    getAttendanceTrends: b.query({ query: (params) => ({ url: '/attendance/trends', params }), providesTags: ['Attendance'] }),
    getRoster: b.query({ query: (params) => ({ url: '/attendance/roster', params }), providesTags: ['Attendance'] }),
    markClassAttendance: b.mutation({
      query: (body) => ({ url: '/attendance/mark', method: 'POST', body }),
      invalidatesTags: ['Attendance', 'Analytics'],
    }),
    getAttendanceSessions: b.query({ query: (params) => ({ url: '/attendance/sessions', params }), providesTags: ['Attendance'] }),
    getLowAttendance: b.query({ query: (params) => ({ url: '/attendance/low', params }), providesTags: ['Attendance'] }),
    // "My Classes": the signed-in faculty member's own subject/section list and
    // the attendance of one of those exact classes.
    getMyClassOptions: b.query({ query: () => '/attendance/my-classes/options', providesTags: ['Attendance', 'Timetable'] }),
    getMyClassAttendance: b.query({ query: (params) => ({ url: '/attendance/my-classes', params }), providesTags: ['Attendance'] }),
    getReportOptions: b.query({ query: () => '/attendance/reports/options', providesTags: ['Attendance', 'Timetable'] }),
    // "Our Class": the complete attendance of the faculty member's Class In-Charge class.
    getOurClassAttendance: b.query({ query: (params) => ({ url: '/attendance/our-class', params }), providesTags: ['Attendance'] }),
    // The report Period dropdown, derived from the authorized class's timetable for a date.
    getReportPeriods: b.query({ query: (params) => ({ url: '/attendance/reports/periods', params }), providesTags: ['Attendance', 'Timetable'] }),
    getAttendanceReport: b.query({
      query: ({ type, ...params }) => ({ url: `/attendance/reports/${type}`, params }),
      providesTags: ['Attendance'],
    }),
    getStudentAttendance: b.query({ query: ({ id, ...params }) => ({ url: `/attendance/student/${id}`, params }), providesTags: ['Attendance'] }),
    getSubjectAttendance: b.query({ query: ({ id, ...params }) => ({ url: `/attendance/subject/${id}`, params }), providesTags: ['Attendance'] }),
    getCorrections: b.query({ query: (params) => ({ url: '/attendance/corrections', params }), providesTags: ['Correction'] }),
    requestCorrection: b.mutation({ query: (body) => ({ url: '/attendance/corrections', method: 'POST', body }), invalidatesTags: ['Correction'] }),
    reviewCorrection: b.mutation({
      query: ({ id, ...body }) => ({ url: `/attendance/corrections/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Correction', 'Attendance'],
    }),
    getAttendanceSummary: b.query({ query: (params) => ({ url: '/attendance/summary', params }), providesTags: ['Attendance', 'StaffAttendance'] }),
    getSummaryStudents: b.query({ query: (params) => ({ url: '/attendance/summary/students', params }), providesTags: ['Attendance'] }),
    getSummaryFaculty: b.query({ query: (params) => ({ url: '/attendance/summary/faculty', params }), providesTags: ['StaffAttendance'] }),
    getFacultyRoster: b.query({ query: (params) => ({ url: '/attendance/faculty/roster', params }), providesTags: ['StaffAttendance'] }),
    markFacultyAttendance: b.mutation({
      query: (body) => ({ url: '/attendance/faculty/mark', method: 'POST', body }),
      invalidatesTags: ['StaffAttendance'],
    }),

    // ── Timetable / subjects ──────────────────────────
    getTimetable: b.query({ query: (params) => ({ url: '/timetable', params }), providesTags: ['Timetable'] }),
    getCurrentClass: b.query({ query: () => '/timetable/current', providesTags: ['Timetable'] }),
    getTimetableFacultyOptions: b.query({ query: () => '/timetable/faculty-options', providesTags: ['User'] }),
    // "My Schedule": always the authenticated user's own teaching periods.
    getMySchedule: b.query({ query: (params) => ({ url: '/timetable/my-schedule', params }), providesTags: ['Timetable'] }),

    // ── Study materials ────────────────────────────────
    getStudyMaterials: b.query({ query: (params) => ({ url: '/study-materials', params }), providesTags: ['StudyMaterial'] }),
    getStudyMaterial: b.query({ query: (id) => `/study-materials/${id}`, providesTags: ['StudyMaterial'] }),
    getMyTeachingAssignments: b.query({ query: () => '/study-materials/my-assignments' }),
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
    getGateDashboard: b.query({ query: () => '/gate-pass/dashboard', providesTags: ['GatePass'] }),
    getSecurityDashboard: b.query({ query: () => '/gate-pass/dashboard/security', providesTags: ['GatePass'] }),
    createGatePass: b.mutation({ query: (body) => ({ url: '/gate-pass', method: 'POST', body }), invalidatesTags: ['GatePass'] }),
    facultyReviewGatePass: b.mutation({ query: ({ id, ...body }) => ({ url: `/gate-pass/${id}/faculty-review`, method: 'PATCH', body }), invalidatesTags: ['GatePass'] }),
    getParentOtp: b.query({ query: (id) => `/gate-pass/${id}/parent-otp`, keepUnusedDataFor: 0 }),
    requestParentOtp: b.mutation({ query: (id) => ({ url: `/gate-pass/${id}/parent-otp`, method: 'POST' }) }),
    verifyParentOtp: b.mutation({ query: ({ id, otp }) => ({ url: `/gate-pass/${id}/parent-otp/verify`, method: 'POST', body: { otp } }), invalidatesTags: ['GatePass'] }),
    getDevOtps: b.query({ query: () => '/dev/otp', keepUnusedDataFor: 0 }),
    hodReviewGatePass: b.mutation({ query: ({ id, ...body }) => ({ url: `/gate-pass/${id}/hod-review`, method: 'PATCH', body }), invalidatesTags: ['GatePass'] }),
    principalReviewGatePass: b.mutation({ query: ({ id, ...body }) => ({ url: `/gate-pass/${id}/principal-review`, method: 'PATCH', body }), invalidatesTags: ['GatePass'] }),
    cancelGatePass: b.mutation({ query: (id) => ({ url: `/gate-pass/${id}/cancel`, method: 'PATCH' }), invalidatesTags: ['GatePass'] }),
    revokeGatePass: b.mutation({ query: ({ id, reason }) => ({ url: `/gate-pass/${id}/revoke`, method: 'PATCH', body: { reason } }), invalidatesTags: ['GatePass'] }),
    verifyGatePass: b.mutation({ query: (code) => ({ url: '/gate-pass/verify', method: 'POST', body: { code } }) }),
    recordGateOut: b.mutation({ query: ({ id, code }) => ({ url: `/gate-pass/${id}/out`, method: 'PATCH', body: { code } }), invalidatesTags: ['GatePass'] }),
    createEmergencyGatePass: b.mutation({ query: (body) => ({ url: '/gate-pass/emergency', method: 'POST', body }), invalidatesTags: ['GatePass'] }),
    emergencyReviewGatePass: b.mutation({ query: ({ id, ...body }) => ({ url: `/gate-pass/${id}/emergency-review`, method: 'PATCH', body }), invalidatesTags: ['GatePass'] }),
    recordGateIn: b.mutation({ query: ({ id, code }) => ({ url: `/gate-pass/${id}/in`, method: 'PATCH', body: { code } }), invalidatesTags: ['GatePass'] }),
    verifyReturnCredential: b.mutation({ query: (code) => ({ url: '/gate-pass/return/verify', method: 'POST', body: { code } }) }),
    verifyReturnLocation: b.mutation({ query: ({ id, ...reading }) => ({ url: `/gate-pass/${id}/return-location/verify`, method: 'POST', body: reading }), invalidatesTags: ['GatePass'] }),
    getReturnCredential: b.query({ query: (id) => `/gate-pass/${id}/return-credential`, providesTags: ['GatePass'], keepUnusedDataFor: 0 }),

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
  useUpdateAdminUserMutation,
  useGetActivityQuery,
  useCreateAdminUserMutation,
  useDeleteAdminUserMutation,
  useGetGroupRequestsQuery,
  useReviewGroupRequestMutation,
  useGetAttendanceSummaryQuery,
  useGetSummaryStudentsQuery,
  useGetSummaryFacultyQuery,
  useGetFacultyRosterQuery,
  useMarkFacultyAttendanceMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
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
  useDeleteMessageMutation,
  useMarkConversationReadMutation,
  useSearchMessagesQuery,
  useAddChatMembersMutation,
  useUpdateGroupMutation,
  useDeleteGroupMutation,
  useGetGroupClassQuery,
  useLeaveConversationMutation,
  useGetMyAttendanceQuery,
  useGetAttendanceRecordsQuery,
  useGetAttendanceTrendsQuery,
  useGetRosterQuery,
  useMarkClassAttendanceMutation,
  useGetAttendanceSessionsQuery,
  useGetLowAttendanceQuery,
  useGetStudentAttendanceQuery,
  useGetSubjectAttendanceQuery,
  useGetCorrectionsQuery,
  useRequestCorrectionMutation,
  useReviewCorrectionMutation,
  useGetTimetableQuery,
  useGetCurrentClassQuery,
  useGetTimetableFacultyOptionsQuery,
  useGetStudyMaterialsQuery,
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
  useCancelGatePassMutation,
  useRevokeGatePassMutation,
  useVerifyGatePassMutation,
  useRecordGateOutMutation,
  useCreateEmergencyGatePassMutation,
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
  useGetMyClassOptionsQuery,
  useGetMyClassAttendanceQuery,
  useGetReportOptionsQuery,
  useGetAttendanceReportQuery,
  useGetOurClassAttendanceQuery,
  useGetReportPeriodsQuery,
} = api;
