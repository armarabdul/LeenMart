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
// No `createAuditModule` yet: this chunk is persistence only. There is no
// HTTP surface to mount and no composition to perform until a caller exists
// (the same sequencing `MfaSecret`/`MfaChallenge` persistence followed).
export * from './domain/index.js';
