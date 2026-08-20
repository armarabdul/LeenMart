import { useCallback, useEffect, useState } from 'react';
import {
  dequeueRedemption,
  enqueueRedemption,
  listQueuedRedemptions,
} from './offline-redemption-queue';
import { verifyPickupTokenLocally } from './pickup-local-verification';
import { useRedeemPickupTokenMutation } from './vendor-order.api';

export type QueueDrainOutcome = 'success' | 'conflict';

export interface OfflineRedemptionQueueState {
  readonly isOnline: boolean;
  /** True while a QR token has been verified locally and is waiting on connectivity to confirm. */
  readonly hasQueuedItems: boolean;
  /**
   * Verifies `token` locally and, only if that succeeds, queues it for the
   * next reconnect. Callers only reach this while offline — the ordinary
   * online path submits through `useRedeemPickupTokenMutation` directly,
   * unchanged (S4-QR-FALLBACK is additive, not a rewrite of that path).
   */
  readonly verifyAndQueue: (token: string) => Promise<{ readonly valid: boolean }>;
}

/**
 * The offline half of the QR redemption flow (S4-QR-FALLBACK). Drains the
 * local queue through the existing, authoritative
 * `POST /vendor/orders/pickup/redeem` endpoint — `queuedOffline: true`
 * marks each resubmission so the server can tell a genuinely offline
 * attempt apart from an ordinary retry (see `RedeemPickupTokenUseCase`'s own
 * doc comment) — on mount and whenever the browser regains connectivity.
 * Never a generic sync framework: this hook only ever touches pickup
 * redemption.
 */
export const useOfflineRedemptionQueue = (
  onDrainResult: (result: QueueDrainOutcome) => void,
): OfflineRedemptionQueueState => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [hasQueuedItems, setHasQueuedItems] = useState(() => listQueuedRedemptions().length > 0);
  const [redeemPickupToken] = useRedeemPickupTokenMutation();

  const drain = useCallback(async (): Promise<void> => {
    for (const item of listQueuedRedemptions()) {
      try {
        await redeemPickupToken({ token: item.token, queuedOffline: true }).unwrap();
        onDrainResult('success');
      } catch {
        // Already redeemed (online, or by another device) in the meantime —
        // a genuine conflict, not a transient failure worth retrying again.
        onDrainResult('conflict');
      }
      dequeueRedemption(item.token);
    }
    setHasQueuedItems(listQueuedRedemptions().length > 0);
  }, [redeemPickupToken, onDrainResult]);

  useEffect(() => {
    if (navigator.onLine) {
      void drain();
    }
    const handleOnline = (): void => {
      setIsOnline(true);
      void drain();
    };
    const handleOffline = (): void => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
    // Runs once on mount (plus on reconnect via the listener) — intentional,
    // see the inline reasoning above the effect body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verifyAndQueue = useCallback(async (token: string): Promise<{ valid: boolean }> => {
    const local = await verifyPickupTokenLocally(token);
    if (!local.valid) {
      return { valid: false };
    }
    enqueueRedemption(token);
    setHasQueuedItems(true);
    return { valid: true };
  }, []);

  return { isOnline, hasQueuedItems, verifyAndQueue };
};
