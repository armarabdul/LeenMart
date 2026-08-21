import { Input, Textarea } from '@leen-mart/ui';

export interface ProductOptionalFieldsValue {
  brand: string;
  description: string;
  hsnCode: string;
  countryOfOrigin: string;
  netQuantity: string;
}

/** Every optional product field `createProductRequestSchema`/`updateProductRequestSchema` accepts — split out purely to keep the owning form within this repository's function-length budget. */
export const ProductOptionalFields = ({
  value,
  onChange,
}: {
  readonly value: ProductOptionalFieldsValue;
  readonly onChange: (field: keyof ProductOptionalFieldsValue, value: string) => void;
}): JSX.Element => (
  <>
    <Input
      label="Brand (optional)"
      maxLength={120}
      value={value.brand}
      onChange={(event) => onChange('brand', event.target.value)}
    />

    <Textarea
      label="Description (optional)"
      maxLength={5000}
      rows={4}
      value={value.description}
      onChange={(event) => onChange('description', event.target.value)}
    />

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Input
        label="HSN code (optional)"
        maxLength={8}
        value={value.hsnCode}
        onChange={(event) => onChange('hsnCode', event.target.value)}
      />
      <Input
        label="Country of origin (optional)"
        hint="ISO 2-letter code, e.g. IN"
        maxLength={2}
        value={value.countryOfOrigin}
        onChange={(event) => onChange('countryOfOrigin', event.target.value.toUpperCase())}
      />
      <Input
        label="Net quantity (optional)"
        hint="e.g. 250 g"
        maxLength={40}
        value={value.netQuantity}
        onChange={(event) => onChange('netQuantity', event.target.value)}
      />
    </div>
  </>
);
