import { useParams } from 'react-router-dom';
import { Alert } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useGetCategoryQuery } from '@/features/category-management/category.api';
import { CategoryEditForm } from '@/features/category-management/components/CategoryEditForm';
import { CategoryReparentControl } from '@/features/category-management/components/CategoryReparentControl';
import { CategoryDangerZone } from '@/features/category-management/components/CategoryDangerZone';
import { CategorySubcategoriesSection } from '@/features/category-management/components/CategorySubcategoriesSection';
import { CategoryAttributesSection } from '@/features/category-management/components/CategoryAttributesSection';

const DetailSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading category">
    {Array.from({ length: 4 }, (_, index) => (
      <div key={index} className="h-16 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

/** `GET /admin/categories/:categoryId` plus the attribute sub-resource (Phase L, L7). No commission-rate editing here — the backend does not implement it. */
export const CategoryDetailPage = (): JSX.Element => {
  const { categoryId } = useParams<{ categoryId: string }>();
  const { data, isLoading, isError, error } = useGetCategoryQuery(categoryId ?? '', {
    skip: !categoryId,
  });

  if (isLoading || !categoryId) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Category</h1>
        <DetailSkeleton />
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Category</h1>
        <Alert tone="danger">{apiErrorMessage(error, 'This category could not be found.')}</Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{data.name}</h1>
        <p className="text-sm text-slate-600">{data.slug}</p>
      </div>

      <CategoryEditForm category={data} />
      <CategoryReparentControl categoryId={data.id} />
      <CategoryDangerZone categoryId={data.id} />
      <CategorySubcategoriesSection parentId={data.id} />
      <CategoryAttributesSection categoryId={data.id} />
    </main>
  );
};
