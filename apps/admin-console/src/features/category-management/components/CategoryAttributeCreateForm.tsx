import { useState, type FormEvent } from 'react';
import type {
  CategoryAttributeTypeDto,
  CreateCategoryAttributeRequest,
} from '@leen-mart/contracts';
import { Alert, Button, Input, Select } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useAddCategoryAttributeMutation } from '../category-attribute.api';

const DATA_TYPES: readonly CategoryAttributeTypeDto[] = ['STRING', 'NUMBER', 'BOOLEAN', 'ENUM'];

interface CategoryAttributeCreateFormProps {
  readonly categoryId: string;
}

/** `POST /admin/categories/:categoryId/attributes` (Phase L, L7). Mirrors `createCategoryAttributeRequestSchema`'s discriminated union by hand: `unit` only reaches the request when `dataType === 'NUMBER'`, `options` only when `dataType === 'ENUM'` — nothing invented beyond what the schema accepts. */
export const CategoryAttributeCreateForm = ({
  categoryId,
}: CategoryAttributeCreateFormProps): JSX.Element => {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [dataType, setDataType] = useState<CategoryAttributeTypeDto>('STRING');
  const [isRequired, setIsRequired] = useState(false);
  const [position, setPosition] = useState(0);
  const [unit, setUnit] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [addAttribute, { isLoading, error }] = useAddCategoryAttributeMutation();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const common = { key, label, isRequired, position };
    const body: CreateCategoryAttributeRequest =
      dataType === 'NUMBER'
        ? { ...common, dataType: 'NUMBER', ...(unit.trim() ? { unit: unit.trim() } : {}) }
        : dataType === 'ENUM'
          ? {
              ...common,
              dataType: 'ENUM',
              options: optionsText
                .split(',')
                .map((option) => option.trim())
                .filter((option) => option.length > 0) as [string, ...string[]],
            }
          : { ...common, dataType };

    const result = await addAttribute({ categoryId, body });
    if (!('error' in result)) {
      setKey('');
      setLabel('');
      setDataType('STRING');
      setIsRequired(false);
      setPosition(0);
      setUnit('');
      setOptionsText('');
    }
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      noValidate
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
        New attribute
      </h2>
      <Input
        label="Key"
        hint="Lowercase letters, digits and underscores, starting with a letter."
        value={key}
        onChange={(event) => setKey(event.target.value)}
        required
      />
      <Input
        label="Label"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        required
      />
      <Select
        label="Data type"
        value={dataType}
        onChange={(event) => setDataType(event.target.value as CategoryAttributeTypeDto)}
        options={DATA_TYPES.map((value) => ({ value, label: value }))}
      />
      {dataType === 'NUMBER' && (
        <Input
          label="Unit (optional)"
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
        />
      )}
      {dataType === 'ENUM' && (
        <Input
          label="Options"
          hint="Comma-separated, at least one."
          value={optionsText}
          onChange={(event) => setOptionsText(event.target.value)}
          required
        />
      )}
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
      {error !== undefined && (
        <Alert tone="danger">{apiErrorMessage(error, 'The attribute could not be added.')}</Alert>
      )}
      <Button type="submit" loading={isLoading} className="self-start">
        Add attribute
      </Button>
    </form>
  );
};
