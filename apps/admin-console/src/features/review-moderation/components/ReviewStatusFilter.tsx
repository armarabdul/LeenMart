import type { ReviewModerationStatusDto } from '@leen-mart/contracts';
import { REVIEW_STATUS_LABEL } from '../lib/review-status-label';

const FILTERABLE_STATUSES: readonly ReviewModerationStatusDto[] = [
  'SUBMITTED',
  'APPROVED',
  'HIDDEN',
];

interface ReviewStatusFilterProps {
  readonly selected: readonly ReviewModerationStatusDto[];
  readonly onChange: (statuses: readonly ReviewModerationStatusDto[]) => void;
}

/** Toggle-button filter over `reviewModerationStatusSchema`'s three values — mirrors `ProductStatusFilter`. */
export const ReviewStatusFilter = ({
  selected,
  onChange,
}: ReviewStatusFilterProps): JSX.Element => {
  const toggle = (status: ReviewModerationStatusDto): void => {
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
            {REVIEW_STATUS_LABEL[status]}
          </button>
        );
      })}
    </div>
  );
};
