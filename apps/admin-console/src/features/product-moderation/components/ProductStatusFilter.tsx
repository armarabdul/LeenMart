import type { AdminProductQueueStatus } from '@leen-mart/contracts';
import { PRODUCT_STATUS_LABEL } from '../lib/product-status-label';

const FILTERABLE_STATUSES: readonly AdminProductQueueStatus[] = [
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
];

interface ProductStatusFilterProps {
  readonly selected: readonly AdminProductQueueStatus[];
  readonly onChange: (statuses: readonly AdminProductQueueStatus[]) => void;
}

/** Toggle-button filter over the three queue statuses `adminProductQueueStatusSchema` declares — split out purely to keep `ProductQueuePage` within this repository's function-length budget. */
export const ProductStatusFilter = ({
  selected,
  onChange,
}: ProductStatusFilterProps): JSX.Element => {
  const toggle = (status: AdminProductQueueStatus): void => {
    onChange(
      selected.includes(status)
        ? selected.filter((current) => current !== status)
        : [...selected, status],
    );
  };

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
      {FILTERABLE_STATUSES.map((status) => {
        const isActive = selected.includes(status);
        return (
          <button
            key={status}
            type="button"
            aria-pressed={isActive}
            onClick={() => toggle(status)}
            className={`h-9 rounded-full border px-3 text-xs font-medium ${
              isActive
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-border-strong bg-surface text-text hover:bg-surface-alt'
            }`}
          >
            {PRODUCT_STATUS_LABEL[status]}
          </button>
        );
      })}
    </div>
  );
};
