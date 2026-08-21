import type {
  AdminCategoryAttribute,
  CreateCategoryAttributeRequest,
  UpdateCategoryAttributeRequest,
} from '@leen-mart/contracts';
import { baseApi } from '@/shared/api/base-api';

/**
 * Per-category attribute definitions (Phase L, L7) —
 * `packages/contracts/src/catalogue/category-attribute.contract.ts` and
 * `admin-category.routes.ts`'s attribute sub-router, nothing invented. Split
 * into its own api file the same way the backend splits it into its own
 * controller: a different resource under the same router.
 */
export const categoryAttributeApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listCategoryAttributes: builder.query<readonly AdminCategoryAttribute[], string>({
      query: (categoryId) => `/admin/categories/${encodeURIComponent(categoryId)}/attributes`,
      transformResponse: (response: { data: readonly AdminCategoryAttribute[] }) => response.data,
      providesTags: (result, _error, categoryId) =>
        result
          ? [
              ...result.map((attribute) => ({
                type: 'CategoryAttribute' as const,
                id: attribute.id,
              })),
              { type: 'CategoryAttribute' as const, id: `LIST-${categoryId}` },
            ]
          : [{ type: 'CategoryAttribute' as const, id: `LIST-${categoryId}` }],
    }),
    addCategoryAttribute: builder.mutation<
      AdminCategoryAttribute,
      { categoryId: string; body: CreateCategoryAttributeRequest }
    >({
      query: ({ categoryId, body }) => ({
        url: `/admin/categories/${encodeURIComponent(categoryId)}/attributes`,
        method: 'POST',
        body,
      }),
      transformResponse: (response: { data: AdminCategoryAttribute }) => response.data,
      invalidatesTags: (_result, _error, { categoryId }) => [
        { type: 'CategoryAttribute', id: `LIST-${categoryId}` },
      ],
    }),
    updateCategoryAttribute: builder.mutation<
      AdminCategoryAttribute,
      { categoryId: string; attributeId: string; body: UpdateCategoryAttributeRequest }
    >({
      query: ({ categoryId, attributeId, body }) => ({
        url: `/admin/categories/${encodeURIComponent(categoryId)}/attributes/${encodeURIComponent(attributeId)}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: { data: AdminCategoryAttribute }) => response.data,
      invalidatesTags: (_result, _error, { categoryId, attributeId }) => [
        { type: 'CategoryAttribute', id: attributeId },
        { type: 'CategoryAttribute', id: `LIST-${categoryId}` },
      ],
    }),
    removeCategoryAttribute: builder.mutation<
      AdminCategoryAttribute,
      { categoryId: string; attributeId: string }
    >({
      query: ({ categoryId, attributeId }) => ({
        url: `/admin/categories/${encodeURIComponent(categoryId)}/attributes/${encodeURIComponent(attributeId)}`,
        method: 'DELETE',
      }),
      transformResponse: (response: { data: AdminCategoryAttribute }) => response.data,
      invalidatesTags: (_result, _error, { categoryId, attributeId }) => [
        { type: 'CategoryAttribute', id: attributeId },
        { type: 'CategoryAttribute', id: `LIST-${categoryId}` },
      ],
    }),
  }),
});

export const {
  useListCategoryAttributesQuery,
  useAddCategoryAttributeMutation,
  useUpdateCategoryAttributeMutation,
  useRemoveCategoryAttributeMutation,
} = categoryAttributeApi;
