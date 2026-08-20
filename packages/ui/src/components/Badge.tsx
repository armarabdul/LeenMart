import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-alt text-text-muted',
  primary: 'bg-primary-soft text-primary-hover',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
};

/** A small, static pill for a count or a short label. For a domain status (order/review/KYC state), reach for `StatusBadge` instead — it adds the dot and the semantic mapping. */
export const Badge = ({ tone = 'neutral', className, ...rest }: BadgeProps): JSX.Element => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none',
      TONE_CLASSES[tone],
      className,
    )}
    {...rest}
  />
);
