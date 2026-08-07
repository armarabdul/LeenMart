import type { ReadinessResponse } from '@leen-mart/contracts';
import { baseApi } from './base-api';

/**
 * Platform health, injected into the shared API slice.
 *
 * Uses `queryFn` rather than `query` because `/readyz` is an operational
 * endpoint mounted at the server root, outside the versioned `/api/v1` prefix
 * that `baseQuery` prepends.
 *
 * This exists as a worked example of the endpoint-injection pattern every
 * feature will follow — and so the shell has something real to render.
 */
export const healthApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getReadiness: builder.query<ReadinessResponse, void>({
      queryFn: async () => {
        try {
          const response = await fetch('/readyz', { headers: { Accept: 'application/json' } });
          const data = (await response.json()) as ReadinessResponse;
          // 503 is a valid, meaningful answer here: the body still describes
          // which dependency is down, so it is data rather than an error.
          return { data };
        } catch (error) {
          return {
            error: {
              status: 'FETCH_ERROR' as const,
              error: error instanceof Error ? error.message : 'Network request failed',
            },
          };
        }
      },
      providesTags: ['Health'],
    }),
  }),
});

export const { useGetReadinessQuery } = healthApi;
