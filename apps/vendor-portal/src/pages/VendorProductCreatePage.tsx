import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createProductRequestSchema,
  createProductVariantRequestSchema,
  type CreateProductRequest,
} from '@leen-mart/contracts';
import { Alert, Button, Input, Select } from '@leen-mart/ui';
import { apiErrorMessage, apiFieldErrors } from '@/shared/api/base-api';
import { validateWithSchema } from '@/shared/lib/validate-with-schema';
import { useGetCategoryTreeQuery } from '@/features/catalogue/catalogue.api';
import { useCreateProductMutation } from '@/features/vendor-product/vendor-product.api';
import { flattenCategoryTree } from '@/features/vendor-product/lib/flatten-category-tree';
import {
  validateVariantFields,
  variantFieldError,
} from '@/features/vendor-product/lib/validate-variant-fields';
import {
  ProductOptionalFields,
  type ProductOptionalFieldsValue,
} from '@/features/vendor-product/components/ProductOptionalFields';
import {
  VariantFields,
  type VariantFieldsValue,
} from '@/features/vendor-product/components/VariantFields';

/** The top-level product schema, minus `variant` — validated separately by `validateVariantFields`, the same helper `VariantsSection`'s own add form uses. */
const topLevelSchema = createProductRequestSchema.omit({ variant: true });

type TopLevelState = ProductOptionalFieldsValue & { categoryId: string; name: string };
const EMPTY_TOP_LEVEL: TopLevelState = {
  categoryId: '',
  name: '',
  brand: '',
  description: '',
  hsnCode: '',
  countryOfOrigin: '',
  netQuantity: '',
};
const EMPTY_VARIANT: VariantFieldsValue = {
  name: '',
  priceRupees: '',
  unitOfMeasure: '',
  quantityStep: '1',
};

type TopLevelField = 'categoryId' | 'name';
const TOP_LEVEL_FIELD_ORDER = ['categoryId', 'name'] as const satisfies readonly TopLevelField[];
type VariantField = keyof VariantFieldsValue | 'sku';

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/**
 * The shape actually handed to `topLevelSchema` for live validation. Blank
 * optional fields become `null`, matching what `toRequestBody` sends — the
 * schema accepts `null` for these but not an empty string, so validating the
 * raw form state directly would reject an untouched, correctly-blank field.
 */
const toValidationInput = (top: TopLevelState): Record<string, string | null> => ({
  categoryId: top.categoryId,
  name: top.name,
  brand: orNull(top.brand),
  description: orNull(top.description),
  hsnCode: orNull(top.hsnCode),
  countryOfOrigin: orNull(top.countryOfOrigin),
  netQuantity: orNull(top.netQuantity),
});

/** Assembles the request body — split out purely to keep the owning handler within this repository's function-length budget. */
const toRequestBody = (
  top: TopLevelState,
  sku: string,
  variant: VariantFieldsValue,
  amount: string,
): CreateProductRequest => ({
  categoryId: top.categoryId,
  name: top.name.trim(),
  brand: orNull(top.brand),
  description: orNull(top.description),
  hsnCode: orNull(top.hsnCode),
  countryOfOrigin: orNull(top.countryOfOrigin),
  netQuantity: orNull(top.netQuantity),
  variant: {
    sku: sku.trim(),
    name: variant.name.trim(),
    price: { amount, currency: 'INR' },
    unitOfMeasure: variant.unitOfMeasure.trim(),
    quantityStep: Number(variant.quantityStep),
  },
});

