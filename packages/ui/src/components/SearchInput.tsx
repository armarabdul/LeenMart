import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visually hidden by default (SDD accessibility convention already used by `SearchBar`) — pass `false` only when a visible label is genuinely part of the layout. */
  readonly label?: string;
  readonly hideLabel?: boolean;
  /** Shown only once `value` is non-empty; omit to never render a clear affordance (e.g. an uncontrolled field). */
  readonly onClear?: () => void;
}

const SearchIcon = (): JSX.Element => (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 text-text-faint">
    <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="m17 17-3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * A presentational search field — icon, input, optional clear button. Owns
 * no submit/navigation behaviour of its own, so a feature composes it into
 * whatever search flow it actually needs (results route, inline filter,
 * etc.) rather than this component assuming one.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ label = 'Search', hideLabel = true, onClear, id, className, value, ...rest }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const hasValue = typeof value === 'string' && value.length > 0;

    return (
      <div className="relative w-full">
        <label
          htmlFor={inputId}
          className={hideLabel ? 'sr-only' : 'text-sm font-medium text-text'}
        >
          {label}
        </label>
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
          <SearchIcon />
        </span>
        <input
          ref={ref}
          id={inputId}
          type="search"
          value={value}
          className={cn(
            'h-10 w-full rounded-md border border-border-strong bg-surface pl-9 pr-9 text-sm text-text placeholder:text-text-faint',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
            className,
          )}
          {...rest}
        />
        {onClear && hasValue && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            className="absolute inset-y-0 right-2 flex items-center px-1 text-text-faint hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            ×
          </button>
        )}
      </div>
    );
  },
);
SearchInput.displayName = 'SearchInput';
