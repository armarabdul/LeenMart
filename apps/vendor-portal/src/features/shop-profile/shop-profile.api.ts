import type { SetVendorShopAddressRequest, VendorShopAddressResponse } from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

/**
 * The vendor's own shop profile (S4-ADDR). Both endpoints are gated by
 * `MANAGE_SHOP_PROFILE` server-side and neither accepts a vendor id — the
 * caller's own vendor is resolved from the authenticated principal, so there
 * is no id here to tamper with.
 *
 * `PUT` rather than `PATCH`: the address parts are only meaningful as a set,
 * so the whole address is replaced rather than merged.
 */
export const shopProfileApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getShopProfile: builder.query<VendorShopAddressResponse, void>({
      query: () => '/vendors/me/shop-address',
      transformResponse: (response: SuccessEnvelope<VendorShopAddressResponse>) => response.data,
      providesTags: ['ShopProfile'],
    }),
    setShopAddress: builder.mutation<VendorShopAddressResponse, SetVendorShopAddressRequest>({
      query: (body) => ({ url: '/vendors/me/shop-address', method: 'PUT', body }),
      transformResponse: (response: SuccessEnvelope<VendorShopAddressResponse>) => response.data,
      invalidatesTags: ['ShopProfile'],
    }),
  }),
});

export const { useGetShopProfileQuery, useSetShopAddressMutation } = shopProfileApi;
