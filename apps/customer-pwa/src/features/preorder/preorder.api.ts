import type {
  ConfirmReservationPaymentRequest,
  CreateReservationRequest,
  PublicCampaignResponse,
  ReservationPaymentInitiationResponse,
  ReservationResponse,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

interface CreateReservationArgs extends CreateReservationRequest {
  readonly idempotencyKey: string;
}

interface ReservationActionArgs {
  readonly reservationId: string;
  readonly idempotencyKey: string;
}

interface ConfirmReservationPaymentArgs extends ConfirmReservationPaymentRequest {
  readonly reservationId: string;
  readonly idempotencyKey: string;
}

/**
 * The preorder surface (Phase Next, SDD §14): public campaign browse/detail
 * (`/api/v1/preorders`, unauthenticated) plus the customer's own reservation
 * lifecycle (`/api/v1/preorder-reservations`). Split from a hypothetical
 * "vendor campaign management" slice on purpose — that lives in
 * `vendor-portal`, a different app entirely; this app never manages a
 * campaign, only reserves against one.
 *
 * Every mutation carries an `idempotencyKey` header, generated client-side
 * once per attempt — mirrors `checkout.api.ts`/`payment.api.ts` exactly,
 * never a second convention.
 */
export const preorderApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listPublicCampaigns: builder.query<readonly PublicCampaignResponse[], void>({
      query: () => '/preorders',
      transformResponse: (response: SuccessEnvelope<readonly PublicCampaignResponse[]>) =>
        response.data,
      providesTags: (result) =>
        result
          ? [
              ...result.map((c) => ({ type: 'PreorderCampaign' as const, id: c.id })),
              { type: 'PreorderCampaign' as const, id: 'LIST' },
            ]
          : [{ type: 'PreorderCampaign' as const, id: 'LIST' }],
    }),
    getPublicCampaign: builder.query<PublicCampaignResponse, string>({
      query: (campaignId) => `/preorders/${encodeURIComponent(campaignId)}`,
      transformResponse: (response: SuccessEnvelope<PublicCampaignResponse>) => response.data,
      providesTags: (_result, _error, campaignId) => [{ type: 'PreorderCampaign', id: campaignId }],
    }),

    createReservation: builder.mutation<ReservationResponse, CreateReservationArgs>({
      query: ({ idempotencyKey, ...body }) => ({
        url: '/preorder-reservations',
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      transformResponse: (response: SuccessEnvelope<ReservationResponse>) => response.data,
      // The campaign's own `remainingQuantity` just moved.
      invalidatesTags: (_result, _error, { campaignId }) => [
        { type: 'PreorderCampaign', id: campaignId },
        { type: 'PreorderReservation', id: 'LIST' },
      ],
    }),
    getReservation: builder.query<ReservationResponse, string>({
      query: (reservationId) => `/preorder-reservations/${encodeURIComponent(reservationId)}`,
      transformResponse: (response: SuccessEnvelope<ReservationResponse>) => response.data,
      providesTags: (_result, _error, reservationId) => [
        { type: 'PreorderReservation', id: reservationId },
      ],
    }),
    listMyReservations: builder.query<readonly ReservationResponse[], void>({
      query: () => '/preorder-reservations',
      transformResponse: (response: SuccessEnvelope<readonly ReservationResponse[]>) =>
        response.data,
      providesTags: (result) =>
        result
          ? [
              ...result.map((r) => ({ type: 'PreorderReservation' as const, id: r.id })),
              { type: 'PreorderReservation' as const, id: 'LIST' },
            ]
          : [{ type: 'PreorderReservation' as const, id: 'LIST' }],
    }),
    cancelReservation: builder.mutation<ReservationResponse, ReservationActionArgs>({
      query: ({ reservationId }) => ({
        url: `/preorder-reservations/${encodeURIComponent(reservationId)}/cancel`,
        method: 'POST',
      }),
      transformResponse: (response: SuccessEnvelope<ReservationResponse>) => response.data,
      invalidatesTags: (_result, _error, { reservationId }) => [
        { type: 'PreorderReservation', id: reservationId },
        { type: 'PreorderReservation', id: 'LIST' },
      ],
    }),

    initiateAdvancePayment: builder.mutation<
      ReservationPaymentInitiationResponse,
      ReservationActionArgs
    >({
      query: ({ reservationId, idempotencyKey }) => ({
        url: `/preorder-reservations/${encodeURIComponent(reservationId)}/advance-payment/initiate`,
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      transformResponse: (response: SuccessEnvelope<ReservationPaymentInitiationResponse>) =>
        response.data,
    }),
    confirmAdvancePayment: builder.mutation<ReservationResponse, ConfirmReservationPaymentArgs>({
      query: ({ reservationId, idempotencyKey, ...body }) => ({
        url: `/preorder-reservations/${encodeURIComponent(reservationId)}/advance-payment/confirm`,
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      transformResponse: (response: SuccessEnvelope<ReservationResponse>) => response.data,
      invalidatesTags: (_result, _error, { reservationId }) => [
        { type: 'PreorderReservation', id: reservationId },
      ],
    }),
    initiateBalancePayment: builder.mutation<
      ReservationPaymentInitiationResponse,
      ReservationActionArgs
    >({
      query: ({ reservationId, idempotencyKey }) => ({
        url: `/preorder-reservations/${encodeURIComponent(reservationId)}/balance-payment/initiate`,
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      transformResponse: (response: SuccessEnvelope<ReservationPaymentInitiationResponse>) =>
        response.data,
    }),
    confirmBalancePayment: builder.mutation<ReservationResponse, ConfirmReservationPaymentArgs>({
      query: ({ reservationId, idempotencyKey, ...body }) => ({
        url: `/preorder-reservations/${encodeURIComponent(reservationId)}/balance-payment/confirm`,
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      transformResponse: (response: SuccessEnvelope<ReservationResponse>) => response.data,
      invalidatesTags: (_result, _error, { reservationId }) => [
        { type: 'PreorderReservation', id: reservationId },
      ],
    }),
  }),
});

export const {
  useListPublicCampaignsQuery,
  useGetPublicCampaignQuery,
  useCreateReservationMutation,
  useGetReservationQuery,
  useListMyReservationsQuery,
  useCancelReservationMutation,
  useInitiateAdvancePaymentMutation,
  useConfirmAdvancePaymentMutation,
  useInitiateBalancePaymentMutation,
  useConfirmBalancePaymentMutation,
} = preorderApi;
