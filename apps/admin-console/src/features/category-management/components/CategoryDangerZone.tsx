import { useNavigate } from 'react-router-dom';
import { Alert, Button } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useRemoveCategoryMutation } from '../category.api';

interface CategoryDangerZoneProps {
  readonly categoryId: string;
}

/** `DELETE /admin/categories/:categoryId` (Phase L, L7), split out of `CategoryDetailPage` to keep that component's branching within this repository's complexity budget. */
export const CategoryDangerZone = ({ categoryId }: CategoryDangerZoneProps): JSX.Element => {
  const navigate = useNavigate();
  const [removeCategory, { isLoading, error }] = useRemoveCategoryMutation();

  const handleDelete = async (): Promise<void> => {
    const result = await removeCategory(categoryId);
    if (!('error' in result)) void navigate('/categories');
  };

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Danger zone</h2>
      {error !== undefined && (
        <Alert tone="danger">{apiErrorMessage(error, 'The category could not be deleted.')}</Alert>
      )}
      <Button
        type="button"
        variant="danger"
        loading={isLoading}
        onClick={() => void handleDelete()}
        className="self-start"
      >
        Delete category
      </Button>
    </div>
  );
};
