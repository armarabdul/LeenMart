import type {
  SetVendorBusinessHoursRequest,
  SetVendorDeliverySlotsRequest,
  SetVendorServiceablePincodesRequest,
  SetVendorShopAddressRequest,
  VendorBusinessHoursResponse,
  VendorDeliverySlotsResponse,
  VendorServiceablePincodesResponse,
  VendorShopAddressResponse,
} from '@leen-mart/contracts';
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
    getServiceablePincodes: builder.query<VendorServiceablePincodesResponse, void>({
      query: () => '/vendors/me/serviceable-pincodes',
      transformResponse: (response: SuccessEnvelope<VendorServiceablePincodesResponse>) =>
        response.data,
      providesTags: ['ServiceablePincodes'],
    }),
    setServiceablePincodes: builder.mutation<
      VendorServiceablePincodesResponse,
      SetVendorServiceablePincodesRequest
    >({
      query: (body) => ({ url: '/vendors/me/serviceable-pincodes', method: 'PUT', body }),
      transformResponse: (response: SuccessEnvelope<VendorServiceablePincodesResponse>) =>
        response.data,
      invalidatesTags: ['ServiceablePincodes'],
    }),
    getBusinessHours: builder.query<VendorBusinessHoursResponse, void>({
      query: () => '/vendors/me/business-hours',
      transformResponse: (response: SuccessEnvelope<VendorBusinessHoursResponse>) => response.data,
      providesTags: ['BusinessHours'],
    }),
    setBusinessHours: builder.mutation<VendorBusinessHoursResponse, SetVendorBusinessHoursRequest>({
      query: (body) => ({ url: '/vendors/me/business-hours', method: 'PUT', body }),
      transformResponse: (response: SuccessEnvelope<VendorBusinessHoursResponse>) => response.data,
      invalidatesTags: ['BusinessHours'],
    }),
    getDeliverySlots: builder.query<VendorDeliverySlotsResponse, void>({
      query: () => '/vendors/me/delivery-slots',
      transformResponse: (response: SuccessEnvelope<VendorDeliverySlotsResponse>) => response.data,
      providesTags: ['DeliverySlots'],
    }),
    setDeliverySlots: builder.mutation<VendorDeliverySlotsResponse, SetVendorDeliverySlotsRequest>({
      query: (body) => ({ url: '/vendors/me/delivery-slots', method: 'PUT', body }),
      transformResponse: (response: SuccessEnvelope<VendorDeliverySlotsResponse>) => response.data,
      invalidatesTags: ['DeliverySlots'],
    }),
  }),
});

export const {
  useGetShopProfileQuery,
  useSetShopAddressMutation,
  useGetServiceablePincodesQuery,
  useSetServiceablePincodesMutation,
  useGetBusinessHoursQuery,
  useSetBusinessHoursMutation,
  useGetDeliverySlotsQuery,
  useSetDeliverySlotsMutation,
} = shopProfileApi;
