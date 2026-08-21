import { useRef, useState, type FormEvent } from 'react';
import {
  KYC_DOCUMENT_MAX_BYTES,
  kycDocumentContentTypeSchema,
  submitVendorKycRequestSchema,
  type KycDocumentTypeDto,
  type SubmitVendorKycRequest,
} from '@leen-mart/contracts';
import { Alert, Button } from '@leen-mart/ui';
import { apiErrorMessage, apiFieldErrors } from '@/shared/api/base-api';
import { validateWithSchema } from '@/shared/lib/validate-with-schema';
import { useCreateKycUploadIntentMutation, useSubmitKycMutation } from '../kyc.api';
import { ciphertextSizeBytes, KYC_ENCRYPTION_OVERHEAD_BYTES } from '../lib/kyc-document-crypto';
import { submitKycDocuments } from '../lib/submit-kyc-documents';
import { KYC_DOCUMENTS } from '../lib/kyc-documents';
import { KycBusinessDetailsFields, type KycTextFieldName } from './KycBusinessDetailsFields';
import { KycDocumentFields } from './KycDocumentFields';

const TEXT_FIELD_ORDER: readonly KycTextFieldName[] = ['pan', 'gstin', 'accountNumber', 'ifsc'];
const ALLOWED_CONTENT_TYPES = kycDocumentContentTypeSchema.options;
/** The cap applies to the *encrypted* upload; the plaintext file must leave room for the 28-byte IV+tag overhead. */
const MAX_PLAINTEXT_BYTES = KYC_DOCUMENT_MAX_BYTES - KYC_ENCRYPTION_OVERHEAD_BYTES;

const fileErrorFor = (file: File | null): string | undefined => {
  if (!file) return 'Choose a file';
  if (!ALLOWED_CONTENT_TYPES.includes(file.type as (typeof ALLOWED_CONTENT_TYPES)[number])) {
    return 'Must be a JPEG, PNG or PDF file';
  }
  if (file.size > MAX_PLAINTEXT_BYTES) {
    return `Must be ${(MAX_PLAINTEXT_BYTES / (1024 * 1024)).toFixed(0)} MB or smaller`;
  }
  return undefined;
};

type UploadPhase = 'idle' | 'requesting' | 'uploading' | 'finalising';
const PHASE_LABEL: Record<UploadPhase, string> = {
  idle: 'Submit for review',
  requesting: 'Preparing upload…',
  uploading: 'Uploading documents…',
  finalising: 'Finishing up…',
};

const schemaKeyFor = (field: KycTextFieldName): string =>
  field === 'accountNumber' || field === 'ifsc' ? `bankAccount.${field}` : field;

interface KycSubmissionFormProps {
  readonly vendorId: string;
  /** `true` once a submission already exists and this is a resubmission after rejection — changes only the heading copy. */
  readonly isResubmission: boolean;
}

/**
 * KYC document submission (SDD 12.2/12.3, Phase J). Encrypts each file
 * client-side with its own per-document key before uploading directly to the
 * presigned URL (`submit-kyc-documents.ts` owns the orchestration; this
 * component owns only form state and phase tracking).
 *
 * A fresh `createKycUploadIntent` call is minted on every submit attempt,
 * including a retry after a failure — simpler and safer than trying to
 * resume a partial upload, and the backend accepts as many intents as are
 * requested (only the *submission* actually advances the vendor's status).
 */
