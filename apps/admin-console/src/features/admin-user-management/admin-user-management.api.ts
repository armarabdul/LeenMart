import type { AdminUser, CreateAdminUserRequest, ListAdminUsersQuery } from '@leen-mart/contracts';
import { baseApi } from '@/shared/api/base-api';

/**
 * The SUPER_ADMIN-only subordinate admin-management surface (Phase L.2
 * backend, Phase L.5 frontend). Every route/contract here is consumed exactly
 * as `packages/contracts/src/identity/identity.contract.ts` and
 * `admin-user-management.routes.ts` already define — nothing invented.
 */
interface PaginatedResponse<TItem> {
  readonly data: readonly TItem[];
  readonly meta: {
    readonly requestId: string;
    readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
  };
}

export interface AdminUserListPage {
  readonly items: readonly AdminUser[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** Built by hand rather than via `params`, matching `auditLogUrl`'s own reasoning — every field here is a plain scalar. */
const adminUserListUrl = (query: ListAdminUsersQuery): string => {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  const search = params.toString();
  return search ? `/admin/users?${search}` : '/admin/users';
};

export const adminUserManagementApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listAdminUsers: builder.query<AdminUserListPage, ListAdminUsersQuery>({
      query: adminUserListUrl,
      transformResponse: (response: PaginatedResponse<AdminUser>) => ({
        items: response.data,
        nextCursor: response.meta.pagination.nextCursor,
        hasMore: response.meta.pagination.hasMore,
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((item) => ({ type: 'AdminUser' as const, id: item.id })),
              { type: 'AdminUser' as const, id: 'LIST' },
            ]
          : [{ type: 'AdminUser' as const, id: 'LIST' }],
    }),
    createAdminUser: builder.mutation<AdminUser, CreateAdminUserRequest>({
      query: (body) => ({ url: '/admin/users', method: 'POST', body }),
      transformResponse: (response: { data: AdminUser }) => response.data,
      invalidatesTags: [{ type: 'AdminUser', id: 'LIST' }],
    }),
  }),
});

export const { useListAdminUsersQuery, useCreateAdminUserMutation } = adminUserManagementApi;
