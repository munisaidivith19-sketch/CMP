import { useCallback } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { api, getCsrfCookie, refreshSession } from './api';
import { setCredentials } from '../features/authSlice';
import { isCsrfRejection } from './csrfCookie';

/**
 * Skill Wallet API. Every endpoint is authorized on the server (ownership,
 * team membership, reviewer / verifier / coordinator designations); nothing
 * here is a security boundary. File URLs in responses are short-lived and
 * bound to the signed-in viewer, so queries refetch on mount rather than
 * reusing stale signed links.
 */
const fresh = { keepUnusedDataFor: 30, refetchOnMountOrArgChange: true };
const T = 'SkillWallet';
const tag = (type, id = 'LIST') => ({ type, id });

export const skillWalletApi = api
  .enhanceEndpoints({ addTagTypes: [T, 'SWProject', 'SWInvite', 'SWCert', 'SWLink', 'SWReview', 'SWManage', 'SWGallery', 'SWConfig'] })
  .injectEndpoints({
    endpoints: (b) => ({
      getSwConfig: b.query({ query: () => '/skill-wallet/config', providesTags: ['SWConfig'] }),
      updateSwConfig: b.mutation({ query: (body) => ({ url: '/skill-wallet/config', method: 'PUT', body }), invalidatesTags: ['SWConfig'] }),

      // ── Projects ──
      getMyProjects: b.query({ query: (params) => ({ url: '/skill-wallet/projects', params }), providesTags: [tag('SWProject')], ...fresh }),
      getSwProject: b.query({ query: (id) => `/skill-wallet/projects/${id}`, providesTags: (r, e, id) => [tag('SWProject', id)], ...fresh }),
      getSwProjectHistory: b.query({ query: (id) => `/skill-wallet/projects/${id}/history`, providesTags: (r, e, id) => [tag('SWProject', id)] }),
      createSwProject: b.mutation({ query: (body) => ({ url: '/skill-wallet/projects', method: 'POST', body }), invalidatesTags: [tag('SWProject')] }),
      updateSwProject: b.mutation({
        query: ({ id, ...body }) => ({ url: `/skill-wallet/projects/${id}`, method: 'PUT', body }),
        invalidatesTags: (r, e, { id }) => [tag('SWProject'), tag('SWProject', id), 'SWGallery'],
      }),
      deleteSwProject: b.mutation({ query: (id) => ({ url: `/skill-wallet/projects/${id}`, method: 'DELETE' }), invalidatesTags: [tag('SWProject'), 'SWGallery'] }),
      submitSwProject: b.mutation({ query: (id) => ({ url: `/skill-wallet/projects/${id}/submit`, method: 'POST' }), invalidatesTags: (r, e, id) => [tag('SWProject'), tag('SWProject', id)] }),
      withdrawSwProject: b.mutation({ query: (id) => ({ url: `/skill-wallet/projects/${id}/withdraw`, method: 'POST' }), invalidatesTags: (r, e, id) => [tag('SWProject'), tag('SWProject', id)] }),
      addSwMilestone: b.mutation({ query: ({ id, ...body }) => ({ url: `/skill-wallet/projects/${id}/milestones`, method: 'POST', body }), invalidatesTags: (r, e, { id }) => [tag('SWProject', id)] }),

      // ── Team & invitations ──
      getSwTeam: b.query({ query: (id) => `/skill-wallet/projects/${id}/team`, providesTags: (r, e, id) => [tag('SWProject', id), tag('SWInvite')], ...fresh }),
      inviteSwMember: b.mutation({ query: ({ id, ...body }) => ({ url: `/skill-wallet/projects/${id}/invitations`, method: 'POST', body }), invalidatesTags: (r, e, { id }) => [tag('SWProject', id), tag('SWInvite')] }),
      getSwInvitations: b.query({ query: (params) => ({ url: '/skill-wallet/invitations', params }), providesTags: [tag('SWInvite')], ...fresh }),
      acceptSwInvitation: b.mutation({ query: (id) => ({ url: `/skill-wallet/invitations/${id}/accept`, method: 'POST' }), invalidatesTags: [tag('SWInvite'), tag('SWProject'), 'Notification'] }),
      declineSwInvitation: b.mutation({ query: (id) => ({ url: `/skill-wallet/invitations/${id}/decline`, method: 'POST' }), invalidatesTags: [tag('SWInvite'), 'Notification'] }),
      cancelSwInvitation: b.mutation({ query: (id) => ({ url: `/skill-wallet/invitations/${id}`, method: 'DELETE' }), invalidatesTags: [tag('SWInvite'), tag('SWProject')] }),
      removeSwMember: b.mutation({ query: ({ id, userId }) => ({ url: `/skill-wallet/projects/${id}/team/${userId}`, method: 'DELETE' }), invalidatesTags: (r, e, { id }) => [tag('SWProject', id)] }),
      leaveSwTeam: b.mutation({ query: (id) => ({ url: `/skill-wallet/projects/${id}/team/leave`, method: 'POST' }), invalidatesTags: [tag('SWProject')] }),
      transferSwOwnership: b.mutation({ query: ({ id, userId }) => ({ url: `/skill-wallet/projects/${id}/team/transfer`, method: 'POST', body: { userId } }), invalidatesTags: (r, e, { id }) => [tag('SWProject'), tag('SWProject', id), tag('SWInvite')] }),

      // ── Publication ──
      getSwPublication: b.query({ query: (id) => `/skill-wallet/projects/${id}/publication`, providesTags: (r, e, id) => [tag('SWProject', id)], ...fresh }),
      setSwPublication: b.mutation({ query: ({ id, ...body }) => ({ url: `/skill-wallet/projects/${id}/publication`, method: 'PUT', body }), invalidatesTags: (r, e, { id }) => [tag('SWProject'), tag('SWProject', id), 'SWGallery'] }),
      setSwConsent: b.mutation({ query: ({ id, decision }) => ({ url: `/skill-wallet/projects/${id}/publication/consent`, method: 'POST', body: { decision } }), invalidatesTags: (r, e, { id }) => [tag('SWProject'), tag('SWProject', id), 'SWGallery'] }),

      // ── Gallery ──
      getSwGallery: b.query({ query: (params) => ({ url: '/skill-wallet/gallery', params }), providesTags: ['SWGallery'], ...fresh }),
      getSwPublicGallery: b.query({ query: (params) => ({ url: '/skill-wallet/public/gallery', params }), providesTags: ['SWGallery'], ...fresh }),
      getSwGalleryProject: b.query({ query: (id) => `/skill-wallet/gallery/${id}`, providesTags: (r, e, id) => [{ type: 'SWGallery', id }], ...fresh }),
      getSwPublicGalleryProject: b.query({ query: (id) => `/skill-wallet/public/gallery/${id}`, ...fresh }),
      getSwLeaderboard: b.query({ query: (board) => ({ url: '/skill-wallet/leaderboard', params: { board } }), providesTags: ['SWGallery'], ...fresh }),
      getSwPublicLeaderboard: b.query({ query: (board) => ({ url: '/skill-wallet/public/leaderboard', params: { board } }), ...fresh }),
      toggleSwLike: b.mutation({ query: (id) => ({ url: `/skill-wallet/projects/${id}/like`, method: 'POST' }), invalidatesTags: (r, e, id) => [{ type: 'SWGallery', id }] }),
      getSwComments: b.query({ query: ({ id, page }) => ({ url: `/skill-wallet/projects/${id}/comments`, params: { page } }), providesTags: (r, e, { id }) => [{ type: 'SWGallery', id: `c-${id}` }] }),
      addSwComment: b.mutation({ query: ({ id, body }) => ({ url: `/skill-wallet/projects/${id}/comments`, method: 'POST', body: { body } }), invalidatesTags: (r, e, { id }) => [{ type: 'SWGallery', id: `c-${id}` }, { type: 'SWGallery', id }] }),
      deleteSwComment: b.mutation({ query: ({ commentId }) => ({ url: `/skill-wallet/comments/${commentId}`, method: 'DELETE' }), invalidatesTags: (r, e, { id }) => [{ type: 'SWGallery', id: `c-${id}` }, { type: 'SWGallery', id }] }),
      reportSwContent: b.mutation({ query: ({ id, ...body }) => ({ url: `/skill-wallet/projects/${id}/report`, method: 'POST', body }) }),
      requestSwContact: b.mutation({ query: ({ id, message }) => ({ url: `/skill-wallet/projects/${id}/contact`, method: 'POST', body: { message } }), invalidatesTags: ['SWInvite'] }),
      getSwContactRequests: b.query({ query: (params) => ({ url: '/skill-wallet/contact-requests', params }), providesTags: [tag('SWInvite')], ...fresh }),
      respondSwContact: b.mutation({ query: ({ id, decision }) => ({ url: `/skill-wallet/contact-requests/${id}/respond`, method: 'POST', body: { decision } }), invalidatesTags: [tag('SWInvite')] }),
      getSwPortfolio: b.query({ query: (userId = 'me') => `/skill-wallet/portfolio/${userId}`, providesTags: [tag('SWProject'), tag('SWCert'), tag('SWLink')], ...fresh }),

      // ── NPTEL certifications (create / update go through useSkillWalletUpload for progress) ──
      getMyCertifications: b.query({ query: () => '/skill-wallet/certifications', providesTags: [tag('SWCert')], ...fresh }),
      getMyCertification: b.query({ query: (id) => `/skill-wallet/certifications/${id}`, providesTags: (r, e, id) => [tag('SWCert', id)], keepUnusedDataFor: 0 }),
      deleteMyCertification: b.mutation({ query: (id) => ({ url: `/skill-wallet/certifications/${id}`, method: 'DELETE' }), invalidatesTags: [tag('SWCert')] }),

      // ── Links ──
      getSwLinks: b.query({ query: () => '/skill-wallet/profile-links', providesTags: [tag('SWLink')] }),
      createSwLink: b.mutation({ query: (body) => ({ url: '/skill-wallet/profile-links', method: 'POST', body }), invalidatesTags: [tag('SWLink')] }),
      updateSwLink: b.mutation({ query: ({ id, ...body }) => ({ url: `/skill-wallet/profile-links/${id}`, method: 'PUT', body }), invalidatesTags: [tag('SWLink')] }),
      deleteSwLink: b.mutation({ query: (id) => ({ url: `/skill-wallet/profile-links/${id}`, method: 'DELETE' }), invalidatesTags: [tag('SWLink')] }),

      // ── Review workspace ──
      getSwReviewerRoles: b.query({ query: () => '/skill-wallet/review/me', providesTags: ['SWReview'] }),
      getSwReviewQueue: b.query({ query: (params) => ({ url: '/skill-wallet/review/queue', params }), providesTags: ['SWReview'], ...fresh }),
      getSwReviewProject: b.query({ query: (id) => `/skill-wallet/review/projects/${id}`, providesTags: (r, e, id) => [{ type: 'SWReview', id }], ...fresh }),
      submitSwReview: b.mutation({ query: ({ id, ...body }) => ({ url: `/skill-wallet/review/projects/${id}/reviews`, method: 'POST', body }), invalidatesTags: (r, e, { id }) => ['SWReview', { type: 'SWReview', id }, 'SWManage'] }),
      getSwCertQueue: b.query({ query: (params) => ({ url: '/skill-wallet/review/certifications', params }), providesTags: ['SWReview'], ...fresh }),
      getSwCertForReview: b.query({ query: (id) => `/skill-wallet/review/certifications/${id}`, keepUnusedDataFor: 0 }),
      decideSwCert: b.mutation({ query: ({ id, ...body }) => ({ url: `/skill-wallet/review/certifications/${id}/decision`, method: 'POST', body }), invalidatesTags: ['SWReview'] }),

      // ── Innovation management ──
      getSwOverview: b.query({ query: () => '/skill-wallet/management/overview', providesTags: ['SWManage'], ...fresh }),
      getSwManagedProjects: b.query({ query: (params) => ({ url: '/skill-wallet/management/projects', params }), providesTags: ['SWManage'], ...fresh }),
      searchSwStaff: b.query({ query: (q) => ({ url: '/skill-wallet/management/staff', params: { q } }) }),
      assignSwReviewers: b.mutation({ query: ({ id, reviewerIds }) => ({ url: `/skill-wallet/management/projects/${id}/reviewers`, method: 'PUT', body: { reviewerIds } }), invalidatesTags: ['SWManage', 'SWReview'] }),
      hideSwProject: b.mutation({ query: ({ id, reason }) => ({ url: `/skill-wallet/management/projects/${id}/hide`, method: 'POST', body: { reason } }), invalidatesTags: ['SWManage', 'SWGallery'] }),
      unhideSwProject: b.mutation({ query: ({ id }) => ({ url: `/skill-wallet/management/projects/${id}/unhide`, method: 'POST', body: {} }), invalidatesTags: ['SWManage', 'SWGallery'] }),
      getSwRecommendations: b.query({ query: (params) => ({ url: '/skill-wallet/management/recommendations', params }), providesTags: ['SWManage'], ...fresh }),
      updateSwRecommendation: b.mutation({ query: ({ id, ...body }) => ({ url: `/skill-wallet/management/recommendations/${id}`, method: 'PATCH', body }), invalidatesTags: ['SWManage'] }),
      getSwMilestones: b.query({ query: (params) => ({ url: '/skill-wallet/management/milestones', params }), providesTags: ['SWManage'], ...fresh }),
      decideSwMilestone: b.mutation({ query: ({ id, ...body }) => ({ url: `/skill-wallet/management/milestones/${id}`, method: 'PATCH', body }), invalidatesTags: ['SWManage'] }),
      getSwReports: b.query({ query: (params) => ({ url: '/skill-wallet/management/reports', params }), providesTags: ['SWManage'], ...fresh }),
      resolveSwReport: b.mutation({ query: ({ id, ...body }) => ({ url: `/skill-wallet/management/reports/${id}`, method: 'PATCH', body }), invalidatesTags: ['SWManage', 'SWGallery'] }),
      getSwDesignations: b.query({ query: () => '/skill-wallet/management/designations', providesTags: ['SWManage'] }),
      grantSwDesignation: b.mutation({ query: (body) => ({ url: '/skill-wallet/management/designations', method: 'POST', body }), invalidatesTags: ['SWManage', 'SWReview'] }),
      revokeSwDesignation: b.mutation({ query: (id) => ({ url: `/skill-wallet/management/designations/${id}`, method: 'DELETE' }), invalidatesTags: ['SWManage', 'SWReview'] }),
    }),
  });

