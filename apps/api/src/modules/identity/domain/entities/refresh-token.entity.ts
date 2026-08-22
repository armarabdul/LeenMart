/**
 * Backward-compatibility alias.
 *
 * This entity was renamed `Session` (see session.entity.ts) — "session" is
 * the domain concept; "refresh token" named the OAuth mechanism it happens
 * to be persisted as. This file is kept, at this exact path and export name,
 * solely so application/infrastructure code written against the old name
 * keeps compiling without modification (out of scope this milestone). It is
 * a re-export, not a second implementation — there is only one entity here.
 */
export {
  Session as RefreshToken,
  type SessionProps as RefreshTokenProps,
} from './session.entity.js';
