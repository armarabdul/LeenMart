import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label?: string | undefined;
  /** Helper copy shown when there is no error. Replaced by `error` when one is present, never shown alongside it. */
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly containerClassName?: string | undefined;
  /** An icon/button pinned to the input's trailing edge (e.g. a password-visibility toggle). Never affects label/hint layout — only the input row. */
  readonly endAdornment?: ReactNode;
}

interface HelperTextProps {
  readonly hintId: string;
  readonly errorId: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
}

/** The one slot below the field — an error takes priority, then a hint, then nothing. */
const HelperText = ({ hintId, errorId, hint, error }: HelperTextProps): JSX.Element | null => {
  if (error) {
    return (
      <p id={errorId} role="alert" className="text-xs text-danger">
        {error}
      </p>
    );
  }
  if (hint) {
    return (
      <p id={hintId} className="text-xs text-text-muted">
        {hint}
      </p>
    );
  }
  return null;
};

/** Pins a trailing icon/button to the input's edge without affecting its own layout. */
const EndAdornment = ({ children }: { readonly children?: ReactNode }): JSX.Element | null =>
  children ? <div className="absolute inset-y-0 right-1 flex items-center">{children}</div> : null;

/**
 * A labelled text input with one slot for supporting copy that is either a
 * hint or an error, never both at once — an error already says what's
 * wrong, and a hint underneath it would just be noise.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { label, hint, error, id, className, containerClassName, disabled, endAdornment, ...rest },
    ref,
  ) => {
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
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(
              'h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-text placeholder:text-text-faint',
              'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
              'disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-text-faint',
              error && 'border-danger focus:border-danger focus:ring-danger',
              endAdornment && 'pr-10',
              className,
            )}
            {...rest}
          />
          <EndAdornment>{endAdornment}</EndAdornment>
        </div>
        <HelperText hintId={hintId} errorId={errorId} hint={hint} error={error} />
      </div>
    );
  },
);
Input.displayName = 'Input';
