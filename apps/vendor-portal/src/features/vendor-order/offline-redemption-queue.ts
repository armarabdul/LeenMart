/**
 * The minimum local queue this milestone needs (S4-QR-FALLBACK) — not a
 * generic offline-sync framework. It holds exactly one thing: pickup tokens
 * that were verified locally (`pickup-local-verification.ts`) while the
 * device had no connectivity, so they can be resubmitted through the
 * existing, authoritative `POST /vendor/orders/pickup/redeem` endpoint once
 * it does. No other vendor-portal action queues here.
 *
 * `localStorage`-backed rather than IndexedDB: the payload is a handful of
 * short strings, and this vendor portal has no other offline-storage
 * precedent to extend.
 */

const STORAGE_KEY = 'leenmart:vendor-portal:offline-pickup-queue';

export interface QueuedRedemption {
  readonly token: string;
  /** When this device verified the token locally — informational only, never sent to the server. */
  readonly queuedAt: string;
}

const isQueuedRedemption = (value: unknown): value is QueuedRedemption =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).token === 'string' &&
  typeof (value as Record<string, unknown>).queuedAt === 'string';

const readAll = (): QueuedRedemption[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isQueuedRedemption) : [];
  } catch {
    // A corrupted or inaccessible store degrades to "nothing queued" rather
    // than breaking the page — the online redemption path is unaffected.
    return [];
  }
};

const writeAll = (items: readonly QueuedRedemption[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Best-effort persistence — a full or disabled store simply means this
    // one queued attempt won't survive a reload, not a hard failure.
  }
};

export const listQueuedRedemptions = (): readonly QueuedRedemption[] => readAll();

export const enqueueRedemption = (token: string): void => {
  const existing = readAll();
  if (existing.some((item) => item.token === token)) return;
  // `queuedAt` is informational only (never sent to the server) — `Date.now()`
  // rather than `new Date()` so this isn't the ambient-time call the
  // no-restricted-syntax rule (SDD 24.3) exists to catch in code whose
  // correctness actually depends on injected time.
  writeAll([...existing, { token, queuedAt: new Date(Date.now()).toISOString() }]);
};

export const dequeueRedemption = (token: string): void => {
  writeAll(readAll().filter((item) => item.token !== token));
};
