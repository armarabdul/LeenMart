import type {
  ReinstateVendorRequest,
  SuspendVendorRequest,
  VendorStatusChangeResponse,
} from '@leen-mart/contracts';
import { baseApi } from '@/shared/api/base-api';

/**
 * The admin vendor suspend/reinstate surface (Phase L.4). Every route/
 * contract here is consumed exactly as the backend already defines it —
 * `packages/contracts/src/vendor/vendor.contract.ts` — nothing invented.
 *
 * Deliberately just these two mutations: this is vendor-management, not a
 * generic user-management surface (Phase L.4's own scope), and there is no
 * vendor list/read endpoint to inject here either — the vendor's current
 * status is already in hand wherever these mutations are called from (the
 * KYC submission detail view), and each mutation's own response carries the
 * resulting status back.
 */
export const vendorManagementApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    suspendVendor: builder.mutation<
      VendorStatusChangeResponse,
      { vendorId: string; body: SuspendVendorRequest }
    >({
      query: ({ vendorId, body }) => ({
        url: `/admin/vendors/${encodeURIComponent(vendorId)}/suspend`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: { data: VendorStatusChangeResponse }) => response.data,
      invalidatesTags: (_result, _error, { vendorId }) => [{ type: 'Vendor', id: vendorId }],
    }),
    reinstateVendor: builder.mutation<
      VendorStatusChangeResponse,
      { vendorId: string; body: ReinstateVendorRequest }
    >({
      query: ({ vendorId, body }) => ({
        url: `/admin/vendors/${encodeURIComponent(vendorId)}/reinstate`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: { data: VendorStatusChangeResponse }) => response.data,
      invalidatesTags: (_result, _error, { vendorId }) => [{ type: 'Vendor', id: vendorId }],
    }),
  }),
});

export const { useSuspendVendorMutation, useReinstateVendorMutation } = vendorManagementApi;
