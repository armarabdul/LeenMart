import { Link } from 'react-router-dom';
import type { VendorProduct } from '@leen-mart/contracts';
import { Alert, Button, Card, EmptyState, StatusBadge } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useListProductsQuery } from '@/features/vendor-product/vendor-product.api';
import { PRODUCT_STATUS_LABEL } from '@/features/vendor-product/lib/product-status-label';
import { PRODUCT_STATUS_TONE } from '@/features/vendor-product/lib/product-status-tone';

/** Named predicates, not inline `&&`/`||` chains, purely to keep `VendorProductsPage` within this repository's complexity budget. */
const hasLoadError = (isLoading: boolean, isError: boolean, products: unknown): boolean =>
  !isLoading && (isError || !products);
const isEmpty = (isLoading: boolean, products: readonly VendorProduct[] | undefined): boolean =>
  !isLoading && !!products && products.length === 0;
const hasProducts = (isLoading: boolean, products: readonly VendorProduct[] | undefined): boolean =>
  !isLoading && !!products && products.length > 0;

const ProductsSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your products">
    {Array.from({ length: 3 }, (_, index) => (
      <div key={index} className="h-20 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

const ProductRow = ({ product }: { readonly product: VendorProduct }): JSX.Element => (
  <li>
    <Link to={`/products/${product.id}`} className="block">
      <Card interactive className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{product.name}</p>
          {product.brand && <p className="truncate text-xs text-text-muted">{product.brand}</p>}
        </div>
        <StatusBadge
          tone={PRODUCT_STATUS_TONE[product.status]}
          label={PRODUCT_STATUS_LABEL[product.status]}
        />
      </Card>
    </Link>
  </li>
);

/** The vendor's own catalogue (S2-3/S2-5, Phase J) — `GET /vendor/products`, tenant-scoped to the caller. */
export const VendorProductsPage = (): JSX.Element => {
  const { data: products, isLoading, isError, error, refetch } = useListProductsQuery();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Products</h1>
        <Link
          to="/products/new"
          className="inline-flex h-10 items-center rounded-md bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Add product
        </Link>
      </div>

      {isLoading && <ProductsSkeleton />}

      {hasLoadError(isLoading, isError, products) && (
        <div className="flex flex-col gap-3">
          <Alert tone="danger">
            {apiErrorMessage(error, 'Your products could not be loaded.')}
          </Alert>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void refetch()}
            className="self-start"
          >
            Try again
          </Button>
        </div>
      )}

      {isEmpty(isLoading, products) && (
        <EmptyState
          title="No products yet"
          description="Add your first product to start selling."
          action={
            <Link
              to="/products/new"
              className="inline-flex h-10 items-center rounded-md bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Add product
            </Link>
          }
        />
      )}

      {hasProducts(isLoading, products) && products && (
        <ul className="flex flex-col gap-3">
          {products.map((product) => (
            <ProductRow key={product.id} product={product} />
          ))}
        </ul>
      )}
    </main>
  );
};
