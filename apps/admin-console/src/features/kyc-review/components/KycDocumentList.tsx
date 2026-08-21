import type { AdminKycDocument } from '@leen-mart/contracts';
import { Badge } from '@leen-mart/ui';

const DOCUMENT_LABEL: Record<AdminKycDocument['type'], string> = {
  PAN: 'PAN card',
  GSTIN: 'GSTIN certificate',
  BANK_ACCOUNT_PROOF: 'Bank account proof',
};

/**
 * One document row (Phase L, L4).
 *
 * **No "View document" action here, and that is a discovered backend/contract
 * gap, not an oversight.** `GET /admin/kyc/submissions/:kycId/documents/:documentId`
 * requires `documentId` to be the document's own UUID
 * (`kycDocumentParamsSchema` in `admin-kyc.routes.ts`), but the read model
 * this list renders from — `adminKycDocumentSchema`
 * (`packages/contracts/src/vendor/kyc-review.contract.ts`) — carries only
 * `type`/`contentType`/`sizeBytes`/`status`/`uploadedAt`, never an `id`.
 * There is no value available anywhere on the admin-facing submission
 * detail response this screen could pass as `documentId` without
 * fabricating one, and fabricating a UUID to satisfy a schema is exactly
 * the kind of invented behaviour this phase is instructed not to produce.
 * `useAccessKycDocumentMutation` (`kyc-review.api.ts`) is still wired
 * correctly against the real contract and route, ready to use the moment
 * the read model exposes a real document id.
 */
const DocumentRow = ({ document }: { readonly document: AdminKycDocument }): JSX.Element => (
  <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3">
    <div>
      <p className="text-sm font-medium text-text">{DOCUMENT_LABEL[document.type]}</p>
      <p className="text-xs text-text-muted">
        {document.contentType} · {(document.sizeBytes / 1024).toFixed(0)} KB
      </p>
    </div>
    <Badge tone={document.status === 'UPLOADED' ? 'success' : 'neutral'}>
      {document.status === 'UPLOADED' ? 'Uploaded' : 'Awaiting upload'}
    </Badge>
  </li>
);

export const KycDocumentList = ({
  documents,
}: {
  readonly documents: readonly AdminKycDocument[];
}): JSX.Element => (
  <div className="flex flex-col gap-2">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Documents</h2>
    <ul className="flex flex-col gap-2">
      {documents.map((document) => (
        <DocumentRow key={document.type} document={document} />
      ))}
    </ul>
  </div>
);
