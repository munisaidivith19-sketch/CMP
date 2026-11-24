import { api } from './api';
import { safeMessage } from './safeError.js';

/**
 * console + module policies. Every endpoint is authorized on the
 * server (super_admin role, re-auth for sensitive writes); nothing here is a
 * security boundary. Privileged data is never cached across identities: the
 * whole API cache is reset on sign-out, and these queries use keepUnusedDataFor: 0.
 */
const fresh = { keepUnusedDataFor: 0 };

export const superAdminApi = api.enhanceEndpoints({ addTagTypes: ['SuperAdmin', 'Emergency', 'MyPolicies', 'AccountModules', 'PolicyTargets', 'UserPolicies', 'SocError', 'SocIncident', 'SocRun'] }).injectEndpoints({
  endpoints: (b) => ({
    superReauth: b.mutation({ query: (password) => ({ url: '/console/reauth', method: 'POST', body: { password } }) }),
    getSuperOverview: b.query({ query: () => '/console/overview', providesTags: ['SuperAdmin'], ...fresh }),
    getPolicyCatalogue: b.query({ query: () => '/console/policies/catalogue' }),
    getSuperAdmins: b.query({ query: (params) => ({ url: '/console/admins', params }), providesTags: ['SuperAdmin'], ...fresh }),
    createSuperAdminAdmin: b.mutation({ query: (body) => ({ url: '/console/admins', method: 'POST', body }), invalidatesTags: ['SuperAdmin'] }),
    updateSuperAdminAdmin: b.mutation({ query: ({ id, ...body }) => ({ url: `/console/admins/${id}`, method: 'PATCH', body }), invalidatesTags: ['SuperAdmin'] }),
    setAdminStatus: b.mutation({ query: ({ id, ...body }) => ({ url: `/console/admins/${id}/status`, method: 'POST', body }), invalidatesTags: ['SuperAdmin'] }),
    resetAdminPassword: b.mutation({ query: ({ id, ...body }) => ({ url: `/console/admins/${id}/reset-password`, method: 'POST', body }), invalidatesTags: ['SuperAdmin'] }),
    revokeAdminSessions: b.mutation({ query: (id) => ({ url: `/console/admins/${id}/revoke-sessions`, method: 'POST' }), invalidatesTags: ['SuperAdmin'] }),
    setAdminPolicies: b.mutation({ query: ({ id, policies }) => ({ url: `/console/admins/${id}/policies`, method: 'PUT', body: { policies } }), invalidatesTags: ['SuperAdmin'] }),
    // Dashboard modules as checkboxes: exactly the ticked module keys.
    setAdminModules: b.mutation({ query: ({ id, modules }) => ({ url: `/console/admins/${id}/modules`, method: 'PUT', body: { modules } }), invalidatesTags: ['SuperAdmin'] }),
    setAdminDelegation: b.mutation({ query: ({ id, delegation }) => ({ url: `/console/admins/${id}/delegation`, method: 'PUT', body: { delegation } }), invalidatesTags: ['SuperAdmin'] }),
    getAdminEvents: b.query({ query: ({ id, ...params }) => ({ url: `/console/admins/${id}/events`, params }), ...fresh }),
    getSuperSecurityEvents: b.query({ query: (params) => ({ url: '/console/security/events', params }), ...fresh }),
    getSuspiciousLogins: b.query({ query: () => '/console/security/suspicious-logins', ...fresh }),
    getAuditTrail: b.query({ query: (params) => ({ url: '/console/security/audit', params }), ...fresh }),
    getMonitoring: b.query({ query: () => '/console/monitoring', ...fresh }),
    // Read-only chat oversight (no send endpoint exists for this role).
    getSuperChats: b.query({ query: (params) => ({ url: '/console/chats', params }), ...fresh }),
    getSuperChatMessages: b.query({ query: ({ id, ...params }) => ({ url: `/console/chats/${id}/messages`, params }), ...fresh }),
    getRecovery: b.query({ query: () => '/console/recovery', providesTags: ['Emergency'], ...fresh }),
    getEmergencyState: b.query({ query: () => '/console/emergency/state', providesTags: ['Emergency'], ...fresh }),
    emergencyTransition: b.mutation({ query: (body) => ({ url: '/console/emergency/transition', method: 'POST', body }), invalidatesTags: ['Emergency', 'SuperAdmin'] }),
    emergencyHealthCheck: b.mutation({ query: () => ({ url: '/console/emergency/health-check', method: 'POST' }), invalidatesTags: ['Emergency'] }),
    // ── SOC & troubleshooting ──
    getSocOverview: b.query({ query: (range) => ({ url: '/console/soc/overview', params: { range } }), ...fresh }),
    getSocAlerts: b.query({ query: (range) => ({ url: '/console/soc/alerts', params: { range } }), ...fresh }),
    getSocErrors: b.query({ query: (params) => ({ url: '/console/soc/errors', params }), providesTags: ['SocError'], ...fresh }),
    getSocError: b.query({ query: (id) => `/console/soc/errors/${id}`, providesTags: ['SocError', 'SocRun'], ...fresh }),
    setSocErrorStatus: b.mutation({ query: ({ id, ...body }) => ({ url: `/console/soc/errors/${id}/status`, method: 'POST', body }), invalidatesTags: ['SocError'] }),
    addSocErrorNote: b.mutation({ query: ({ id, text }) => ({ url: `/console/soc/errors/${id}/notes`, method: 'POST', body: { text } }), invalidatesTags: ['SocError'] }),
    verifySocError: b.mutation({ query: (id) => ({ url: `/console/soc/errors/${id}/verify`, method: 'POST' }), invalidatesTags: ['SocError', 'SocRun'] }),
    aiExplainSocError: b.mutation({ query: (id) => ({ url: `/console/soc/errors/${id}/ai-explain`, method: 'POST' }) }),
    getSocDiagnostics: b.query({ query: (params) => ({ url: '/console/soc/diagnostics', params }), ...fresh }),
    smsTest: b.mutation({ query: (phone) => ({ url: '/console/soc/diagnostics/sms-test', method: 'POST', body: { phone } }) }),
    runSocDiagnostic: b.mutation({ query: (body) => ({ url: '/console/soc/diagnostics/run', method: 'POST', body }), invalidatesTags: ['SocRun'] }),
    getSocRuns: b.query({ query: (params) => ({ url: '/console/soc/diagnostics/runs', params }), providesTags: ['SocRun'], ...fresh }),
    getSocRun: b.query({ query: (id) => `/console/soc/diagnostics/runs/${id}`, ...fresh }),
    cancelSocRun: b.mutation({ query: (id) => ({ url: `/console/soc/diagnostics/runs/${id}/cancel`, method: 'POST' }), invalidatesTags: ['SocRun'] }),
    getSocIncidents: b.query({ query: (params) => ({ url: '/console/soc/incidents', params }), providesTags: ['SocIncident'], ...fresh }),
    getSocIncident: b.query({ query: (id) => `/console/soc/incidents/${id}`, providesTags: ['SocIncident'], ...fresh }),
    getSocAssignees: b.query({ query: () => '/console/soc/incidents/assignees', ...fresh }),
    createSocIncident: b.mutation({ query: (body) => ({ url: '/console/soc/incidents', method: 'POST', body }), invalidatesTags: ['SocIncident', 'SocError'] }),
    updateSocIncident: b.mutation({ query: ({ id, ...body }) => ({ url: `/console/soc/incidents/${id}`, method: 'PATCH', body }), invalidatesTags: ['SocIncident', 'SocError'] }),
    addSocIncidentNote: b.mutation({ query: ({ id, text }) => ({ url: `/console/soc/incidents/${id}/notes`, method: 'POST', body: { text } }), invalidatesTags: ['SocIncident'] }),
    getSocHealth: b.query({ query: () => '/console/soc/health', ...fresh }),
    runSocHealth: b.mutation({ query: () => ({ url: '/console/soc/health/run', method: 'POST' }) }),
    getSocCatalog: b.query({ query: () => '/console/soc/catalog', ...fresh }),
    getSocCoverage: b.query({ query: () => '/console/soc/coverage', ...fresh }),
    // Ordinary admins: own effective permissions (drives which admin pages show).
    getMyPolicies: b.query({ query: () => '/admin/my-policies', providesTags: ['MyPolicies'], ...fresh }),
    // The signed-in account's dashboard modules, live from its policies (never cached server-side).
    getAccountModules: b.query({ query: () => '/account/modules', providesTags: ['AccountModules'], ...fresh }),
    // Delegated policy assignment (an Admin holding user_management.policies).
    getPolicyTargets: b.query({ query: () => '/admin/policy-targets', providesTags: ['PolicyTargets'], ...fresh }),
    // One account's policies (Admins: module policies; staff: additional policies).
    getUserPolicies: b.query({ query: (id) => `/admin/users/${id}/policies`, providesTags: ['UserPolicies'], ...fresh }),
    setUserPolicies: b.mutation({
      query: ({ id, policies }) => ({ url: `/admin/users/${id}/policies`, method: 'PUT', body: { policies, merge: true } }),
      invalidatesTags: ['UserPolicies', 'PolicyTargets'],
    }),
    setDelegatedPolicies: b.mutation({
      query: ({ id, policies }) => ({ url: `/admin/users/${id}/policies`, method: 'PUT', body: { policies, merge: true } }),
      invalidatesTags: ['PolicyTargets', 'MyPolicies'],
    }),
  }),
});

