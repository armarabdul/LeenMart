import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label?: string;
  /** Helper copy shown when there is no error. Replaced by `error` when one is present, never shown alongside it. */
  readonly hint?: string;
  readonly error?: string;
  readonly containerClassName?: string;
}

/**
 * A labelled text input with one slot for supporting copy that is either a
 * hint or an error, never both at once — an error already says what's
 * wrong, and a hint underneath it would just be noise.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, id, className, containerClassName, disabled, ...rest }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;
    const describedBy = error ? errorId : hint ? hintId : undefined;

    return (
      <div className={cn('flex flex-col gap-1.5', containerClassName)}>
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-text">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-10 rounded-md border border-border-strong bg-surface px-3 text-sm text-text placeholder:text-text-faint',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
            'disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-text-faint',
            error && 'border-danger focus:border-danger focus:ring-danger',
            className,
          )}
          {...rest}
        />
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : (
          hint && (
            <p id={hintId} className="text-xs text-text-muted">
              {hint}
            </p>
          )
        )}
      </div>
    );
  },
);
Input.displayName = 'Input';
