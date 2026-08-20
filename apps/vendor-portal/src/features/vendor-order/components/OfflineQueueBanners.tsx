import type { QueueDrainOutcome } from '../use-offline-redemption-queue';

interface OfflineQueueBannersProps {
  readonly isOnline: boolean;
  readonly hasQueuedItems: boolean;
  readonly drainBanner: QueueDrainOutcome | null;
}

/** The connectivity/queue status banners for `QrRedemptionForm` — split out purely to keep that component's complexity under budget. */
export const OfflineQueueBanners = ({
  isOnline,
  hasQueuedItems,
  drainBanner,
}: OfflineQueueBannersProps): JSX.Element => (
  <>
    {!isOnline && (
      <p
        role="status"
        className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
      >
        You&rsquo;re offline. A scanned code will be verified on this device and confirmed
        automatically once you&rsquo;re back online.
      </p>
    )}

    {hasQueuedItems && (
      <p
        role="status"
        className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
      >
        A pickup is waiting to be confirmed once you&rsquo;re back online.
      </p>
    )}

    {drainBanner === 'success' && (
      <p
        role="status"
        className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
      >
        A queued pickup was confirmed.
      </p>
    )}
    {drainBanner === 'conflict' && (
      <p
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      >
        A queued pickup could not be confirmed automatically — it may have already been completed
        another way. Please check this order before telling the customer it&rsquo;s done.
      </p>
    )}
  </>
);
