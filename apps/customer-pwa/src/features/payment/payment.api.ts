import type {
  ConfirmPaymentRequest,
  OrderResponse,
  PaymentInitiationResponse,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

/**
 * `idempotencyKey` is generated client-side, once per attempt, and carried
 * as a request header — mirroring `checkout.api.ts`'s own `placeOrder`
 * shape, which mirrors the backend's `Idempotency-Key` middleware.
 */
interface InitiatePaymentArgs {
  readonly orderId: string;
  readonly idempotencyKey: string;
}

interface ConfirmPaymentArgs extends ConfirmPaymentRequest {
  readonly orderId: string;
  readonly idempotencyKey: string;
}

/**
 * S3-3B's mock payment step. Both endpoints only ever report on the caller's
 * own order — the backend re-derives ownership, order status and amount
 * from its own database on every call (SEC-02); nothing here can widen that.
 */
export const paymentApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    initiatePayment: builder.mutation<PaymentInitiationResponse, InitiatePaymentArgs>({
      query: ({ orderId, idempotencyKey }) => ({
        url: `/orders/${encodeURIComponent(orderId)}/payment/initiate`,
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      transformResponse: (response: SuccessEnvelope<PaymentInitiationResponse>) => response.data,
      invalidatesTags: (_result, _error, { orderId }) => [{ type: 'Order', id: orderId }],
    }),
    confirmPayment: builder.mutation<OrderResponse, ConfirmPaymentArgs>({
      query: ({ orderId, idempotencyKey, ...body }) => ({
        url: `/orders/${encodeURIComponent(orderId)}/payment/confirm`,
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      transformResponse: (response: SuccessEnvelope<OrderResponse>) => response.data,
      // The backend's own response is CONFIRMED-or-thrown — either way the
      // cached `Order` this order's id points at is stale.
      invalidatesTags: (_result, _error, { orderId }) => [{ type: 'Order', id: orderId }],
    }),
  }),
});

export const { useInitiatePaymentMutation, useConfirmPaymentMutation } = paymentApi;
