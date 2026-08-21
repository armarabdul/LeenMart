import { useState, type FormEvent } from 'react';
import type { AdminCategory, CategoryRiskLevelDto } from '@leen-mart/contracts';
import { Alert, Button, Input, Select } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useUpdateCategoryMutation } from '../category.api';

const RISK_LEVELS: readonly CategoryRiskLevelDto[] = ['LOW', 'MEDIUM', 'RESTRICTED'];

interface CategoryEditFormProps {
  readonly category: AdminCategory;
}

/** `PATCH /admin/categories/:categoryId` (Phase L, L7). `slug` and `parentId` are absent by design — `updateCategoryRequestSchema` forbids both; the slug is immutable and moving a category is the separate reparent action. */
export const CategoryEditForm = ({ category }: CategoryEditFormProps): JSX.Element => {
  const [name, setName] = useState(category.name);
  const [riskLevel, setRiskLevel] = useState<CategoryRiskLevelDto>(category.riskLevel);
  const [requiresHsn, setRequiresHsn] = useState(category.requirements.requiresHsn);
  const [requiresCountryOfOrigin, setRequiresCountryOfOrigin] = useState(
    category.requirements.requiresCountryOfOrigin,
  );
  const [requiresNetQuantity, setRequiresNetQuantity] = useState(
    category.requirements.requiresNetQuantity,
  );
  const [isActive, setIsActive] = useState(category.isActive);
  const [updateCategory, { isLoading, error }] = useUpdateCategoryMutation();

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void updateCategory({
      categoryId: category.id,
      body: {
        name,
        riskLevel,
        requirements: { requiresHsn, requiresCountryOfOrigin, requiresNetQuantity },
        isActive,
      },
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      noValidate
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
        Edit category
      </h2>
      <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} required />
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
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />
        Active
      </label>
      {error !== undefined && (
        <Alert tone="danger">{apiErrorMessage(error, 'The category could not be updated.')}</Alert>
      )}
      <Button type="submit" loading={isLoading} className="self-start">
        Save changes
      </Button>
    </form>
  );
};
