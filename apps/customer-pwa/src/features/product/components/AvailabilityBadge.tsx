import { StatusBadge } from '@leen-mart/ui';

interface AvailabilityBadgeProps {
  readonly available: number;
}

const LOW_STOCK_THRESHOLD = 5;

export const AvailabilityBadge = ({ available }: AvailabilityBadgeProps): JSX.Element => {
  if (available <= 0) {
    return <StatusBadge tone="danger" label="Out of stock" />;
  }

  if (available <= LOW_STOCK_THRESHOLD) {
    return <StatusBadge tone="warning" label={`Only ${available} left`} />;
  }

  return <StatusBadge tone="success" label="In stock" />;
};
