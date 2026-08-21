import type { VendorProductMediaListResponse } from '@leen-mart/contracts';
import { Badge, Button } from '@leen-mart/ui';

const MEDIA_STATUS_LABEL: Record<string, string> = {
  AWAITING_UPLOAD: 'Uploading…',
  PROCESSING: 'Processing…',
  READY: 'Ready',
  FAILED: 'Failed',
};

const toneFor = (status: string): 'success' | 'danger' | 'neutral' => {
  if (status === 'READY') return 'success';
  if (status === 'FAILED') return 'danger';
  return 'neutral';
};

/** The uploaded-photo list — split out of `MediaSection` purely to keep it within this repository's function-length budget. */
export const MediaList = ({
  media,
  onDelete,
}: {
  readonly media: VendorProductMediaListResponse;
  readonly onDelete: (mediaId: string) => void;
}): JSX.Element => (
  <ul className="flex flex-col gap-2">
    {media.map((item) => (
      <li
        key={item.id}
        className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-3"
      >
        <div className="flex items-center gap-2">
          <Badge tone={toneFor(item.status)}>
            {MEDIA_STATUS_LABEL[item.status] ?? item.status}
          </Badge>
          <span className="text-xs text-text-muted">{item.contentType}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-danger hover:bg-danger/10"
          onClick={() => onDelete(item.id)}
        >
          Delete
        </Button>
      </li>
    ))}
  </ul>
);
