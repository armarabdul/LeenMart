import { useState, type FormEvent } from 'react';
import {
  updateProductVariantRequestSchema,
  type UpdateProductVariantRequest,
  type VendorProductVariant,
} from '@leen-mart/contracts';
import { Alert, Button, Card } from '@leen-mart/ui';
import { apiErrorMessage, apiFieldErrors } from '@/shared/api/base-api';
import { formatMoney } from '@/shared/lib/format-money';
import { useDeleteVariantMutation, useUpdateVariantMutation } from '../vendor-product-variant.api';
import { paiseToRupees } from '../lib/rupees-to-paise';
import { validateVariantFields, variantFieldError } from '../lib/validate-variant-fields';
import { VariantFields, type VariantFieldsValue } from './VariantFields';
import { VariantInventoryEditor } from './VariantInventoryEditor';

const toEditForm = (variant: VendorProductVariant): VariantFieldsValue => ({
  name: variant.name,
  priceRupees: paiseToRupees(variant.price.amount),
  unitOfMeasure: variant.unitOfMeasure,
  quantityStep: String(variant.quantityStep),
});

/** One variant of a product (S2-3a, Phase J) — view, edit in place, or delete. */
export const VariantRow = ({
  productId,
  variant,
}: {
  readonly productId: string;
  readonly variant: VendorProductVariant;
}): JSX.Element => {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<VariantFieldsValue>(() => toEditForm(variant));
  const [updateVariant, { isLoading: isSaving, error: saveError }] = useUpdateVariantMutation();
  const [deleteVariant, { isLoading: isDeleting, error: deleteError }] = useDeleteVariantMutation();

  const { errors, priceInvalid, amount } = validateVariantFields(
    updateProductVariantRequestSchema,
    form,
  );
  const serverFieldErrors = apiFieldErrors(saveError);

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSaving || Object.keys(errors).length > 0 || priceInvalid || amount === null) return;
    const body: UpdateProductVariantRequest = {
      name: form.name.trim(),
      price: { amount, currency: 'INR' },
      unitOfMeasure: form.unitOfMeasure.trim(),
      quantityStep: Number(form.quantityStep),
    };
    try {
      await updateVariant({ productId, variantId: variant.id, body }).unwrap();
      setIsEditing(false);
    } catch {
      // Surfaced below via `saveError`.
    }
  };

  const handleDelete = async (): Promise<void> => {
    try {
      await deleteVariant({ productId, variantId: variant.id }).unwrap();
    } catch {
      // Surfaced below via `deleteError`.
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      {!isEditing ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text">{variant.name}</p>
            <p className="text-xs text-text-muted">
              SKU {variant.sku} · {formatMoney(variant.price)} / {variant.unitOfMeasure} · step{' '}
              {variant.quantityStep}
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={isDeleting}
              className="text-danger hover:bg-danger/10"
              onClick={() => void handleDelete()}
            >
              Delete
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(event) => void handleSave(event)}
          className="flex flex-col gap-3"
          noValidate
        >
          <VariantFields
            value={form}
            onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
            errorFor={(field) => variantFieldError(field, errors, priceInvalid)}
          />
          {saveError !== undefined && Object.keys(serverFieldErrors).length === 0 && (
            <Alert tone="danger">
              {apiErrorMessage(saveError, 'This variant could not be saved.')}
            </Alert>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={isSaving}>
              Save variant
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {deleteError !== undefined && (
        <Alert tone="danger">
          {apiErrorMessage(deleteError, 'This variant could not be removed.')}
        </Alert>
      )}

      <div className="border-t border-border pt-3">
        <VariantInventoryEditor productId={productId} variantId={variant.id} />
      </div>
    </Card>
  );
};
