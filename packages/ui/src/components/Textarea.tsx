import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly label?: string | undefined;
  /** Helper copy shown when there is no error. Replaced by `error` when one is present, never shown alongside it. */
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly containerClassName?: string | undefined;
}

/** Same label/hint/error shape as `Input`/`Select`, over a native `<textarea>` — free-text fields (a review body, a message) need the identical accessible-error wiring a single-line field does. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, id, className, containerClassName, disabled, ...rest }, ref) => {
    const generatedId = useId();
    const textareaId = id ?? generatedId;
    const hintId = `${textareaId}-hint`;
    const errorId = `${textareaId}-error`;
    const describedBy = error ? errorId : hint ? hintId : undefined;

    return (
      <div className={cn('flex flex-col gap-1.5', containerClassName)}>
        {label && (
          <label htmlFor={textareaId} className="text-sm font-medium text-text">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint',
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
Textarea.displayName = 'Textarea';
