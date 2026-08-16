import type { VendorSubOrderResponse, VendorSubOrderSummaryResponse } from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

/**
 * "Vendor Orders" (S3-5). Addressed by `SubOrderId` throughout, matching the
 * backend's own locked decision — `getVendorOrder`/`startProcessing` both
 * take the sub-order's own id, never a parent order id.
 */
export const vendorOrderApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listVendorOrders: builder.query<readonly VendorSubOrderSummaryResponse[], void>({
      query: () => '/vendor/orders',
      transformResponse: (response: SuccessEnvelope<readonly VendorSubOrderSummaryResponse[]>) =>
        response.data,
      providesTags: ['VendorOrder'],
    }),
    getVendorOrder: builder.query<VendorSubOrderResponse, string>({
      query: (subOrderId) => `/vendor/orders/${encodeURIComponent(subOrderId)}`,
      transformResponse: (response: SuccessEnvelope<VendorSubOrderResponse>) => response.data,
      providesTags: (_result, _error, subOrderId) => [{ type: 'VendorOrder', id: subOrderId }],
    }),
    startProcessing: builder.mutation<VendorSubOrderResponse, string>({
      query: (subOrderId) => ({
        url: `/vendor/orders/${encodeURIComponent(subOrderId)}/process`,
        method: 'POST',
      }),
      transformResponse: (response: SuccessEnvelope<VendorSubOrderResponse>) => response.data,
      // A bare 'VendorOrder' tag invalidates both the list and every
      // id-scoped detail query — the same RTK Query semantics `checkout.api.ts`
      // already relies on for `placeOrder`/`cancelOrder` (S3-3A/S3-4).
      invalidatesTags: ['VendorOrder'],
    }),
  }),
});

export const { useListVendorOrdersQuery, useGetVendorOrderQuery, useStartProcessingMutation } =
  vendorOrderApi;
