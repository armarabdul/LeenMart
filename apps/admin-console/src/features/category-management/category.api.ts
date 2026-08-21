import type {
  AdminCategory,
  AdminCategoryListQuery,
  CreateCategoryRequest,
  ReparentCategoryRequest,
  UpdateCategoryRequest,
} from '@leen-mart/contracts';
import { baseApi } from '@/shared/api/base-api';

/**
 * The admin taxonomy surface (Phase L, L7). Every route/contract here is
 * consumed exactly as `packages/contracts/src/catalogue/category.contract.ts`
 * and `admin-category.routes.ts` already define — nothing invented. No
 * commission-rate editing: `MANAGE_CATEGORIES_OR_COMMISSION`'s commission
 * half is not implemented on the backend (the route file's own comment
 * confirms `commission_rules` belongs to a module that does not exist).
 */
interface PaginatedResponse<TItem> {
  readonly data: readonly TItem[];
  readonly meta: {
    readonly requestId: string;
    readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
  };
}

export interface CategoryListPage {
  readonly items: readonly AdminCategory[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

const categoryListUrl = (query: AdminCategoryListQuery): string => {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  const search = params.toString();
  return search ? `/admin/categories?${search}` : '/admin/categories';
};

export const categoryApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listCategories: builder.query<CategoryListPage, AdminCategoryListQuery>({
      query: categoryListUrl,
      transformResponse: (response: PaginatedResponse<AdminCategory>) => ({
        items: response.data,
        nextCursor: response.meta.pagination.nextCursor,
        hasMore: response.meta.pagination.hasMore,
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((item) => ({ type: 'Category' as const, id: item.id })),
              { type: 'Category' as const, id: 'LIST' },
            ]
          : [{ type: 'Category' as const, id: 'LIST' }],
    }),
    getCategory: builder.query<AdminCategory, string>({
      query: (categoryId) => `/admin/categories/${encodeURIComponent(categoryId)}`,
      transformResponse: (response: { data: AdminCategory }) => response.data,
      providesTags: (_result, _error, categoryId) => [{ type: 'Category', id: categoryId }],
    }),
    createCategory: builder.mutation<AdminCategory, CreateCategoryRequest>({
      query: (body) => ({ url: '/admin/categories', method: 'POST', body }),
      transformResponse: (response: { data: AdminCategory }) => response.data,
      invalidatesTags: [{ type: 'Category', id: 'LIST' }],
    }),
    updateCategory: builder.mutation<
      AdminCategory,
      { categoryId: string; body: UpdateCategoryRequest }
    >({
      query: ({ categoryId, body }) => ({
        url: `/admin/categories/${encodeURIComponent(categoryId)}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: { data: AdminCategory }) => response.data,
      invalidatesTags: (_result, _error, { categoryId }) => [
        { type: 'Category', id: categoryId },
        { type: 'Category', id: 'LIST' },
      ],
    }),
    reparentCategory: builder.mutation<
      AdminCategory,
      { categoryId: string; body: ReparentCategoryRequest }
    >({
      query: ({ categoryId, body }) => ({
        url: `/admin/categories/${encodeURIComponent(categoryId)}/parent`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: { data: AdminCategory }) => response.data,
      invalidatesTags: [{ type: 'Category', id: 'LIST' }],
    }),
    removeCategory: builder.mutation<AdminCategory, string>({
      query: (categoryId) => ({
        url: `/admin/categories/${encodeURIComponent(categoryId)}`,
        method: 'DELETE',
      }),
      transformResponse: (response: { data: AdminCategory }) => response.data,
      invalidatesTags: (_result, _error, categoryId) => [
        { type: 'Category', id: categoryId },
        { type: 'Category', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useListCategoriesQuery,
  useGetCategoryQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useReparentCategoryMutation,
  useRemoveCategoryMutation,
} = categoryApi;
