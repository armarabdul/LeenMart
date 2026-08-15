interface AvailabilityBadgeProps {
  readonly available: number;
}

const LOW_STOCK_THRESHOLD = 5;

export const AvailabilityBadge = ({ available }: AvailabilityBadgeProps): JSX.Element => {
  if (available <= 0) {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
        Out of stock
      </span>
    );
  }

  if (available <= LOW_STOCK_THRESHOLD) {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
        Only {available} left
      </span>
    );
  }

  return (
    <span className="inline-flex w-fit items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
      In stock
    </span>
  );
};
