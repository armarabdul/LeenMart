import type {
  VendorEarningsLineResponse,
  VendorEarningsSummaryResponse,
} from '@leen-mart/contracts';
import { baseApi } from '@/shared/api/base-api';

export interface VendorEarningsPageArg {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

/** The statement page a component actually renders — `data`+`meta.pagination` flattened into one shape (S3-8). */
export interface VendorEarningsPage {
  readonly summary: VendorEarningsSummaryResponse;
  readonly lines: readonly VendorEarningsLineResponse[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface VendorEarningsEnvelope {
  readonly data: {
    readonly summary: VendorEarningsSummaryResponse;
    readonly lines: readonly VendorEarningsLineResponse[];
  };
  readonly meta: {
    readonly requestId: string;
    readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
  };
}

/**
 * "Vendor Earnings" (S3-8, `VIEW_VENDOR_EARNINGS`) — a single read-only
 * `GET`, mirroring `vendor-order.api.ts`'s own shape. No mutation endpoint
 * exists here and none should be added: this is an accrued-earnings
 * statement, never a payout surface (locked decision #1).
 */
export const vendorEarningsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getVendorEarnings: builder.query<VendorEarningsPage, VendorEarningsPageArg | void>({
      query: (arg) => {
        const params = new URLSearchParams();
        if (arg?.limit !== undefined) params.set('limit', String(arg.limit));
        if (arg?.cursor !== undefined) params.set('cursor', arg.cursor);
        const query = params.toString();
        return `/vendor/earnings${query ? `?${query}` : ''}`;
      },
      transformResponse: (response: VendorEarningsEnvelope): VendorEarningsPage => ({
        summary: response.data.summary,
        lines: response.data.lines,
        nextCursor: response.meta.pagination.nextCursor,
        hasMore: response.meta.pagination.hasMore,
      }),
      providesTags: ['VendorEarnings'],
    }),
  }),
});

export const { useGetVendorEarningsQuery } = vendorEarningsApi;
