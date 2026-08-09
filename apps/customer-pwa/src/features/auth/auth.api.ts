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
 * Customer email/password auth (Milestone 3 Step 1). Phone+OTP is a later,
 * separate step — see docs/identity-milestone2-backlog.md.
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
          // Local session always clears, even if the network call fails —
          // logout must never leave the customer stuck in a signed-in UI
          // state (backend logout is also idempotent/always-200).
          dispatch(sessionCleared());
        }
      },
    }),
  }),
});

export const { useRegisterMutation, useLoginMutation, useRefreshMutation, useLogoutMutation } =
  authApi;
