import type { ZodTypeAny } from 'zod';
import { validateWithSchema } from '@/shared/lib/validate-with-schema';
import { rupeesToPaise } from './rupees-to-paise';
import type { VariantFieldsValue } from '../components/VariantFields';

/**
 * Validates the shared variant field set (name/price/unitOfMeasure/
 * quantityStep, plus an optional `sku`) against whichever real
 * `@leen-mart/contracts` schema the caller is submitting against — the add
 * form's `createProductVariantRequestSchema` or the edit form's
 * `updateProductVariantRequestSchema`. Shared so `VariantsSection` and
 * `VariantRow` can never validate the same fields two different ways.
 */
export const validateVariantFields = (
  schema: ZodTypeAny,
  value: VariantFieldsValue,
  sku?: string,
): {
  readonly errors: Readonly<Record<string, string>>;
  readonly priceInvalid: boolean;
  readonly amount: string | null;
} => {
  const amount = rupeesToPaise(value.priceRupees);
  const errors = validateWithSchema(schema, {
    ...(sku !== undefined ? { sku } : {}),
    name: value.name,
    unitOfMeasure: value.unitOfMeasure,
    quantityStep: Number(value.quantityStep),
    ...(amount !== null ? { price: { amount, currency: 'INR' } } : {}),
  });
  const priceInvalid = value.priceRupees.trim() !== '' && amount === null;
  return { errors, priceInvalid, amount };
};

/** The field-level message for one `VariantFields` field, folding in the price-parse failure the schema itself can't express. */
export const variantFieldError = (
  field: keyof VariantFieldsValue,
  errors: Readonly<Record<string, string>>,
  priceInvalid: boolean,
): string | undefined => {
  if (field === 'priceRupees') {
    return priceInvalid ? 'Enter a valid amount, e.g. 99.00' : errors['price.amount'];
  }
  return errors[field];
};
