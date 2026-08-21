import type {
  AdminLoginStepOneRequest,
  AdminLoginStepOneResponse,
  AdminMfaEnrollConfirmRequest,
  AdminMfaEnrollRequest,
  AdminMfaEnrollResponse,
  AdminMfaVerifyRequest,
  AuthSessionResponse,
  LogoutRequest,
  LogoutResponse,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';
import { sessionCleared, sessionEstablished } from '@/shared/api/session.slice';

/**
 * Admin sign-in (Phase L, SDD 7.1: mandatory TOTP, always). Two independent
 * paths, both starting from email + password, exactly matching the real
 * backend design — see `AdminLoginStepOneUseCase`/`AdminMfaEnrollUseCase`'s
 * own doc comments: every rejection on either path (unknown email, wrong
 * password, non-admin role, no confirmed secret vs a secret that already
 * exists) throws the identical `InvalidCredentialsError` (SEC-15), so the
 * server deliberately never tells the client *which* path applies to a
 * given administrator. The UI cannot auto-detect "not enrolled yet" and
 * must not try to — `LoginPage` and `MfaEnrollPage` are both always
 * reachable, and the administrator (who knows whether they have signed in
 * before) chooses.
 *
 * `login` (step 1) and `enroll` (start) return no session — only an opaque
 * challenge or an unconfirmed secret. `verifyMfa` (step 2) and
 * `confirmEnrollment` are the only two calls that ever return a real
 * session, in the identical `authSessionResponseSchema` shape every other
 * login on this platform returns.
 */
export const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation<AdminLoginStepOneResponse, AdminLoginStepOneRequest>({
      query: (body) => ({ url: '/admin/login', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<AdminLoginStepOneResponse>) => response.data,
    }),
    verifyMfa: builder.mutation<AuthSessionResponse, AdminMfaVerifyRequest>({
      query: (body) => ({ url: '/admin/mfa/verify', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<AuthSessionResponse>) => response.data,
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        const { data } = await queryFulfilled;
        dispatch(sessionEstablished(data));
      },
    }),
    enrollMfa: builder.mutation<AdminMfaEnrollResponse, AdminMfaEnrollRequest>({
      query: (body) => ({ url: '/admin/mfa/enroll', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<AdminMfaEnrollResponse>) => response.data,
    }),
    confirmMfaEnrollment: builder.mutation<AuthSessionResponse, AdminMfaEnrollConfirmRequest>({
      query: (body) => ({ url: '/admin/mfa/enroll/confirm', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<AuthSessionResponse>) => response.data,
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        const { data } = await queryFulfilled;
        dispatch(sessionEstablished(data));
      },
    }),
    logout: builder.mutation<LogoutResponse, LogoutRequest>({
      query: (body) => ({ url: '/identity/logout', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<LogoutResponse>) => response.data,
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try {
          await queryFulfilled;
        } finally {
          dispatch(sessionCleared());
          dispatch(baseApi.util.resetApiState());
        }
      },
    }),
  }),
});

export const {
  useLoginMutation,
  useVerifyMfaMutation,
  useEnrollMfaMutation,
  useConfirmMfaEnrollmentMutation,
  useLogoutMutation,
} = authApi;
