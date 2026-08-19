import type {
  OrderResponse,
  OrderSummaryResponse,
  PickupTokenResponse,
  PlaceOrderRequest,
  SlotAvailabilityResponse,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

/**
 * `idempotencyKey` is generated client-side, once per checkout attempt (see
 * `CheckoutPage`), and carried as a request header rather than a body field —
 * mirroring the backend's own `Idempotency-Key` middleware, which reads it
 * from the header, not the payload.
 */
interface PlaceOrderArgs extends PlaceOrderRequest {
  readonly idempotencyKey: string;
}

export const checkoutApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    placeOrder: builder.mutation<OrderResponse, PlaceOrderArgs>({
      query: ({ idempotencyKey, ...body }) => ({
        url: '/orders',
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      transformResponse: (response: SuccessEnvelope<OrderResponse>) => response.data,
      // The order clears the caller's cart server-side (best-effort) — the
      // cart cache must be treated as stale too, not just `Order`.
      invalidatesTags: ['Cart', 'Order'],
    }),
    /**
     * S4-SLOTS. Scoped to the caller's own cart server-side — no vendor id is
     * sent. Tagged `Cart` so changing the cart re-fetches what can be chosen:
     * removing the last item from a vendor removes that vendor's slots too.
     *
     * `refetchOnMountOrArgChange` is deliberately left off: the numbers are a
     * snapshot, never a promise, and placement re-checks capacity atomically.
     */
    getSlotAvailability: builder.query<SlotAvailabilityResponse, void>({
      query: () => '/orders/slot-availability',
      transformResponse: (response: SuccessEnvelope<SlotAvailabilityResponse>) => response.data,
      providesTags: ['Cart'],
    }),
    getOrder: builder.query<OrderResponse, string>({
      query: (orderId) => `/orders/${encodeURIComponent(orderId)}`,
      transformResponse: (response: SuccessEnvelope<OrderResponse>) => response.data,
      providesTags: (_result, _error, orderId) => [{ type: 'Order', id: orderId }],
    }),
    // "My Orders" (S3-4). A bare `'Order'` tag — invalidated by `placeOrder`'s
    // own existing `invalidatesTags` without any change there, since RTK
    // Query already treats a type-only invalidation as matching every
    // id-scoped tag of that type too.
    /**
     * S4-QR: the current QR credential for one PICKUP sub-order. Each call
     * *rotates* the token server-side, so this is deliberately not cached
     * under an `Order` tag — `PickupQrPanel` re-fetches on its own schedule,
     * driven by the `expiresAt` the server returns, and a stale cache entry
     * would show a QR the backend has already invalidated.
     */
    getPickupToken: builder.query<
      PickupTokenResponse,
      { readonly orderId: string; readonly subOrderId: string }
    >({
      query: ({ orderId, subOrderId }) =>
        `/orders/${encodeURIComponent(orderId)}/sub-orders/${encodeURIComponent(subOrderId)}/pickup-token`,
      transformResponse: (response: SuccessEnvelope<PickupTokenResponse>) => response.data,
    }),
    listOrders: builder.query<readonly OrderSummaryResponse[], void>({
      query: () => '/orders',
      transformResponse: (response: SuccessEnvelope<readonly OrderSummaryResponse[]>) =>
        response.data,
      providesTags: ['Order'],
    }),
    cancelOrder: builder.mutation<OrderResponse, string>({
      query: (orderId) => ({
        url: `/orders/${encodeURIComponent(orderId)}/cancel`,
        method: 'POST',
      }),
      transformResponse: (response: SuccessEnvelope<OrderResponse>) => response.data,
      invalidatesTags: ['Order'],
    }),
  }),
});

export const {
  usePlaceOrderMutation,
  useGetOrderQuery,
  useListOrdersQuery,
  useCancelOrderMutation,
  useGetPickupTokenQuery,
  useGetSlotAvailabilityQuery,
} = checkoutApi;
