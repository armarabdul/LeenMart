import { describe, expect, it } from 'vitest';
import type { AuthSessionResponse } from '@leen-mart/contracts';
import { sessionCleared, sessionEstablished, sessionReducer } from '@/shared/api/session.slice';

const session: AuthSessionResponse = {
  user: {
    id: '00000000-0000-7000-8000-000000000001',
    email: 'shopper@example.com',
    role: 'CUSTOMER',
  },
  accessToken: 'access-token',
  accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: '2026-01-31T00:00:00.000Z',
};

describe('session reducer', () => {
  it('starts with no session', () => {
    const state = sessionReducer(undefined, { type: '@@INIT' });
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
  });

  it('stores the full session on sessionEstablished', () => {
    const state = sessionReducer(undefined, sessionEstablished(session));
    expect(state.user).toEqual(session.user);
    expect(state.accessToken).toBe('access-token');
    expect(state.refreshToken).toBe('refresh-token');
  });

  it('returns to the initial state on sessionCleared', () => {
    const established = sessionReducer(undefined, sessionEstablished(session));
    const cleared = sessionReducer(established, sessionCleared());
    expect(cleared.user).toBeNull();
    expect(cleared.accessToken).toBeNull();
    expect(cleared.refreshToken).toBeNull();
  });
});
