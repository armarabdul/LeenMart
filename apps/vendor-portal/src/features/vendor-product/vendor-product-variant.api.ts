import type {
  AddProductVariantRequest,
  UpdateProductVariantRequest,
  VendorProductVariant,
  VendorProductVariantListResponse,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

interface VariantArgs {
  readonly productId: string;
  readonly variantId: string;
}

/** A product's variants (S2-3a, Phase J) — split out of `vendor-product.api.ts`, see that file's own doc comment. */
export const vendorProductVariantApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listVariants: builder.query<VendorProductVariantListResponse, string>({
      query: (productId) => `/vendor/products/${encodeURIComponent(productId)}/variants`,
      transformResponse: (response: SuccessEnvelope<VendorProductVariantListResponse>) =>
        response.data,
      providesTags: (_result, _error, productId) => [
        { type: 'VendorProductVariant', id: productId },
      ],
    }),
    addVariant: builder.mutation<
      VendorProductVariant,
      { productId: string; body: AddProductVariantRequest }
    >({
      query: ({ productId, body }) => ({
        url: `/vendor/products/${encodeURIComponent(productId)}/variants`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: SuccessEnvelope<VendorProductVariant>) => response.data,
      invalidatesTags: (_result, _error, { productId }) => [
        { type: 'VendorProductVariant', id: productId },
      ],
    }),
    updateVariant: builder.mutation<
      VendorProductVariant,
      VariantArgs & { body: UpdateProductVariantRequest }
    >({
      query: ({ productId, variantId, body }) => ({
        url: `/vendor/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: SuccessEnvelope<VendorProductVariant>) => response.data,
      invalidatesTags: (_result, _error, { productId }) => [
        { type: 'VendorProductVariant', id: productId },
      ],
    }),
    deleteVariant: builder.mutation<VendorProductVariant, VariantArgs>({
      query: ({ productId, variantId }) => ({
        url: `/vendor/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
        method: 'DELETE',
      }),
      transformResponse: (response: SuccessEnvelope<VendorProductVariant>) => response.data,
      invalidatesTags: (_result, _error, { productId }) => [
        { type: 'VendorProductVariant', id: productId },
      ],
    }),
  }),
});

export const {
  useListVariantsQuery,
  useAddVariantMutation,
  useUpdateVariantMutation,
  useDeleteVariantMutation,
} = vendorProductVariantApi;
