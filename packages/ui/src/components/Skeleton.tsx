import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export type SkeletonShape = 'text' | 'circle' | 'rect';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  readonly shape?: SkeletonShape;
}

const SHAPE_CLASSES: Record<SkeletonShape, string> = {
  text: 'rounded',
  circle: 'rounded-full',
  rect: 'rounded-card',
};

/**
 * A loading placeholder. Respects reduced-motion by default (the `animate-pulse`
 * utility is itself defined in terms of `prefers-reduced-motion` at the
 * global stylesheet level — see `styles.css`'s existing base layer — so no
 * separate opt-out is needed here).
 */
export const Skeleton = ({ shape = 'text', className, ...rest }: SkeletonProps): JSX.Element => (
  <div
    aria-hidden="true"
    className={cn('animate-pulse bg-surface-alt', SHAPE_CLASSES[shape], className)}
    {...rest}
  />
);
