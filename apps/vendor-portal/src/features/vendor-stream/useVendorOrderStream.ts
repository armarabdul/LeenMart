import { useCallback, useEffect, useState } from 'react';
import { useAppSelector } from '@/app/hooks';
import { selectAccessToken, selectIsAuthenticated } from '@/shared/api/session.slice';
import { env } from '@/shared/config/env';
import { extractSseFrames } from './parse-sse';

/**
 * Mirrors `EventSource`'s own default reconnect delay (~3s) — a fixed
 * delay, not a custom backoff/heartbeat protocol, per the locked design
 * ("do not invent server-side replay or persistence").
 */
export const RECONNECT_DELAY_MS = 3_000;

export interface VendorOrderStreamState {
  readonly isAlerting: boolean;
  readonly acknowledge: () => void;
}

/**
 * Connects to `GET /api/v1/vendor/stream` and raises `isAlerting` on every
 * `order.placed` frame (S4-SSE).
 *
 * **`fetch()`, not `EventSource`** (locked decision N-1): native
 * `EventSource` cannot attach an `Authorization` header, and this app's
 * entire session model is bearer-token-in-header (`base-api.ts`'s own
 * `prepareHeaders`) with no cookie-session fallback to fall back on. The
 * wire format is still plain, standard SSE framing — `extractSseFrames` is
 * the client-side mirror of the server's own frame writer, nothing custom.
 *
 * **No persistent acknowledgement state.** `isAlerting` is component state
 * alone; a page reload loses it, and a reconnect after a network blip does
 * not clear or re-trigger it on its own — only a fresh `order.placed` frame,
 * or the user's own `acknowledge()`, changes it.
 */
export const useVendorOrderStream = (): VendorOrderStreamState => {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const accessToken = useAppSelector(selectAccessToken);
  const [isAlerting, setIsAlerting] = useState(false);

  const acknowledge = useCallback((): void => setIsAlerting(false), []);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return undefined;

    const controller = new AbortController();
    let stopped = false;

    const readStream = async (): Promise<void> => {
      const response = await fetch(`${env.apiBaseUrl}/vendor/stream`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      const body = response.body;
      if (!response.ok || !body) {
        throw new Error(`Vendor stream connection failed with status ${response.status}`);
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });

        const { frames, remainder } = extractSseFrames(buffer);
        buffer = remainder;
        if (frames.some((frame) => frame.type === 'order.placed')) {
          setIsAlerting(true);
        }
      }
    };

    // The reconnect loop: a dropped or ended stream simply reconnects after
    // a fixed delay, matching `EventSource`'s own default behaviour — no
    // replay, no resumption, no persisted cursor.
    const connectWithReconnect = async (): Promise<void> => {
      while (!stopped) {
        try {
          await readStream();
        } catch {
          if (controller.signal.aborted) return;
        }
        if (stopped) return;
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
      }
    };

    void connectWithReconnect();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [isAuthenticated, accessToken]);

  return { isAlerting, acknowledge };
};
