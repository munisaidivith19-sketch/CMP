import { api } from './api';

/**
 * Terms and Conditions / Privacy Policy. The documents are public (no session
 * needed); acceptance is always recorded for the signed-in account on the
 * server, which also enforces it on every protected API.
 */
export const legalApi = api.enhanceEndpoints({ addTagTypes: ['LegalPolicy'] }).injectEndpoints({
  endpoints: (b) => ({
    getPolicy: b.query({
      query: (policyId) => `/legal/policies/${policyId}`,
      providesTags: (_r, _e, id) => [{ type: 'LegalPolicy', id }],
      keepUnusedDataFor: 300,
    }),
  }),
});

export const { useGetPolicyQuery } = legalApi;