export const {
  useGetSwConfigQuery,
  useUpdateSwConfigMutation,
  useGetMyProjectsQuery,
  useGetSwProjectQuery,
  useGetSwProjectHistoryQuery,
  useCreateSwProjectMutation,
  useUpdateSwProjectMutation,
  useDeleteSwProjectMutation,
  useSubmitSwProjectMutation,
  useWithdrawSwProjectMutation,
  useAddSwMilestoneMutation,
  useGetSwTeamQuery,
  useInviteSwMemberMutation,
  useGetSwInvitationsQuery,
  useAcceptSwInvitationMutation,
  useDeclineSwInvitationMutation,
  useCancelSwInvitationMutation,
  useRemoveSwMemberMutation,
  useLeaveSwTeamMutation,
  useTransferSwOwnershipMutation,
  useGetSwPublicationQuery,
  useSetSwPublicationMutation,
  useSetSwConsentMutation,
  useGetSwGalleryQuery,
  useGetSwPublicGalleryQuery,
  useGetSwGalleryProjectQuery,
  useGetSwPublicGalleryProjectQuery,
  useGetSwLeaderboardQuery,
  useGetSwPublicLeaderboardQuery,
  useToggleSwLikeMutation,
  useGetSwCommentsQuery,
  useAddSwCommentMutation,
  useDeleteSwCommentMutation,
  useReportSwContentMutation,
  useRequestSwContactMutation,
  useGetSwContactRequestsQuery,
  useRespondSwContactMutation,
  useGetSwPortfolioQuery,
  useGetMyCertificationsQuery,
  useGetMyCertificationQuery,
  useDeleteMyCertificationMutation,
  useGetSwLinksQuery,
  useCreateSwLinkMutation,
  useUpdateSwLinkMutation,
  useDeleteSwLinkMutation,
  useGetSwReviewerRolesQuery,
  useGetSwReviewQueueQuery,
  useGetSwReviewProjectQuery,
  useSubmitSwReviewMutation,
  useGetSwCertQueueQuery,
  useGetSwCertForReviewQuery,
  useDecideSwCertMutation,
  useGetSwOverviewQuery,
  useGetSwManagedProjectsQuery,
  useSearchSwStaffQuery,
  useAssignSwReviewersMutation,
  useHideSwProjectMutation,
  useUnhideSwProjectMutation,
  useGetSwRecommendationsQuery,
  useUpdateSwRecommendationMutation,
  useGetSwMilestonesQuery,
  useDecideSwMilestoneMutation,
  useGetSwReportsQuery,
  useResolveSwReportMutation,
  useGetSwDesignationsQuery,
  useGrantSwDesignationMutation,
  useRevokeSwDesignationMutation,
} = skillWalletApi;

