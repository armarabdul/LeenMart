import type {
  CreateKycUploadIntentRequest,
  CreateKycUploadIntentResponse,
  KycDocumentTypeDto,
  SubmitVendorKycRequest,
} from '@leen-mart/contracts';
import { encryptKycDocument } from './kyc-document-crypto';

export interface KycTextDetails {
  readonly pan: string;
  readonly gstin: string;
  readonly accountNumber: string;
  readonly ifsc: string;
}

/**
 * Uploads one already-encrypted document's bytes to its presigned URL.
 * Split out purely so the orchestration loop below reads as one step per
 * line rather than a nested nine-line nested block.
 */
const uploadOneDocument = async (
  uploadTarget: CreateKycUploadIntentResponse['documents'][number],
  file: File,
  vendorId: string,
  kycId: string,
): Promise<SubmitVendorKycRequest['documents'][number]> => {
  const encrypted = await encryptKycDocument(file, uploadTarget.dataKey, {
    vendorId,
    kycId,
    documentType: uploadTarget.type,
  });
  const response = await fetch(uploadTarget.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': uploadTarget.contentType },
    body: encrypted,
  });
  if (!response.ok) {
    throw new Error(`Uploading ${uploadTarget.type} failed (${response.status}).`);
  }
  return {
    type: uploadTarget.type,
    wrappedDataKey: uploadTarget.wrappedDataKey,
    contentType: uploadTarget.contentType,
    sizeBytes: uploadTarget.sizeBytes,
  };
};

/**
 * The full KYC submission orchestration (Phase J): mint an upload intent,
 * encrypt and PUT each of the three documents in turn, then submit. Kept as
 * a plain function outside the component so `KycSubmissionForm`'s own
 * `handleSubmit` stays a thin phase-tracking wrapper around it.
 */
export const submitKycDocuments = async (params: {
  readonly vendorId: string;
  readonly text: KycTextDetails;
  readonly files: Readonly<Record<KycDocumentTypeDto, File>>;
  readonly onPhaseChange: (phase: 'requesting' | 'uploading' | 'finalising') => void;
  readonly createUploadIntent: (
    arg: CreateKycUploadIntentRequest,
  ) => Promise<CreateKycUploadIntentResponse>;
  readonly submitKyc: (arg: SubmitVendorKycRequest) => Promise<unknown>;
  readonly documentSpecs: readonly { readonly type: KycDocumentTypeDto }[];
  readonly ciphertextSizeBytes: (plaintextSizeBytes: number) => number;
}): Promise<void> => {
  const { vendorId, text, files, onPhaseChange, createUploadIntent, submitKyc, documentSpecs } =
    params;

  onPhaseChange('requesting');
  const intent = await createUploadIntent({
    documents: documentSpecs.map((spec) => ({
      type: spec.type,
      // Cast, not re-validated: the form already refuses to submit unless
      // `fileErrorFor` has confirmed this file's MIME type is one of the
      // three the schema allows — `File.type` itself is always a bare
      // `string` in the DOM lib, with no way to narrow it further here.
      contentType: files[spec.type]
        .type as CreateKycUploadIntentRequest['documents'][number]['contentType'],
      sizeBytes: params.ciphertextSizeBytes(files[spec.type].size),
    })),
  });

  onPhaseChange('uploading');
  const submissionDocuments: SubmitVendorKycRequest['documents'] = [];
  for (const uploadTarget of intent.documents) {
    // Sequential, not `Promise.all`: uploads share one `kycId`, and the
    // server rejects a submission with a mismatched size or a document it
    // never received a PUT for, so each must finish before the next starts.
    const submitted = await uploadOneDocument(
      uploadTarget,
      files[uploadTarget.type],
      vendorId,
      intent.kycId,
    );
    submissionDocuments.push(submitted);
  }

  onPhaseChange('finalising');
  await submitKyc({
    kycId: intent.kycId,
    pan: text.pan,
    gstin: text.gstin,
    bankAccount: { accountNumber: text.accountNumber, ifsc: text.ifsc },
    documents: submissionDocuments,
  });
};
