import { Alert } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useListCategoryAttributesQuery } from '../category-attribute.api';
import { CategoryAttributeCreateForm } from './CategoryAttributeCreateForm';
import { CategoryAttributeRow } from './CategoryAttributeRow';

interface CategoryAttributesSectionProps {
  readonly categoryId: string;
}

const AttributeSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading attributes">
    {Array.from({ length: 3 }, (_, index) => (
      <div key={index} className="h-14 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

/** Per-category attribute list + create form, split out of `CategoryDetailPage` to keep that component's branching within budget. */
export const CategoryAttributesSection = ({
  categoryId,
}: CategoryAttributesSectionProps): JSX.Element => {
  const { data, isLoading, isError, error } = useListCategoryAttributesQuery(categoryId);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Attributes</h2>
      {isLoading && <AttributeSkeleton />}
      {isError && (
        <Alert tone="danger">{apiErrorMessage(error, 'Attributes could not be loaded.')}</Alert>
      )}
      {!isLoading && !isError && (
        <ul className="flex flex-col gap-2">
          {(data ?? []).map((attribute) => (
            <CategoryAttributeRow
              key={attribute.id}
              categoryId={categoryId}
              attribute={attribute}
            />
          ))}
        </ul>
      )}
      <CategoryAttributeCreateForm categoryId={categoryId} />
    </div>
  );
};
