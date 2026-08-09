import type { TokenGenerator } from '../../domain/services/token-generator.service.js';
import type { TokenHasher } from '../../domain/services/token-hasher.service.js';

/**
 * Compatibility re-export. `RefreshTokenHasher` used to define its own
 * bundled generate+hash interface; the domain now canonically splits that
 * into `TokenGenerator` (generation-only) and `TokenHasher` (hashing-only)
 * (Milestone 2 Step 7 — see docs/identity-milestone2-backlog.md). Every
 * current caller (`SessionIssuer`, `RefreshSessionUseCase`, `LogoutUseCase`)
 * always needs both operations together, so this alias preserves the
 * bundled shape those call sites depend on — it is structurally identical
 * to the old interface (`{ generate(): string; hash(rawToken: string): string }`),
 * so no caller needed to change.
 */
export type RefreshTokenHasher = TokenGenerator & TokenHasher;
