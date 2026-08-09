/**
 * Compatibility re-export. `PasswordHasher` is canonically defined in
 * `domain/services/password-hasher.service.ts`, using the `PasswordHash`
 * value object rather than raw strings (Milestone 2 Step 6 reconciliation —
 * see docs/identity-milestone2-backlog.md). This file used to define its own
 * raw-string interface; that definition is gone, not just re-exported under
 * a new name, since every caller needed the same signature change anyway.
 */
export type { PasswordHasher } from '../../domain/services/password-hasher.service.js';
