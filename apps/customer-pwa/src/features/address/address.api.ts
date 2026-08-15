import type {
  AddAddressRequest,
  AddressResponse,
  ListAddressesResponse,
  RemoveAddressResponse,
  UpdateAddressRequest,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

interface UpdateAddressArgs {
  readonly id: string;
  readonly body: UpdateAddressRequest;
}

export const addressApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAddresses: builder.query<ListAddressesResponse, void>({
      query: () => '/me/addresses',
      transformResponse: (response: SuccessEnvelope<ListAddressesResponse>) => response.data,
      providesTags: ['Address'],
    }),
    addAddress: builder.mutation<AddressResponse, AddAddressRequest>({
      query: (body) => ({ url: '/me/addresses', method: 'POST', body }),
      transformResponse: (response: SuccessEnvelope<AddressResponse>) => response.data,
      invalidatesTags: ['Address'],
    }),
    updateAddress: builder.mutation<AddressResponse, UpdateAddressArgs>({
      query: ({ id, body }) => ({
        url: `/me/addresses/${encodeURIComponent(id)}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: SuccessEnvelope<AddressResponse>) => response.data,
      invalidatesTags: ['Address'],
    }),
    removeAddress: builder.mutation<RemoveAddressResponse, string>({
      query: (id) => ({ url: `/me/addresses/${encodeURIComponent(id)}`, method: 'DELETE' }),
      transformResponse: (response: SuccessEnvelope<RemoveAddressResponse>) => response.data,
      invalidatesTags: ['Address'],
    }),
    setDefaultAddress: builder.mutation<AddressResponse, string>({
      query: (id) => ({ url: `/me/addresses/${encodeURIComponent(id)}/default`, method: 'POST' }),
      transformResponse: (response: SuccessEnvelope<AddressResponse>) => response.data,
      invalidatesTags: ['Address'],
    }),
  }),
});

export const {
  useGetAddressesQuery,
  useAddAddressMutation,
  useUpdateAddressMutation,
  useRemoveAddressMutation,
  useSetDefaultAddressMutation,
} = addressApi;
