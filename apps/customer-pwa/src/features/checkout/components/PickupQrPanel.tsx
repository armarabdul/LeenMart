import { useEffect } from 'react';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useGetPickupTokenQuery } from '../checkout.api';

interface PickupQrPanelProps {
  readonly orderId: string;
  readonly subOrderId: string;
}

/** Re-fetch this far before the server's own expiry, so a customer is never shown a QR that has just died in their hand. */
const REFRESH_MARGIN_MS = 10_000;
/** Never poll faster than this, whatever the server's TTL, so a stuck clock cannot turn into a request loop. */
const MIN_REFRESH_MS = 5_000;

/**
 * The customer's pickup QR (S4-QR, SDD §13).
 *
 * The token is short-lived and single-use, and **every fetch rotates it** —
 * so this schedules its own re-fetch from the `expiresAt` the server
 * returns rather than guessing a TTL or polling on a fixed interval. That
 * keeps the displayed credential valid without ever holding a stale one.
 *
 * The token string is rendered as text rather than an actual QR bitmap:
 * S4-QR's scope is the *security* of issuance and redemption, and adding a
 * QR-rendering dependency is not needed to prove it — the vendor portal
 * accepts the same string a scanner would produce. A rendering library can
 * be dropped in here later without touching anything else.
 */
export const PickupQrPanel = ({ orderId, subOrderId }: PickupQrPanelProps): JSX.Element => {
  const { data, isLoading, isError, error, refetch, fulfilledTimeStamp } = useGetPickupTokenQuery({
    orderId,
    subOrderId,
  });

  const expiresAt = data?.expiresAt;

  /**
   * Re-armed on `fulfilledTimeStamp` rather than on the computed delay.
   *
   * Each rotation lands roughly a full TTL in the future, so the delay is
   * numerically the *same* from one token to the next; keying the effect on it
   * meant a rotation often did not re-run the effect at all, leaving no timer
   * armed and the customer holding a code that quietly expired. Only
   * millisecond jitter between renders hid it. `fulfilledTimeStamp` changes on
   * every fulfilled fetch — including one that somehow returned an identical
   * payload — so exactly one timer is armed per completed fetch.
   */
  useEffect(() => {
    if (expiresAt === undefined) return undefined;
    const remaining = new Date(expiresAt).getTime() - Date.now();
    const refreshInMs = Math.max(remaining - REFRESH_MARGIN_MS, MIN_REFRESH_MS);
    const timer = setTimeout(() => void refetch(), refreshInMs);
    return () => clearTimeout(timer);
  }, [expiresAt, fulfilledTimeStamp, refetch]);

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-brand-200 bg-brand-50 p-3">
      <p className="text-sm font-medium text-brand-900">Ready for pickup</p>
      <p className="text-sm text-brand-800">
        Show this code at the shop. It refreshes automatically and can be used once.
      </p>

      {isLoading && <p className="text-sm text-slate-600">Preparing your pickup code…</p>}

      {isError && (
        <p role="alert" className="text-sm text-red-700">
          {apiErrorMessage(error, 'Your pickup code could not be loaded. Please try again.')}
        </p>
      )}

      {/* RTK Query keeps the last successful `data` alongside an error, so the
          error state must suppress it explicitly. Once the pickup completes
          the backend stops issuing tokens, and the retained code is spent —
          showing it under "not available" would invite a customer to present
          a QR that cannot work. */}
      {data && !isError && (
        <output
          aria-label="Pickup code"
          className="block break-all rounded border border-brand-300 bg-white p-2 font-mono text-xs text-slate-800"
        >
          {data.token}
        </output>
      )}
    </div>
  );
};
