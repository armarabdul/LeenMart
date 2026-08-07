# 4. UUID v7 primary keys, generated in the application

- **Status:** Accepted
- **Date:** 2026-08-07
- **Relates to:** SDD §6.1

## Context

The project standards mandate UUID primary keys. UUIDs avoid the enumeration
exposure of sequential integers and let an id be assigned before a row is
written, which matters for the outbox pattern. But random (v4) UUIDs scatter
inserts across a B-tree index, causing page splits, index fragmentation and
write amplification on exactly the tables that grow fastest.

## Decision

Use **UUID v7**: a 48-bit big-endian timestamp followed by randomness. Generate
them in the application via the `IdGenerator` port, not in the database.

## Consequences

**Positive.** Inserts stay roughly sequential, so index locality is close to a
bigserial while keeping the non-enumerable property. Ids are creation-ordered,
which makes cursor pagination and time-range queries natural. Application-side
generation means an aggregate and its outbox event can share an id before the
transaction commits.

**Negative.** A v7 id leaks its creation time to anyone holding it. Acceptable:
creation time is already visible on almost every resource we expose. It is
noted here so that any future identifier which must not leak timing uses a
random value instead.

## Alternatives considered

**UUID v4.** Rejected on index-fragmentation grounds.

**Database-generated (`gen_random_uuid()`).** Rejected: v4 only, and the id is
unknown until after the insert.

**ULID.** Equivalent properties, but not a native PostgreSQL `uuid` type, so it
would cost 26 bytes as text versus 16 as `uuid`, plus a custom Prisma mapping.
