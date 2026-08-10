export { createIdentityModule } from './identity.module.js';
export type { IdentityModule, IdentityModuleDeps } from './identity.module.js';
// Minimal cross-module surface: the uthorization module's policy
// evaluator (SDD 7.4/8) keys its matrix by role name and has no other
// reason to depend on this module.
export type { RoleName } from './domain/index.js';
