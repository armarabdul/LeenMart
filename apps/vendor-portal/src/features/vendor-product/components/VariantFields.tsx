import { Input } from '@leen-mart/ui';

export interface VariantFieldsValue {
  name: string;
  priceRupees: string;
  unitOfMeasure: string;
  quantityStep: string;
}

interface VariantFieldsProps {
  readonly value: VariantFieldsValue;
  readonly onChange: (field: keyof VariantFieldsValue, value: string) => void;
  readonly errorFor: (field: keyof VariantFieldsValue) => string | undefined;
  /** SKU is immutable once a variant exists (`updateProductVariantRequestSchema` has no `sku` field) — shown only when adding a new one. */
  readonly sku?: {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly error: string | undefined;
  };
}

/** The four (or five, with SKU) variant fields — shared by `VariantsSection`'s add form and `VariantRow`'s edit form so the two can never drift apart. */
export const VariantFields = ({
  value,
  onChange,
  errorFor,
  sku,
}: VariantFieldsProps): JSX.Element => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    {sku && (
      <Input
        label="SKU"
        required
        maxLength={64}
        value={sku.value}
        onChange={(event) => sku.onChange(event.target.value)}
        error={sku.error}
      />
    )}
    <Input
      label="Variant name"
      required
      maxLength={120}
      value={value.name}
      onChange={(event) => onChange('name', event.target.value)}
      error={errorFor('name')}
    />
    <Input
      label="Price (₹)"
      required
      inputMode="decimal"
      value={value.priceRupees}
      onChange={(event) => onChange('priceRupees', event.target.value)}
      error={errorFor('priceRupees')}
    />
    <Input
      label="Unit of measure"
      required
      maxLength={40}
      value={value.unitOfMeasure}
      onChange={(event) => onChange('unitOfMeasure', event.target.value)}
      error={errorFor('unitOfMeasure')}
    />
    <Input
      label="Quantity step"
      required
      type="number"
      min={1}
      step={1}
      value={value.quantityStep}
      onChange={(event) => onChange('quantityStep', event.target.value)}
      error={errorFor('quantityStep')}
    />
  </div>
);
