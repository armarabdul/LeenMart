import { useRef, useState, type FormEvent, type RefObject } from 'react';
import type { SelectOption } from '@leen-mart/ui';
import type { VendorProduct } from '@leen-mart/contracts';
import { updateProductRequestSchema, type UpdateProductRequest } from '@leen-mart/contracts';
import { Alert, Button, Input, Select } from '@leen-mart/ui';
import { apiErrorMessage, apiFieldErrors } from '@/shared/api/base-api';
import { validateWithSchema } from '@/shared/lib/validate-with-schema';
import { ProductOptionalFields, type ProductOptionalFieldsValue } from './ProductOptionalFields';

type FormState = ProductOptionalFieldsValue & { categoryId: string; name: string };

const toForm = (product: VendorProduct): FormState => ({
  categoryId: product.categoryId,
  name: product.name,
  brand: product.brand ?? '',
  description: product.description ?? '',
  hsnCode: product.hsnCode ?? '',
  countryOfOrigin: product.countryOfOrigin ?? '',
  netQuantity: product.netQuantity ?? '',
});

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

type RequiredField = 'categoryId' | 'name';
const FIELD_ORDER = ['categoryId', 'name'] as const satisfies readonly RequiredField[];

const PRODUCT_REJECTION_LABEL: Record<NonNullable<VendorProduct['rejectionReason']>, string> = {
  INCOMPLETE_MANDATORY_FIELDS: 'Some required fields were missing.',
  POLICY_VIOLATION: 'This listing violates platform policy.',
  MISLEADING_LISTING: 'This listing was found to be misleading.',
  DUPLICATE_LISTING: 'This appears to duplicate an existing listing.',
  PRICING_ISSUE: 'There was an issue with the listed price.',
  OTHER: 'See the note below.',
};

interface ProductDetailsFormProps {
  readonly product: VendorProduct;
  readonly categoryOptions: readonly SelectOption[];
  readonly isCategoriesLoading: boolean;
  readonly onSave: (body: UpdateProductRequest) => Promise<void>;
  readonly isSaving: boolean;
  readonly saveError: unknown;
  readonly justSaved: boolean;
}

/**
 * The editable product fields (S2-3, Phase J) — everything
 * `updateProductRequestSchema` allows, and nothing it doesn't (status/id/
 * vendorId are not editable through a field). The category tree is fetched
 * once at the page level and passed down — `features/vendor-product` may not
 * import `features/catalogue` directly (SDD 25.3).
 */
export const ProductDetailsForm = ({
  product,
  categoryOptions,
  isCategoriesLoading,
  onSave,
  isSaving,
  saveError,
  justSaved,
}: ProductDetailsFormProps): JSX.Element => {
  const [form, setForm] = useState<FormState>(() => toForm(product));
  const [touched, setTouched] = useState<Partial<Record<RequiredField, boolean>>>({});

  const categoryRef = useRef<HTMLSelectElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const refs: Record<RequiredField, RefObject<HTMLSelectElement | HTMLInputElement>> = {
    categoryId: categoryRef,
    name: nameRef,
  };

  const localErrors = validateWithSchema(updateProductRequestSchema, {
    categoryId: form.categoryId,
    name: form.name,
  });
  const serverFieldErrors = apiFieldErrors(saveError);
  const fieldError = (field: RequiredField): string | undefined =>
    (touched[field] ? localErrors[field] : undefined) ?? serverFieldErrors[field];

  const setOptional = (field: keyof ProductOptionalFieldsValue, value: string): void =>
    setForm((current) => ({ ...current, [field]: value }));
  const markTouched = (field: RequiredField) => (): void =>
    setTouched((current) => ({ ...current, [field]: true }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSaving) return;
    setTouched({ categoryId: true, name: true });
    if (Object.keys(localErrors).length > 0) {
      const firstInvalid = FIELD_ORDER.find((field) => localErrors[field]);
      if (firstInvalid) refs[firstInvalid].current?.focus();
      return;
    }

    await onSave({
      categoryId: form.categoryId,
      name: form.name.trim(),
      brand: orNull(form.brand),
      description: orNull(form.description),
      hsnCode: orNull(form.hsnCode),
      countryOfOrigin: orNull(form.countryOfOrigin),
      netQuantity: orNull(form.netQuantity),
    });
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4" noValidate>
      {product.status === 'REJECTED' && (
        <Alert tone="danger" title="This product was rejected">
          {product.rejectionReason ? PRODUCT_REJECTION_LABEL[product.rejectionReason] : null}
          {product.rejectionNote && <p className="mt-1">{product.rejectionNote}</p>}
        </Alert>
      )}

      <Select
        ref={categoryRef}
        label="Category"
        required
        disabled={isCategoriesLoading}
        placeholder={isCategoriesLoading ? 'Loading categories…' : 'Choose a category'}
        options={categoryOptions}
        value={form.categoryId}
        onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}
        onBlur={markTouched('categoryId')}
        error={fieldError('categoryId')}
      />

      <Input
        ref={nameRef}
        label="Product name"
        required
        maxLength={200}
        value={form.name}
        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        onBlur={markTouched('name')}
        error={fieldError('name')}
      />

      <ProductOptionalFields value={form} onChange={setOptional} />

      {saveError !== undefined && Object.keys(serverFieldErrors).length === 0 && (
        <Alert tone="danger">
          {apiErrorMessage(saveError, 'Your changes could not be saved.')}
        </Alert>
      )}
      {justSaved && <Alert tone="success">Product details saved.</Alert>}

      <Button type="submit" loading={isSaving} className="self-start">
        {isSaving ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
};
