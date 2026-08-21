import type { VendorProductMediaListResponse } from '@leen-mart/contracts';
import { Alert, Button } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { MediaList } from './MediaList';

const hasLoadError = (isLoading: boolean, isError: boolean, media: unknown): boolean =>
  !isLoading && (isError || !media);
const hasMedia = (isLoading: boolean, media: VendorProductMediaListResponse | undefined): boolean =>
  !isLoading && !!media && media.length > 0;

interface MediaGalleryProps {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly media: VendorProductMediaListResponse | undefined;
  readonly refetch: () => void;
  readonly onDelete: (mediaId: string) => void;
  readonly deleteError: unknown;
}

/** The loading/error/list states for a product's photos — split out of `MediaSection` purely to keep it within this repository's complexity budget. */
export const MediaGallery = ({
  isLoading,
  isError,
  error,
  media,
  refetch,
  onDelete,
  deleteError,
}: MediaGalleryProps): JSX.Element => (
  <>
    {isLoading && <p className="text-sm text-text-muted">Loading photos…</p>}

    {hasLoadError(isLoading, isError, media) && (
      <div className="flex flex-col gap-2">
        <Alert tone="danger">{apiErrorMessage(error, 'Photos could not be loaded.')}</Alert>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={refetch}
          className="self-start"
        >
          Try again
        </Button>
      </div>
    )}

    {hasMedia(isLoading, media) && media && <MediaList media={media} onDelete={onDelete} />}

    {deleteError !== undefined && (
      <Alert tone="danger">
        {apiErrorMessage(deleteError, 'This photo could not be removed.')}
      </Alert>
    )}
  </>
);
