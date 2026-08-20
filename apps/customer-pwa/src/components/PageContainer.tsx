import type { ReactNode } from 'react';
import { cn } from '@leen-mart/ui';

export interface PageContainerProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * The one horizontal rail every shell surface sits on (Phase C).
 *
 * Header and footer previously repeated `mx-auto max-w-6xl px-4`, which meant
 * the chrome and the content could drift apart the moment either changed. This
 * makes the rail a single named thing.
 *
 * The padding steps up with the viewport (`px-4` → `sm:px-6` → `lg:px-8`)
 * rather than staying flat: at 320px a 16px gutter is the most a phone can
 * spare, while at 1440px the same 16px leaves text visually glued to the
 * window edge. `w-full` matters as much as `max-w-6xl` — without it a flex
 * parent can shrink this below the viewport and reintroduce the edge-hugging
 * this exists to prevent.
 */
export const PageContainer = ({ children, className }: PageContainerProps): JSX.Element => (
  <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8', className)}>{children}</div>
);
