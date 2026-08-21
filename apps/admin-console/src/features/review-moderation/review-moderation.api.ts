import type {
  AdminReviewQueueItem,
  AdminReviewQueueQuery,
  DecideReviewModerationRequest,
  DecideReviewModerationResponse,
} from '@leen-mart/contracts';
import { baseApi } from '@/shared/api/base-api';

/** Mirrors `kyc-review.api.ts`'s own paginated-response shape (`admin-review.controller.ts`'s `listQueue` handler). */
interface PaginatedResponse<TItem> {
  readonly data: readonly TItem[];
  readonly meta: {
    readonly requestId: string;
    readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
  };
}

export interface ReviewQueuePage {
  readonly items: readonly AdminReviewQueueItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

const reviewQueueUrl = (query: AdminReviewQueueQuery): string => {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  for (const status of query.status ?? []) params.append('status', status);
  const search = params.toString();
  return search ? `/admin/reviews?${search}` : '/admin/reviews';
};

/** The admin review moderation surface (Phase L, L6) — `packages/contracts/src/review/review.contract.ts`, nothing invented. Only `APPROVE`/`HIDE` — no `RESTORE` verb exists on the backend. */
export const reviewModerationApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listReviewQueue: builder.query<ReviewQueuePage, AdminReviewQueueQuery>({
      query: reviewQueueUrl,
      transformResponse: (response: PaginatedResponse<AdminReviewQueueItem>) => ({
        items: response.data,
        nextCursor: response.meta.pagination.nextCursor,
        hasMore: response.meta.pagination.hasMore,
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((item) => ({ type: 'ReviewQueue' as const, id: item.id })),
              { type: 'ReviewQueue' as const, id: 'LIST' },
            ]
          : [{ type: 'ReviewQueue' as const, id: 'LIST' }],
    }),
    decideReview: builder.mutation<
      DecideReviewModerationResponse,
      { reviewId: string; body: DecideReviewModerationRequest }
    >({
      query: ({ reviewId, body }) => ({
        url: `/admin/reviews/${encodeURIComponent(reviewId)}/decision`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: { data: DecideReviewModerationResponse }) => response.data,
      invalidatesTags: (_result, _error, { reviewId }) => [
        { type: 'ReviewQueue', id: reviewId },
        { type: 'ReviewQueue', id: 'LIST' },
      ],
    }),
  }),
});

export const { useListReviewQueueQuery, useDecideReviewMutation } = reviewModerationApi;
