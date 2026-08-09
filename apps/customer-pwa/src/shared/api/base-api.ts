import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';
import type { AuthSessionResponse, ErrorEnvelope } from '@leen-mart/contracts';
import type { RootState } from '@/app/store';
import { env } from '../config/env';
import {
  selectAccessToken,
  selectRefreshToken,
  sessionCleared,
  sessionEstablished,
} from './session.slice';

/** Every success response is wrapped `{ data, meta }` (SDD 9.3). */
export interface SuccessEnvelope<TData> {
  readonly data: TData;
  readonly meta: { readonly requestId: string };
}

/**
 * The SDD's intended refresh token is an httpOnly cookie (SDD 7.2); the
 * backend does not set one yet (Milestone 3 Step 1 analysis — see
 * docs/identity-milestone2-backlog.md), so today's refresh token is a plain
 * string the client must hold and resubmit. `credentials: 'include'` is kept
 * so nothing needs to change here once that backend gap closes.
 */
const rawBaseQuery = fetchBaseQuery({
  baseUrl: env.apiBaseUrl,
  credentials: 'include',
  prepareHeaders: (headers, { getState }) => {
    headers.set('Accept', 'application/json');
    const accessToken = selectAccessToken(getState() as RootState);
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    return headers;
  },
});

/**
 * Wraps every request with refresh-on-401 (SDD 25.3: "baseQuery with auth +
 * refresh interception"). A single retry only — the refresh call itself uses
 * `rawBaseQuery` directly, never this wrapper, so an invalid/expired refresh
 * token fails once and clears the session instead of looping.
 */
const baseQueryWithReauth: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions,
) => {
  let result = await rawBaseQuery(args, api, extraOptions);

  if (result.error?.status === 401) {
    const refreshToken = selectRefreshToken(api.getState() as RootState);

    if (refreshToken) {
      const refreshResult = await rawBaseQuery(
        { url: '/identity/refresh', method: 'POST', body: { refreshToken } },
        api,
        extraOptions,
      );

      if (refreshResult.data) {
        const { data: refreshedSession } =
          refreshResult.data as SuccessEnvelope<AuthSessionResponse>;
        api.dispatch(sessionEstablished(refreshedSession));
        result = await rawBaseQuery(args, api, extraOptions);
      } else {
        api.dispatch(sessionCleared());
      }
    } else {
      api.dispatch(sessionCleared());
    }
  }

  return result;
};

/**
 * The single RTK Query API slice every feature injects its endpoints into
 * (SDD 25.3).
 *
 * One slice rather than one per feature: RTK Query's cache, deduplication and
 * tag invalidation only work across endpoints that share a slice.
 */
export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  // Declared centrally so features can invalidate across module boundaries
  // without importing each other.
  tagTypes: ['Health'],
  endpoints: () => ({}),
  refetchOnReconnect: true,
});

/** Narrows an RTK Query error to the platform's error envelope (SDD 9.3). */
export const isApiError = (error: unknown): error is { status: number; data: ErrorEnvelope } => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; data?: unknown };
  if (typeof candidate.status !== 'number') return false;
  const data = candidate.data as { error?: { code?: unknown } } | undefined;
  return typeof data?.error?.code === 'string';
};

/**
 * Extracts a user-facing message.
 *
 * The UI switches on `error.code`, never on `error.message` — the message is
 * localisable prose and its wording is not a contract.
 */
export const apiErrorMessage = (error: unknown, fallback = 'Something went wrong.'): string =>
  isApiError(error) ? error.data.error.message : fallback;
