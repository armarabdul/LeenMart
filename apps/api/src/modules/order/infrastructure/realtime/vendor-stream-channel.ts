import { toVendorId, type VendorId } from '../../../identity/index.js';

/** The one fixed Redis pub/sub channel this feature uses — no channel-per-vendor churn as connections open/close. */
export const VENDOR_STREAM_CHANNEL = 'sse:order-placed';

/** The message the worker's outbox handler publishes and the API's subscriber parses. */
export interface VendorStreamMessage {
  readonly vendorId: VendorId;
  readonly orderId: string;
  readonly occurredAt: string;
}

export const encodeVendorStreamMessage = (message: VendorStreamMessage): string =>
  JSON.stringify(message);

/** `null` for anything malformed — the subscriber logs and drops it rather than throwing out of an ioredis event handler. */
export const decodeVendorStreamMessage = (raw: string): VendorStreamMessage | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).vendorId !== 'string' ||
      typeof (parsed as Record<string, unknown>).orderId !== 'string' ||
      typeof (parsed as Record<string, unknown>).occurredAt !== 'string'
    ) {
      return null;
    }
    const candidate = parsed as { vendorId: string; orderId: string; occurredAt: string };
    return {
      vendorId: toVendorId(candidate.vendorId),
      orderId: candidate.orderId,
      occurredAt: candidate.occurredAt,
    };
  } catch {
    return null;
  }
};
