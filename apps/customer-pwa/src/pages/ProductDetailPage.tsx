import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PublicProductDetail, PublicProductVariant } from '@leen-mart/contracts';
import { Alert, Badge, Breadcrumb, Card, Skeleton } from '@leen-mart/ui';
import { useGetProductDetailQuery } from '@/features/product/product.api';
import { VariantSelector } from '@/features/product/components/VariantSelector';
import { AvailabilityBadge } from '@/features/product/components/AvailabilityBadge';
import { AddToCartButton } from '@/features/product/components/AddToCartButton';
import { QuantityControl } from '@/shared/components/QuantityControl';
import { useAddCartItemMutation } from '@/features/cart/cart.api';
import { ProductReviews } from '@/features/review/components/ProductReviews';
import { PageContainer } from '@/components/PageContainer';
import { formatMoney } from '@/shared/lib/format-money';
import { apiErrorMessage } from '@/shared/api/base-api';

const SUCCESS_DISPLAY_MS = 2000;

/**
 * The media well.
 *
 * There is still no image to render — the public detail contract carries
 * `mediaCount` and no URL, because media delivery (S2-6c) is deferred. This
 * holds the space at a fixed square so the two-column layout does not jump
 * once images land, and states what exists rather than showing a decorative
 * stand-in that would read as the product's own photo.
 */
const MediaWell = ({ mediaCount }: { readonly mediaCount: number }): JSX.Element => (
  <div className="flex aspect-square w-full items-center justify-center rounded-card border border-border bg-surface-alt">
    <div className="flex flex-col items-center gap-2 px-6 text-center text-text-faint">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-10 w-10">
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8.5" cy="10" r="1.5" fill="currentColor" />
        <path
          d="m4 17 4.5-4.5 3 3L15 12l5 5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-sm">
        {mediaCount > 0
          ? `${mediaCount} photo${mediaCount === 1 ? '' : 's'} — not yet available for preview`
          : 'No photos available'}
      </span>
    </div>
  </div>
);

/** Product facts, as a description list so a screen reader reads label/value pairs. */
const SpecificationList = ({
  product,
}: {
  readonly product: PublicProductDetail;
}): JSX.Element | null => {
  const rows: { label: string; value: string }[] = [
    ...(product.netQuantity ? [{ label: 'Net quantity', value: product.netQuantity }] : []),
    ...(product.countryOfOrigin
      ? [{ label: 'Country of origin', value: product.countryOfOrigin }]
      : []),
    ...Object.entries(product.attributeValues).map(([label, value]) => ({
      label,
      value: String(value),
    })),
  ];
  if (rows.length === 0) return null;

  return (
    <dl className="divide-y divide-border rounded-card border border-border bg-surface">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-2 gap-4 px-4 py-3 text-sm">
          <dt className="text-text-muted">{row.label}</dt>
          <dd className="text-text">{row.value}</dd>
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
 *
 * Phase D changed only the presentation. Every behaviour below — the
 * available-variant preference, the quantity reset on variant change, the
 * cleared "Added" confirmation, the error surface — is unchanged.
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
    return <Alert tone="info">This product is not currently available to add to cart.</Alert>;
  }

  return (
    <Card padding="md" className="flex flex-col gap-4">
      <div>
        <p className="text-2xl font-semibold text-text">
          {formatMoney(selectedVariant.price)}
          <span className="ml-1 text-sm font-normal text-text-muted">
            / {selectedVariant.unitOfMeasure}
          </span>
        </p>
        <div className="mt-2">
          <AvailabilityBadge available={selectedVariant.available} />
        </div>
      </div>

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
        <Alert tone="warning">This option is currently out of stock.</Alert>
      )}
    </Card>
  );
};

const DetailSkeleton = (): JSX.Element => (
  <div className="grid gap-8 lg:grid-cols-2">
    <Skeleton shape="rect" className="aspect-square w-full" />
    <div className="flex flex-col gap-3">
      <Skeleton shape="text" className="h-6 w-2/3" />
      <Skeleton shape="text" className="w-1/3" />
      <Skeleton shape="rect" className="h-40 w-full" />
    </div>
  </div>
);

/**
 * Public product detail (Phase D presentation over the S3-3 backend surface).
 * Browsing never requires a session — only `ProductPurchasePanel`'s
 * add-to-cart mutation does.
 *
 * **On the missing shop identity.** A marketplace PDP should name the seller,
 * and Leen Mart's whole premise is buying from a specific local shop. The
 * public detail contract does not expose one: `publicProductDetailSchema`
 * omits `vendorId` deliberately, and there is no public vendor endpoint to
 * resolve a name from. Rather than invent a shop, this page shows the brand
 * where the product has one and leaves the seller block out entirely — see the
 * Phase D report, where this is raised as the main gap between the design
 * target and the available API.
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
      <main>
        <PageContainer>
          <div className="py-6 sm:py-8">
            <DetailSkeleton />
          </div>
        </PageContainer>
      </main>
    );
  }

  if (isError || !product) {
    return (
      <main>
        <PageContainer>
          <div className="py-8">
            <Alert tone="danger" title="Product unavailable">
              {isError
                ? apiErrorMessage(error, 'This product could not be found.')
                : 'This product could not be found.'}
            </Alert>
          </div>
        </PageContainer>
      </main>
    );
  }

  return (
    <main>
      <PageContainer>
        <div className="flex flex-col gap-10 py-6 sm:py-8">
          <Breadcrumb
            items={[
              { label: 'Home', href: '/' },
              { label: 'Catalogue', href: '/catalogue' },
              { label: product.name },
            ]}
            renderLink={({ href, children }) => <Link to={href}>{children}</Link>}
          />

          <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
            <MediaWell mediaCount={product.mediaCount} />

            {/* Sticky from `lg` up, where the media column is tall enough that
                the price and the add-to-cart button would otherwise scroll away
                while the shopper reads. Not sticky on mobile: the panel already
                sits directly under the title, so it is reachable without a bar
                overlaying the page — and a second add-to-cart control would mean
                two copies of the variant/quantity state to keep in step. */}
            <div className="flex flex-col gap-5 lg:sticky lg:top-24">
              <div className="flex flex-col gap-2">
                {product.brand && <Badge tone="neutral">{product.brand}</Badge>}
                <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-3xl">
                  {product.name}
                </h1>
              </div>

              {product.description && (
                <p className="text-sm leading-relaxed text-text-muted">{product.description}</p>
              )}

              <ProductPurchasePanel product={product} />
            </div>
          </div>

          <section aria-labelledby="product-details" className="flex flex-col gap-3">
            <h2 id="product-details" className="text-base font-semibold text-text">
              Product details
            </h2>
            <SpecificationList product={product} />
          </section>

          <ProductReviews productId={product.id} />
        </div>
      </PageContainer>
    </main>
  );
};
