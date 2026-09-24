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
  'ChatRequest', 'StaffAttendance',
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
    createGatePass: b.mutation({ query: (body) => ({ url: '/gate-pass', method: 'POST', body }), invalidatesTags: ['GatePass'] }),
    reviewGatePass: b.mutation({ query: ({ id, ...body }) => ({ url: `/gate-pass/${id}/review`, method: 'PATCH', body }), invalidatesTags: ['GatePass'] }),
    cancelGatePass: b.mutation({ query: (id) => ({ url: `/gate-pass/${id}/cancel`, method: 'PATCH' }), invalidatesTags: ['GatePass'] }),
    revokeGatePass: b.mutation({ query: ({ id, reason }) => ({ url: `/gate-pass/${id}/revoke`, method: 'PATCH', body: { reason } }), invalidatesTags: ['GatePass'] }),
    verifyGatePass: b.mutation({ query: (code) => ({ url: '/gate-pass/verify', method: 'POST', body: { code } }) }),
    recordGateExit: b.mutation({ query: (id) => ({ url: `/gate-pass/${id}/exit`, method: 'PATCH' }), invalidatesTags: ['GatePass'] }),
    recordGateReturn: b.mutation({ query: (id) => ({ url: `/gate-pass/${id}/return`, method: 'PATCH' }), invalidatesTags: ['GatePass'] }),

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
  useCreateGatePassMutation,
  useReviewGatePassMutation,
  useCancelGatePassMutation,
  useRevokeGatePassMutation,
  useVerifyGatePassMutation,
  useRecordGateExitMutation,
  useRecordGateReturnMutation,
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
} = api;
