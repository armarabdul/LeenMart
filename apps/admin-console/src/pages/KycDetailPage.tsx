import { useParams } from 'react-router-dom';
import { Alert, StatusBadge } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useGetKycSubmissionQuery } from '@/features/kyc-review/kyc-review.api';
import { KycDocumentList } from '@/features/kyc-review/components/KycDocumentList';
import { KycActionPanel } from '@/features/kyc-review/components/KycActionPanel';
import { VENDOR_STATUS_LABEL } from '@/features/kyc-review/lib/kyc-status-label';
import { VENDOR_STATUS_TONE } from '@/features/kyc-review/lib/kyc-status-tone';
import { KYC_REJECTION_REASON_LABEL } from '@/features/kyc-review/lib/kyc-rejection-reason-label';
import { VendorStatusActionPanel } from '@/features/vendor-management/components/VendorStatusActionPanel';

const DetailSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading KYC submission">
    {Array.from({ length: 4 }, (_, index) => (
      <div key={index} className="h-16 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

/**
 * `GET /admin/kyc/submissions/:kycId` (Phase L, L4) — one submission in
 * full: vendor information, documents, and the claim → decide →
 * (approve →) activate workflow, kept as the three separate backend
 * operations they actually are.
 */
export const KycDetailPage = (): JSX.Element => {
  const { kycId } = useParams<{ kycId: string }>();
  const { data, isLoading, isError, error } = useGetKycSubmissionQuery(kycId ?? '', {
    skip: !kycId,
  });

  if (isLoading || !kycId) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">KYC submission</h1>
        <DetailSkeleton />
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">KYC submission</h1>
        <Alert tone="danger">{apiErrorMessage(error, 'This submission could not be found.')}</Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">KYC submission</h1>
        <StatusBadge
          tone={VENDOR_STATUS_TONE[data.vendorStatus]}
          label={VENDOR_STATUS_LABEL[data.vendorStatus]}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-text-muted">Vendor</p>
          <p className="text-sm text-text">{data.vendorId}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted">PAN</p>
          <p className="text-sm text-text">····{data.panLast4}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted">GSTIN</p>
          <p className="text-sm text-text">{data.gstin}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted">Bank account</p>
          <p className="text-sm text-text">
            ····{data.bankAccountLast4} · {data.ifsc}
          </p>
        </div>
      </div>

      {data.rejectionReason && (
        <Alert tone="danger" title="This submission was rejected">
          {KYC_REJECTION_REASON_LABEL[data.rejectionReason]}
          {data.rejectionNote && <p className="mt-1">{data.rejectionNote}</p>}
        </Alert>
      )}

      <KycDocumentList documents={data.documents} />

      <KycActionPanel kycId={kycId} data={data} />

      {/*
        Suspend/reinstate (Phase L.4): a vendor lifecycle action, not a KYC
        decision, composed here at the page level rather than inside
        `KycActionPanel` — a feature may not import another feature's
        components (SDD 25.3). Every vendor that could ever be ACTIVE or
        SUSPENDED necessarily has a completed KYC submission (only
        `activate()`, reachable solely from `KYC_APPROVED`, can put them in
        ACTIVE in the first place), so this view already reaches the full
        universe of vendors this action could ever apply to.
      */}
      {(data.vendorStatus === 'ACTIVE' || data.vendorStatus === 'SUSPENDED') && (
        <VendorStatusActionPanel vendorId={data.vendorId} status={data.vendorStatus} />
      )}
    </main>
  );
};
