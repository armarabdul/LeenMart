import { useState } from 'react';
import { apiErrorMessage } from '@/shared/api/base-api';
import { ORDER_STATUS_LABEL } from '@/shared/lib/order-status-label';
import { useRedeemPickupTokenMutation } from '@/features/vendor-order/vendor-order.api';

/**
 * "Redeem pickup" (S4-QR, SDD §13.2). The vendor scans the customer's QR
 * code and submits its raw payload; the backend verifies the signature,
 * expiry, audience and nonce, then atomically redeems it.
 *
 * The field is a plain text input rather than a camera scanner on purpose:
 * every hardware scanner and phone camera app produces the same string, and
 * S4-QR's scope is the *security* of redemption, not the capture device. A
 * scanner can be dropped in later behind the same submit.
 *
 * Nothing here interprets *why* a token failed — the backend deliberately
 * returns one uniform error for forged, expired, rotated, wrong-vendor and
 * unknown tokens (SEC-15), and this page shows exactly that message rather
 * than guessing a more specific one.
 */
export const RedeemPickupPage = (): JSX.Element => {
  const [token, setToken] = useState('');
  const [redeemPickupToken, { isLoading, error, data, reset }] = useRedeemPickupTokenMutation();
  const [hasErrored, setHasErrored] = useState(false);

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setHasErrored(false);
    try {
      await redeemPickupToken({ token: token.trim() }).unwrap();
      setToken('');
    } catch {
      setHasErrored(true);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Redeem pickup</h1>
        <p className="text-sm text-slate-600">
          Scan the customer&rsquo;s QR code, or paste its contents below, to complete the pickup.
        </p>
      </header>

      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3">
        <label htmlFor="pickup-token" className="text-sm font-medium text-slate-700">
          Pickup code
        </label>
        <textarea
          id="pickup-token"
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            if (hasErrored) setHasErrored(false);
            if (data) reset();
          }}
          rows={3}
          className="w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
          placeholder="Paste the scanned pickup code"
        />
        <button
          type="submit"
          disabled={isLoading || token.trim().length === 0}
          className="self-end rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {isLoading ? 'Redeeming…' : 'Redeem pickup'}
        </button>
      </form>

      {hasErrored && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {apiErrorMessage(error, 'This pickup code could not be redeemed.')}
        </p>
      )}

      {data && (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
        >
          <p className="font-medium">Pickup completed</p>
          <p className="mt-1">
            Order {data.id} is now {ORDER_STATUS_LABEL[data.status]}.
          </p>
        </div>
      )}
    </main>
  );
};
