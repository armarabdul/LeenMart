# 1. Modular monolith over microservices

- **Status:** Accepted
- **Date:** 2026-08-07
- **Relates to:** SDD §2

## Context

Leen Mart spans catalogue, orders, payments, settlement, fulfilment, preorders,
fraud and notifications. Placing a single order touches most of them.

## Decision

Build a modular monolith deployed as two runtime processes (API and worker),
with module boundaries enforced in code, not by the network.

## Consequences

**Positive.** Order placement is one ACID transaction plus an outbox record
rather than a saga with compensating actions per step. One deployment pipeline,
one on-call surface, one place to look during an incident. Refactoring across
module boundaries stays a compiler-checked operation.

**Negative.** Modules cannot scale independently; a runaway query in one module
can affect another. We accept this because the load profile in the PRD has one
spiky subsystem (preorder checkout), which is solved by scaling the API tier and
isolating the worker tier.

**Mitigation.** Every module publishes an interface via `index.ts`, owns its own
tables, and communicates outward only through that interface or domain events.
The extraction seam therefore already exists when a module genuinely needs to
become a service.

## Alternatives considered

**Microservices from the start.** Rejected: distributed transactions would
dominate the engineering effort, and the operational maturity microservices
require (mesh, distributed tracing across a dozen services, per-service on-call)
is a cost paid up front for a benefit that arrives much later.

**Unstructured monolith.** Rejected: without an enforced dependency rule, module
boundaries decay within a quarter and the extraction option is lost.