export const KycSubmissionForm = ({
  vendorId,
  isResubmission,
}: KycSubmissionFormProps): JSX.Element => {
  const [text, setText] = useState({ pan: '', gstin: '', accountNumber: '', ifsc: '' });
  const [touched, setTouched] = useState<Partial<Record<KycTextFieldName, boolean>>>({});
  const [files, setFiles] = useState<Record<KycDocumentTypeDto, File | null>>({
    PAN: null,
    GSTIN: null,
    BANK_ACCOUNT_PROOF: null,
  });
  const [filesTouched, setFilesTouched] = useState<Partial<Record<KycDocumentTypeDto, boolean>>>(
    {},
  );
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [createUploadIntent, { error: intentError }] = useCreateKycUploadIntentMutation();
  const [submitKyc, { error: submitKycError }] = useSubmitKycMutation();
  const isSubmitting = phase !== 'idle';
  const panRef = useRef<HTMLInputElement>(null);

  const localErrors = validateWithSchema(submitVendorKycRequestSchema, {
    // A placeholder — the real `kycId` is minted server-side by the
    // upload-intent call and does not exist yet at the point this form
    // validates its own text fields. It is never user-editable, so it can
    // never actually fail validation here.
    kycId: '00000000-0000-7000-8000-000000000000',
    pan: text.pan,
    gstin: text.gstin,
    bankAccount: { accountNumber: text.accountNumber, ifsc: text.ifsc },
    documents: [],
  } satisfies SubmitVendorKycRequest);
  const serverFieldErrors = apiFieldErrors(submitKycError);
  const textFieldError = (field: KycTextFieldName): string | undefined =>
    (touched[field] ? localErrors[schemaKeyFor(field)] : undefined) ??
    serverFieldErrors[schemaKeyFor(field)];
  const fileErrors: Record<KycDocumentTypeDto, string | undefined> = {
    PAN: fileErrorFor(files.PAN),
    GSTIN: fileErrorFor(files.GSTIN),
    BANK_ACCOUNT_PROOF: fileErrorFor(files.BANK_ACCOUNT_PROOF),
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) return;
    setSubmitError(null);
    setTouched({ pan: true, gstin: true, accountNumber: true, ifsc: true });
    setFilesTouched({ PAN: true, GSTIN: true, BANK_ACCOUNT_PROOF: true });

    const firstInvalidText = TEXT_FIELD_ORDER.find((field) => localErrors[schemaKeyFor(field)]);
    if (firstInvalidText) {
      panRef.current?.focus();
      return;
    }
    if (KYC_DOCUMENTS.some((document) => fileErrors[document.type])) return;

    try {
      await submitKycDocuments({
        vendorId,
        text,
        files: files as Record<KycDocumentTypeDto, File>,
        onPhaseChange: setPhase,
        createUploadIntent: (arg) => createUploadIntent(arg).unwrap(),
        submitKyc: (arg) => submitKyc(arg).unwrap(),
        documentSpecs: KYC_DOCUMENTS,
        ciphertextSizeBytes,
      });
    } catch (error) {
      setSubmitError(
        error instanceof Error && !(error as { data?: unknown }).data ? error.message : null,
      );
    } finally {
      setPhase('idle');
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6" noValidate>
      <KycBusinessDetailsFields
        value={text}
        onChange={(field, value) => setText((current) => ({ ...current, [field]: value }))}
        onBlur={(field) => setTouched((current) => ({ ...current, [field]: true }))}
        errorFor={textFieldError}
        panRef={panRef}
      />

      <KycDocumentFields
        onSelect={(type, file) => setFiles((current) => ({ ...current, [type]: file }))}
        onBlur={(type) => setFilesTouched((current) => ({ ...current, [type]: true }))}
        errorFor={(type) => (filesTouched[type] ? fileErrors[type] : undefined)}
      />

      {isSubmitting && (
        <p role="status" className="text-sm text-text-muted">
          {PHASE_LABEL[phase]}
        </p>
      )}
      {intentError !== undefined && (
        <Alert tone="danger">
          {apiErrorMessage(intentError, 'Your documents could not be prepared for upload.')}
        </Alert>
      )}
      {submitKycError !== undefined && Object.keys(serverFieldErrors).length === 0 && (
        <Alert tone="danger">
          {apiErrorMessage(submitKycError, 'Your KYC submission could not be saved.')}
        </Alert>
      )}
      {submitError !== null && <Alert tone="danger">{submitError}</Alert>}

      <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
        {isResubmission && phase === 'idle' ? 'Resubmit for review' : PHASE_LABEL[phase]}
      </Button>
    </form>
  );
};
