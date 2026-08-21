import { useState } from 'react';
import type { AdminCategoryAttribute } from '@leen-mart/contracts';
import { Alert, Badge, Button, Input } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import {
  useRemoveCategoryAttributeMutation,
  useUpdateCategoryAttributeMutation,
} from '../category-attribute.api';

interface CategoryAttributeRowProps {
  readonly categoryId: string;
  readonly attribute: AdminCategoryAttribute;
}

/** `PATCH`/`DELETE .../attributes/:attributeId` (Phase L, L7). `key` and `dataType` are immutable — only `label`/`isRequired`/`position` are editable here, matching `updateCategoryAttributeRequestSchema`. */
export const CategoryAttributeRow = ({
  categoryId,
  attribute,
}: CategoryAttributeRowProps): JSX.Element => {
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(attribute.label);
  const [isRequired, setIsRequired] = useState(attribute.isRequired);
  const [position, setPosition] = useState(attribute.position);
  const [updateAttribute, { isLoading: isSaving, error: saveError }] =
    useUpdateCategoryAttributeMutation();
  const [removeAttribute, { isLoading: isRemoving, error: removeError }] =
    useRemoveCategoryAttributeMutation();

  const handleSave = async (): Promise<void> => {
    const result = await updateAttribute({
      categoryId,
      attributeId: attribute.id,
      body: { label, isRequired, position },
    });
    if (!('error' in result)) setIsEditing(false);
  };

  return (
    <li className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-text">
            {attribute.label} <span className="text-text-faint">({attribute.key})</span>
          </p>
          <p className="text-xs text-text-muted">
            {attribute.dataType}
            {attribute.unit ? ` · ${attribute.unit}` : ''}
            {attribute.options.length > 0 ? ` · ${attribute.options.join(', ')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {attribute.isRequired && <Badge tone="info">Required</Badge>}
          <Button type="button" variant="secondary" onClick={() => setIsEditing((value) => !value)}>
            {isEditing ? 'Cancel' : 'Edit'}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={isRemoving}
            onClick={() => void removeAttribute({ categoryId, attributeId: attribute.id })}
          >
            Remove
          </Button>
        </div>
      </div>

      {isEditing && (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <Input label="Label" value={label} onChange={(event) => setLabel(event.target.value)} />
          <Input
            label="Position"
            type="number"
            min={0}
            value={position}
            onChange={(event) => setPosition(Number(event.target.value))}
          />
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(event) => setIsRequired(event.target.checked)}
            />
            Required
          </label>
          {saveError !== undefined && (
            <Alert tone="danger">
              {apiErrorMessage(saveError, 'The attribute could not be saved.')}
            </Alert>
          )}
          <Button
            type="button"
            loading={isSaving}
            onClick={() => void handleSave()}
            className="self-start"
          >
            Save
          </Button>
        </div>
      )}

      {removeError !== undefined && (
        <Alert tone="danger">
          {apiErrorMessage(removeError, 'The attribute could not be removed.')}
        </Alert>
      )}
    </li>
  );
};
