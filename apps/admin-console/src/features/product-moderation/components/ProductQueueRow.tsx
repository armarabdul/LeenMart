import { Link } from 'react-router-dom';
import type { AdminProductQueueItem } from '@leen-mart/contracts';
import { Card, StatusBadge } from '@leen-mart/ui';
import { PRODUCT_STATUS_LABEL } from '../lib/product-status-label';
import { PRODUCT_STATUS_TONE } from '../lib/product-status-tone';

export const ProductQueueRow = ({
  item,
}: {
  readonly item: AdminProductQueueItem;
}): JSX.Element => (
  <li>
    <Link to={`/product-moderation/${item.productId}`} className="block">
      <Card interactive className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{item.name}</p>
          <p className="truncate text-xs text-text-muted">Vendor {item.vendorId}</p>
        </div>
        <StatusBadge
          tone={PRODUCT_STATUS_TONE[item.status]}
          label={PRODUCT_STATUS_LABEL[item.status]}
        />
      </Card>
    </Link>
  </li>
);
