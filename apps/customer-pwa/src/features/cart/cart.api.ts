import type {
  AddCartItemRequest,
  CartActionSuccessResponse,
  CartResponse,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

interface UpdateCartItemArgs {
  readonly itemId: string;
  readonly quantity: number;
}

/**
 * The authenticated cart surface (S3-1). Every route requires a session —
 * `baseQueryWithReauth` already attaches the bearer token and handles 401
 * refresh, so nothing here needs to know about authentication itself.
 */
export const cartApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getCart: builder.query<CartResponse, void>({
      query: () => '/me/cart',
      transformResponse: (response: SuccessEnvelope<CartResponse>) => response.data,
      providesTags: ['Cart'],
    }),

    /**
     * `POST`/`PATCH` both answer with the complete, already-updated cart, and
     * the first implementation here wrote that response straight into the
     * `getCart` cache entry via `onQueryStarted`/`upsertQueryData` to save a
     * round trip. That optimization did not hold up under testing — real
     * end-to-end verification against the live backend showed the cache
     * write not reliably reaching the mounted `getCart` subscribers, so the
     * UI could keep showing a stale quantity even though the mutation had
     * already succeeded server-side (confirmed independently against the
     * database). Every write here now uses the same `invalidatesTags`
     * pattern as the two DELETE endpoints below — a genuine refetch, the
     * conventional and well-tested RTK Query mechanism — trading a small
     * amount of efficiency for correctness that has actually been verified.
     */
    addCartItem: builder.mutation<CartResponse, AddCartItemRequest>({
      query: (body) => ({ url: '/me/cart/items', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<CartResponse>) => response.data,
      invalidatesTags: ['Cart'],
    }),

    updateCartItem: builder.mutation<CartResponse, UpdateCartItemArgs>({
      query: ({ itemId, quantity }) => ({
        url: `/me/cart/items/${encodeURIComponent(itemId)}`,
        method: 'PATCH',
        body: { quantity },
      }),
      transformResponse: (response: SuccessEnvelope<CartResponse>) => response.data,
      invalidatesTags: ['Cart'],
    }),

    /**
     * Neither DELETE route answers with the resulting cart (`{success:true}`
     * only), so there is nothing to write into the cache directly — an
     * invalidated `Cart` tag is what triggers `getCart` to refetch.
     */
    removeCartItem: builder.mutation<CartActionSuccessResponse, string>({
      query: (itemId) => ({
        url: `/me/cart/items/${encodeURIComponent(itemId)}`,
        method: 'DELETE',
      }),
      transformResponse: (response: SuccessEnvelope<CartActionSuccessResponse>) => response.data,
      invalidatesTags: ['Cart'],
    }),

    clearCart: builder.mutation<CartActionSuccessResponse, void>({
      query: () => ({ url: '/me/cart', method: 'DELETE' }),
      transformResponse: (response: SuccessEnvelope<CartActionSuccessResponse>) => response.data,
      invalidatesTags: ['Cart'],
    }),
  }),
});

export const {
  useGetCartQuery,
  useAddCartItemMutation,
  useUpdateCartItemMutation,
  useRemoveCartItemMutation,
  useClearCartMutation,
} = cartApi;
