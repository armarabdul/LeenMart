import type { SetInventoryRequest, VendorInventory } from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

interface VariantArgs {
  readonly productId: string;
  readonly variantId: string;
}

/** One variant's stock (S2-4, Phase J) — split out of `vendor-product.api.ts`, see that file's own doc comment. Version-guarded (D-B). */
export const vendorInventoryApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getInventory: builder.query<VendorInventory, VariantArgs>({
      query: ({ productId, variantId }) =>
        `/vendor/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/inventory`,
      transformResponse: (response: SuccessEnvelope<VendorInventory>) => response.data,
      providesTags: (_result, _error, { variantId }) => [
        { type: 'VendorInventory', id: variantId },
      ],
    }),
    setInventory: builder.mutation<VendorInventory, VariantArgs & { body: SetInventoryRequest }>({
      query: ({ productId, variantId, body }) => ({
        url: `/vendor/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/inventory`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: SuccessEnvelope<VendorInventory>) => response.data,
      invalidatesTags: (_result, _error, { variantId }) => [
        { type: 'VendorInventory', id: variantId },
      ],
    }),
  }),
});

export const { useGetInventoryQuery, useSetInventoryMutation } = vendorInventoryApi;
