import { useParams } from 'react-router-dom';
import type { DecideProductRequest } from '@leen-mart/contracts';
import { Alert, StatusBadge } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import {
  useDecideProductMutation,
  useGetProductSubmissionQuery,
} from '@/features/product-moderation/product-moderation.api';
import { ProductDecisionForm } from '@/features/product-moderation/components/ProductDecisionForm';
import { ProductInfoGrid } from '@/features/product-moderation/components/ProductInfoGrid';
import { PRODUCT_STATUS_LABEL } from '@/features/product-moderation/lib/product-status-label';
import { PRODUCT_STATUS_TONE } from '@/features/product-moderation/lib/product-status-tone';
import { PRODUCT_REJECTION_REASON_LABEL } from '@/features/product-moderation/lib/product-rejection-reason-label';

const DetailSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading product submission">
    {Array.from({ length: 4 }, (_, index) => (
      <div key={index} className="h-16 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

/**
 * `GET /admin/products/submissions/:productId` (Phase L, L5).
 *
 * Shows exactly what `adminProductDetailSchema` provides — product
 * identity, category, brand/description/HSN/origin/net-quantity, and
 * moderation state. **No variant, inventory, or media detail is shown, and
 * that is a discovered contract gap, not an omission**: the admin product
 * read model carries none of those (confirmed by reading
 * `packages/contracts/src/catalogue/product-review.contract.ts` directly)
 * — a moderator reviewing a listing today sees the same fields the API
 * itself exposes for this purpose, nothing invented on top.
 */
export const ProductDetailPage = (): JSX.Element => {
  const { productId } = useParams<{ productId: string }>();
  const { data, isLoading, isError, error } = useGetProductSubmissionQuery(productId ?? '', {
    skip: !productId,
  });
  const [decideProduct, { isLoading: isDeciding, error: decideError }] = useDecideProductMutation();

  if (isLoading || !productId) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Product submission</h1>
        <DetailSkeleton />
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Product submission</h1>
        <Alert tone="danger">{apiErrorMessage(error, 'This product could not be found.')}</Alert>
      </main>
    );
  }

  const handleDecide = (body: DecideProductRequest): void => {
    void decideProduct({ productId, body });
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{data.name}</h1>
        <StatusBadge
          tone={PRODUCT_STATUS_TONE[data.status]}
          label={PRODUCT_STATUS_LABEL[data.status]}
        />
      </div>

      <ProductInfoGrid data={data} />

      {data.rejectionReason && (
        <Alert tone="danger" title="This product was rejected">
          {PRODUCT_REJECTION_REASON_LABEL[data.rejectionReason]}
          {data.rejectionNote && <p className="mt-1">{data.rejectionNote}</p>}
        </Alert>
      )}

      {data.status === 'PENDING_REVIEW' && (
        <ProductDecisionForm
          isSubmitting={isDeciding}
          submitError={decideError}
          onDecide={handleDecide}
        />
      )}
    </main>
  );
};
