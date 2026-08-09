/**
 * Compatibility re-export. `UserRepository` is now canonically defined in
 * domain/repositories/user.repository.ts (Milestone 2 Step 1 reconciliation)
 * — the two interfaces were structurally identical, so this collapses the
 * duplicate down to one definition while every existing import of this file
 * keeps resolving `UserRepository` exactly as before.
 */
export type { UserRepository } from '../../domain/repositories/user.repository.js';
