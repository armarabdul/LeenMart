import type {
  AuthSessionResponse,
  LoginRequest,
  LogoutRequest,
  LogoutResponse,
  RefreshSessionRequest,
  RegisterCustomerRequest,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';
import { sessionCleared, sessionEstablished } from '@/shared/api/session.slice';

/**
 * Vendor email/password auth, mirroring `customer-pwa`'s own `auth.api.ts`.
 *
 * `register` creates the underlying identity account (role `CUSTOMER`) via
 * the same `/identity/register` endpoint customer-pwa uses — becoming a
 * *vendor* is a separate act (`POST /vendors`, see `vendor.api.ts`), which
 * `RegisterVendorUseCase` deliberately keeps as its own step: promoting the
 * account to `VENDOR_OWNER` revokes every session, so the two calls can never
 * be collapsed into one that stays logged in afterward (S3-5's own locked
 * decision this route composes with, not replaces).
 */
export const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    register: builder.mutation<AuthSessionResponse, RegisterCustomerRequest>({
      query: (body) => ({ url: '/identity/register', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<AuthSessionResponse>) => response.data,
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        const { data } = await queryFulfilled;
        dispatch(sessionEstablished(data));
      },
    }),
    login: builder.mutation<AuthSessionResponse, LoginRequest>({
      query: (body) => ({ url: '/identity/login', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<AuthSessionResponse>) => response.data,
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        const { data } = await queryFulfilled;
        dispatch(sessionEstablished(data));
      },
    }),
    refresh: builder.mutation<AuthSessionResponse, RefreshSessionRequest>({
      query: (body) => ({ url: '/identity/refresh', method: 'POST', body }),
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
          // Purges every cached query result (vendor orders, vendor earnings,
          // …), not just the session — found during S3-8's own cross-vendor
          // isolation walkthrough: without this, a second vendor signing in
          // on the same tab reused the first vendor's cached responses (the
          // RTK Query cache key carries no identity), briefly rendering one
          // vendor's data under another vendor's session. The backend itself
          // was never at risk — every request it received was correctly
          // scoped — this is purely the client-side display layer.
          dispatch(baseApi.util.resetApiState());
        }
      },
    }),
  }),
});

export const { useRegisterMutation, useLoginMutation, useRefreshMutation, useLogoutMutation } =
  authApi;
