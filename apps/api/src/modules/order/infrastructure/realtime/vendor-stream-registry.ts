import type { Response } from 'express';
import type { VendorId } from '../../../identity/index.js';

/** One SSE frame — `type` becomes the wire `event:` field, `data` is JSON-encoded onto the `data:` field. */
export interface VendorStreamEvent {
  readonly type: string;
  readonly data: unknown;
}

const writeFrame = (res: Response, event: VendorStreamEvent): void => {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
};

/**
 * Holds every open `/api/v1/vendor/stream` connection this API process is
 * currently serving, keyed by `VendorId` (S4-SSE, locked decision N-4 —
 * vendor-scoped, not owner-scoped: every connected `VENDOR_OWNER`/
 * `VENDOR_MANAGER`/`VENDOR_STAFF` session for a vendor is a member of that
 * vendor's set, so a manager's or a second tab's connection receives the
 * alert exactly like the owner's).
 *
 * **Deliberately in-memory and per-process.** SSE connections are ephemeral
 * by nature — a process restart drops them and the browser's own reconnect
 * loop re-establishes and re-registers, which is the whole of this
 * component's recovery story (locked scope: no persistent state, no replay).
 * Horizontal scaling falls out of this for free without being asked for:
 * each API replica holds only the connections it is actually serving, and
 * `RedisVendorStreamSubscriber` fans the same message out to every replica,
 * so a vendor's alert reaches them regardless of which replica their
 * connection landed on.
 */
export class VendorStreamRegistry {
  private readonly connectionsByVendor = new Map<VendorId, Set<Response>>();

  /**
   * Adds `res` to `vendorId`'s set. Returns a closure that removes it again
   * and, if that was the last connection for this vendor, deletes the map
   * entry entirely — a `Map` that only ever grows as vendors connect once
   * and never return is a slow leak, not a smaller one.
   */
  register(vendorId: VendorId, res: Response): () => void {
    const existing = this.connectionsByVendor.get(vendorId);
    if (existing) {
      existing.add(res);
    } else {
      this.connectionsByVendor.set(vendorId, new Set([res]));
    }

    return (): void => {
      const connections = this.connectionsByVendor.get(vendorId);
      if (!connections) return;
      connections.delete(res);
      if (connections.size === 0) {
        this.connectionsByVendor.delete(vendorId);
      }
    };
  }

  /** Writes `event` to every connection currently registered for `vendorId` — a no-op if none are open. */
  publishLocal(vendorId: VendorId, event: VendorStreamEvent): void {
    const connections = this.connectionsByVendor.get(vendorId);
    if (!connections) return;
    for (const res of connections) {
      writeFrame(res, event);
    }
  }

  /** For tests and diagnostics — never used to drive delivery decisions. */
  connectionCountFor(vendorId: VendorId): number {
    return this.connectionsByVendor.get(vendorId)?.size ?? 0;
  }

  /** For tests only — proves an empty vendor entry does not linger in the map. */
  hasVendor(vendorId: VendorId): boolean {
    return this.connectionsByVendor.has(vendorId);
  }
}
