import { useState } from 'react';
import { MAX_IMAGES_PER_PRODUCT } from '@leen-mart/contracts';
import { Alert, Input } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import {
  useCreateMediaUploadIntentMutation,
  useCompleteMediaUploadMutation,
  useDeleteMediaMutation,
  useListMediaQuery,
} from '../vendor-product-media.api';
import { uploadProductMedia, validateMediaFile } from '../lib/upload-product-media';
import { MediaGallery } from './MediaGallery';

/**
 * A product's photos (S2-6a, Phase J) — plain presigned uploads, unlike KYC's
 * client-side-encrypted documents: product media is not sensitive personal
 * data, and `createProductMediaUploadIntentRequestSchema` carries no `dataKey`
 * at all. No reorder — the API exposes none.
 */
export const MediaSection = ({ productId }: { readonly productId: string }): JSX.Element => {
  const { data: media, isLoading, isError, error, refetch } = useListMediaQuery(productId);
  const [createUploadIntent] = useCreateMediaUploadIntentMutation();
  const [completeUpload] = useCompleteMediaUploadMutation();
  const [deleteMedia, { error: deleteError }] = useDeleteMediaMutation();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const atLimit = (media?.length ?? 0) >= MAX_IMAGES_PER_PRODUCT;

  const handleFileSelected = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setUploadError(null);

    const validationError = validateMediaFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setIsUploading(true);
    try {
      await uploadProductMedia({
        file,
        createUploadIntent: (body) => createUploadIntent({ productId, body }).unwrap(),
        completeUpload: (mediaId) => completeUpload({ productId, mediaId }).unwrap(),
      });
    } catch (thrown) {
      setUploadError(
        thrown instanceof Error && !(thrown as { data?: unknown }).data
          ? thrown.message
          : apiErrorMessage(thrown, 'This photo could not be uploaded.'),
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
        Photos ({media?.length ?? 0}/{MAX_IMAGES_PER_PRODUCT})
      </h2>

      <MediaGallery
        isLoading={isLoading}
        isError={isError}
        error={error}
        media={media}
        refetch={() => void refetch()}
        onDelete={(mediaId) => void deleteMedia({ productId, mediaId })}
        deleteError={deleteError}
      />

      <Input
        label={atLimit ? `You've reached the ${MAX_IMAGES_PER_PRODUCT}-photo limit` : 'Add a photo'}
        type="file"
        disabled={isUploading || atLimit}
        accept="image/jpeg,image/png,image/webp"
        hint="JPEG, PNG or WebP, up to 10 MB"
        onChange={(event) => void handleFileSelected(event.target.files?.[0])}
      />
      {isUploading && (
        <p role="status" className="text-sm text-text-muted">
          Uploading…
        </p>
      )}
      {uploadError !== null && <Alert tone="danger">{uploadError}</Alert>}
    </section>
  );
};
