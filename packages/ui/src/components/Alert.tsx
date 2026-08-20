import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type AlertTone = 'success' | 'warning' | 'danger' | 'info';

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly tone: AlertTone;
  readonly title?: string;
  readonly children: ReactNode;
}

const TONE_CLASSES: Record<AlertTone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  info: 'border-info/30 bg-info/10 text-info',
};

/**
 * Inline feedback banner — a form-level submission error, a page-level
 * warning, a success confirmation. `danger`/`warning` are `role="alert"`
 * (announced immediately, matching every existing error message in the
 * app today); `success`/`info` are `role="status"` (announced politely,
 * never interrupting).
 */
export const Alert = ({ tone, title, children, className, ...rest }: AlertProps): JSX.Element => (
  <div
    role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
    className={cn('rounded-md border px-4 py-3 text-sm', TONE_CLASSES[tone], className)}
    {...rest}
  >
    {title && <p className="font-semibold">{title}</p>}
    <div className={title ? 'mt-0.5' : undefined}>{children}</div>
  </div>
);
