import type {
  PublicCategoryNode,
  PublicCategoryTreeResponse,
  PublicProductSearchListResponse,
  ResponseMeta,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

/**
 * `PublicProductSearchQuery` (zod-inferred) requires `limit` in its output
 * type because the schema applies a `.default(20)` — that default is a
 * server-side parsing concern, not something every caller here should have
 * to pass. This is the request-side shape callers actually build, with every
 * field explicitly optional (and `| undefined`, matching
 * `exactOptionalPropertyTypes`) so `fetchBaseQuery` can drop absent params.
 */
export interface SearchProductsArgs {
  readonly q?: string | undefined;
  readonly categoryId?: string | undefined;
  readonly vendorId?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/**
 * `SuccessEnvelope` (from `base-api.ts`) only types `meta.requestId` — every
 * other endpoint in this codebase ignores pagination. Search is the one
 * endpoint here that needs it, so it reads the envelope against the
 * contracts package's full `ResponseMeta` instead of the narrowed local type.
 */
interface PaginatedEnvelope<TData> {
  readonly data: TData;
  readonly meta: ResponseMeta;
}

/**
 * The result page shape the UI actually needs: items plus the platform's
 * cursor-pagination signal (SDD 9.3's `meta.pagination`). `transformResponse`
 * has to keep `meta` around here — unlike `authApi`'s mutations, which only
 * ever need `data` — because search is the one endpoint in this file whose
 * envelope carries pagination at all.
 */
export interface SearchResultPage {
  readonly items: PublicProductSearchListResponse;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * Public catalogue/search (S2-2c, S2-7). Every endpoint here is
 * unauthenticated — no vendor tenant exists for a customer, so this module
 * never touches `/api/v1/vendor/products/*`, which is the only surface that
 * carries variant, price, or availability data (see the catalogue feature's
 * own README for why product detail/variant selection/add-to-cart are
 * deferred rather than built against a surface that doesn't expose them).
 */
export const catalogueApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCategoryTree: builder.query<PublicCategoryTreeResponse, void>({
      query: () => '/catalogue/categories',
      transformResponse: (response: SuccessEnvelope<PublicCategoryTreeResponse>) => response.data,
    }),
    getCategoryBySlug: builder.query<PublicCategoryNode, string>({
      query: (slug) => `/catalogue/categories/${encodeURIComponent(slug)}`,
      transformResponse: (response: SuccessEnvelope<PublicCategoryNode>) => response.data,
    }),
    searchProducts: builder.query<SearchResultPage, SearchProductsArgs>({
      query: (params) => ({ url: '/search', params }),
      transformResponse: (
        response: PaginatedEnvelope<PublicProductSearchListResponse>,
      ): SearchResultPage => ({
        items: response.data,
        nextCursor: response.meta.pagination?.nextCursor ?? null,
        hasMore: response.meta.pagination?.hasMore ?? false,
      }),
    }),
  }),
});

export const { useGetCategoryTreeQuery, useGetCategoryBySlugQuery, useSearchProductsQuery } =
  catalogueApi;
