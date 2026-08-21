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

/** Every success response is wrapped `{ data, meta }` (SDD 9.3) — mirrors `vendor-portal`'s own `base-api.ts`. */
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

/**
 * Refresh-on-401, mirroring `vendor-portal`'s own wrapper exactly — a
 * single retry only. `/identity/refresh` is role-agnostic (`RefreshSessionUseCase`
 * carries no admin check), so the same shared endpoint reissues an admin
 * session exactly as it does a vendor or customer one.
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

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: [
    'KycQueue',
    'KycSubmission',
    'ProductQueue',
    'ReviewQueue',
    'Category',
    'CategoryAttribute',
  ],
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

/**
 * A `VALIDATION_FAILED` response's `details` map straight onto form fields
 * (mirrors `vendor-portal`'s own `apiFieldErrors` exactly). The API's
 * `validate()` middleware names each one `body.<field>`, so this strips
 * that prefix and returns exactly the shape a form can spread onto its own
 * `error={..}` props.
 */
export const apiFieldErrors = (error: unknown): Readonly<Record<string, string>> => {
  if (!isApiError(error)) return {};
  const details = error.data.error.details;
  if (!details) return {};

  const fields: Record<string, string> = {};
  for (const detail of details) {
    if (!detail.field) continue;
    const field = detail.field.startsWith('body.')
      ? detail.field.slice('body.'.length)
      : detail.field;
    if (!(field in fields)) fields[field] = detail.issue;
  }
  return fields;
};

/**
 * `403 UNAUTHORIZED` (SDD 7.4 step 2 — "may this role perform this action at
 * all?") is never distinguishable from *why* by design
 * (`authorize.ts`: "it never says which permission was missing"). This is
 * the one user-facing message every screen shows for it — never the raw
 * server error, and never a guess at which permission was missing.
 */
export const isForbiddenError = (error: unknown): boolean =>
  isApiError(error) && error.status === 403;
