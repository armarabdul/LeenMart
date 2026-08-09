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
 * Held entirely in the Redux store — JS memory only, never persisted to Web
 * Storage. The SDD's intended refresh token (httpOnly cookie, SDD 7.2) isn't
 * set by the backend yet, so the refresh token lives here too as a deliberate,
 * approved interim choice; a full page reload loses this state by design and
 * the customer signs in again (see docs/identity-milestone2-backlog.md).
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
