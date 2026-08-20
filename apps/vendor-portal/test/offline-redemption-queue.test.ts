import { afterEach, describe, expect, it } from 'vitest';
import {
  dequeueRedemption,
  enqueueRedemption,
  listQueuedRedemptions,
} from '@/features/vendor-order/offline-redemption-queue';

describe('offline redemption queue (S4-QR-FALLBACK)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    expect(listQueuedRedemptions()).toEqual([]);
  });

  it('enqueues a token', () => {
    enqueueRedemption('token-1');

    const queued = listQueuedRedemptions();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.token).toBe('token-1');
  });

  it('does not enqueue the same token twice', () => {
    enqueueRedemption('token-1');
    enqueueRedemption('token-1');

    expect(listQueuedRedemptions()).toHaveLength(1);
  });

  it('queues multiple distinct tokens', () => {
    enqueueRedemption('token-1');
    enqueueRedemption('token-2');

    expect(
      listQueuedRedemptions()
        .map((item) => item.token)
        .sort(),
    ).toEqual(['token-1', 'token-2']);
  });

  it('dequeues exactly the named token', () => {
    enqueueRedemption('token-1');
    enqueueRedemption('token-2');

    dequeueRedemption('token-1');

    const queued = listQueuedRedemptions();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.token).toBe('token-2');
  });

  it('dequeuing an item not present is a no-op', () => {
    enqueueRedemption('token-1');

    expect(() => dequeueRedemption('never-queued')).not.toThrow();
    expect(listQueuedRedemptions()).toHaveLength(1);
  });

  it('persists across a fresh read (simulating a page reload)', () => {
    enqueueRedemption('token-1');

    // `listQueuedRedemptions` always re-reads `localStorage` rather than
    // caching in memory, so this is exactly what a reload would see.
    expect(listQueuedRedemptions()).toHaveLength(1);
  });

  it('degrades to an empty list rather than throwing on corrupted storage', () => {
    localStorage.setItem('leenmart:vendor-portal:offline-pickup-queue', 'not json');

    expect(listQueuedRedemptions()).toEqual([]);
  });
});
