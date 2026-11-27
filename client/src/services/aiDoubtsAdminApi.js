import { api } from './api';

/**
 * IT support controls for the self-hosted AI Doubts model (server/ai).
 * The server enforces everything: IT support role, password re-entry for
 * changes, audit log. There is deliberately no "resume" call — AI is turned
 * back on only from the server terminal (`npm run ai:resume`).
 */
export const aiDoubtsAdminApi = api.enhanceEndpoints({ addTagTypes: ['AiDoubtsAdmin', 'AiDoubtsBlocked', 'AiDoubtsCredits'] }).injectEndpoints({
  endpoints: (b) => ({
    getAiDoubtsStatus: b.query({ query: () => '/console/ai-doubts/status', providesTags: ['AiDoubtsAdmin'], keepUnusedDataFor: 0 }),
    emergencyStopAiDoubts: b.mutation({
      query: (reason) => ({ url: '/console/ai-doubts/emergency-stop', method: 'POST', body: { reason } }),
      invalidatesTags: ['AiDoubtsAdmin'],
    }),
    getAiDoubtsBlocked: b.query({ query: () => '/console/ai-doubts/blocked', providesTags: ['AiDoubtsBlocked'], keepUnusedDataFor: 0 }),
    unblockAiDoubtsUser: b.mutation({
      query: ({ userId, reason }) => ({ url: '/console/ai-doubts/unblock', method: 'POST', body: { userId, ...(reason ? { reason } : {}) } }),
      invalidatesTags: ['AiDoubtsBlocked', 'AiDoubtsAdmin'],
    }),
    getAiDoubtsCredits: b.query({
      query: (account) => ({ url: '/console/ai-doubts/credits', params: { account } }),
      providesTags: ['AiDoubtsCredits'],
      keepUnusedDataFor: 0,
    }),
    grantAiDoubtsCredits: b.mutation({
      query: (body) => ({ url: '/console/ai-doubts/credits/grant', method: 'POST', body }),
      invalidatesTags: ['AiDoubtsCredits'],
    }),
  }),
});

export const {
  useGetAiDoubtsStatusQuery,
  useEmergencyStopAiDoubtsMutation,
  useGetAiDoubtsBlockedQuery,
  useUnblockAiDoubtsUserMutation,
  useLazyGetAiDoubtsCreditsQuery,
  useGrantAiDoubtsCreditsMutation,
} = aiDoubtsAdminApi;
