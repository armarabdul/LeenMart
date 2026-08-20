import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PublicProductDetail, PublicProductVariant } from '@leen-mart/contracts';
import { useGetProductDetailQuery } from '@/features/product/product.api';
import { VariantSelector } from '@/features/product/components/VariantSelector';
import { AvailabilityBadge } from '@/features/product/components/AvailabilityBadge';
import { AddToCartButton } from '@/features/product/components/AddToCartButton';
import { QuantityControl } from '@/shared/components/QuantityControl';
import { useAddCartItemMutation } from '@/features/cart/cart.api';
import { ProductReviews } from '@/features/review/components/ProductReviews';
import { formatMoney } from '@/shared/lib/format-money';
import { apiErrorMessage } from '@/shared/api/base-api';

const SUCCESS_DISPLAY_MS = 2000;

const MediaPlaceholder = ({ mediaCount }: { readonly mediaCount: number }): JSX.Element => (
  <div className="flex aspect-square w-full shrink-0 items-center justify-center rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-400 md:max-w-sm">
    {mediaCount > 0
      ? `${mediaCount} photo${mediaCount === 1 ? '' : 's'} — not yet available for preview`
      : 'No photos available'}
  </div>
);

const AttributeList = ({
  attributeValues,
}: {
  readonly attributeValues: Readonly<Record<string, unknown>>;
}): JSX.Element | null => {
  const entries = Object.entries(attributeValues);
  if (entries.length === 0) return null;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-slate-500">{key}</dt>
          <dd className="text-slate-900">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
};

interface ProductPurchasePanelProps {
  readonly product: PublicProductDetail;
}

/**
 * Owns variant selection, quantity, and the add-to-cart mutation. The
 * mutation is triggered from here (a `pages/` file) rather than inside
 * `features/product/components/AddToCartButton` — `features/product` may
 * not import `features/cart/cart.api` directly (SDD 25.3), so composition
 * happens at the page level instead, per that lint rule's own guidance.
 */
const ProductPurchasePanel = ({ product }: ProductPurchasePanelProps): JSX.Element => {
  // Prefer an available variant; fall back to the first if none are in
  // stock, but never override an *available* one with an unavailable
  // default.
  const defaultVariant = useMemo(() => {
    if (product.variants.length === 0) return null;
    return product.variants.find((variant) => variant.available > 0) ?? product.variants[0] ?? null;
  }, [product]);

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const selectedVariant: PublicProductVariant | null =
    product.variants.find((variant) => variant.id === selectedVariantId) ?? defaultVariant;

  const [quantity, setQuantity] = useState(1);

  // A newly selected (or newly resolved) variant may have a different step
  // or availability than the previous one — the quantity must restart at a
  // value that is valid for it.
  useEffect(() => {
    if (selectedVariant) setQuantity(selectedVariant.quantityStep);
  }, [selectedVariant]);

  const [addCartItem, { isLoading: isAdding, error: addError }] = useAddCartItemMutation();
  const [justAdded, setJustAdded] = useState(false);

  // A different variant/quantity is a fresh intent — the previous "Added"
  // confirmation no longer describes what this click would do.
  useEffect(() => {
    setJustAdded(false);
  }, [selectedVariant, quantity]);

  useEffect(() => {
    if (!justAdded) return undefined;
    const timer = setTimeout(() => setJustAdded(false), SUCCESS_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [justAdded]);

  const handleAddToCart = (): void => {
    if (!selectedVariant) return;
    const variantId = selectedVariant.id;
    void (async (): Promise<void> => {
      try {
        await addCartItem({ variantId, quantity }).unwrap();
        setJustAdded(true);
      } catch {
        // Surfaced below via `addError` from the mutation hook.
      }
    })();
  };

  if (!selectedVariant) {
    return (
      <p className="text-sm text-slate-600">
        This product is not currently available to add to cart.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xl font-semibold text-slate-900">
        {formatMoney(selectedVariant.price)}
        <span className="ml-1 text-sm font-normal text-slate-500">
          / {selectedVariant.unitOfMeasure}
        </span>
      </p>

      <AvailabilityBadge available={selectedVariant.available} />

      <VariantSelector
        variants={product.variants}
        selectedVariantId={selectedVariant.id}
        onSelect={setSelectedVariantId}
      />

      {selectedVariant.available > 0 ? (
        <>
          <QuantityControl
            quantity={quantity}
            quantityStep={selectedVariant.quantityStep}
            available={selectedVariant.available}
            onChange={setQuantity}
          />
          <AddToCartButton
            onAddToCart={handleAddToCart}
            isLoading={isAdding}
            error={addError}
            justAdded={justAdded}
          />
        </>
      ) : (
        <p className="text-sm text-slate-600">This option is currently out of stock.</p>
      )}
    </div>
  );
};

/**
 * Public product detail (S3-3 discovery milestone's approved backend
 * surface). Browsing never requires a session — only
 * `ProductPurchasePanel`'s add-to-cart mutation does.
 */
export const ProductDetailPage = (): JSX.Element => {
  const { id } = useParams<{ id: string }>();
  const {
    data: product,
    isLoading,
    isError,
    error,
  } = useGetProductDetailQuery(id ?? '', { skip: !id });

  if (isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
        <div className="flex flex-col gap-6 md:flex-row">
          <div className="aspect-square w-full animate-pulse rounded-lg bg-slate-100 md:max-w-sm" />
          <div className="flex flex-1 flex-col gap-3">
            <div className="h-6 w-2/3 animate-pulse rounded bg-slate-100" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-slate-100" />
            <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  if (isError || !product) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8">
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {isError
            ? apiErrorMessage(error, 'This product could not be found.')
            : 'This product could not be found.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-6 md:flex-row">
        <MediaPlaceholder mediaCount={product.mediaCount} />

        <div className="flex flex-1 flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{product.name}</h1>
            {product.brand && <p className="mt-1 text-sm text-slate-500">{product.brand}</p>}
          </div>

          {product.description && <p className="text-sm text-slate-700">{product.description}</p>}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600">
            {product.netQuantity && (
              <>
                <dt className="text-slate-500">Net quantity</dt>
                <dd>{product.netQuantity}</dd>
              </>
            )}
            {product.countryOfOrigin && (
              <>
                <dt className="text-slate-500">Country of origin</dt>
                <dd>{product.countryOfOrigin}</dd>
              </>
            )}
          </dl>

          <AttributeList attributeValues={product.attributeValues} />

          <ProductPurchasePanel product={product} />
        </div>
      </div>

      <ProductReviews productId={product.id} />
    </main>
  );
};
