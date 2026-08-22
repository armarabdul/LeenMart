import type {
  CampaignDemandSummaryResponse,
  CancelCampaignRequest,
  CreateCampaignRequest,
  UpdateCampaignRequest,
  VendorCampaignResponse,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

interface UpdateCampaignArgs {
  readonly campaignId: string;
  readonly body: UpdateCampaignRequest;
}
interface CancelCampaignArgs {
  readonly campaignId: string;
  readonly body: CancelCampaignRequest;
}

/**
 * The vendor's own preorder campaign surface (Phase Next) —
 * `/api/v1/vendor/preorder-campaigns`. Every write here reuses
 * `CREATE_PREORDER_CAMPAIGN` server-side (no new permission), the same
 * "one permission, full CRUD" shape `vendor-product.api.ts` already
 * establishes for `CREATE_OR_EDIT_PRODUCT`.
 */
export const vendorPreorderCampaignApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listCampaigns: builder.query<readonly VendorCampaignResponse[], void>({
      query: () => '/vendor/preorder-campaigns',
      transformResponse: (response: SuccessEnvelope<readonly VendorCampaignResponse[]>) =>
        response.data,
      providesTags: (result) =>
        result
          ? [
              ...result.map((c) => ({ type: 'PreorderCampaign' as const, id: c.id })),
              { type: 'PreorderCampaign' as const, id: 'LIST' },
            ]
          : [{ type: 'PreorderCampaign' as const, id: 'LIST' }],
    }),
    getCampaign: builder.query<VendorCampaignResponse, string>({
      query: (campaignId) => `/vendor/preorder-campaigns/${encodeURIComponent(campaignId)}`,
      transformResponse: (response: SuccessEnvelope<VendorCampaignResponse>) => response.data,
      providesTags: (_result, _error, campaignId) => [{ type: 'PreorderCampaign', id: campaignId }],
    }),
    createCampaign: builder.mutation<VendorCampaignResponse, CreateCampaignRequest>({
      query: (body) => ({ url: '/vendor/preorder-campaigns', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<VendorCampaignResponse>) => response.data,
      invalidatesTags: [{ type: 'PreorderCampaign', id: 'LIST' }],
    }),
    updateCampaign: builder.mutation<VendorCampaignResponse, UpdateCampaignArgs>({
      query: ({ campaignId, body }) => ({
        url: `/vendor/preorder-campaigns/${encodeURIComponent(campaignId)}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: SuccessEnvelope<VendorCampaignResponse>) => response.data,
      invalidatesTags: (_result, _error, { campaignId }) => [
        { type: 'PreorderCampaign', id: campaignId },
        { type: 'PreorderCampaign', id: 'LIST' },
      ],
    }),
    cancelCampaign: builder.mutation<VendorCampaignResponse, CancelCampaignArgs>({
      query: ({ campaignId, body }) => ({
        url: `/vendor/preorder-campaigns/${encodeURIComponent(campaignId)}/cancel`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: SuccessEnvelope<VendorCampaignResponse>) => response.data,
      invalidatesTags: (_result, _error, { campaignId }) => [
        { type: 'PreorderCampaign', id: campaignId },
        { type: 'PreorderCampaign', id: 'LIST' },
      ],
    }),
    getDemandSummary: builder.query<CampaignDemandSummaryResponse, string>({
      query: (campaignId) =>
        `/vendor/preorder-campaigns/${encodeURIComponent(campaignId)}/demand-summary`,
      transformResponse: (response: SuccessEnvelope<CampaignDemandSummaryResponse>) =>
        response.data,
      providesTags: (_result, _error, campaignId) => [
        { type: 'PreorderCampaign', id: `${campaignId}-demand` },
      ],
    }),
  }),
});

export const {
  useListCampaignsQuery,
  useGetCampaignQuery,
  useCreateCampaignMutation,
  useUpdateCampaignMutation,
  useCancelCampaignMutation,
  useGetDemandSummaryQuery,
} = vendorPreorderCampaignApi;
