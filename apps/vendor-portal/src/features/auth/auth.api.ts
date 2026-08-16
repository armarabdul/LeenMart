import type {
  AuthSessionResponse,
  LoginRequest,
  LogoutRequest,
  LogoutResponse,
  RefreshSessionRequest,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';
import { sessionCleared, sessionEstablished } from '@/shared/api/session.slice';

/**
 * Vendor email/password auth, mirroring `customer-pwa`'s own `auth.api.ts`
 * — but no `register` endpoint: a vendor account is created through the
 * customer-facing registration + vendor-registration flow, never here (S3-5
 * is a minimal shell — login only, per the locked decision).
 */
export const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
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
        }
      },
    }),
  }),
});

export const { useLoginMutation, useRefreshMutation, useLogoutMutation } = authApi;
