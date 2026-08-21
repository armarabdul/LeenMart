import type { PublicCategoryTreeResponse } from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

/**
 * The public category tree (S2-2c), Phase J. Vendors pick a `categoryId` for
 * a product from the same tree customer-pwa browses by — there is no
 * vendor-specific category endpoint, and the admin category surface
 * (`adminCategorySchema`) is not reachable from a vendor role. Unauthenticated,
 * matching customer-pwa's own `catalogueApi.getCategoryTree` exactly.
 */
export const catalogueApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCategoryTree: builder.query<PublicCategoryTreeResponse, void>({
      query: () => '/catalogue/categories',
      transformResponse: (response: SuccessEnvelope<PublicCategoryTreeResponse>) => response.data,
    }),
  }),
});

export const { useGetCategoryTreeQuery } = catalogueApi;
