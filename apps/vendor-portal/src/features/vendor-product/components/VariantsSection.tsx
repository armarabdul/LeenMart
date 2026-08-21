import { useState, type FormEvent } from 'react';
import {
  createProductVariantRequestSchema,
  type CreateProductVariantRequest,
} from '@leen-mart/contracts';
import { Alert, Button } from '@leen-mart/ui';
import { apiErrorMessage, apiFieldErrors } from '@/shared/api/base-api';
import { useAddVariantMutation, useListVariantsQuery } from '../vendor-product-variant.api';
import { validateVariantFields, variantFieldError } from '../lib/validate-variant-fields';
import { VariantFields, type VariantFieldsValue } from './VariantFields';
import { VariantRow } from './VariantRow';

const EMPTY_FORM: VariantFieldsValue = {
  name: '',
  priceRupees: '',
  unitOfMeasure: '',
  quantityStep: '1',
};

/** The add-variant form — split out of `VariantsSection` purely to keep it within this repository's complexity budget. */
const AddVariantForm = ({
  productId,
  onDone,
}: {
  readonly productId: string;
  readonly onDone: () => void;
}): JSX.Element => {
  const [addVariant, { isLoading: isAdding, error: addError }] = useAddVariantMutation();
  const [sku, setSku] = useState('');
  const [form, setForm] = useState<VariantFieldsValue>(EMPTY_FORM);

  const { errors, priceInvalid, amount } = validateVariantFields(
    createProductVariantRequestSchema,
    form,
    sku,
  );
  const serverFieldErrors = apiFieldErrors(addError);

  const handleAdd = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isAdding || Object.keys(errors).length > 0 || priceInvalid || amount === null) return;
    const body: CreateProductVariantRequest = {
      sku: sku.trim(),
      name: form.name.trim(),
      price: { amount, currency: 'INR' },
      unitOfMeasure: form.unitOfMeasure.trim(),
      quantityStep: Number(form.quantityStep),
    };
    try {
      await addVariant({ productId, body }).unwrap();
      onDone();
    } catch {
      // Surfaced below via `addError`.
    }
  };

  return (
    <form
      onSubmit={(event) => void handleAdd(event)}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      noValidate
    >
      <VariantFields
        value={form}
        onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
        errorFor={(field) => variantFieldError(field, errors, priceInvalid)}
        sku={{ value: sku, onChange: setSku, error: errors.sku }}
      />
      {addError !== undefined && Object.keys(serverFieldErrors).length === 0 && (
        <Alert tone="danger">{apiErrorMessage(addError, 'This variant could not be added.')}</Alert>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={isAdding}>
          Add variant
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

/** A product's variants (S2-3a, Phase J) — list, add, and (via `VariantRow`) edit/delete each one. */
export const VariantsSection = ({ productId }: { readonly productId: string }): JSX.Element => {
  const { data: variants, isLoading, isError, error, refetch } = useListVariantsQuery(productId);
  const [isFormOpen, setIsFormOpen] = useState(false);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Variants</h2>
        {!isFormOpen && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setIsFormOpen(true)}>
            Add variant
          </Button>
        )}
      </div>

      {isLoading && <p className="text-sm text-text-muted">Loading variants…</p>}

      {!isLoading && (isError || !variants) && (
        <div className="flex flex-col gap-2">
          <Alert tone="danger">{apiErrorMessage(error, 'Variants could not be loaded.')}</Alert>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void refetch()}
            className="self-start"
          >
            Try again
          </Button>
        </div>
      )}

      {!isLoading &&
        variants?.map((variant) => (
          <VariantRow key={variant.id} productId={productId} variant={variant} />
        ))}

      {isFormOpen && <AddVariantForm productId={productId} onDone={() => setIsFormOpen(false)} />}
    </section>
  );
};
