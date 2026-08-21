import type {
  CreateKycUploadIntentRequest,
  CreateKycUploadIntentResponse,
  SubmitVendorKycRequest,
  SubmitVendorKycResponse,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

/**
 * The two-phase KYC submission (SDD 12.2/12.3, Phase J).
 *
 * `createKycUploadIntent` (`POST /vendors/me/kyc/documents`) mints a
 * presigned PUT and a plaintext `dataKey` per document — the caller encrypts
 * client-side (see `kyc-document-crypto.ts`) and uploads directly to
 * storage, never through this API. `submitKyc` (`POST /vendors/me/kyc`) is
 * the second phase: it sends back each `wrappedDataKey` (never the plaintext
 * one) plus PAN/GSTIN/bank details, and is what actually advances the
 * vendor's status to `KYC_SUBMITTED`.
 *
 * Neither endpoint is a query — nothing here is meant to be cached or
 * refetched, and `ShopProfile` (the tag `GET /vendors/me/shop-address`
 * carries) is invalidated by `submitKyc` since it is what changes the
 * vendor's `status`.
 */
export const kycApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    createKycUploadIntent: builder.mutation<
      CreateKycUploadIntentResponse,
      CreateKycUploadIntentRequest
    >({
      query: (body) => ({ url: '/vendors/me/kyc/documents', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<CreateKycUploadIntentResponse>) =>
        response.data,
    }),
    submitKyc: builder.mutation<SubmitVendorKycResponse, SubmitVendorKycRequest>({
      query: (body) => ({ url: '/vendors/me/kyc', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<SubmitVendorKycResponse>) => response.data,
      invalidatesTags: ['ShopProfile'],
    }),
  }),
});

export const { useCreateKycUploadIntentMutation, useSubmitKycMutation } = kycApi;
