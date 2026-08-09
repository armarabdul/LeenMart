/**
 * Compatibility re-export. `RefreshTokenRepository` is now canonically
 * defined as `SessionRepository` in domain/repositories/session.repository.ts
 * (Milestone 2 Step 2 reconciliation) — the two interfaces were structurally
 * identical (same 3 methods, same types, `RefreshToken` already being an
 * alias for `Session` since Milestone 1), so this collapses the duplicate
 * down to one definition while every existing import of this file keeps
 * resolving `RefreshTokenRepository` exactly as before.
 */
export type { SessionRepository as RefreshTokenRepository } from '../../domain/repositories/session.repository.js';
