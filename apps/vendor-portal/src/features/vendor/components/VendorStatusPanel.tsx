import { Link } from 'react-router-dom';
import type { VendorShopAddressResponse } from '@leen-mart/contracts';
import { Alert, Card, StatusBadge } from '@leen-mart/ui';
import { VENDOR_STATUS_LABEL } from '@/shared/lib/vendor-status-label';
import { VENDOR_STATUS_TONE } from '@/shared/lib/vendor-status-tone';
import { KycSubmissionForm } from './KycSubmissionForm';

type VendorStatus = VendorShopAddressResponse['status'];
/** Status groups as lookup tables, not inline `||` chains, purely to keep this component within this repository's complexity budget. */
const KYC_FORM_STATUSES: readonly VendorStatus[] = ['REGISTERED', 'KYC_REJECTED'];
const UNDER_REVIEW_STATUSES: readonly VendorStatus[] = ['KYC_SUBMITTED', 'KYC_UNDER_REVIEW'];
const INACTIVE_STATUSES: readonly VendorStatus[] = ['SUSPENDED', 'TERMINATED'];

/**
 * Everything rendered once a vendor profile has loaded (Phase J) — split out
 * of `OnboardingPage` purely to keep that page within this repository's
 * complexity budget. Every branch is one of the eight states
 * `vendorStatusSchema` actually declares, and none is invented.
 */
export const VendorStatusPanel = ({
  profile,
}: {
  readonly profile: VendorShopAddressResponse;
}): JSX.Element => (
  <div className="flex flex-col gap-6">
    <Card className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-text">{profile.shopName ?? 'Your shop'}</p>
        <p className="text-xs text-text-muted">Vendor status</p>
      </div>
      <StatusBadge
        tone={VENDOR_STATUS_TONE[profile.status]}
        label={VENDOR_STATUS_LABEL[profile.status]}
      />
    </Card>

    {KYC_FORM_STATUSES.includes(profile.status) && (
      <Card className="flex flex-col gap-4">
        {profile.status === 'KYC_REJECTED' && (
          <Alert tone="danger" title="Your KYC submission was rejected">
            Please review your details and documents, then resubmit below.
          </Alert>
        )}
        <KycSubmissionForm
          vendorId={profile.id}
          isResubmission={profile.status === 'KYC_REJECTED'}
        />
      </Card>
    )}

    {UNDER_REVIEW_STATUSES.includes(profile.status) && (
      <Alert tone="info">
        Your KYC submission is being reviewed. This page will show the outcome once a decision has
        been made.
      </Alert>
    )}

    {profile.status === 'KYC_APPROVED' && (
      <Alert tone="info">
        Your KYC has been approved. An administrator will activate your shop shortly — you&apos;ll
        be able to receive orders once that happens.
      </Alert>
    )}

    {profile.status === 'ACTIVE' && (
      <Alert tone="success">
        Your shop is active. You can manage your{' '}
        <Link to="/products" className="font-medium underline">
          products
        </Link>{' '}
        and incoming orders.
      </Alert>
    )}

    {INACTIVE_STATUSES.includes(profile.status) && (
      <Alert tone="danger">
        Your shop is {VENDOR_STATUS_LABEL[profile.status].toLowerCase()}. Contact support for more
        information.
      </Alert>
    )}
  </div>
);