export const {
  useSuperReauthMutation,
  useGetSuperOverviewQuery,
  useGetPolicyCatalogueQuery,
  useGetSuperAdminsQuery,
  useCreateSuperAdminAdminMutation,
  useUpdateSuperAdminAdminMutation,
  useSetAdminStatusMutation,
  useResetAdminPasswordMutation,
  useRevokeAdminSessionsMutation,
  useSetAdminPoliciesMutation,
  useSetAdminModulesMutation,
  useSetAdminDelegationMutation,
  useGetAdminEventsQuery,
  useGetSuperSecurityEventsQuery,
  useGetSuspiciousLoginsQuery,
  useGetAuditTrailQuery,
  useGetMonitoringQuery,
  useGetSuperChatsQuery,
  useGetSuperChatMessagesQuery,
  useGetRecoveryQuery,
  useGetEmergencyStateQuery,
  useEmergencyTransitionMutation,
  useEmergencyHealthCheckMutation,
  useGetMyPoliciesQuery,
  useGetAccountModulesQuery,
  useGetPolicyTargetsQuery,
  useSetDelegatedPoliciesMutation,
  useGetUserPoliciesQuery,
  useSetUserPoliciesMutation,
  useGetSocOverviewQuery,
  useGetSocAlertsQuery,
  useGetSocErrorsQuery,
  useGetSocErrorQuery,
  useSetSocErrorStatusMutation,
  useAddSocErrorNoteMutation,
  useVerifySocErrorMutation,
  useAiExplainSocErrorMutation,
  useGetSocDiagnosticsQuery,
  useRunSocDiagnosticMutation,
  useSmsTestMutation,
  useGetSocRunsQuery,
  useGetSocRunQuery,
  useCancelSocRunMutation,
  useGetSocIncidentsQuery,
  useGetSocIncidentQuery,
  useGetSocAssigneesQuery,
  useCreateSocIncidentMutation,
  useUpdateSocIncidentMutation,
  useAddSocIncidentNoteMutation,
  useGetSocHealthQuery,
  useRunSocHealthMutation,
  useGetSocCatalogQuery,
  useGetSocCoverageQuery,
} = superAdminApi;

/** True when an RTK error is the server asking for a password re-entry. */
export const needsReauth = (err) => err?.status === 403 && err?.data?.code === 'REAUTH_REQUIRED';
export const errorMessage = (err, fallback = 'Something went wrong') => safeMessage(err?.data?.errors?.[0]?.msg, safeMessage(err?.data?.message, fallback));
