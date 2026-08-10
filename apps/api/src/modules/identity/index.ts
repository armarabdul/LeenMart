export { createIdentityModule } from './identity.module.js';
export type { IdentityModule, IdentityModuleDeps } from './identity.module.js';

// Minimal cross-module surface: the `authorization` module's policy
// evaluator (SDD 7.4/8) keys its matrix by role name and has no other
// reason to depend on this module.
export type { RoleName } from './domain/index.js';

// `UserId` is the shared identity anchor other modules key their records to
// (SDD 6.7). `VendorId` is published from here only because it still lives
// in this module — a documented pre-existing SDD 5 discrepancy, since SDD 5
// assigns the vendor profile and its events to the `vendor` module. Left in
// place deliberately; the `vendor` module consumes it through this interface.
export type { UserId, VendorId } from './domain/index.js';

// Their constructors, needed by any module that rehydrates its own rows into
// branded ids at the persistence boundary (the `vendor` module's repository
// does exactly this). Value exports rather than type-only: `toDomain` has to
// call them at runtime.
export { toUserId, toVendorId } from './domain/index.js';

// Minimal cross-cutting surface: the shared authentication middleware
// (SDD 7.4 step 1) is parameterised by this module's AccessTokenService and
// produces a Principal from its verified claims.
export type { AccessTokenService } from './application/ports/access-token.port.js';
export type { Principal } from './application/ports/principal.js';
