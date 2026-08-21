import type { RefObject } from 'react';
import { Input } from '@leen-mart/ui';

export interface KycTextFormState {
  pan: string;
  gstin: string;
  accountNumber: string;
  ifsc: string;
}

export type KycTextFieldName = keyof KycTextFormState;

interface KycBusinessDetailsFieldsProps {
  readonly value: KycTextFormState;
  readonly onChange: (field: KycTextFieldName, value: string) => void;
  readonly onBlur: (field: KycTextFieldName) => void;
  readonly errorFor: (field: KycTextFieldName) => string | undefined;
  readonly panRef: RefObject<HTMLInputElement>;
}

/** The four text fields `submitVendorKycRequestSchema` requires — split out of `KycSubmissionForm` purely to keep it within this repository's function-length budget. */
export const KycBusinessDetailsFields = ({
  value,
  onChange,
  onBlur,
  errorFor,
  panRef,
}: KycBusinessDetailsFieldsProps): JSX.Element => (
  <div className="flex flex-col gap-4">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
      Business details
    </h2>
    <Input
      ref={panRef}
      label="PAN"
      required
      maxLength={10}
      autoComplete="off"
      value={value.pan}
      onChange={(event) => onChange('pan', event.target.value)}
      onBlur={() => onBlur('pan')}
      error={errorFor('pan')}
    />
    <Input
      label="GSTIN"
      required
      maxLength={15}
      autoComplete="off"
      value={value.gstin}
      onChange={(event) => onChange('gstin', event.target.value)}
      onBlur={() => onBlur('gstin')}
      error={errorFor('gstin')}
    />
    <Input
      label="Bank account number"
      required
      maxLength={34}
      autoComplete="off"
      value={value.accountNumber}
      onChange={(event) => onChange('accountNumber', event.target.value)}
      onBlur={() => onBlur('accountNumber')}
      error={errorFor('accountNumber')}
    />
    <Input
      label="IFSC code"
      required
      maxLength={11}
      autoComplete="off"
      value={value.ifsc}
      onChange={(event) => onChange('ifsc', event.target.value)}
      onBlur={() => onBlur('ifsc')}
      error={errorFor('ifsc')}
    />
  </div>
);
