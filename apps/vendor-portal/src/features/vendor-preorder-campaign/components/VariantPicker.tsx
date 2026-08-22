import { Select, type SelectOption } from '@leen-mart/ui';

interface VariantPickerProps {
  readonly productOptions: readonly SelectOption[];
  readonly isProductsLoading: boolean;
  readonly variantOptions: readonly SelectOption[];
  readonly isVariantsLoading: boolean;
  readonly productId: string;
  readonly variantId: string;
  readonly onProductChange: (productId: string) => void;
  readonly onVariantChange: (variantId: string) => void;
  readonly variantError?: string | undefined;
}

/**
 * A campaign is created against one existing variant
 * (`createCampaignRequestSchema.variantId`) — this two-step picker (product,
 * then that product's own variants) is how a vendor names one, mirroring
 * the category-tree select pattern `VendorProductCreatePage` already uses
 * for a similar "pick from my own data" field.
 *
 * Purely presentational — a feature may not import another feature's own
 * API slice (SDD 25.3), so `VendorPreorderCampaignCreatePage` fetches
 * products/variants itself (via `features/vendor-product`'s API, a page-level
 * import, not a feature-to-feature one) and hands the resolved options down.
 */
export const VariantPicker = ({
  productOptions,
  isProductsLoading,
  variantOptions,
  isVariantsLoading,
  productId,
  variantId,
  onProductChange,
  onVariantChange,
  variantError,
}: VariantPickerProps): JSX.Element => (
  <div className="flex flex-col gap-4">
    <Select
      label="Product"
      required
      disabled={isProductsLoading}
      placeholder={isProductsLoading ? 'Loading products…' : 'Choose a product'}
      options={productOptions}
      value={productId}
      onChange={(event) => onProductChange(event.target.value)}
    />
    <Select
      label="Variant"
      required
      disabled={!productId || isVariantsLoading}
      placeholder={
        !productId
          ? 'Choose a product first'
          : isVariantsLoading
            ? 'Loading variants…'
            : 'Choose a variant'
      }
      options={variantOptions}
      value={variantId}
      onChange={(event) => onVariantChange(event.target.value)}
      error={variantError}
    />
  </div>
);
