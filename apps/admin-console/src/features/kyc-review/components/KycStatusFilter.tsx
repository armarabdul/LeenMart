import type { AdminKycQueueStatus } from '@leen-mart/contracts';

const FILTERABLE_STATUSES: readonly AdminKycQueueStatus[] = [
  'KYC_SUBMITTED',
  'KYC_UNDER_REVIEW',
  'KYC_APPROVED',
  'KYC_REJECTED',
];

const STATUS_LABEL: Record<AdminKycQueueStatus, string> = {
  KYC_SUBMITTED: 'Submitted',
  KYC_UNDER_REVIEW: 'Under review',
  KYC_APPROVED: 'Approved',
  KYC_REJECTED: 'Rejected',
};

interface KycStatusFilterProps {
  readonly selected: readonly AdminKycQueueStatus[];
  readonly onChange: (statuses: readonly AdminKycQueueStatus[]) => void;
}

/** Toggle-button filter over the four queue statuses `adminKycQueueStatusSchema` actually declares — split out of `KycQueuePage` purely to keep it within this repository's function-length budget. */
export const KycStatusFilter = ({ selected, onChange }: KycStatusFilterProps): JSX.Element => {
  const toggle = (status: AdminKycQueueStatus): void => {
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
            {STATUS_LABEL[status]}
          </button>
        );
      })}
    </div>
  );
};
