// This module's published interface (SDD 5.1). Other modules must import
// from here, never from `./domain/**` directly.
//
// SDD 5 classes `audit` as platform-wide rather than a numbered domain
// module, and SDD 5.1 makes it one of the four modules anything may depend
// on — but only through this barrel, which is why it lives under `modules/`
// alongside `authorization` rather than in `shared/`: the ESLint boundary
// rules key off the `**/modules/*/domain/**` path, so this placement is what
// makes the published-interface rule machine-enforced here too.
//
// Still no `createAuditModule`: this module has no HTTP surface of its own.
// What it now publishes beyond persistence is the write port other modules
// call directly — SDD 5.1 makes `audit` one of the four modules anything may
// depend on, and SDD 5 gives it no published events, so a direct call is the
// intended shape rather than an event subscription.
export * from './domain/index.js';
export type { AuditWriter, AuditWriterInput } from './application/ports/audit-writer.port.js';
export {
  AmbientAuditWriter,
  type AmbientAuditWriterDeps,
} from './infrastructure/ambient-audit-writer.js';