/** `POST /vendor/products` (S2-3, Phase J) — creates the product and its required first variant in one request. */
export const VendorProductCreatePage = (): JSX.Element => {
  const navigate = useNavigate();
  const { data: categories, isLoading: isCategoriesLoading } = useGetCategoryTreeQuery();
  const [createProduct, { isLoading: isSaving, error: saveError }] = useCreateProductMutation();

  const [top, setTop] = useState<TopLevelState>(EMPTY_TOP_LEVEL);
  const [sku, setSku] = useState('');
  const [variant, setVariant] = useState<VariantFieldsValue>(EMPTY_VARIANT);
  const [topTouched, setTopTouched] = useState<Partial<Record<TopLevelField, boolean>>>({});
  const [variantTouched, setVariantTouched] = useState<Partial<Record<VariantField, boolean>>>({});

  const categoryRef = useRef<HTMLSelectElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const topRefs: Record<TopLevelField, RefObject<HTMLSelectElement | HTMLInputElement>> = {
    categoryId: categoryRef,
    name: nameRef,
  };

  const topErrors = validateWithSchema(topLevelSchema, toValidationInput(top));
  const {
    errors: variantErrors,
    priceInvalid,
    amount,
  } = validateVariantFields(createProductVariantRequestSchema, variant, sku);
  const serverFieldErrors = apiFieldErrors(saveError);

  const topFieldError = (field: TopLevelField): string | undefined =>
    (topTouched[field] ? topErrors[field] : undefined) ?? serverFieldErrors[field];
  const variantFieldErrorFor = (field: keyof VariantFieldsValue): string | undefined =>
    variantTouched[field] ? variantFieldError(field, variantErrors, priceInvalid) : undefined;
  const skuError = variantTouched.sku ? variantErrors.sku : undefined;

  const setOptional = (field: keyof ProductOptionalFieldsValue, value: string): void =>
    setTop((current) => ({ ...current, [field]: value }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSaving) return;

    setTopTouched({ categoryId: true, name: true });
    setVariantTouched({
      sku: true,
      name: true,
      priceRupees: true,
      unitOfMeasure: true,
      quantityStep: true,
    });

    const hasError =
      Object.keys(topErrors).length > 0 || Object.keys(variantErrors).length > 0 || priceInvalid;
    if (hasError || amount === null) {
      const firstInvalidTop = TOP_LEVEL_FIELD_ORDER.find((field) => topErrors[field]);
      if (firstInvalidTop) {
        topRefs[firstInvalidTop].current?.focus();
        return;
      }
      return;
    }

    try {
      const created = await createProduct(toRequestBody(top, sku, variant, amount)).unwrap();
      void navigate(`/products/${created.product.id}`, { replace: true });
    } catch {
      // Surfaced below via `saveError`.
    }
  };

  const markVariantTouched = (field: VariantField): void =>
    setVariantTouched((current) => ({ ...current, [field]: true }));
  const handleVariantChange = (field: keyof VariantFieldsValue, value: string): void => {
    setVariant((current) => ({ ...current, [field]: value }));
    markVariantTouched(field);
  };
  const handleSkuChange = (value: string): void => {
    setSku(value);
    markVariantTouched('sku');
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">Add product</h1>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-4"
        noValidate
      >
        <Select
          ref={categoryRef}
          label="Category"
          required
          disabled={isCategoriesLoading}
          placeholder={isCategoriesLoading ? 'Loading categories…' : 'Choose a category'}
          options={flattenCategoryTree(categories ?? [])}
          value={top.categoryId}
          onChange={(event) =>
            setTop((current) => ({ ...current, categoryId: event.target.value }))
          }
          onBlur={() => setTopTouched((current) => ({ ...current, categoryId: true }))}
          error={topFieldError('categoryId')}
        />

        <Input
          ref={nameRef}
          label="Product name"
          required
          maxLength={200}
          value={top.name}
          onChange={(event) => setTop((current) => ({ ...current, name: event.target.value }))}
          onBlur={() => setTopTouched((current) => ({ ...current, name: true }))}
          error={topFieldError('name')}
        />

        <ProductOptionalFields value={top} onChange={setOptional} />

        <h2 className="mt-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
          First variant
        </h2>
        <VariantFields
          value={variant}
          onChange={handleVariantChange}
          errorFor={variantFieldErrorFor}
          sku={{ value: sku, onChange: handleSkuChange, error: skuError }}
        />

        {saveError !== undefined && Object.keys(serverFieldErrors).length === 0 && (
          <Alert tone="danger">
            {apiErrorMessage(saveError, 'Your product could not be created.')}
          </Alert>
        )}

        <Button type="submit" size="lg" loading={isSaving} className="w-full sm:w-auto">
          {isSaving ? 'Creating…' : 'Create product'}
        </Button>
      </form>
    </main>
  );
};
