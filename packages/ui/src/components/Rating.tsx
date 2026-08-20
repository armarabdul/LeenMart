import { cn } from '../lib/cn.js';

const STARS = [1, 2, 3, 4, 5] as const;

export interface RatingProps {
  readonly value: number;
  /** Present → interactive picker (radiogroup, keyboard-selectable). Absent → read-only display. */
  readonly onChange?: (rating: number) => void;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly className?: string;
}

const SIZE_CLASSES = { sm: 'text-base', md: 'text-xl', lg: 'text-2xl' } as const;

/**
 * A 1–5 star rating — read-only (product cards, review lists) or
 * interactive (the review-composition form), decided purely by whether
 * `onChange` is passed. Mirrors the two bespoke implementations this
 * replaces (`ProductReviews.tsx`'s `Stars`, `WriteReviewControl.tsx`'s
 * `RatingPicker`) exactly in aria shape, so swapping either in is a pure
 * refactor with no behaviour change.
 */
export const Rating = ({ value, onChange, size = 'md', className }: RatingProps): JSX.Element => {
  if (!onChange) {
    return (
      <span
        aria-label={`${value} out of 5 stars`}
        className={cn('text-warning', SIZE_CLASSES[size], className)}
      >
        <span aria-hidden="true">{'★'.repeat(value)}</span>
        <span aria-hidden="true" className="text-border-strong">
          {'★'.repeat(5 - value)}
        </span>
      </span>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Rating"
      className={cn('flex gap-1', SIZE_CLASSES[size], className)}
    >
      {STARS.map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star === 1 ? '' : 's'}`}
          onClick={() => onChange(star)}
          className={cn(
            'leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded',
            star <= value ? 'text-warning' : 'text-border-strong',
          )}
        >
          ★
        </button>
      ))}
    </div>
  );
};
