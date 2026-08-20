import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';
import type { BadgeTone } from './Badge.js';

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone: Exclude<BadgeTone, 'neutral' | 'primary'> | 'neutral';
  readonly label: string;
}

const TONE_CLASSES: Record<StatusBadgeProps['tone'], string> = {
  neutral: 'bg-surface-alt text-text-muted',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
};

const DOT_CLASSES: Record<StatusBadgeProps['tone'], string> = {
  neutral: 'bg-text-faint',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

/**
 * A lifecycle-state indicator — a dot plus a label, for order status,
 * review moderation state, KYC status, and the like.
 *
 * Deliberately takes `tone` and `label` rather than a domain status string:
 * Leen Mart has several independent status enums (orders, reviews, vendor
 * KYC…) and baking one of them in here would make this component silently
 * wrong for every other one. Each feature maps its own status to a tone at
 * the call site — the same separation `order-status-label.ts` already
 * keeps from the order domain today.
 */
export const StatusBadge = ({ tone, label, className, ...rest }: StatusBadgeProps): JSX.Element => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium leading-none',
      TONE_CLASSES[tone],
      className,
    )}
    {...rest}
  >
    <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', DOT_CLASSES[tone])} />
    {label}
  </span>
);
