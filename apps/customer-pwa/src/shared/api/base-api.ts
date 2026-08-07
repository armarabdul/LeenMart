import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { ErrorEnvelope } from '@leen-mart/contracts';
import { env } from '../config/env';

/**
 * The single RTK Query API slice every feature injects its endpoints into
 * (SDD 25.3).
 *
 * One slice rather than one per feature: RTK Query's cache, deduplication and
 * tag invalidation only work across endpoints that share a slice.
 */
export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: env.apiBaseUrl,
    // Refresh tokens live in an httpOnly cookie (SDD 7.2), so the browser must
    // be allowed to send it. The access token is held in memory and attached
    // by the auth feature once that module exists.
    credentials: 'include',
    prepareHeaders: (headers) => {
      headers.set('Accept', 'application/json');
      return headers;
    },
  }),
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
