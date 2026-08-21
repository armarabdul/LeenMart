import type {
  CompleteProductMediaUploadRequest,
  CreateProductMediaUploadIntentRequest,
  CreateProductMediaUploadIntentResponse,
  VendorProductMedia,
  VendorProductMediaListResponse,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

interface MediaArgs {
  readonly productId: string;
  readonly mediaId: string;
}

/** A product's photos (S2-6a, Phase J) — split out of `vendor-product.api.ts`, see that file's own doc comment. No reorder endpoint — the API exposes none. */
export const vendorProductMediaApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listMedia: builder.query<VendorProductMediaListResponse, string>({
      query: (productId) => `/vendor/products/${encodeURIComponent(productId)}/media`,
      transformResponse: (response: SuccessEnvelope<VendorProductMediaListResponse>) =>
        response.data,
      providesTags: (_result, _error, productId) => [{ type: 'VendorProductMedia', id: productId }],
    }),
    createMediaUploadIntent: builder.mutation<
      CreateProductMediaUploadIntentResponse,
      { productId: string; body: CreateProductMediaUploadIntentRequest }
    >({
      query: ({ productId, body }) => ({
        url: `/vendor/products/${encodeURIComponent(productId)}/media`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: SuccessEnvelope<CreateProductMediaUploadIntentResponse>) =>
        response.data,
    }),
    completeMediaUpload: builder.mutation<
      VendorProductMedia,
      MediaArgs & { body?: CompleteProductMediaUploadRequest }
    >({
      query: ({ productId, mediaId }) => ({
        url: `/vendor/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(mediaId)}/complete`,
        method: 'POST',
        body: {},
      }),
      transformResponse: (response: SuccessEnvelope<VendorProductMedia>) => response.data,
      invalidatesTags: (_result, _error, { productId }) => [
        { type: 'VendorProductMedia', id: productId },
      ],
    }),
    deleteMedia: builder.mutation<VendorProductMedia, MediaArgs>({
      query: ({ productId, mediaId }) => ({
        url: `/vendor/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(mediaId)}`,
        method: 'DELETE',
      }),
      transformResponse: (response: SuccessEnvelope<VendorProductMedia>) => response.data,
      invalidatesTags: (_result, _error, { productId }) => [
        { type: 'VendorProductMedia', id: productId },
      ],
    }),
  }),
});

export const {
  useListMediaQuery,
  useCreateMediaUploadIntentMutation,
  useCompleteMediaUploadMutation,
  useDeleteMediaMutation,
} = vendorProductMediaApi;
