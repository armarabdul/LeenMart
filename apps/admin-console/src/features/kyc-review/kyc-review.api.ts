import type {
  ActivateVendorResponse,
  AdminKycDocumentAccessResponse,
  AdminKycQueueItem,
  AdminKycQueueQuery,
  AdminKycSubmissionDetail,
  DecideVendorKycRequest,
  DecideVendorKycResponse,
  StartKycReviewResponse,
} from '@leen-mart/contracts';
import { baseApi } from '@/shared/api/base-api';

/**
 * The admin KYC review surface (Phase L, L4). Every route/contract here is
 * consumed exactly as the backend already defines it —
 * `packages/contracts/src/vendor/kyc-review.contract.ts` and
 * `.../vendor.contract.ts` — nothing invented.
 */

/** List endpoints return `{ data, meta: { requestId, pagination } }`, not the plain `SuccessEnvelope` shape (`admin-kyc.controller.ts`'s own `listQueue` handler). */
interface PaginatedResponse<TItem> {
  readonly data: readonly TItem[];
  readonly meta: {
    readonly requestId: string;
    readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
  };
}

export interface KycQueuePage {
  readonly items: readonly AdminKycQueueItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** Builds the queue URL by hand: repeated `status=A&status=B`, matching how Express parses a repeated query key into an array — a `params` object handed to `fetchBaseQuery` would not reproduce this shape for an array value. */
const kycQueueUrl = (query: AdminKycQueueQuery): string => {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  for (const status of query.status ?? []) params.append('status', status);
  const search = params.toString();
  return search ? `/admin/kyc/submissions?${search}` : '/admin/kyc/submissions';
};

export const kycReviewApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listKycQueue: builder.query<KycQueuePage, AdminKycQueueQuery>({
      query: kycQueueUrl,
      transformResponse: (response: PaginatedResponse<AdminKycQueueItem>) => ({
        items: response.data,
        nextCursor: response.meta.pagination.nextCursor,
        hasMore: response.meta.pagination.hasMore,
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((item) => ({ type: 'KycQueue' as const, id: item.kycId })),
              { type: 'KycQueue' as const, id: 'LIST' },
            ]
          : [{ type: 'KycQueue' as const, id: 'LIST' }],
    }),
    getKycSubmission: builder.query<AdminKycSubmissionDetail, string>({
      query: (kycId) => `/admin/kyc/submissions/${encodeURIComponent(kycId)}`,
      transformResponse: (response: { data: AdminKycSubmissionDetail }) => response.data,
      // Also tagged by vendor id (Phase L.4): this is the only read the
      // vendor-management suspend/reinstate mutations can invalidate by
      // vendorId, since there is no separate vendor-read endpoint.
      providesTags: (result, _error, kycId) => [
        { type: 'KycSubmission', id: kycId },
        ...(result ? [{ type: 'Vendor' as const, id: result.vendorId }] : []),
      ],
    }),
    startKycReview: builder.mutation<StartKycReviewResponse, string>({
      query: (kycId) => ({
        url: `/admin/kyc/submissions/${encodeURIComponent(kycId)}/review`,
        method: 'POST',
        body: {},
      }),
      transformResponse: (response: { data: StartKycReviewResponse }) => response.data,
      invalidatesTags: (_result, _error, kycId) => [
        { type: 'KycSubmission', id: kycId },
        { type: 'KycQueue', id: kycId },
        { type: 'KycQueue', id: 'LIST' },
      ],
    }),
    decideKyc: builder.mutation<
      DecideVendorKycResponse,
      { kycId: string; body: DecideVendorKycRequest }
    >({
      query: ({ kycId, body }) => ({
        url: `/admin/kyc/submissions/${encodeURIComponent(kycId)}/decision`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: { data: DecideVendorKycResponse }) => response.data,
      invalidatesTags: (_result, _error, { kycId }) => [
        { type: 'KycSubmission', id: kycId },
        { type: 'KycQueue', id: kycId },
        { type: 'KycQueue', id: 'LIST' },
      ],
    }),
    accessKycDocument: builder.mutation<
      AdminKycDocumentAccessResponse,
      { kycId: string; documentId: string }
    >({
      query: ({ kycId, documentId }) => ({
        url: `/admin/kyc/submissions/${encodeURIComponent(kycId)}/documents/${encodeURIComponent(documentId)}`,
        method: 'GET',
      }),
      transformResponse: (response: { data: AdminKycDocumentAccessResponse }) => response.data,
    }),
    activateVendor: builder.mutation<ActivateVendorResponse, string>({
      query: (vendorId) => ({
        url: `/admin/kyc/vendors/${encodeURIComponent(vendorId)}/activate`,
        method: 'POST',
        body: {},
      }),
      transformResponse: (response: { data: ActivateVendorResponse }) => response.data,
      invalidatesTags: (_result, _error, _vendorId) => [{ type: 'KycQueue', id: 'LIST' }],
    }),
  }),
});

export const {
  useListKycQueueQuery,
  useGetKycSubmissionQuery,
  useStartKycReviewMutation,
  useDecideKycMutation,
  useAccessKycDocumentMutation,
  useActivateVendorMutation,
} = kycReviewApi;
