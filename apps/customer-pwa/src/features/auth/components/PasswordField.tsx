import { forwardRef, useState } from 'react';
import { Input, type InputProps } from '@leen-mart/ui';

const EyeIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
    <path
      d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

const EyeOffIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
    <path
      d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M6.3 6.4C3.9 8 2 12 2 12s3.6 7 10 7c1.7 0 3.15-.47 4.37-1.16M9.9 4.24A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a15.3 15.3 0 0 1-3.1 4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * A password `Input` with a show/hide toggle (Phase F).
 *
 * The toggle only changes the field's `type` — every other prop (value,
 * onChange, autoComplete, required, minLength, name) passes straight through
 * to `Input`/the underlying `<input>`, so nothing about validation or the
 * submitted value changes.
 */
export const PasswordField = forwardRef<HTMLInputElement, InputProps>((props, ref) => {
  const [visible, setVisible] = useState(false);

  return (
    <Input
      ref={ref}
      type={visible ? 'text' : 'password'}
      endAdornment={
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="flex h-full w-10 items-center justify-center rounded text-text-faint hover:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      }
      {...props}
    />
  );
});
PasswordField.displayName = 'PasswordField';
