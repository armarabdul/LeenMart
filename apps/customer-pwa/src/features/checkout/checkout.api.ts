import type { OrderResponse, OrderSummaryResponse, PlaceOrderRequest } from '@leen-mart/contracts';
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
    getOrder: builder.query<OrderResponse, string>({
      query: (orderId) => `/orders/${encodeURIComponent(orderId)}`,
      transformResponse: (response: SuccessEnvelope<OrderResponse>) => response.data,
      providesTags: (_result, _error, orderId) => [{ type: 'Order', id: orderId }],
    }),
    // "My Orders" (S3-4). A bare `'Order'` tag — invalidated by `placeOrder`'s
    // own existing `invalidatesTags` without any change there, since RTK
    // Query already treats a type-only invalidation as matching every
    // id-scoped tag of that type too.
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
} = checkoutApi;
