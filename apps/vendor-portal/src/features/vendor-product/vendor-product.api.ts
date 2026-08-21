import type {
  CreateProductRequest,
  CreateProductResponse,
  UpdateProductRequest,
  VendorProduct,
  VendorProductListResponse,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

/**
 * The vendor-facing product surface (S2-3/S2-5, Phase J) —
 * `/api/v1/vendor/products`. Every write here is `CREATE_OR_EDIT_PRODUCT` —
 * tenant-scoped, self-service, and carries no vendor id: the caller's own
 * vendor is resolved server-side from the authenticated principal, exactly
 * as `shopProfileApi` already establishes for this app.
 *
 * Split from variants/inventory/media (see the sibling `vendor-*.api.ts`
 * files) purely to keep each `injectEndpoints` call within this
 * repository's function-length budget — they all inject into the same
 * `baseApi` and share its cache.
 *
 * `deleteProduct`/`submitProduct` answer `200` with the row's own
 * representation (not `204`) — the API's own controller does this
 * consistently, so the response type matches that rather than assuming a
 * REST convention this backend doesn't use.
 */
export const vendorProductApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listProducts: builder.query<VendorProductListResponse, void>({
      query: () => '/vendor/products',
      transformResponse: (response: SuccessEnvelope<VendorProductListResponse>) => response.data,
      providesTags: (result) =>
        result
          ? [
              ...result.map((product) => ({ type: 'VendorProduct' as const, id: product.id })),
              { type: 'VendorProduct' as const, id: 'LIST' },
            ]
          : [{ type: 'VendorProduct' as const, id: 'LIST' }],
    }),
    getProduct: builder.query<VendorProduct, string>({
      query: (productId) => `/vendor/products/${encodeURIComponent(productId)}`,
      transformResponse: (response: SuccessEnvelope<VendorProduct>) => response.data,
      providesTags: (_result, _error, productId) => [{ type: 'VendorProduct', id: productId }],
    }),
    createProduct: builder.mutation<CreateProductResponse, CreateProductRequest>({
      query: (body) => ({ url: '/vendor/products', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<CreateProductResponse>) => response.data,
      invalidatesTags: [{ type: 'VendorProduct', id: 'LIST' }],
    }),
    updateProduct: builder.mutation<
      VendorProduct,
      { productId: string; body: UpdateProductRequest }
    >({
      query: ({ productId, body }) => ({
        url: `/vendor/products/${encodeURIComponent(productId)}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: SuccessEnvelope<VendorProduct>) => response.data,
      invalidatesTags: (_result, _error, { productId }) => [
        { type: 'VendorProduct', id: productId },
        { type: 'VendorProduct', id: 'LIST' },
      ],
    }),
    deleteProduct: builder.mutation<VendorProduct, string>({
      query: (productId) => ({
        url: `/vendor/products/${encodeURIComponent(productId)}`,
        method: 'DELETE',
      }),
      transformResponse: (response: SuccessEnvelope<VendorProduct>) => response.data,
      invalidatesTags: (_result, _error, productId) => [
        { type: 'VendorProduct', id: productId },
        { type: 'VendorProduct', id: 'LIST' },
      ],
    }),
    submitProduct: builder.mutation<VendorProduct, string>({
      query: (productId) => ({
        url: `/vendor/products/${encodeURIComponent(productId)}/submit`,
        method: 'POST',
      }),
      transformResponse: (response: SuccessEnvelope<VendorProduct>) => response.data,
      invalidatesTags: (_result, _error, productId) => [
        { type: 'VendorProduct', id: productId },
        { type: 'VendorProduct', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useListProductsQuery,
  useGetProductQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
  useSubmitProductMutation,
} = vendorProductApi;
