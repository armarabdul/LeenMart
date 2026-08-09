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

## 2. `User.status` made mandatory ✅ Done (Milestone 2 Step 5)

**What was deferred**: `UserProps.status` stayed optional (`status?: UserStatus`),
with the `status` getter defaulting to `ACTIVE` when absent, rather than being
a required field the entity always owns explicitly.

**Why it was deferred**: the Prisma `User` model had **no `status` column at
all** — there was nothing for the repository to read even if it were in scope
to try. Making the field mandatory in the domain type would have immediately
broken the one production call site that constructs a `User` without it
(`prisma-user.repository.ts`'s `toDomain()`), and fixing that properly required
a Prisma migration (new column) plus repository read/write logic — both
infrastructure/Prisma work, out of scope for the domain-only Milestone 1.

**Resolution (Step 5)**: added `enum UserStatus` and `User.status UserStatus
@default(ACTIVE)` to `schema.prisma`, with a migration that adds the column as
`NOT NULL DEFAULT 'ACTIVE'` (safe for any existing rows — matches the exact
fallback the domain getter already used). `UserProps.status` is now required;
the `?? UserStatus.ACTIVE` fallback was removed from the getter.
`prisma-user.repository.ts` reads `UserStatus.fromName(row.status)` in
`toDomain()` and writes `user.status.name` in `create()`, mirroring the
existing `Role` mapping pattern exactly. `register()`, `activate()`,
`suspend()`, `lock()`, and `reinstate()` were not changed — they already
either set `status` explicitly or already required no change.

**Explicitly not included in Step 5** (see item 11): persisting the _results_
of `activate()`/`suspend()`/`lock()`/`reinstate()` — there is still no
`UserRepository.update()`/`PrismaUserRepository.update()` method. Step 5 made
the column exist and made create/read round-trip correctly; it did not add a
way to persist a status transition after registration.

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

## 4. `Role` still lives in `domain/entities/`, not `domain/value-objects/` ✅ Done (Milestone 2 Step 8)

**What was deferred**: `Role` is structurally a value object (immutable,
private constructor, no identity) but remained at
`domain/entities/role.entity.ts` rather than moving to
`domain/value-objects/role.value-object.ts`, per your explicit "keep it where
it is for now" instruction.

**Why it was deferred**: at the time, moving it would have changed an import
path relied on by `user.entity.ts` and (once branded IDs landed) infrastructure
code — a pure relocation with no behavioral upside, deferred to avoid
unnecessary churn while other things were still settling.

**Resolution (Step 8)**: relocated file content unchanged — `Role`'s values,
`fromName()`, `equals()`, and singleton behavior are byte-identical to before,
only the file's path and its imports changed. Updated every genuine consumer:
`domain/index.ts` (barrel export moved from the entities section to the
value-objects section), `domain/entities/user.entity.ts`,
`application/ports/access-token.port.ts`,
`infrastructure/persistence/prisma-user.repository.ts`,
`infrastructure/security/jsonwebtoken-access-token.service.ts`, and the two
test files that imported `Role` by path
(`test/.../domain/user.entity.test.ts`, `test/.../domain/role.entity.test.ts` —
the test file itself was not renamed or moved, matching this codebase's
existing convention of flat test files regardless of source subfolder). No
compatibility re-export was left behind — every consumer is internal to this
repository, so the old path was removed outright rather than aliased.

**Files affected**:

- `domain/entities/role.entity.ts` → `domain/value-objects/role.value-object.ts`
- `domain/index.ts` — barrel export moved
- `domain/entities/user.entity.ts` — import path update
- `application/ports/access-token.port.ts` — import path update
- `infrastructure/persistence/prisma-user.repository.ts` — import path update
- `infrastructure/security/jsonwebtoken-access-token.service.ts` — import path update
- `test/unit/modules/identity/domain/user.entity.test.ts` — import path update
- `test/unit/modules/identity/domain/role.entity.test.ts` — import path update

**Owning milestone**: Milestone 2, Step 8.

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
- ~~`application/ports/password-hasher.port.ts` — reconcile with `domain/services/password-hasher.service.ts`~~ **Done** (Milestone 2 Step 6): unlike the repositories, this was genuinely not structurally identical (`PasswordHash` vs. raw `string`), so it was reconciled by _adoption_ rather than re-export — the domain contract became canonical, and every caller was migrated to it, not aliased around. See the new subsection below.
- ~~`application/ports/refresh-token-hasher.port.ts` — reconcile with `domain/services/token-generator.service.ts`~~ **Done** (Milestone 2 Step 7): unlike `PasswordHasher`, this did _not_ need a full-adoption migration — see 8b below.

**Owning milestone**: Milestone 2. All four reconciliations under this item are now complete: the two repository re-exports (Steps 1–2), `PasswordHasher` (Step 6, full adoption), and `TokenGenerator`/`TokenHasher`/`RefreshTokenHasher` (Step 7, split + compatibility alias). Item 8 is closed.

### 8b. `TokenGenerator`/`RefreshTokenHasher` reconciliation — resolution (Milestone 2 Step 7)

Chosen resolution differed deliberately from `PasswordHasher`'s: rather than
picking one existing interface as canonical, the bundled application-layer
`RefreshTokenHasher` (`generate()` + `hash()` in one interface) was **split**
into two narrower canonical domain contracts, matching how the two
operations are actually semantically distinct (a refresh token is already
256 bits of randomness — hashing it for storage needs no `verify` method the
way a low-entropy password does, since lookups happen by re-hashing and
querying, not by comparison):

- `domain/services/token-generator.service.ts` — already existed
  (`generate(): string`), adopted as-is, unchanged.
- `domain/services/token-hasher.service.ts` — **new**, minimal
  (`hash(rawToken: string): string`), added only because the existing
  `RefreshTokenHasher` genuinely bundles hashing with generation and
  needed a real hashing-only counterpart to split against — not spun up
  speculatively.
- `application/ports/refresh-token-hasher.port.ts` — `RefreshTokenHasher` is
  now `export type RefreshTokenHasher = TokenGenerator & TokenHasher`, an
  intersection re-export rather than the previous freestanding interface.
  This resolved structurally identically to the old bundled shape (same two
  method signatures), so **every existing caller needed zero changes**:
  `CryptoRefreshTokenHasher`, `SessionIssuer`, `RefreshSessionUseCase`,
  `LogoutUseCase`, `identity.module.ts`, and every test fake/test file all
  compiled and passed unmodified. This is different from `PasswordHasher`
  (Step 6), where the return-type change (`string → PasswordHash`) genuinely
  propagated through callers — here, both domain contracts still deal in
  plain `string`, so there was no representation change to propagate, only
  an organizational one.

**No plaintext token is ever stored** — unaffected by this step; the
generate → return raw → hash → persist-hash-only flow is identical to
before, confirmed unchanged by the full identity integration test suite.

### 8a. `PasswordHasher` reconciliation — resolution (Milestone 2 Step 6)

Chosen resolution: **Option A, full adoption** — the domain `PasswordHasher`
(`hash(plaintext): Promise<PasswordHash>`, `verify(hash: PasswordHash, plaintext): Promise<boolean>`)
became the one canonical contract. The pre-existing application-layer port
(raw `string` in, raw `string` out) was not compatible enough for a re-export
(`Promise<PasswordHash>` cannot stand in for `Promise<string>`), so this was a
real migration:

- `application/ports/password-hasher.port.ts` — no longer defines its own
  interface; now `export type { PasswordHasher } from '../../domain/services/password-hasher.service.js'`.
- `domain/entities/user.entity.ts` — `UserProps.passwordHash` (and the
  `register()`/getter signatures) changed from `string` to `PasswordHash`.
  This was the one genuinely new piece of scope beyond the port itself:
  `PasswordHash` had zero adopters before this (not even `User`, the entity
  it was ostensibly modelled for) — Step 6 is what actually put it to use.
- `infrastructure/security/argon2-password-hasher.ts` — `hash()` now wraps
  Argon2's raw output in `PasswordHash.create(...)`; `verify()` reads the
  wrapped value's already-public `.value` accessor before calling
  `argon2.verify()`. Algorithm/parameters unchanged.
- `infrastructure/persistence/prisma-user.repository.ts` — `toDomain()` wraps
  the read column in `PasswordHash.create(row.passwordHash)`; `create()`
  writes `user.passwordHash.value`. Prisma's `password_hash` column is
  unchanged (still a plain `TEXT` column — branding/wrapping is TypeScript-only).
- `register-customer.use-case.ts`, `login.use-case.ts` — **needed zero
  changes**. Both already passed the hasher's `hash()`/`verify()` results
  straight through without touching the raw value, so the type change
  propagated transparently — the intended payoff of doing this as a contract
  migration rather than a spot-fix.
- Test fakes/tests updated to match: `FakePasswordHasher` in
  `test/.../application/fakes.ts` now returns/accepts `PasswordHash`;
  `user.entity.test.ts`, `register-customer.use-case.test.ts`, and
  `argon2-password-hasher.test.ts` updated for the new type. Two unrelated
  tests (`logout.use-case.test.ts`, `refresh-session.use-case.test.ts`) used
  a 2-character placeholder password (`'pw'`) that produced a fake hash under
  `PasswordHash`'s 20-character minimum — fixed by using a longer placeholder
  password, since neither test asserts anything about the password itself.

**No plaintext password is ever stored** — `PasswordHash.create()`'s existing
validation (rejecting anything under 20 characters, aimed at catching an
accidental plaintext/empty value) was not weakened, and nothing bypasses it.

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

## 10. `domain/services/clock.service.ts` is a pure re-export with no domain-specific behaviour ✅ Done (Milestone 2 Step 8)

**What was deferred**: `domain/services/clock.service.ts` existed solely to
satisfy the milestone's original "four domain service interfaces" list —
its entire content was `export type { Clock } from '@leen-mart/domain-kit';`.
It added nothing; the real interface and its `SystemClock`/`FixedClock`
implementations already live in domain-kit and are what every entity/value
object in this module actually uses (`now: Date` parameters).

**Why it was flagged rather than removed at the time**: it did no harm sitting
alongside the other three (genuinely non-trivial) service interfaces in the
same folder, and removing it wasn't worth a separate change on its own. Per
explicit instruction, this pattern (a wrapper re-export with zero added
behaviour) was not to be expanded elsewhere — it was the one and only
exception, kept for discoverability within `domain/services/`, not a
precedent.

**Resolution (Step 8)**: deleted `domain/services/clock.service.ts` and
removed its line from `domain/index.ts`. Confirmed first, by inspection, that
nothing in the identity module imported `Clock` via the domain barrel —
every existing call site (`identity.module.ts`, all four use cases,
`session-issuer.service.ts`, `jsonwebtoken-access-token.service.ts`, and every
test that needs `FixedClock`) already imported `Clock` directly from
`@leen-mart/domain-kit`, exactly as this entry predicted. No other file
required any change.

**Owning milestone**: Milestone 2, Step 8.

---

## 11. `User` status transitions (`activate`/`suspend`/`lock`/`reinstate`) are not persisted

**What was deferred**: `User.activate()`, `.suspend()`, `.lock()`, and
`.reinstate()` all correctly return a new `User` instance with the updated
`status` in memory, but nothing writes that change back to the database —
`UserRepository`/`PrismaUserRepository` has no `update()` method at all today,
only `create()`, `findById()`, and `findByEmail()`.

**Why deferred**: Milestone 2 Step 5 was explicitly scoped to making
`UserStatus` a persisted, required _column_ — correct create/read round-trip
through `status` — not to wiring up transition persistence, which requires a
new port method (`UserRepository.update(user: User): Promise<void>`), a new
`PrismaUserRepository.update()` implementation, and (eventually) an
application use case that actually calls `activate()`/`suspend()`/etc. and
persists the result. None of that exists yet, and no current use case ever
calls these methods.

**Files that will be affected when this is picked up**:

- `domain/repositories/user.repository.ts` — add `update(user: User): Promise<void>`
- `application/ports/user-repository.port.ts` — re-export picks this up automatically (it's a compatibility alias of the domain interface)
- `infrastructure/persistence/prisma-user.repository.ts` — new `update()` implementation
- New application use case(s) to actually trigger a transition (e.g. admin suspends a user) — not yet scoped

**Owning milestone**: Unscheduled — no current use case needs it; pick up whenever a real caller (e.g. admin moderation) is scoped.

---

## Summary table

| #   | Item                                                                | Owning milestone                                  |
| --- | ------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | Branded IDs on `User`/`Session` throughout app/infra                | Milestone 2                                       |
| 2   | `User.status` mandatory + real persistence column                   | ✅ Done (Milestone 2 Step 5)                      |
| 3   | Persistence + use cases for `Session`/`VendorProfile`/`Otp`         | Milestone 2 (partial), later for use cases        |
| 4   | `Role` relocation to `value-objects/`                               | ✅ Done (Milestone 2 Step 8)                      |
| 5   | Single `Role` → role collection                                     | Unscheduled (needs product decision)              |
| 6   | Optional email / phone-primary customer auth                        | Milestone 2 (schema+domain), later (use case)     |
| 7   | Vendor registration + Admin MFA                                     | Unscheduled (likely its own milestone)            |
| 8   | Reconcile `domain/{repositories,services}` with `application/ports` | ✅ Done (Steps 1, 2, 6, 7)                        |
| 9   | Move `DomainEvent<TType>` to `@leen-mart/domain-kit`                | Unscheduled (when a 2nd bounded context needs it) |
| 10  | Remove/simplify the pure-re-export `clock.service.ts`               | ✅ Done (Milestone 2 Step 8)                      |
| 11  | Persist `User` status transitions (needs `UserRepository.update()`) | Unscheduled (no current caller)                   |
