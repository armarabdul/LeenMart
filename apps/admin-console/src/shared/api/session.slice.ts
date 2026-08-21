import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AuthSessionResponse, AuthUserDto } from '@leen-mart/contracts';
import type { RootState } from '@/app/store';

export interface SessionState {
  readonly user: AuthUserDto | null;
  readonly accessToken: string | null;
  readonly accessTokenExpiresAt: string | null;
  readonly refreshToken: string | null;
  readonly refreshTokenExpiresAt: string | null;
}

const initialState: SessionState = {
  user: null,
  accessToken: null,
  accessTokenExpiresAt: null,
  refreshToken: null,
  refreshTokenExpiresAt: null,
};

/**
 * Held entirely in the Redux store, mirroring `vendor-portal`'s own
 * `session.slice.ts` — JS memory only, never persisted to Web Storage. A
 * full page reload loses this state by design; the administrator signs in
 * again, including the mandatory MFA step (Phase L, SDD 7.1).
 *
 * The admin login surface (`/api/v1/admin/mfa/verify`,
 * `/api/v1/admin/mfa/enroll/confirm`) returns the identical
 * `authSessionResponseSchema` shape every other login does
 * (`identity.controller.ts`'s `toSessionResponse`, reused verbatim by
 * `admin-auth.controller.ts`) — so this slice needs no admin-specific
 * shape, only admin-specific actions to reach it.
 */
const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    sessionEstablished: (_state, action: PayloadAction<AuthSessionResponse>): SessionState => ({
      user: action.payload.user,
      accessToken: action.payload.accessToken,
      accessTokenExpiresAt: action.payload.accessTokenExpiresAt,
      refreshToken: action.payload.refreshToken,
      refreshTokenExpiresAt: action.payload.refreshTokenExpiresAt,
    }),
    sessionCleared: (): SessionState => initialState,
  },
});

export const { sessionEstablished, sessionCleared } = sessionSlice.actions;
export const sessionReducer = sessionSlice.reducer;

export const selectCurrentUser = (state: RootState): AuthUserDto | null => state.session.user;
export const selectAccessToken = (state: RootState): string | null => state.session.accessToken;
export const selectRefreshToken = (state: RootState): string | null => state.session.refreshToken;
export const selectIsAuthenticated = (state: RootState): boolean => state.session.user !== null;
