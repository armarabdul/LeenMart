import { useState, type FormEvent } from 'react';
import { Alert, Button, Input } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useReparentCategoryMutation } from '../category.api';

interface CategoryReparentControlProps {
  readonly categoryId: string;
}

/** `POST /admin/categories/:categoryId/parent` (Phase L, L7) — a sub-resource action, not a field on the edit form, matching how the backend itself separates it. No category picker exists (the list endpoint has no name search), so the target is entered by id directly. */
export const CategoryReparentControl = ({
  categoryId,
}: CategoryReparentControlProps): JSX.Element => {
  const [targetParentId, setTargetParentId] = useState('');
  const [reparentCategory, { isLoading, error }] = useReparentCategoryMutation();

  const handleMove = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void reparentCategory({ categoryId, body: { parentId: targetParentId.trim() } });
  };

  const handleMakeRoot = (): void => {
    void reparentCategory({ categoryId, body: { parentId: null } });
  };

  return (
    <form
      onSubmit={handleMove}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      noValidate
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
        Move category
      </h2>
      <Input
        label="New parent category id"
        value={targetParentId}
        onChange={(event) => setTargetParentId(event.target.value)}
      />
      {error !== undefined && (
        <Alert tone="danger">{apiErrorMessage(error, 'The category could not be moved.')}</Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={isLoading} disabled={!targetParentId.trim()}>
          Move under parent
        </Button>
        <Button type="button" variant="secondary" loading={isLoading} onClick={handleMakeRoot}>
          Make root category
        </Button>
      </div>
    </form>
  );
};
