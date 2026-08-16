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

/** Every success response is wrapped `{ data, meta }` (SDD 9.3) — mirrors `customer-pwa`'s own `base-api.ts`. */
export interface SuccessEnvelope<TData> {
  readonly data: TData;
  readonly meta: { readonly requestId: string };
}

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

/** Refresh-on-401, mirroring `customer-pwa`'s own wrapper exactly — a single retry only. */
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

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: ['VendorOrder'],
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

/** The UI switches on `error.code`, never on `error.message` — the message is localisable prose, not a contract. */
export const apiErrorMessage = (error: unknown, fallback = 'Something went wrong.'): string =>
  isApiError(error) ? error.data.error.message : fallback;
