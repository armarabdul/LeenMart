# Identity Module — Milestone 2 Backlog

Every item below is an architectural decision that Milestone 1 (Identity Domain
Layer) deliberately deferred, so that Milestone 1 could stay strictly
domain-only and land without touching `application/`, `infrastructure/`,
`interface/`, or the Prisma schema. Read this before starting Milestone 2 —
nothing here should be rediscovered from scratch.

---

## 1. Branded ID adoption for `User` and `Session`

**What was deferred**: `User.id` stays `Uuid`; `Session.id` and `Session.userId`
stay `Uuid`. The milestone's own value objects (`UserId`, `SessionId`,
`VendorId`, `OtpId`) exist and are already fully adopted by `VendorProfile` and
`Otp` (which have no existing callers), but were **not** retrofitted onto
`User`/`Session`.

**Why**: `IdGenerator.generate()` (domain-kit, used across the whole app, not
identity-specific) returns the generic `Uuid`. Every call site that currently
hands a `Uuid` to `User`/`Session` would need an explicit `toUserId()` /
`toSessionId()` conversion added — that's real wiring code in application and
infrastructure, not a type-only change, and this milestone was scoped to
domain-only with the build required to stay green throughout.

**Files that will be affected in Milestone 2**:

- `application/ports/user-repository.port.ts` — `findById(id: Uuid)` → `UserId`
- `application/ports/access-token.port.ts` — `AccessTokenClaims.sub: Uuid` → `UserId`
- `application/services/session-issuer.service.ts` — `user.id` used at 2 call
  sites (`accessTokenService.sign`, `RefreshToken.issue`); the session's own id
  from `idGenerator.generate()` needs a `toSessionId()` conversion
- `application/use-cases/register-customer.use-case.ts` — `id: idGenerator.generate()` → needs `toUserId()`
- `application/use-cases/refresh-session.use-case.ts` — `userRepository.findById(existing.userId)`, depends on the above lining up
- `infrastructure/persistence/prisma-user.repository.ts` — `toUuid(row.id)` → `toUserId(row.id)`; `findById(id: Uuid)` signature
- `infrastructure/persistence/prisma-refresh-token.repository.ts` — three `toUuid()` calls (`id` → `toSessionId`, `userId` → `toUserId`, `replacedByTokenId` → `toSessionId`)
- `infrastructure/security/jsonwebtoken-access-token.service.ts` — `toUuid(payload.sub)` → `toUserId(payload.sub)`
- `test/unit/modules/identity/domain/user.entity.test.ts` and `refresh-token.entity.test.ts` — construct plain `Uuid` values via `toUuid()`, need `toUserId`/`toSessionId` instead

**Owning milestone**: Milestone 2.

---

## 2. `User.status` made mandatory

**What was deferred**: `UserProps.status` stays optional (`status?: UserStatus`),
with the `status` getter defaulting to `ACTIVE` when absent, rather than being
a required field the entity always owns explicitly.

