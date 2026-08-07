import { describe, expect, it } from 'vitest';
import { createStore } from '@/app/store';
import { baseApi } from '@/shared/api/base-api';
import { apiErrorMessage, isApiError } from '@/shared/api/base-api';

describe('store', () => {
  it('mounts the API reducer', () => {
    const store = createStore();
    expect(store.getState()).toHaveProperty(baseApi.reducerPath);
  });

  it('creates isolated stores so tests cannot leak state into each other', () => {
    expect(createStore()).not.toBe(createStore());
  });
});

describe('API error helpers', () => {
  const envelope = {
    status: 409,
    data: {
      error: {
        code: 'PREORDER_SOLD_OUT',
        message: 'This preorder is no longer available.',
        requestId: 'req-1',
        timestamp: '2026-08-07T06:00:00.000Z',
      },
    },
  };

  it('recognises the platform error envelope', () => {
    expect(isApiError(envelope)).toBe(true);
    expect(isApiError({ status: 500 })).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError('boom')).toBe(false);
  });

  it('extracts the user-facing message', () => {
    expect(apiErrorMessage(envelope)).toBe('This preorder is no longer available.');
  });

  it('falls back when the error is not from our API', () => {
    expect(apiErrorMessage(new Error('network'), 'Offline')).toBe('Offline');
  });
});
