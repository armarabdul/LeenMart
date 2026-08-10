export { createIdentityModule } from './identity.module.js';
export type { IdentityModule, IdentityModuleDeps } from './identity.module.js';

// Minimal cross-module surface: the `authorization` module's policy
// evaluator (SDD 7.4/8) keys its matrix by role name and has no other
// reason to depend on this module.
export type { RoleName } from './domain/index.js';

// Minimal cross-cutting surface: the shared authentication middleware
// (SDD 7.4 step 1) is parameterised by this module's AccessTokenService and
// produces a Principal from its verified claims.
export type { AccessTokenService } from './application/ports/access-token.port.js';
export type { Principal } from './application/ports/principal.js';
