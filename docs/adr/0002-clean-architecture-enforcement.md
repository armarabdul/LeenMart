# 2. Enforce the Clean Architecture dependency rule with ESLint

- **Status:** Accepted
- **Date:** 2026-08-07
- **Relates to:** SDD §2.3, §24.4

## Context

ADR-0001 depends on module boundaries actually holding. Documented architecture
that is not machine-checked decays: the first time someone needs a Prisma call
inside a domain entity under deadline pressure, it goes in and stays in.

## Decision

Encode the dependency rule as `no-restricted-imports` patterns in
`@leen-mart/config/eslint/node`, scoped by file path, and run ESLint as a
blocking CI gate.

- `domain/` may import only from `domain/`. No Express, Prisma, ioredis, Pino,
  `node:fs`, `node:http`.
- `application/` may import `domain/` and ports. No adapters, no HTTP framework.
- Cross-module imports must target the module's `index.ts`.
- The composition root (`container.ts`, `app.ts`, `server.ts`) is explicitly
  exempt, because wiring adapters to ports is its entire purpose.

## Consequences

**Positive.** A violation is a build failure with a message naming the SDD
section. Reviewers stop policing layering by eye. The domain stays unit-testable
with no I/O.

**Negative.** Occasional false positives when a legitimately shared utility
lives in the wrong place — which is usually a genuine signal that it belongs in
`shared/` or `domain-kit`.

## Alternatives considered

`eslint-plugin-boundaries` and `dependency-cruiser` both express this more
richly. Rejected for now: `no-restricted-imports` is core ESLint, so there is
one less dependency to keep compatible with the flat-config migration, and the
rule set is small enough to read in one screen. Revisit if the patterns grow
unwieldy.