**Why**: the Prisma `User` model has **no `status` column at all today** —
there is nothing for the repository to read even if it were in scope to try.
Making the field mandatory in the domain type would immediately break the one
production call site that constructs a `User` without it
(`prisma-user.repository.ts`'s `toDomain()`), and fixing that properly requires
a Prisma migration (new column) plus repository read/write logic — both
infrastructure/Prisma work, explicitly out of scope this milestone. A
stopgap default _inside the repository_ was considered and rejected for this
milestone too: it still means editing `prisma-user.repository.ts`, and you
directed that compatibility defaults do not belong in repositories during
Milestone 1 either — the persistence layer should own a real column before the
domain treats status as always-present.

**Files that will be affected in Milestone 2**:

- `apps/api/prisma/schema.prisma` — add a `status` column to `User` (with a migration)
- `infrastructure/persistence/prisma-user.repository.ts` — `toDomain()` must read the new column instead of omitting the field
- `domain/entities/user.entity.ts` — `status` becomes a required field on `UserProps`; drop the `?? UserStatus.ACTIVE` default in the getter
- `test/unit/modules/identity/domain/user.entity.test.ts` — `reconstitute()` call must supply `status` explicitly

**Owning milestone**: Milestone 2.

---

## 3. Persistence and application wiring for `Session`, `VendorProfile`, `Otp`

**What was deferred**: `VendorProfile` and `Otp` have no Prisma models, no
repository implementations, and no application use cases. `Session` has a
working repository/use-case path today (inherited unchanged from
`RefreshToken`), but nothing yet constructs or persists a `VendorProfile` or
`Otp` anywhere in the running system.

**Why**: this milestone was domain-only by design — entities and their
invariants first, orchestration and persistence later.

**Files that will be affected in Milestone 2 (or a dedicated persistence
milestone)**:

- `apps/api/prisma/schema.prisma` — new `VendorProfile` and `Otp` models
- New `infrastructure/persistence/prisma-vendor-profile.repository.ts` and `prisma-otp.repository.ts`
- New `application/ports/vendor-repository.port.ts` and `otp-repository.port.ts` (see item 5 below — repository interfaces for these do land in Milestone 1, Step 5; only the _implementations_ are deferred)
- New application use cases: vendor registration/onboarding, OTP issuance/verification, KYC approval workflow

**Owning milestone**: Milestone 2 (repository implementations, Prisma models); application use cases may land in a later milestone still, once the auth-strategy work below is scoped.

---

## 4. `Role` still lives in `domain/entities/`, not `domain/value-objects/`

**What was deferred**: `Role` is structurally a value object (immutable,
private constructor, no identity) but remains at
`domain/entities/role.entity.ts` rather than moving to
`domain/value-objects/role.value-object.ts`, per your explicit "keep it where
it is for now" instruction.

**Why**: at the time, moving it would have changed an import path relied on by
`user.entity.ts` and (once branded IDs land) infrastructure code — a pure
relocation with no behavioral upside, deferred to avoid unnecessary churn
while other things were still settling.

**Files that will be affected whenever this is revisited**:

- `domain/entities/role.entity.ts` → `domain/value-objects/role.value-object.ts`
- `domain/entities/user.entity.ts` — import path update
- Once Milestone 2's infrastructure changes land: `infrastructure/persistence/prisma-user.repository.ts` — import path update

**Owning milestone**: Unscheduled — revisit opportunistically, likely alongside Milestone 2 since that's when `user.entity.ts` and the Prisma repository are next touched anyway.

---

## 5. Single `Role` per `User`, not a role collection

**What was deferred**: `User.role: Role` remains a single value. The original
PRD's "must always have at least one role" phrasing reads as plural, but per
your decision, Milestone 1 keeps the existing singular model rather than
introducing `roles: ReadonlySet<Role>`.

**Why**: explicitly decided ("Keep a single Role. Do not introduce multiple
roles or collections yet") — this is a genuine open product question (can one
account legitimately hold more than one role simultaneously?) that wasn't
resolved, only postponed.

**Files that will be affected if/when this changes**:

- `domain/entities/user.entity.ts` — `role: Role` → `roles: ReadonlySet<Role>` (or similar), plus the "at least one role" invariant enforced in `register()`/mutation methods
- Every application/infrastructure file that reads `user.role` (see the file list in item 1 — largely the same surface)
- `apps/api/prisma/schema.prisma` — `role Role` column would need to become a join table or array column

**Owning milestone**: Not yet scheduled — needs a product decision before it can be scoped to a milestone.

---

## 6. Optional email / phone-primary customer authentication

**What was deferred**: `User.email` and `User.passwordHash` remain required,
non-optional fields. The target model (customers authenticate primarily by
phone + OTP, with email optional) is not yet representable — `register()`
still requires both email and a password hash for every user, including
customers.

**Why**: the Prisma `User` model's `email` and `password_hash` columns are
both `NOT NULL` today. Making these domain fields genuinely optional would
change the return type of `User.email`/`.passwordHash` (to `Email | undefined`
etc.), which would break `prisma-user.repository.ts`'s `create()` method
(builds a Prisma `data` object that requires non-null `email`/`passwordHash`)
— an infrastructure/Prisma change, out of scope this milestone. Decision #8
("keep the design open for future authentication strategies without
implementing them yet") was satisfied by ensuring nothing in this milestone's
model _precludes_ this later (the `PhoneNumber` value object already exists,
unused), not by implementing it now.

**Files that will be affected in Milestone 2+**:

- `apps/api/prisma/schema.prisma` — `email` becomes nullable; new `phone` column (unique, nullable-until-verified)
- `domain/entities/user.entity.ts` — `email`/`passwordHash` become optional; new `phone?: PhoneNumber` field; a new factory (e.g. a phone-based registration path) alongside the existing `register()`
- `infrastructure/persistence/prisma-user.repository.ts` — `create()`/`toDomain()` updated for nullable columns
- New application use case(s) for phone+OTP registration/login, using the already-built `Otp` entity

**Owning milestone**: Milestone 2 for the schema/domain groundwork; the actual OTP registration/login use case may land in a subsequent milestone.

---

## 7. Vendor email+password registration and Admin MFA

**What was deferred**: no application use case exists for vendor
registration (email + password, with phone verification required during
onboarding) or admin authentication (email + password + MFA). `VendorProfile`
models the KYC-gated activation invariant in the domain, but nothing wires a
vendor or admin account into existence yet.

**Why**: explicitly out of scope — "Do NOT implement authentication. Only
model the domain," reaffirmed by decision #8.

**Files that will be affected**:

- New application use cases for vendor registration and admin login/MFA
- `infrastructure/security/` — an MFA-capable token/verification service (new)
- `apps/api/prisma/schema.prisma` — MFA secret storage for admins

**Owning milestone**: Not yet scheduled — likely its own milestone given the added complexity of MFA specifically.

---

## 8. `domain/repositories/` and `domain/services/` overlap with pre-existing `application/ports/`

**What was deferred**: Milestone 1 Step 5 added `domain/repositories/{user,session,vendor,otp}.repository.ts`
and `domain/services/{password-hasher,otp-generator,token-generator,clock}.service.ts`,
per the milestone's explicit spec. Three of these — `UserRepository`,
`SessionRepository` (conceptually the same contract as the existing
`RefreshTokenRepository`), and `PasswordHasher` — describe the same capability
as an interface that already exists in `application/ports/` for the currently
wired-up use cases. `TokenGenerator` overlaps partially with the existing
`RefreshTokenHasher` port (which bundles generation _and_ hashing; the new
domain interface is generation-only, deliberately narrower). No file was
renamed, removed, or converted to a re-export this time — unlike the
`Session`/`RefreshToken` resolution, the method signatures actually differ
(the domain versions use `PasswordHash`/`Uuid` more precisely in places), so a
compatibility alias would misrepresent one of the two contracts. Two
interfaces with overlapping intent now legitimately exist side by side.

**Why deferred rather than reconciled now**: reconciling them means either (a)
migrating `application/ports/*` to depend on the new `domain/*` interfaces
(an application-layer edit), or (b) having the infrastructure implementations
satisfy both (an infrastructure-layer edit) — both explicitly out of scope
for a domain-only milestone.

**Files that will be affected in Milestone 2**:

- ~~`application/ports/user-repository.port.ts` — reconcile with `domain/repositories/user.repository.ts`~~ **Done** (Milestone 2 Step 1): now a compatibility re-export of the domain interface; structurally identical, no caller changes needed.
- ~~`application/ports/refresh-token-repository.port.ts` — reconcile with `domain/repositories/session.repository.ts`~~ **Done** (Milestone 2 Step 2): now a compatibility re-export (`SessionRepository as RefreshTokenRepository`); structurally identical, no caller changes needed.
- `application/ports/password-hasher.port.ts` — reconcile with `domain/services/password-hasher.service.ts` (note the `PasswordHash` vs. raw `string` difference) — **still pending**, not structurally identical (see below), requires real infrastructure/use-case edits.
- `application/ports/refresh-token-hasher.port.ts` — reconcile with `domain/services/token-generator.service.ts` (note the generation/hashing split) — **still pending**.
- `infrastructure/persistence/prisma-user.repository.ts`, `prisma-refresh-token.repository.ts`, `infrastructure/security/argon2-password-hasher.ts` — whichever interface each ends up implementing — **still pending**.

**Owning milestone**: Milestone 2. The two repository re-exports (`UserRepository`, `SessionRepository`/`RefreshTokenRepository`) are complete. `PasswordHasher` and `TokenGenerator`/`RefreshTokenHasher` remain — unlike the repositories, their method signatures genuinely differ (value objects vs. raw primitives, bundled vs. split responsibilities), so reconciling them means editing infrastructure and use-case code, not just re-exporting a type.

---

## 9. `DomainEvent<TType>` should move to `@leen-mart/domain-kit`

**What was deferred**: `DomainEvent<TType>` (the minimal `{ type, occurredAt }`
base every identity event extends, via the new `IdentityDomainEvent` marker)
currently lives at `modules/identity/domain/events/domain-event.ts`.

**Why**: for other future bounded contexts (Catalog, Orders, Payments) to
define their own event hierarchies against the same base — the whole point of
introducing `IdentityDomainEvent` as a pattern to copy — `DomainEvent` needs to
live somewhere every module can reach. It can't stay inside
`modules/identity/domain/`: the existing cross-module ESLint rule blocks any
other module from importing directly out of identity's `domain/` folder (by
design — that's what forces cross-module access through a published
`index.ts`, and a generic event base isn't identity's to publish). This
milestone's file scope was `apps/api/src/modules/identity/domain/` only, so
the move to `packages/domain-kit` wasn't done here.

**Files that will be affected**:

- `packages/domain-kit/src/events/domain-event.ts` (new location)
- `packages/domain-kit/src/index.ts` — export it
- `modules/identity/domain/events/domain-event.ts` — deleted, replaced by the domain-kit import
- `modules/identity/domain/events/identity-domain-event.ts` — import path update only

**Owning milestone**: Unscheduled — do it whenever the second bounded context that needs its own event hierarchy is actually built; no need to move it speculatively before then.

---

## 10. `domain/services/clock.service.ts` is a pure re-export with no domain-specific behaviour

**What was deferred**: `domain/services/clock.service.ts` exists solely to
satisfy the milestone's original "four domain service interfaces" list —
its entire content is `export type { Clock } from '@leen-mart/domain-kit';`.
It adds nothing; the real interface and its `SystemClock`/`FixedClock`
implementations already live in domain-kit and are what every entity/value
object in this module actually uses (`now: Date` parameters).

**Why flagged rather than removed now**: it does no harm sitting alongside
the other three (genuinely non-trivial) service interfaces in the same
folder, and removing it isn't worth a separate change on its own. Per
explicit instruction, this pattern (a wrapper re-export with zero added
behaviour) should not be expanded elsewhere — this is the one and only
exception, kept for discoverability within `domain/services/`, not a
precedent.

**Files affected if simplified**: delete `domain/services/clock.service.ts`;
remove its line from `domain/index.ts`; anywhere that would have imported
`Clock` from this module's domain barrel imports it from
`@leen-mart/domain-kit` directly instead (which is already how every other
existing call site in this codebase gets it).

**Owning milestone**: Unscheduled — cheap to do opportunistically whenever `domain/services/` is next touched (e.g. alongside item 8's reconciliation).

---

## Summary table

| #   | Item                                                                | Owning milestone                                    |
| --- | ------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | Branded IDs on `User`/`Session` throughout app/infra                | Milestone 2                                         |
| 2   | `User.status` mandatory + real persistence column                   | Milestone 2                                         |
| 3   | Persistence + use cases for `Session`/`VendorProfile`/`Otp`         | Milestone 2 (partial), later for use cases          |
| 4   | `Role` relocation to `value-objects/`                               | Unscheduled (opportunistic, likely alongside #1/#2) |
| 5   | Single `Role` → role collection                                     | Unscheduled (needs product decision)                |
| 6   | Optional email / phone-primary customer auth                        | Milestone 2 (schema+domain), later (use case)       |
| 7   | Vendor registration + Admin MFA                                     | Unscheduled (likely its own milestone)              |
| 8   | Reconcile `domain/{repositories,services}` with `application/ports` | Milestone 2                                         |
| 9   | Move `DomainEvent<TType>` to `@leen-mart/domain-kit`                | Unscheduled (when a 2nd bounded context needs it)   |
| 10  | Remove/simplify the pure-re-export `clock.service.ts`               | Unscheduled (opportunistic, alongside #8)           |
