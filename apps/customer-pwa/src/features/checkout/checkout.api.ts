import type { OrderResponse, PlaceOrderRequest } from '@leen-mart/contracts';
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
  }),
});

export const { usePlaceOrderMutation, useGetOrderQuery } = checkoutApi;
