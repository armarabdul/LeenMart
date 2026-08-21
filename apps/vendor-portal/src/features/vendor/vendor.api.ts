import type { RegisterVendorResponse } from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';
import { sessionCleared } from '@/shared/api/session.slice';

/**
 * `POST /vendors` (Phase J) — turns the *currently authenticated* account
 * into a vendor. Empty body: `registerVendorRequestSchema` collects no
 * business fields (SDD 15.1), and the caller is resolved from the verified
 * access token, never supplied.
 *
 * Dispatches `sessionCleared` on success, and nothing else:
 * `RegisterVendorUseCase` revokes every session server-side as part of
 * promoting the account to `VENDOR_OWNER` (the JWT's `role` claim can only
 * change on a fresh token), so the access token this call was made with is
 * already dead the moment it returns 201. The caller must re-authenticate —
 * `RegisterPage` sends them to `/login` rather than pretending the existing
 * session still works.
 */
export const vendorApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    registerVendor: builder.mutation<RegisterVendorResponse, void>({
      query: () => ({ url: '/vendors', method: 'POST', body: {} }),
      transformResponse: (response: SuccessEnvelope<RegisterVendorResponse>) => response.data,
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        await queryFulfilled;
        // The access token this call was authenticated with is already dead
        // the instant the server accepts it (see this endpoint's own doc
        // comment) — clearing local session state here, in the one place
        // every caller of this mutation goes through, is what stops the UI
        // from acting on a session RequireAuth still believes is valid.
        dispatch(sessionCleared());
      },
    }),
  }),
});

export const { useRegisterVendorMutation } = vendorApi;
