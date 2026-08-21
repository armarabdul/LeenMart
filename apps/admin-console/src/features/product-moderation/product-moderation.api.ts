import type {
  AdminProductDetail,
  AdminProductQueueItem,
  AdminProductQueueQuery,
  DecideProductRequest,
  DecideProductResponse,
} from '@leen-mart/contracts';
import { baseApi } from '@/shared/api/base-api';

/** Mirrors `kyc-review.api.ts`'s own paginated-response shape (`admin-product.controller.ts`'s `listQueue` handler). */
interface PaginatedResponse<TItem> {
  readonly data: readonly TItem[];
  readonly meta: {
    readonly requestId: string;
    readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
  };
}

export interface ProductQueuePage {
  readonly items: readonly AdminProductQueueItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

const productQueueUrl = (query: AdminProductQueueQuery): string => {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  for (const status of query.status ?? []) params.append('status', status);
  const search = params.toString();
  return search ? `/admin/products/submissions?${search}` : '/admin/products/submissions';
};

/** The admin product moderation surface (Phase L, L5) — `packages/contracts/src/catalogue/product-review.contract.ts`, nothing invented. */
export const productModerationApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listProductQueue: builder.query<ProductQueuePage, AdminProductQueueQuery>({
      query: productQueueUrl,
      transformResponse: (response: PaginatedResponse<AdminProductQueueItem>) => ({
        items: response.data,
        nextCursor: response.meta.pagination.nextCursor,
        hasMore: response.meta.pagination.hasMore,
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((item) => ({
                type: 'ProductQueue' as const,
                id: item.productId,
              })),
              { type: 'ProductQueue' as const, id: 'LIST' },
            ]
          : [{ type: 'ProductQueue' as const, id: 'LIST' }],
    }),
    getProductSubmission: builder.query<AdminProductDetail, string>({
      query: (productId) => `/admin/products/submissions/${encodeURIComponent(productId)}`,
      transformResponse: (response: { data: AdminProductDetail }) => response.data,
      providesTags: (_result, _error, productId) => [{ type: 'ProductQueue', id: productId }],
    }),
    decideProduct: builder.mutation<
      DecideProductResponse,
      { productId: string; body: DecideProductRequest }
    >({
      query: ({ productId, body }) => ({
        url: `/admin/products/submissions/${encodeURIComponent(productId)}/decision`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: { data: DecideProductResponse }) => response.data,
      invalidatesTags: (_result, _error, { productId }) => [
        { type: 'ProductQueue', id: productId },
        { type: 'ProductQueue', id: 'LIST' },
      ],
    }),
  }),
});

export const { useListProductQueueQuery, useGetProductSubmissionQuery, useDecideProductMutation } =
  productModerationApi;
