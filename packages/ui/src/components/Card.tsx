import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly padding?: CardPadding;
  /** A card that itself acts as a trigger (e.g. a whole product card) — adds hover/focus affordances a purely static card shouldn't have. */
  readonly interactive?: boolean;
}

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

/** The one card shell every grid/list item and content block builds on — border, radius, and shadow live here exactly once. */
export const Card = ({
  padding = 'md',
  interactive = false,
  className,
  ...rest
}: CardProps): JSX.Element => (
  <div
    className={cn(
      'rounded-card border border-border bg-surface shadow-card',
      PADDING_CLASSES[padding],
      interactive &&
        'transition-shadow hover:shadow-lg focus-within:ring-2 focus-within:ring-primary',
      className,
    )}
    {...rest}
  />
);
