import type { KycDocumentTypeDto } from '@leen-mart/contracts';
import { Input } from '@leen-mart/ui';
import { KYC_DOCUMENTS } from '../lib/kyc-documents';

interface KycDocumentFieldsProps {
  readonly onSelect: (type: KycDocumentTypeDto, file: File | null) => void;
  readonly onBlur: (type: KycDocumentTypeDto) => void;
  readonly errorFor: (type: KycDocumentTypeDto) => string | undefined;
}

/** The three document uploads — split out of `KycSubmissionForm` purely to keep it within this repository's function-length budget. */
export const KycDocumentFields = ({
  onSelect,
  onBlur,
  errorFor,
}: KycDocumentFieldsProps): JSX.Element => (
  <div className="flex flex-col gap-4">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Documents</h2>
    {KYC_DOCUMENTS.map((document) => (
      <Input
        key={document.type}
        label={document.label}
        type="file"
        required
        accept="image/jpeg,image/png,application/pdf"
        onChange={(event) => onSelect(document.type, event.target.files?.[0] ?? null)}
        onBlur={() => onBlur(document.type)}
        error={errorFor(document.type)}
        hint="JPEG, PNG or PDF, up to 10 MB"
      />
    ))}
  </div>
);
