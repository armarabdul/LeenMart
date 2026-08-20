import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import {
  decodeVendorStreamMessage,
  encodeVendorStreamMessage,
} from '../../../../../src/modules/order/infrastructure/realtime/vendor-stream-channel.js';

const ids = new UuidV7Generator();

describe('vendor-stream-channel encode/decode', () => {
  it('round-trips a well-formed message', () => {
    const vendorId = toVendorId(ids.generate());
    const message = { vendorId, orderId: ids.generate(), occurredAt: '2026-08-20T00:00:00.000Z' };

    const decoded = decodeVendorStreamMessage(encodeVendorStreamMessage(message));

    expect(decoded).toEqual(message);
  });

  it('returns null for invalid JSON rather than throwing', () => {
    expect(decodeVendorStreamMessage('not json')).toBeNull();
  });

  it('returns null for well-formed JSON missing a required field', () => {
    expect(decodeVendorStreamMessage(JSON.stringify({ vendorId: 'x', orderId: 'y' }))).toBeNull();
  });

  it('returns null for a non-object JSON value', () => {
    expect(decodeVendorStreamMessage('42')).toBeNull();
    expect(decodeVendorStreamMessage('null')).toBeNull();
    expect(decodeVendorStreamMessage('"a string"')).toBeNull();
  });
});
