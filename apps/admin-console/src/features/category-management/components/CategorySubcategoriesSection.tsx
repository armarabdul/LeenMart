import { useState } from 'react';
import { Button } from '@leen-mart/ui';
import { CategoryCreateForm } from './CategoryCreateForm';

interface CategorySubcategoriesSectionProps {
  readonly parentId: string;
}

/** Toggleable "add subcategory" form, split out of `CategoryDetailPage` to keep that component's branching within budget. */
export const CategorySubcategoriesSection = ({
  parentId,
}: CategorySubcategoriesSectionProps): JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Subcategories
        </h2>
        <Button type="button" variant="secondary" onClick={() => setIsOpen((value) => !value)}>
          {isOpen ? 'Cancel' : 'Add subcategory'}
        </Button>
      </div>
      {isOpen && <CategoryCreateForm parentId={parentId} onCreated={() => setIsOpen(false)} />}
    </div>
  );
};
