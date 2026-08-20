import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}

/** "Nothing here yet" — for an empty cart, an empty order list, a product with no reviews. Never a bare blank space. */
export const EmptyState = ({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps): JSX.Element => (
  <div
    className={cn(
      'flex flex-col items-center gap-3 rounded-card border border-dashed border-border-strong px-6 py-10 text-center',
      className,
    )}
  >
    {icon && (
      <span aria-hidden="true" className="text-text-faint">
        {icon}
      </span>
    )}
    <div className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-text">{title}</p>
      {description && <p className="max-w-sm text-sm text-text-muted">{description}</p>}
    </div>
    {action}
  </div>
);
