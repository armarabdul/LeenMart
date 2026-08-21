import { useState, type FormEvent } from 'react';
import type { CategoryRiskLevelDto } from '@leen-mart/contracts';
import { Alert, Button, Input, Select } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useCreateCategoryMutation } from '../category.api';

const RISK_LEVELS: readonly CategoryRiskLevelDto[] = ['LOW', 'MEDIUM', 'RESTRICTED'];

interface CategoryCreateFormProps {
  readonly parentId: string | null;
  readonly onCreated?: () => void;
}

/** `POST /admin/categories` (Phase L, L7). `parentId` is fixed by the caller — a root-level form on `CategoriesPage`, or pre-filled from a parent's detail page — never a field the user edits here. */
export const CategoryCreateForm = ({
  parentId,
  onCreated,
}: CategoryCreateFormProps): JSX.Element => {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [riskLevel, setRiskLevel] = useState<CategoryRiskLevelDto>('LOW');
  const [requiresHsn, setRequiresHsn] = useState(false);
  const [requiresCountryOfOrigin, setRequiresCountryOfOrigin] = useState(false);
  const [requiresNetQuantity, setRequiresNetQuantity] = useState(false);
  const [createCategory, { isLoading, error }] = useCreateCategoryMutation();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const result = await createCategory({
      parentId,
      name,
      slug,
      riskLevel,
      requirements: { requiresHsn, requiresCountryOfOrigin, requiresNetQuantity },
    });
    if (!('error' in result)) {
      setName('');
      setSlug('');
      setRiskLevel('LOW');
      setRequiresHsn(false);
      setRequiresCountryOfOrigin(false);
      setRequiresNetQuantity(false);
      onCreated?.();
    }
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      noValidate
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
        {parentId ? 'New subcategory' : 'New root category'}
      </h2>
      <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} required />
      <Input
        label="Slug"
        hint="Lowercase letters, digits and single hyphens."
        value={slug}
        onChange={(event) => setSlug(event.target.value)}
        required
      />
      <Select
        label="Risk level"
        value={riskLevel}
        onChange={(event) => setRiskLevel(event.target.value as CategoryRiskLevelDto)}
        options={RISK_LEVELS.map((value) => ({ value, label: value }))}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-text">Mandatory field requirements</legend>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={requiresHsn}
            onChange={(event) => setRequiresHsn(event.target.checked)}
          />
          Requires HSN code
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={requiresCountryOfOrigin}
            onChange={(event) => setRequiresCountryOfOrigin(event.target.checked)}
          />
          Requires country of origin
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={requiresNetQuantity}
            onChange={(event) => setRequiresNetQuantity(event.target.checked)}
          />
          Requires net quantity
        </label>
      </fieldset>
      {error !== undefined && (
        <Alert tone="danger">{apiErrorMessage(error, 'The category could not be created.')}</Alert>
      )}
      <Button type="submit" loading={isLoading} className="self-start">
        Create
      </Button>
    </form>
  );
};
