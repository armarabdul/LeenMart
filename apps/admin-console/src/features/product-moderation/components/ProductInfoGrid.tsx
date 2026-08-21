import type { AdminProductDetail } from '@leen-mart/contracts';

interface ProductInfoGridProps {
  readonly data: AdminProductDetail;
}

/** The static identity/compliance fields `adminProductDetailSchema` provides, split out of `ProductDetailPage` to keep that component's branching within budget. */
export const ProductInfoGrid = ({ data }: ProductInfoGridProps): JSX.Element => (
  <div className="grid grid-cols-1 gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-2">
    <div>
      <p className="text-xs text-text-muted">Vendor</p>
      <p className="text-sm text-text">{data.vendorId}</p>
    </div>
    <div>
      <p className="text-xs text-text-muted">Category</p>
      <p className="text-sm text-text">{data.categoryId}</p>
    </div>
    <div>
      <p className="text-xs text-text-muted">Brand</p>
      <p className="text-sm text-text">{data.brand ?? '—'}</p>
    </div>
    <div>
      <p className="text-xs text-text-muted">HSN code</p>
      <p className="text-sm text-text">{data.hsnCode ?? '—'}</p>
    </div>
    <div>
      <p className="text-xs text-text-muted">Country of origin</p>
      <p className="text-sm text-text">{data.countryOfOrigin ?? '—'}</p>
    </div>
    <div>
      <p className="text-xs text-text-muted">Net quantity</p>
      <p className="text-sm text-text">{data.netQuantity ?? '—'}</p>
    </div>
    {data.description && (
      <div className="sm:col-span-2">
        <p className="text-xs text-text-muted">Description</p>
        <p className="text-sm text-text">{data.description}</p>
      </div>
    )}
  </div>
);
