import type {
  CreateReviewRequest,
  ListMyReviewsResponse,
  ListProductReviewsResponse,
  ReviewResponse,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

/**
 * Verified-purchase product reviews (S8-REVIEWS).
 *
 * `getProductReviews` is unauthenticated, the same as `productApi` — a
 * customer may browse a product's reviews without a session. `createReview`
 * and `getMyReviews` require one, matching `WRITE_REVIEW`'s own `OWN` scope.
 */
export const reviewApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getProductReviews: builder.query<ListProductReviewsResponse, string>({
      query: (productId) => `/catalogue/products/${encodeURIComponent(productId)}/reviews`,
      transformResponse: (response: SuccessEnvelope<ListProductReviewsResponse>) => response.data,
      providesTags: ['Review'],
    }),

    /**
     * The caller's own reviews, every status. Used to answer "have I already
     * reviewed this purchase" — a customer's review count is naturally
     * bounded, the same reasoning `listAddressesResponseSchema` uses no
     * pagination.
     */
    getMyReviews: builder.query<ListMyReviewsResponse, void>({
      query: () => '/me/reviews',
      transformResponse: (response: SuccessEnvelope<ListMyReviewsResponse>) => response.data,
      providesTags: ['Review'],
    }),

    createReview: builder.mutation<ReviewResponse, CreateReviewRequest>({
      query: (body) => ({ url: '/me/reviews', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<ReviewResponse>) => response.data,
      invalidatesTags: ['Review'],
    }),
  }),
});

export const { useGetProductReviewsQuery, useGetMyReviewsQuery, useCreateReviewMutation } =
  reviewApi;
