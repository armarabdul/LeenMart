import { Link } from 'react-router-dom';
import type { AdminKycQueueItem } from '@leen-mart/contracts';
import { Card, StatusBadge } from '@leen-mart/ui';
import { VENDOR_STATUS_LABEL } from '../lib/kyc-status-label';
import { VENDOR_STATUS_TONE } from '../lib/kyc-status-tone';

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const KycQueueRow = ({ item }: { readonly item: AdminKycQueueItem }): JSX.Element => (
  <li>
    <Link to={`/kyc-review/${item.kycId}`} className="block">
      <Card interactive className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">Vendor {item.vendorId}</p>
          <p className="truncate text-xs text-text-muted">
            PAN ····{item.panLast4} · GSTIN {item.gstin} · submitted {formatDate(item.submittedAt)}
          </p>
          {item.reviewedBy && (
            <p className="truncate text-xs text-text-faint">Claimed by {item.reviewedBy}</p>
          )}
        </div>
        <StatusBadge
          tone={VENDOR_STATUS_TONE[item.vendorStatus]}
          label={VENDOR_STATUS_LABEL[item.vendorStatus]}
        />
      </Card>
    </Link>
  </li>
);
