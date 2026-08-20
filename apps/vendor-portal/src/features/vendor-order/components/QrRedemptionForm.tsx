import { useCallback, useState } from 'react';
import { apiErrorMessage } from '@/shared/api/base-api';
import { ORDER_STATUS_LABEL } from '@/shared/lib/order-status-label';
import { useRedeemPickupTokenMutation } from '../vendor-order.api';
import type { QueueDrainOutcome } from '../use-offline-redemption-queue';
import { useOfflineRedemptionQueue } from '../use-offline-redemption-queue';
import { OfflineQueueBanners } from './OfflineQueueBanners';

type QueueOutcome = 'invalid-locally' | 'queued';

/**
 * The QR half of "Redeem pickup" (S4-QR, extended S4-QR-FALLBACK). Online
 * behaviour is exactly what it was before this milestone: paste the token,
 * submit, see the result. Offline, the same textarea instead verifies the
 * token locally and queues it — `useOfflineRedemptionQueue` owns the queue
 * itself and drains it automatically on reconnect.
 */
export const QrRedemptionForm = (): JSX.Element => {
  const [token, setToken] = useState('');
  const [queueOutcome, setQueueOutcome] = useState<QueueOutcome | null>(null);
  const [drainBanner, setDrainBanner] = useState<QueueDrainOutcome | null>(null);

  const [redeemPickupToken, redeemState] = useRedeemPickupTokenMutation();
  const handleDrainResult = useCallback((result: QueueDrainOutcome) => {
    setDrainBanner(result);
  }, []);
  const { isOnline, hasQueuedItems, verifyAndQueue } = useOfflineRedemptionQueue(handleDrainResult);

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setQueueOutcome(null);
    if (redeemState.data) redeemState.reset();

    if (!isOnline) {
      const local = await verifyAndQueue(token.trim());
      setQueueOutcome(local.valid ? 'queued' : 'invalid-locally');
      if (local.valid) setToken('');
      return;
    }

    try {
      await redeemPickupToken({ token: token.trim() }).unwrap();
      setToken('');
    } catch {
      // The mutation's own `error` state renders the message below.
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <OfflineQueueBanners
        isOnline={isOnline}
        hasQueuedItems={hasQueuedItems}
        drainBanner={drainBanner}
      />

      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3">
        <label htmlFor="pickup-token" className="text-sm font-medium text-slate-700">
          Pickup code
        </label>
        <textarea
          id="pickup-token"
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            setQueueOutcome(null);
            if (redeemState.data) redeemState.reset();
          }}
          rows={3}
          className="w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
          placeholder="Paste the scanned pickup code"
        />
        <button
          type="submit"
          disabled={redeemState.isLoading || token.trim().length === 0}
          className="self-end rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {redeemState.isLoading ? 'Redeeming…' : 'Redeem pickup'}
        </button>
      </form>

      {queueOutcome === 'queued' && (
        <p role="status" className="text-sm text-amber-800">
          Verified locally — this device is offline, so it&rsquo;s queued and will be confirmed
          automatically once you&rsquo;re back online. Server confirmation is still pending.
        </p>
      )}
      {queueOutcome === 'invalid-locally' && (
        <p role="alert" className="text-sm text-red-700">
          This pickup code could not be verified on this device.
        </p>
      )}

      {redeemState.error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {apiErrorMessage(redeemState.error, 'This pickup code could not be redeemed.')}
        </p>
      )}

      {redeemState.data && (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
        >
          <p className="font-medium">Pickup completed</p>
          <p className="mt-1">
            Order {redeemState.data.id} is now {ORDER_STATUS_LABEL[redeemState.data.status]}.
          </p>
        </div>
      )}
    </div>
  );
};
