# 3. Money as integer minor units

- **Status:** Accepted
- **Date:** 2026-08-07
- **Relates to:** SDD §6.1, §10.3

## Context

The platform computes commission, GST, TCS, TDS, refunds, holds and payouts. A
rounding error in a settlement engine is not a cosmetic bug: it produces a
ledger that does not balance, and reconciliation against the payment gateway
fails without an obvious cause.

## Decision

All monetary values are stored and manipulated as **integer minor units**
(paise) in `BigInt`, paired with an explicit currency column. A `Money` value
object in `@leen-mart/domain-kit` is the only sanctioned way to do currency
arithmetic. Percentages use explicit half-up rounding at four decimal places of
precision, so 0.1% TDS and 2.5% commission are both exact.

On the wire, money is `{ "amount": "149900", "currency": "INR" }` — a string,
because JSON numbers are IEEE-754 doubles.

## Consequences

**Positive.** No floating-point drift. Cross-currency arithmetic throws rather
than silently producing a wrong number. Rounding is explicit and auditable, so a
vendor asking "why is this 1 paisa different?" has an answer.

**Negative.** `BigInt` is slightly awkward — it does not serialise to JSON
natively, hence the string wire format, and Prisma maps it to `BigInt` which
requires care at the repository boundary.

## Alternatives considered

**`NUMERIC`/`Decimal`.** Correct, but invites accidental conversion to a
JavaScript `number` somewhere in the stack, and the failure is silent.

**Floating point.** Never acceptable for currency.