/** One multipart request over XHR so the UI can show real upload progress. */
function sendMultipart({ url, method, form, token, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `/api${url}`);
    xhr.withCredentials = true;
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    const csrf = getCsrfCookie();
    if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(Object.assign(new Error('Network error'), { status: 'FETCH_ERROR' }));
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { status: 'ABORTED' }));
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/**
 * Multipart upload with progress for Skill Wallet files. Refreshes an expired
 * access token once (like the RTK base query) and invalidates the given tags.
 * Rejects with { status, data: { message } } so errMsg() works unchanged.
 */
export function useSkillWalletUpload() {
  const store = useStore();
  const dispatch = useDispatch();
  return useCallback(
    async ({ url, method = 'POST', form, onProgress, signal, invalidates = [] }) => {
      const send = () => sendMultipart({ url, method, form, token: store.getState().auth.accessToken, onProgress, signal });
      let res = await send();
      if (res.status === 401 || isCsrfRejection({ status: res.status, data: res.body })) {
        const session = await refreshSession();
        if (session?.accessToken) {
          dispatch(setCredentials(session));
          onProgress?.(0);
          res = await send();
        }
      }
      if (res.status < 200 || res.status >= 300) {
        throw { status: res.status, data: res.body || { message: `Upload failed (${res.status})` } };
      }
      if (invalidates.length) dispatch(skillWalletApi.util.invalidateTags(invalidates));
      return res.body;
    },
    [store, dispatch]
  );
}
