import type { PublicProductDetail } from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';
import { variantsObserved } from '@/shared/state/known-variants.slice';

/**
 * Public product detail (S3-3 discovery milestone's approved backend
 * surface). Unauthenticated, same as `catalogueApi` — a customer may browse
 * a product page without a session; only adding to cart needs one.
 */
export const productApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getProductDetail: builder.query<PublicProductDetail, string>({
      query: (productId) => `/catalogue/products/${encodeURIComponent(productId)}`,
      transformResponse: (response: SuccessEnvelope<PublicProductDetail>) => response.data,
      /**
       * Every variant of the viewed product is recorded into the shared
       * `knownVariants` index, not just the selected one — a customer may add
       * a different variant than the one first shown, and the cart needs to
       * resolve whichever one they actually chose. This is the only bridge
       * from a cart item's bare `variantId` back to display data; see
       * `known-variants.slice.ts` for why no backend endpoint provides one.
       */
      onQueryStarted: async (_productId, { dispatch, queryFulfilled }) => {
        const { data } = await queryFulfilled;
        dispatch(
          variantsObserved(
            data.variants.map((variant) => ({
              variantId: variant.id,
              productId: data.id,
              productName: data.name,
              variantName: variant.name,
              price: variant.price,
              unitOfMeasure: variant.unitOfMeasure,
              quantityStep: variant.quantityStep,
              available: variant.available,
            })),
          ),
        );
      },
    }),
  }),
});

export const { useGetProductDetailQuery } = productApi;
