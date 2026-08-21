import {
  PRODUCT_MEDIA_MAX_BYTES,
  productMediaContentTypeSchema,
  type CreateProductMediaUploadIntentResponse,
  type ProductMediaContentType,
} from '@leen-mart/contracts';

const ALLOWED_CONTENT_TYPES = productMediaContentTypeSchema.options;

/** `undefined` when the file is acceptable — a field-level message otherwise, so the caller never has to guess why an upload was refused. */
export const validateMediaFile = (file: File): string | undefined => {
  if (!ALLOWED_CONTENT_TYPES.includes(file.type as ProductMediaContentType)) {
    return 'Must be a JPEG, PNG or WebP image';
  }
  if (file.size > PRODUCT_MEDIA_MAX_BYTES) {
    return `Must be ${(PRODUCT_MEDIA_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB or smaller`;
  }
  return undefined;
};

/**
 * The full product-photo upload (S2-6a, Phase J): mint an upload intent, PUT
 * the plain file bytes (no client-side encryption — see `MediaSection`'s own
 * doc comment for why product media differs from KYC here), then mark it
 * complete. Kept outside the component so its own `handleFileSelected` stays
 * a thin wrapper around this.
 */
export const uploadProductMedia = async (params: {
  readonly file: File;
  readonly createUploadIntent: (arg: {
    contentType: ProductMediaContentType;
    sizeBytes: number;
  }) => Promise<CreateProductMediaUploadIntentResponse>;
  readonly completeUpload: (mediaId: string) => Promise<unknown>;
}): Promise<void> => {
  const { file, createUploadIntent, completeUpload } = params;
  const intent = await createUploadIntent({
    contentType: file.type as ProductMediaContentType,
    sizeBytes: file.size,
  });

  const uploadResponse = await fetch(intent.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': intent.contentType },
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Upload failed (${uploadResponse.status}).`);
  }

  await completeUpload(intent.mediaId);
};
