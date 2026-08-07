# Leen Mart — Software Design Document (SDD)

**Document ID:** LM-SDD-001
**Version:** 1.0 (Draft for approval)
**Date:** 07 August 2026
**Author:** Lead Software Architect
**Supersedes:** —
**Depends on:** `01-requirements-gap-analysis.md` (assumptions register §9)
**Status:** **Awaiting approval. No implementation code is to be written until this document is approved.**

> **Read this first.** This SDD is written against the PRD *plus* the twenty-five explicit assumptions in `01-requirements-gap-analysis.md §9`. Where the PRD is silent, an assumption (`ASM-nn`) is cited inline. Changing an assumption changes this document. This SDD contains **no implementation code** by design — only structure, contracts, and decisions.

---

## Table of contents

1. System Overview
2. Architecture Style
3. Technology Stack Justification
4. High-Level Architecture
5. Module Breakdown
6. Database Design Strategy
7. Authentication & Authorization
8. User Roles & Permissions
9. API Strategy
10. Payment Architecture
11. Notification Architecture
12. File Storage Architecture
13. QR Pickup Flow
14. Preorder Workflow
15. Vendor Approval Workflow
16. Fraud Detection Strategy
17. Error Handling Strategy
18. Logging Strategy
19. Monitoring
20. Deployment Architecture
21. Scalability Strategy
22. Backup & Recovery
23. Security Best Practices
24. Coding Standards
25. Folder Structure Recommendation
26. Development Roadmap
27. Appendix — Architecture Decision Record index

---

## 1. System Overview

### 1.1 Purpose

Leen Mart is a **hyperlocal, multi-vendor commerce platform** connecting KYC-verified vendors with customers in a defined service area, differentiated by four capabilities that shape the entire design:

1. **Dual monetisation** — a vendor is on either a commission plan or a subscription plan (ASM-06), which means the pricing and settlement engine must be plan-aware on every single order line.
2. **Preorders for perishable and time-boxed goods** — a scheduled, quantity-capped, partially-prepaid sale with a hard expiry. This is the highest-concurrency, highest-complexity subsystem in the platform.
3. **Hybrid fulfilment without platform logistics** — vendor-managed delivery *and* QR-verified pickup. The platform never touches goods, which shifts the design burden from logistics to **verification and trust**.
4. **Trust-first operations** — manual (later risk-tiered) approval, rule-based fraud detection, and the ability to hold funds.

### 1.2 Scope of this design

| In scope (v1) | Out of scope (v1, designed for) |
|---|---|
| Customer PWA, Vendor portal, Admin console | Native mobile apps (TWA wrapper only, IMP-16) |
| Vendor onboarding + KYC | C2C / customer-as-seller (ASM-04) |
| Catalogue with variants, moderation | Services listings (AMB-11) |
| Cart, checkout, multi-vendor orders (ASM-03) | Coupons, promotions, wallet, loyalty (ASM-25) |
| Delivery + QR pickup fulfilment | Platform-operated logistics |
| Preorders | Multi-language (ASM-25) |
| Razorpay Route payments + settlement (ASM-02) | Bulk CSV catalogue upload |
| GST/TCS/TDS + invoicing (ASM-07/08) | Vendor multi-location |
| Reviews, ratings, abuse reporting | ML-based fraud (ASM-18) |
| Rule-based fraud detection + holds | Warehouse/BI stack |
| Notifications (email, SMS, web push) | |
| Admin console with audit trail | |

### 1.3 Key architectural drivers

| Driver | Consequence on the design |
|---|---|
| **Bursty, scheduled load** (preorder drops) | Admission control, atomic decrements, queue-based backpressure (§21) |
| **Money correctness** | Double-entry ledger, integer paise, idempotency everywhere (§10) |
| **Multi-tenancy** | Tenant scoping enforced in one architectural layer, never in controllers (§6.6) |
| **Regulatory load** (GST, DPDP, CP e-commerce rules) | Tax as a first-class domain concept; auditability; data-lifecycle jobs |
| **Small team, early product** | Modular monolith with hard internal boundaries, not microservices (§2) |
| **Mobile-first, low-bandwidth India** | PWA, CDN, aggressive image optimisation, small JS budget (§21) |
| **Trust is the product** | Immutable audit logs, verifiable pickup, defensible fraud decisions |

### 1.4 System context (C4 Level 1)

```
                         ┌──────────────────────────────────────┐
   Customer (PWA) ─────► │                                      │ ◄──── Razorpay (Payments, Route, Webhooks)
   Vendor (PWA)  ─────►  │            LEEN MART                 │ ◄──── SMS Provider (DLT-registered)
   Admin (Web)   ─────►  │            PLATFORM                  │ ◄──── AWS SES (Email)
                         │                                      │ ◄──── Web Push (VAPID)
                         └──────────────────────────────────────┘ ◄──── Geocoding Provider
                                          │
                                          ├──► Cloudflare R2 + CDN  (media, KYC docs, invoices)
                                          ├──► PostgreSQL + PostGIS (system of record)
                                          └──► Redis                (cache, locks, queues, limits)
```

---

## 2. Architecture Style

### 2.1 Decision

**A Clean-Architecture modular monolith, deployed as two runtime processes (API and Worker), with strictly enforced internal module boundaries and an event backbone that permits later extraction of modules into services.** (ASM-23)

### 2.2 Rationale

Microservices are the wrong choice for Leen Mart today, and the reasons are specific rather than ideological:

- **Distributed transactions would dominate the work.** Placing an order touches catalogue (stock), pricing, tax, payments, ledger and notifications. In a monolith this is one ACID transaction plus an outbox. Across services it is a saga with compensating actions for each step — an enormous increase in complexity for a team that has not yet shipped v1.
- **The PRD does not describe independent scaling needs.** One subsystem is spiky (preorder checkout). That is solved by scaling the single API tier and isolating the worker tier — not by fragmenting the domain.
- **Operational maturity is a prerequisite, not an outcome.** Service meshes, distributed tracing across a dozen services, per-service on-call and independent deployment pipelines are costs that must be paid before the benefits arrive.
- **Boundaries can be enforced without network calls.** The value people attribute to microservices — modularity — comes from discipline, not from HTTP. We get it with module-level encapsulation and a dependency-rule lint gate (§24.4).

**However**, the design deliberately preserves the extraction path: every module exposes a published interface, communicates with other modules only via that interface or via domain events, and owns its own tables (no cross-module foreign keys except to a small set of shared identity tables — §6.7). When `payments` or `search` genuinely needs to become a service, the seam already exists.

### 2.3 Clean Architecture layering

Dependencies point **inward only**. The domain knows nothing about Express, Prisma, Razorpay or React.

```
┌──────────────────────────────────────────────────────────────────┐
│  INTERFACE / DELIVERY          Express routers, controllers,     │
│                                 DTO mapping, Zod request schemas, │
│                                 BullMQ job handlers, CLI          │
├──────────────────────────────────────────────────────────────────┤
│  APPLICATION (Use Cases)       Orchestration, transaction         │
│                                 boundaries, authorisation checks, │
│                                 port interfaces (repositories,     │
│                                 gateways), domain-event dispatch  │
├──────────────────────────────────────────────────────────────────┤
│  DOMAIN (Enterprise Rules)     Entities, value objects (Money,    │
│                                 GSTIN, Pincode, GeoPoint),        │
│                                 aggregates, state machines,       │
│                                 domain services, domain events.   │
│                                 ZERO external dependencies.       │
├──────────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE (Adapters)     Prisma repositories, Razorpay      │
│                                 gateway, R2 storage, Redis cache, │
│                                 SES/SMS senders, PostGIS queries  │
└──────────────────────────────────────────────────────────────────┘
```

**The dependency rule, stated operationally:** `domain/` may import nothing outside `domain/`. `application/` may import `domain/` only. `infrastructure/` and `interface/` may import both. This is enforced by an ESLint boundary rule and fails the build, not a code review (§24.4).

### 2.4 Cross-cutting patterns

| Pattern | Where used | Why |
|---|---|---|
| **Repository (port/adapter)** | All persistence | Domain independence; enables in-memory repositories for fast unit tests |
| **Unit of Work** | Application layer | One explicit transaction boundary per use case; no implicit transactions in repositories |
| **Transactional Outbox** | Every side effect | Guarantees at-least-once delivery of events without 2PC (IMP-04) |
| **Domain events** | Inter-module communication | Decouples modules; the extraction seam |
| **State machine** | Order, SubOrder, Preorder, Vendor, Payout, FraudCase | Illegal transitions become impossible rather than merely untested (IMP-05) |
| **Specification** | Search filters, fraud rules, eligibility checks | Composable business rules, testable in isolation |
| **Strategy** | Pricing/commission per plan, fulfilment per type, notification per channel | Open/closed — new plan or channel adds a class, changes no existing code |
| **CQRS-lite** | Read models for dashboards and listings | Read paths bypass the domain and hit optimised projections; write paths always go through the domain |

---

## 3. Technology Stack Justification

Per ASM-19, the project standing instructions reconcile the PRD's stack (AMB-09). Every choice below is justified, and every one has a stated rejected alternative — because a justification without an alternative is just an assertion.

### 3.1 Language

| Choice | **TypeScript (strict) end to end** |
|---|---|
| Why | A single language across PWA, API and workers lets us share Zod schemas, DTO types and domain value objects through an internal package, eliminating the FE/BE contract drift that causes most integration defects. `strict: true` with `noUncheckedIndexedAccess` catches an entire class of runtime errors before commit. |
| Rejected | Go/Java for the backend — better raw throughput, but the cost of a second language and a duplicated type contract outweighs it at this scale. Node's I/O-bound profile matches a marketplace workload well. |
| Risk | CPU-bound work (image processing, PDF generation, report exports) blocks the event loop → these are **explicitly confined to the worker tier**, never the API tier. |

### 3.2 Backend framework

| Choice | **Node.js 22 LTS + Express 5** |
|---|---|
| Why | Mandated. Express 5 finally handles async errors natively, which removes the `express-async-errors` shim and makes the error middleware in §17 reliable. Enormous ecosystem; every integration we need has a mature library. |
| Rejected | NestJS — gives DI and structure out of the box, but imposes its own opinionated architecture that partially duplicates Clean Architecture, and its decorator-heavy style couples the domain to the framework. We get DI from a lightweight container instead. Fastify — measurably faster, but Express's middleware ecosystem (helmet, rate-limit, multer) and team familiarity win at this stage. |
| Note | Express is confined to the **interface layer**. No `req`/`res` object ever reaches the application or domain layers. This is what makes the Fastify/NestJS decision reversible. |

### 3.3 Database

| Choice | **PostgreSQL 16 + PostGIS** |
|---|---|
| Why | The workload is relational and transactional: orders, order lines, ledger entries and settlements require ACID guarantees and foreign keys. Postgres additionally gives us, without adding infrastructure: **PostGIS** for delivery-radius queries (ASM-17), **`pg_trgm` + `tsvector`** for Phase-1 search (SC-03), **JSONB** for per-category product attributes and rule definitions, **partial and expression indexes**, **`SELECT … FOR UPDATE`** and check constraints for the preorder concurrency problem (§14.4), **declarative partitioning** for the events and audit tables, and **row-level security** as a defence-in-depth option for tenancy. |
| Rejected | MySQL — weaker JSON, no comparable geospatial story, weaker index types. MongoDB — a marketplace ledger without transactions across collections is a correctness hazard; the data is fundamentally relational. |

### 3.4 ORM

| Choice | **Prisma** |
|---|---|
| Why | Mandated. Best-in-class TypeScript inference, a declarative and reviewable schema, and a migration workflow that produces plain SQL files we can inspect and hand-edit — which matters, because several of our constraints (partial indexes, check constraints, PostGIS columns, generated columns) are not expressible in Prisma schema and must be added as raw SQL inside generated migrations. |
| Constraints we accept | (a) Prisma is not a domain model — Prisma types **never** leave the infrastructure layer; repositories map Prisma rows to domain entities. (b) Prisma's connection pooling requires PgBouncer/RDS Proxy at scale (SC-11). (c) `$queryRaw` is restricted to reporting queries in a reviewed directory and is lint-banned elsewhere (SEC-20). |
| Rejected | Drizzle — closer to SQL and lighter, but a smaller ecosystem and weaker migration tooling. TypeORM — historically unreliable migrations. |

### 3.5 Frontend

| Choice | **React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui + Redux Toolkit + RTK Query** |
|---|---|
| Why | Vite gives sub-second HMR and an optimised Rollup production build with automatic code splitting (PERF-11). Tailwind gives a consistent design system without a runtime CSS-in-JS cost. **shadcn/ui is copy-in, not a dependency** — we own the components, so we can meet WCAG 2.1 AA (NFR-08) and brand requirements without fighting a library. RTK Query (PRD-mandated) provides caching, deduplication, tag-based invalidation and optimistic updates, and its generated hooks can be produced directly from our OpenAPI spec (IMP-08) — which turns the PRD's stack choice into a genuine advantage. |
| Rejected | Next.js — SSR would help catalogue SEO, and this is a real trade-off we are consciously deferring: the PRD specifies a PWA with offline support, which is simpler on a pure SPA, and SEO is not a stated Phase-1 objective. **Flagged as a Phase-3 revisit**, since marketplace discovery ultimately depends on organic search. |
| Apps | Three separate Vite applications (`customer-pwa`, `vendor-portal`, `admin-console`) sharing an internal UI package. Separate bundles keep the customer bundle small; the admin console's charts and tables never ship to a customer on 4G. |

### 3.6 Supporting infrastructure

| Component | Choice | Justification |
|---|---|---|
| Cache / locks / rate limits | **Redis 7 (ElastiCache)** | Required for stateless horizontal scaling (SC-07). One component serves four needs: cache-aside, distributed rate limiting, distributed locks, and the job queue backend. |
| Job queue | **BullMQ** | Redis-backed, mature, supports delayed jobs (preorder expiry, slot reminders, settlement runs), repeatable jobs (cron), retries with exponential backoff, and dead-letter handling. Avoids adding SQS + a second operational surface in Phase 1. |
| Object storage | **Cloudflare R2 + Cloudflare CDN** | PRD-mandated. **Zero egress fees** is the decisive factor: an image-heavy marketplace serving mobile users would incur significant S3 egress cost. S3-compatible API, so the adapter is portable. (AMB-10: R2 only; S3 not used for media.) |
| Payments | **Razorpay + Razorpay Route** | PRD-mandated for payments; Route added per ASM-02 to avoid the regulatory exposure of pooling customer funds (BR-05). Native UPI, cards, netbanking, wallets; hosted checkout keeps us in **PCI-DSS SAQ-A** scope (NFR-17). |
| Email | **AWS SES** | Cheap, high deliverability, native to the AWS estate, event feedback via SNS for bounce/complaint handling. |
| SMS | **DLT-registered Indian provider** (e.g. MSG91/Kaleyra) | Indian regulation requires DLT registration of sender headers and templates; a generic international provider will have messages blocked (FR-58). |
| Push | **Web Push (VAPID)** | PRD-mandated PWA push. Note the iOS limitation in AMB-20. |
| Search (Phase 1) | **PostgreSQL FTS** behind a `SearchPort` | Avoids a second datastore before we need one; the port makes the Phase-2 swap cheap (IMP-15). |
| Search (Phase 2+) | **OpenSearch or Typesense** | Adopted when SKU count or query latency crosses the thresholds in §21.4. |
| Containers | **Docker** → **AWS ECS Fargate** | PRD-mandated Docker. Fargate removes node management; Kubernetes is unjustified complexity for two services (ASM-21). |
| CI/CD | **GitHub Actions** | PRD-mandated. |
| Validation | **Zod** | Runtime validation that *infers* TypeScript types — one schema, no drift, shared between the API boundary and the frontend forms. |
| Testing | **Vitest, Supertest, Testcontainers, Playwright** | Vitest shares the Vite config. **Testcontainers is non-negotiable**: repository tests must run against real PostgreSQL, because the constraints and locking behaviour we depend on (§14.4) do not exist in a mock. |
| Observability | **Pino → CloudWatch, OpenTelemetry, Sentry** | §18–19. |

---

## 4. High-Level Architecture

### 4.1 Container view (C4 Level 2)

This replaces the linear diagram in PRD §8, which was not an architecture (AMB-08).

```
                        ┌─────────────────────────────────────────┐
                        │        Cloudflare (CDN + WAF + DNS)     │
                        └───────────────┬─────────────────────────┘
                                        │
              ┌─────────────────────────┼──────────────────────────┐
              │                         │                          │
       ┌──────▼───────┐        ┌────────▼────────┐        ┌────────▼────────┐
       │ Customer PWA │        │ Vendor Portal   │        │ Admin Console   │
       │ React+Vite   │        │ React+Vite      │        │ React+Vite      │
       │ Service Wkr  │        │                 │        │ (MFA-gated)     │
       └──────┬───────┘        └────────┬────────┘        └────────┬────────┘
              │                         │                          │
              └───────────── HTTPS / JSON (REST) ──────────────────┘
                                        │
                        ┌───────────────▼─────────────────┐
                        │   AWS Application Load Balancer │
                        │   (TLS termination, WAF)        │
                        └───────────────┬─────────────────┘
                                        │
              ┌─────────────────────────▼─────────────────────────┐
              │            API SERVICE  (ECS Fargate, N tasks)     │
              │  ┌──────────────────────────────────────────────┐ │
              │  │ Interface: routers, controllers, Zod schemas  │ │
              │  ├──────────────────────────────────────────────┤ │
              │  │ Application: use cases, ports, UoW            │ │
              │  ├──────────────────────────────────────────────┤ │
              │  │ Domain: entities, VOs, state machines, events │ │
              │  ├──────────────────────────────────────────────┤ │
              │  │ Infrastructure: Prisma, Razorpay, R2, Redis   │ │
              │  └──────────────────────────────────────────────┘ │
              └───┬────────────┬───────────────┬──────────────┬────┘
                  │            │               │              │
        ┌─────────▼───┐  ┌─────▼──────┐  ┌─────▼──────┐  ┌────▼────────────┐
        │ PostgreSQL  │  │  Redis     │  │Cloudflare  │  │ Razorpay        │
        │ RDS Multi-AZ│  │ElastiCache │  │    R2      │  │ (+ Route)       │
        │ + PostGIS   │  │cache/queue │  │ media/KYC  │  │                 │
        │ + replica   │  │locks/limits│  │            │  │                 │
        └─────────▲───┘  └─────▲──────┘  └────────────┘  └────┬────────────┘
                  │            │                              │
                  │            │                        webhooks (signed)
                  │            │                              │
              ┌───┴────────────┴──────────────────────────────▼────┐
              │        WORKER SERVICE (ECS Fargate, M tasks)        │
              │  Outbox relay · Notifications · Image processing    │
              │  Preorder scheduler · Settlement runs · Invoices    │
              │  Search indexing · Fraud rule evaluation · Reports  │
              └───┬──────────────┬──────────────┬─────────────┬────┘
                  │              │              │             │
              ┌───▼───┐    ┌─────▼─────┐  ┌─────▼─────┐ ┌────▼──────┐
              │  SES  │    │ SMS (DLT) │  │ Web Push  │ │ Geocoding │
              └───────┘    └───────────┘  └───────────┘ └───────────┘
```

### 4.2 Request flow — order placement (the critical path)

```
1. PWA          POST /api/v1/orders  { cartId, addressId, fulfilment[], idempotencyKey }
2. ALB          → API task
3. Interface    Zod validation → DTO;  Idempotency middleware checks Redis+DB for replay
4. Application  PlaceOrderUseCase:
                 a. Load cart, re-resolve ALL prices server-side from DB      (SEC-02)
                 b. Validate serviceability for each vendor                   (ASM-17)
                 c. Validate slot capacity + business hours                   (FR-27)
                 d. Compute tax (HSN → rate → CGST/SGST/IGST)                 (ASM-07)
                 e. Compute commission per vendor plan                        (ASM-06)
                 f. BEGIN TX
                      · reserve stock / preorder quantity (atomic decrement)  (§14.4)
                      · insert Order + SubOrder[] + OrderItem[] (PENDING_PAYMENT)
                      · insert ledger entries (pending)
                      · insert outbox events
                    COMMIT                                    ← short transaction
                 g. Create Razorpay order (external, OUTSIDE the tx)
5. Response     { orderId, razorpayOrderId, amount }  ← p95 target < 800 ms
6. PWA          Razorpay hosted checkout
7. Razorpay     → POST /api/v1/webhooks/razorpay  (signature-verified, idempotent)
8. Application  ConfirmPaymentUseCase → order CONFIRMED → outbox events
9. Worker       Outbox relay → notifications, invoice generation, search reindex
```

**The three rules embedded in this flow, each of which prevents a class of production failure:**

- **No external HTTP call inside a database transaction.** Razorpay is called after commit. A slow gateway must never hold a row lock.
- **No side effect outside the transaction.** Notifications are written to the outbox in the same commit as the order; the worker delivers them. Either both happened or neither did (IMP-04).
- **No trust in client-supplied money.** Prices, tax, commission and totals are resolved server-side, always (SEC-02).

### 4.3 Runtime topology

| Tier | Scaling trigger | Phase 1 | Phase 3 |
|---|---|---|---|
| API (ECS Fargate) | CPU > 60% or ALB req/target | 2 tasks (Multi-AZ) | 8–20 tasks, auto-scaled |
| Worker (ECS Fargate) | Queue depth | 1 task | 4–10 tasks, per-queue |
| PostgreSQL | — | db.t4g.medium Multi-AZ | db.r7g.xlarge + 2 read replicas + RDS Proxy |
| Redis | Memory / evictions | cache.t4g.small | cache.r7g.large cluster mode |

---

## 5. Module Breakdown

Sixteen bounded modules. Each owns its tables, exposes a published interface, and communicates outward only via that interface or via domain events. Cross-module direct table access is a build failure (§24.4).

| # | Module | Responsibility | Owns (principal tables) | Publishes (events) |
|---|---|---|---|---|
| 1 | **identity** | Users, credentials, OTP, sessions, refresh-token rotation, MFA, devices, consent records | `users`, `user_sessions`, `otp_challenges`, `mfa_secrets`, `devices`, `consents` | `UserRegistered`, `UserSuspended`, `SessionRevoked` |
| 2 | **authorization** | Roles, permissions, policy evaluation, tenant scoping | `roles`, `permissions`, `role_permissions`, `user_roles` | — |
| 3 | **vendor** | Vendor profile, shop, KYC lifecycle, business hours, service area, subscription plan, trust score | `vendors`, `shops`, `kyc_documents`, `kyc_verifications`, `business_hours`, `service_areas`, `vendor_trust_scores` | `VendorRegistered`, `VendorApproved`, `VendorSuspended`, `KycVerified`, `TrustScoreChanged` |
| 4 | **catalogue** | Categories, products, variants, attributes, media, HSN, stock, moderation state | `categories`, `category_attributes`, `products`, `product_variants`, `product_media`, `inventory`, `product_moderation` | `ProductSubmitted`, `ProductApproved`, `ProductRejected`, `ProductUpdated`, `StockChanged` |
| 5 | **search** | Indexing and query. Port + Postgres adapter (Phase 1) | `search_documents` (projection) | — |
| 6 | **cart** | Cart, cart items, price snapshot, merge-on-login, TTL | `carts`, `cart_items` | `CartCheckedOut` |
| 7 | **pricing-tax** | Price resolution, GST computation, commission computation per plan | `commission_rules`, `tax_rates`, `hsn_codes` | — |
| 8 | **order** | Order + SubOrder aggregates, state machines, cancellation, fulfilment tracking | `orders`, `sub_orders`, `order_items`, `order_addresses`, `order_status_history` | `OrderPlaced`, `OrderConfirmed`, `SubOrderStatusChanged`, `OrderCancelled` |
| 9 | **preorder** | Preorder campaigns, quantity pool, reservations, scheduling, expiry, balance collection | `preorder_campaigns`, `preorder_reservations` | `PreorderOpened`, `PreorderSoldOut`, `PreorderExpired`, `PreorderCancelled` |
| 10 | **fulfilment** | Delivery slots + capacity, pickup slots, QR issuance and redemption, serviceability | `delivery_slots`, `slot_capacity`, `pickup_tokens`, `serviceable_pincodes` | `PickupRedeemed`, `DeliveryCompleted` |
| 11 | **payment** | Razorpay orchestration, webhooks, idempotency, refunds, COD receivables | `payments`, `payment_attempts`, `refunds`, `webhook_events`, `idempotency_keys` | `PaymentCaptured`, `PaymentFailed`, `RefundCompleted` |
| 12 | **ledger-settlement** | Double-entry ledger, commission/TCS/TDS accrual, holds, payout runs, vendor statements | `ledger_accounts`, `ledger_entries`, `journal_entries`, `settlements`, `payouts`, `holds` | `SettlementCompleted`, `HoldPlaced`, `HoldReleased` |
| 13 | **invoicing** | Tax invoices (vendor-of-record), commission invoices, per-vendor sequential numbering, GSTR-8 export | `invoices`, `invoice_sequences`, `invoice_lines` | `InvoiceIssued` |
| 14 | **review** | Product/shop reviews, verified-purchase gate, aggregation, moderation, vendor replies | `reviews`, `review_moderation`, `review_aggregates` | `ReviewPublished`, `ReviewFlagged` |
| 15 | **risk-fraud** | Rule engine, signals, scores, cases, reports, holds, analyst queue | `fraud_rules`, `fraud_signals`, `fraud_cases`, `user_reports`, `case_actions` | `FraudCaseOpened`, `EntityFlagged` |
| 16 | **notification** | Templates, preferences, channel adapters, delivery tracking, DLT template registry | `notification_templates`, `notification_preferences`, `notifications`, `delivery_receipts` | `NotificationDelivered`, `NotificationFailed` |

**Platform-wide (not domain modules):** `media` (R2 presigning, processing pipeline), `audit` (immutable admin action log), `outbox` (relay), `scheduler` (repeatable jobs), `admin-bff` (aggregating read models for the console).

### 5.1 Module dependency rules

- **Allowed:** any module → `identity`, `authorization`, `audit`, `notification` (via published interface only).
- **Forbidden:** `catalogue` → `order`, `order` → `catalogue` internals. Order needs product data → it copies a **price/tax snapshot** onto the order line at placement (orders must be immutable against later catalogue edits). Catalogue needs sales data → it subscribes to `OrderConfirmed`.
- **Forbidden everywhere:** reading another module's tables directly, importing another module's domain entities, or a foreign key crossing a module boundary except to `users`/`vendors` (the two shared identity anchors — §6.7).

---

## 6. Database Design Strategy

### 6.1 Principles

| Principle | Rule |
|---|---|
| **Primary keys** | **UUID v7** everywhere (mandated). v7 over v4 specifically: it is time-ordered, so B-tree inserts stay sequential and avoid the index-fragmentation and write-amplification that random v4 keys cause on high-insert tables. Stored as native `uuid`. |
| **Money** | **`BIGINT` paise**, never `FLOAT`, never `NUMERIC` for storage. Every monetary column is paired with an explicit `currency` column (`INR`). A `Money` value object in the domain forbids cross-currency arithmetic (IMP-06). |
| **Timestamps** | `TIMESTAMPTZ` always, stored UTC, rendered IST (ASM-01). Every table has `created_at`, `updated_at`. |
| **Soft deletes** | `deleted_at` on all user-visible entities; hard delete only via a DPDP erasure job (IMP-14, BR-16). All queries filter through a repository base that applies the predicate — never ad hoc. |
| **Immutability** | Financial rows (`ledger_entries`, `payments`, `invoices`, `audit_logs`) are **append-only**. Corrections are new reversing entries, never `UPDATE`. Enforced by a `BEFORE UPDATE` trigger that raises. |
| **Enums** | Postgres native enums for closed sets that rarely change (`order_status`); lookup tables for business-configurable sets (`commission_rules`). |
| **Naming** | `snake_case` tables (plural) and columns; Prisma `@map`/`@@map` to `camelCase` in code. |
| **Constraints in the database** | Not only in the application. `CHECK`, `UNIQUE`, `FOREIGN KEY`, `NOT NULL`, exclusion constraints. The database is the last line of correctness — application bugs must not be able to create a negative preorder quantity. |
| **JSONB** | Only for genuinely open-shaped data: per-category product attributes, fraud rule definitions, webhook payload archives, notification template variables. **Never** for anything queried in a hot path or requiring referential integrity. |

### 6.2 Entity model — conceptual

```
                            ┌──────────┐
                            │  users   │
                            └─────┬────┘
              ┌───────────────────┼───────────────────┬─────────────┐
              │                   │                   │             │
        ┌─────▼─────┐      ┌──────▼──────┐      ┌─────▼─────┐ ┌────▼─────┐
        │ customers │      │  vendors    │      │  admins   │ │ sessions │
        │ (profile) │      │             │      │           │ │ consents │
        └─────┬─────┘      └──────┬──────┘      └───────────┘ └──────────┘
              │                   │
        ┌─────▼──────┐     ┌──────▼──────────────────────────────┐
        │ addresses  │     │ shops · kyc_documents ·             │
        │ (geocoded) │     │ business_hours · service_areas ·    │
        └────────────┘     │ trust_scores · subscriptions        │
                           └──────┬──────────────────────────────┘
                                  │
        ┌─────────────────────────▼────────────────────────────┐
        │ categories ──< products ──< product_variants          │
        │      │            │              │                   │
        │      │            └──< product_media                 │
        │      └──< category_attributes    └──< inventory       │
        └─────────────────────────┬────────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │  preorder_campaigns       │
                    │      └──< preorder_reservations
                    └─────────────┬─────────────┘
                                  │
   ┌──────┐   ┌──────────────────▼───────────────────────────────┐
   │carts │──►│ orders ──< sub_orders ──< order_items             │
   │      │   │    │           │              (price/tax snapshot)│
   └──────┘   │    │           ├──< pickup_tokens                 │
              │    │           ├──< delivery_assignments          │
              │    │           └──< sub_order_status_history      │
              │    └──< order_addresses                           │
              └────────────────┬─────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┬───────────────┐
        │                      │                      │               │
  ┌─────▼──────┐      ┌────────▼────────┐    ┌────────▼──────┐  ┌────▼─────┐
  │ payments   │      │ journal_entries │    │  invoices     │  │ reviews  │
  │  └<refunds │      │  └< ledger_entries   │  └< inv_lines │  │          │
  └────────────┘      │ ledger_accounts │    │ inv_sequences │  └──────────┘
                      │ settlements     │    └───────────────┘
                      │  └< payouts     │
                      │ holds           │
                      └─────────────────┘

  Cross-cutting: audit_logs · outbox_events · notifications ·
                 fraud_rules/signals/cases · user_reports
```

### 6.3 Key relationship decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Order ↔ Vendor cardinality** | `Order 1..N SubOrder`, each SubOrder belongs to exactly one vendor (ASM-03) | This is the most consequential schema decision in the system. One customer payment, N independent fulfilment lifecycles, N settlements, N cancellation paths. Modelling Order:Vendor as 1:1 would make multi-vendor carts impossible without a rewrite. |
| **Order line pricing** | **Full snapshot** on `order_items`: unit price, tax rate, HSN, commission rate, product name, variant name, vendor name | Orders must be immutable evidence of what was agreed. A vendor editing a price or deleting a product must not alter historic orders or invoices. Denormalisation here is correctness, not optimisation. |
| **Product ↔ Variant** | Product is the marketing entity; **Variant is the sellable unit** carrying SKU, price, stock, unit of measure and quantity step (ASM-15, FR-10/11) | Every product has at least one (default) variant. This makes "fish, per kg, 250 g steps" and "shirt, size M, blue" the same model. Orders reference variants, never products. |
| **Stock** | Separate `inventory` row per variant, with `available`, `reserved`, `version` | Isolates the hot row from the wide product row; makes the atomic decrement cheap. |
| **Preorder** | `preorder_campaign` attached to a variant, **not** a separate product type | A preorder is a *selling mode*, not a product kind. Keeps the catalogue model simple. |
| **Money movement** | **Double-entry only** (IMP-02). No `balance` column anywhere. Vendor balance is `SUM(ledger_entries)` over the vendor's account, materialised into a snapshot table for reads. | Commission, TCS, TDS, refunds, holds and COD receivables cannot be reconciled with mutable balances. Every journal entry's debits must equal its credits — enforced by a deferred constraint. |
| **Addresses** | `addresses` (customer's book) is separate from `order_addresses` (snapshot on the order) | Same immutability reasoning as pricing. |
| **Geospatial** | `shops.location geography(Point,4326)` + GiST index; `addresses.location` likewise; plus `serviceable_pincodes` fast path (ASM-17, IMP-11) | 95% of serviceability checks resolve from a pincode lookup; PostGIS handles the precise radius test. |
| **Categories** | Adjacency list + a materialised `path` (`ltree` or a denormalised array) | Nested categories with cheap ancestor/descendant queries without recursive CTEs on every page load. |

### 6.4 Indexing strategy

| Table | Indexes |
|---|---|
| `products` | `(vendor_id, status)`, `(category_id, status)` partial `WHERE deleted_at IS NULL`, GIN on `search_vector`, GIN `pg_trgm` on `name` |
| `product_variants` | `(product_id)`, unique `(vendor_id, sku)` |
| `inventory` | PK `(variant_id)` — single-row lookup for the hot decrement path |
| `orders` | `(customer_id, created_at DESC)`, `(status, created_at)` |
| `sub_orders` | `(vendor_id, status, created_at DESC)` ← the vendor dashboard's primary query |
| `order_items` | `(sub_order_id)`, `(variant_id, created_at)` |
| `payments` | unique `(razorpay_payment_id)`, `(order_id)`, `(status, created_at)` |
| `ledger_entries` | `(account_id, created_at)`, `(journal_entry_id)` |
| `preorder_campaigns` | `(variant_id)`, partial `(status, opens_at)` `WHERE status='SCHEDULED'` |
| `pickup_tokens` | unique `(token_hash)`, `(sub_order_id)` |
| `webhook_events` | unique `(provider, event_id)` — the replay guard |
| `idempotency_keys` | unique `(key, endpoint)` with a TTL sweep |
| `shops`, `addresses` | GiST on `location` |
| `audit_logs`, `outbox_events` | `(created_at)` — both **range-partitioned monthly** |
| `reviews` | unique `(user_id, variant_id, sub_order_id)` — one review per purchase |

Index discipline: no index is added without a query that needs it; `pg_stat_statements` and unused-index reports are reviewed monthly.

### 6.5 Partitioning & archival

Declarative **range partitioning by month** on `audit_logs`, `outbox_events`, `notifications`, `fraud_signals`, and `order_status_history` from day one — cheap now, and impossible to retrofit online later. Partitions older than the retention window (NFR-06) are detached and archived to R2 as Parquet, then dropped.

### 6.6 Multi-tenant isolation (SC-09 / SEC-06)

Three layers, in order of reliance:

1. **Repository-enforced scoping (primary).** A `TenantScopedRepository` base injects `vendorId` from the authenticated principal into every query. Vendor-facing repositories cannot be constructed without a tenant context. A controller physically cannot ask for another vendor's data.
2. **Automated cross-tenant tests (verification).** For every vendor-facing endpoint, a test asserts that Vendor A receives `404` for Vendor B's resource. This suite is generated from the route table so a new endpoint without a test fails CI.
3. **PostgreSQL Row-Level Security (defence in depth).** Enabled on the highest-value tables (`sub_orders`, `payments`, `ledger_entries`, `kyc_documents`) with a session-variable policy. If layers 1 and 2 both fail, the database still refuses.

### 6.7 Migrations

Prisma Migrate, forward-only, reviewed as SQL. Rules: every migration is backward-compatible with the currently deployed application (expand → migrate → contract, over three releases for a column rename); no destructive change in the same release that stops using a column; every migration is tested against a production-sized restore in staging; long-running index builds use `CREATE INDEX CONCURRENTLY` in a manual step, never inside a transaction.

---

## 7. Authentication & Authorization

### 7.1 Authentication methods (ASM-05, FR-01)

| Principal | Primary | Secondary | MFA |
|---|---|---|---|
| **Customer** | Phone (E.164, +91) + 6-digit OTP | Optional email+password after first login | Optional TOTP |
| **Vendor** | Phone + OTP | Email + password | **Mandatory TOTP** before payout details can be changed or funds withdrawn |
| **Admin** | Email + password (Argon2id) | — | **Mandatory TOTP, always** |

### 7.2 Token architecture (SEC-01)

The PRD says "JWT-based authentication". The naïve implementation of that phrase — a long-lived JWT in `localStorage` — is unsafe and unrevocable. The design is:

| Token | Lifetime | Storage | Contents |
|---|---|---|---|
| **Access token** (JWT, EdDSA) | **10 minutes** | **JavaScript memory only** — never `localStorage`, never `sessionStorage` | `sub`, `sid` (session id), `role`, `vendorId?`, `jti`, `exp`, `iat`, `aud`, `iss` |
| **Refresh token** (opaque, 256-bit random) | 30 days sliding | `httpOnly; Secure; SameSite=Strict` cookie, path-scoped to `/api/v1/auth` | Hash stored server-side against a session row |

**Refresh rotation with reuse detection.** Every refresh issues a new refresh token and invalidates the old one. If a already-used refresh token is presented, that is definitionally a stolen token: **the entire session family is revoked** and the user is notified. This is what makes a stolen refresh token a bounded rather than permanent compromise.

**Revocation.** A server-side `user_sessions` row is the source of truth. Suspending a vendor, changing a password, or a user's "log out all devices" action deletes sessions and adds the live `jti`s to a Redis denylist with a TTL equal to the remaining access-token life (max 10 minutes of exposure). This directly solves the PRD's unstated problem: a suspended vendor with a 7-day JWT would otherwise keep trading for a week.

**Asymmetric signing (EdDSA/Ed25519)** rather than HS256: the private key lives only in the auth module, so a compromise of any other component cannot mint tokens. Keys are rotated quarterly with a published JWKS and an overlap window.

### 7.3 OTP handling (SEC-09)

Stored hashed (SHA-256 + per-challenge salt), never in plaintext, never in logs. 5-minute TTL, single use, maximum 5 verification attempts, then the challenge is destroyed. Rate limits: 1 OTP per phone per 60 s, 5 per phone per hour, 20 per IP per hour, plus a global circuit breaker on spend. CAPTCHA after 3 failures. Uniform responses regardless of whether the number is registered (SEC-15).

### 7.4 Authorization model

**RBAC with resource-level policy checks and tenant scoping.** Three distinct questions are asked on every request, in order:

1. **Authentication** — who is this? (middleware)
2. **Permission** — may this role perform this action at all? (`product:approve`, `payout:release`) — declarative, checked in the interface layer.
3. **Resource authorisation** — may *this principal* act on *this specific object*? (Is this sub-order theirs?) — checked in the **application layer**, because only the use case has loaded the object.

Step 3 is where every marketplace leaks data (SEC-06). Locating it in the application layer, backed by repository tenant scoping (§6.6), makes the check impossible to forget: the repository will not return another vendor's row in the first place.

**Policy evaluation** is a pure function `(principal, action, resource) → Allow | Deny` with an explicit deny-by-default. Policies live in the `authorization` module and are unit-tested as a truth table.

### 7.5 Additional controls

Password policy: Argon2id (memory-hard), minimum 10 characters, checked against the Have-I-Been-Pwned k-anonymity range API (SEC-26), lockout with exponential backoff after 5 failures. Admin console: separate subdomain, separate cookie scope, 30-minute idle timeout, optional IP allowlist, and every action written to the immutable audit log (FR-60). Sensitive operations (payout details, password change, MFA disable) require **step-up re-authentication** regardless of session age.

---

## 8. User Roles & Permissions

The PRD defines three roles. A production marketplace needs finer granularity, because "Admin" as a single role means the support intern who answers tickets can also release ₹5 lakh in held funds (FR-09).

### 8.1 Role hierarchy

```
CUSTOMER
VENDOR_OWNER ──┬── VENDOR_MANAGER ── VENDOR_STAFF          (tenant-scoped, FR-08)
ADMIN ─────────┬── SUPER_ADMIN
               ├── CATALOGUE_MODERATOR
               ├── FINANCE_ADMIN
               ├── RISK_ANALYST
               └── SUPPORT_AGENT
```

### 8.2 Permission matrix

Legend: ● full · ◐ own/tenant-scoped only · ○ read-only · — none

| Permission | CUST | V_OWNER | V_MGR | V_STAFF | SUPPORT | CAT_MOD | FINANCE | RISK | SUPER |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Browse catalogue | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| Place order | ● | — | — | — | — | — | — | — | — |
| View own orders | ◐ | — | — | — | ○ | — | ○ | ○ | ● |
| Cancel own order | ◐ | — | — | — | ● | — | — | — | ● |
| Write review | ◐ | — | — | — | — | — | — | — | — |
| Report abuse/fraud | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| Manage shop profile | — | ◐ | ◐ | — | — | — | — | — | ● |
| Submit/edit KYC | — | ◐ | — | — | — | — | — | — | ○ |
| Create/edit product | — | ◐ | ◐ | ◐ | — | — | — | — | ● |
| Publish/unpublish product | — | ◐ | ◐ | — | — | ● | — | — | ● |
| Manage inventory | — | ◐ | ◐ | ◐ | — | — | — | — | ○ |
| Create preorder campaign | — | ◐ | ◐ | — | — | — | — | — | ○ |
| View vendor orders | — | ◐ | ◐ | ◐ | ○ | — | ○ | ○ | ● |
| Accept/reject order | — | ◐ | ◐ | ◐ | — | — | — | — | ● |
| Scan pickup QR | — | ◐ | ◐ | ◐ | — | — | — | — | — |
| Configure delivery/slots | — | ◐ | ◐ | — | — | — | — | — | ○ |
| View vendor payouts | — | ◐ | ○ | — | — | — | ● | ○ | ● |
| Change payout bank details | — | ◐ (MFA + step-up) | — | — | — | — | — | — | ○ |
| Manage vendor staff | — | ◐ | — | — | — | — | — | — | ● |
| Approve/reject product | — | — | — | — | — | ● | — | — | ● |
| Approve/reject vendor KYC | — | — | — | — | — | ○ | ○ | ● | ● |
| Suspend vendor/user | — | — | — | — | — | — | — | ● | ● |
| Place/release fund hold | — | — | — | — | — | — | ● | ● | ● |
| Issue refund (≤ ₹5,000) | — | — | — | — | ● | — | ● | — | ● |
| Issue refund (> ₹5,000) | — | — | — | — | — | — | ● | — | ● |
| Trigger settlement run | — | — | — | — | — | — | ● | — | ● |
| View/close fraud cases | — | — | — | — | ○ | — | ○ | ● | ● |
| Configure fraud rules | — | — | — | — | — | — | — | ● | ● |
| Moderate reviews | — | — | — | — | ○ | ● | — | ○ | ● |
| Manage categories/commission | — | — | — | — | — | ○ | ● | — | ● |
| View platform analytics | — | — | — | — | ○ | ○ | ● | ○ | ● |
| Manage admin users/roles | — | — | — | — | — | — | — | — | ● |
| View audit log | — | — | — | — | — | — | ○ | ○ | ● |
| Impersonate user (audited) | — | — | — | — | ● | — | — | — | ● |
| Export PII / DPDP requests | — | — | — | — | — | — | — | — | ● |

**Separation of duties (deliberate):** the role that *approves* a product cannot *release funds*; the role that *opens* a fraud case cannot *unilaterally refund*; refunds above a threshold require FINANCE. Every one of these is an audited action.

---

## 9. API Strategy

### 9.1 Style

**REST over HTTPS, JSON, OpenAPI 3.1 contract-first** (IMP-08).

REST rather than GraphQL because: the consumers are three first-party clients with known query shapes; RTK Query (PRD-mandated) is built for REST resources; REST caches at the CDN trivially, which matters for a catalogue on mobile; and GraphQL's cost — query-depth attacks, N+1 resolvers, per-field authorisation — buys us nothing here. GraphQL is reconsidered only if third-party API consumers appear.

**Contract-first**: the OpenAPI document is the source of truth, generated from Zod schemas. It produces (a) request validation middleware, (b) the typed RTK Query client, (c) contract tests, and (d) the published documentation. FE/BE drift becomes structurally impossible.

### 9.2 Conventions

| Aspect | Convention |
|---|---|
| Versioning | URI: `/api/v1/...`. Breaking changes bump the version; 6-month deprecation with `Sunset` headers (NFR-19) |
| Naming | Plural nouns, kebab-case paths, camelCase JSON fields |
| Method semantics | `GET` safe & cacheable; `POST` create/action; `PATCH` partial update; `PUT` avoided; `DELETE` soft-deletes |
| Non-CRUD actions | Sub-resource verbs: `POST /sub-orders/{id}/accept`, `POST /pickup-tokens/{id}/redeem` |
| Pagination | **Cursor-based** on all list endpoints (offset pagination degrades and skips rows under concurrent inserts). `?limit=20&cursor=...`, hard ceiling `limit=100` (PERF-08) |
| Filtering/sorting | Allowlisted fields only — never pass user input into an `orderBy` |
| Idempotency | `Idempotency-Key` header **required** on all money-moving POSTs, honoured for 24 h (IMP-07) |
| Correlation | `X-Request-Id` accepted or generated; propagated through logs, jobs and outbound calls |
| Rate limiting | `X-RateLimit-Limit/Remaining/Reset`, `429` + `Retry-After` |
| Compression | Brotli/gzip |
| Time | ISO-8601 UTC in, ISO-8601 UTC out; clients render IST |
| Money in payloads | `{ "amount": 149900, "currency": "INR" }` — integer minor units, never a decimal string |

### 9.3 Standard envelopes

Success:
```
{ "data": <object|array>, "meta": { "requestId": "...", "pagination": { "nextCursor": "...", "hasMore": true } } }
```

Error (RFC 7807 Problem Details, extended):
```
{ "error": { "code": "PREORDER_SOLD_OUT",
             "message": "This preorder is no longer available.",
             "details": [ { "field": "variantId", "issue": "..." } ],
             "requestId": "...", "timestamp": "..." } }
```

`code` is a stable machine-readable enum the frontend switches on; `message` is human-facing and localisable. The frontend never parses `message`.

### 9.4 Surface map

| Group | Base path | Auth |
|---|---|---|
| Auth | `/api/v1/auth/*` | public / refresh cookie |
| Catalogue (public) | `/api/v1/catalogue/*`, `/api/v1/search` | optional |
| Cart & checkout | `/api/v1/cart`, `/api/v1/orders` | customer |
| Customer self-service | `/api/v1/me/*` | customer |
| Vendor | `/api/v1/vendor/*` | vendor, tenant-scoped |
| Admin | `/api/v1/admin/*` | admin, MFA, separate origin |
| Webhooks | `/api/v1/webhooks/{provider}` | signature-verified, no session |
| Health | `/healthz` (liveness), `/readyz` (readiness) | internal |

### 9.5 Caching

Public catalogue `GET`s carry `Cache-Control: public, max-age=60, stale-while-revalidate=300` and `ETag`, cached at the Cloudflare CDN. **Every authenticated response is `Cache-Control: private, no-store`** — this also prevents the service worker from persisting a customer's data on a shared device (SEC-14).

---

## 10. Payment Architecture

### 10.1 The central decision

PRD §5.7 states *"Payments go to platform first, settlement to vendors later."* Implemented literally, Leen Mart would collect and hold customer funds — which, for a non-licensed entity, conflicts with RBI's Payment Aggregator framework (BR-05 / AMB-02). 

**Design: Razorpay Route with linked accounts (ASM-02).** Razorpay is the licensed aggregator and holds the funds. Each approved vendor gets a Razorpay **linked account**, created at KYC approval. At capture, the platform instructs a **transfer** to each vendor's linked account with `on_hold: true`. The platform then releases holds according to its own settlement policy.

This preserves every business outcome the PRD wanted — the platform controls timing, can hold funds on suspicion, and deducts commission — while removing the licensing exposure. It also means **Leen Mart never holds customer money**, which materially reduces regulatory, insurance and audit burden.

### 10.2 Money flow

```
Customer pays ₹1,000 (incl. GST)
        │
        ▼
Razorpay captures → funds in Razorpay's escrow
        │
        ├── Transfer to Vendor linked account: ₹1,000 − commission − TCS   [on_hold: true]
        └── Platform account: commission + GST on commission
                                     │
                          (hold released after the settlement rule is satisfied:
                           delivery confirmed / pickup redeemed + dispute window
                           elapsed / no open fraud case)
                                     ▼
                        Razorpay settles to the vendor's bank
```

**Internal double-entry ledger runs in parallel** and is the platform's own system of record (IMP-02). Razorpay is the money rail; the ledger is the truth about who is owed what. They are reconciled daily (§10.7).

### 10.3 Ledger design

Accounts (per vendor and per platform function): `VENDOR_PAYABLE`, `VENDOR_RECEIVABLE_COD`, `PLATFORM_COMMISSION_INCOME`, `GST_OUTPUT`, `TCS_PAYABLE`, `TDS_PAYABLE`, `REFUND_CLEARING`, `HOLD_SUSPENSE`, `GATEWAY_CLEARING`.

Every business event produces a **journal entry** whose ledger lines sum to zero. Illustrative (₹1,000 order, 10% commission, 5% GST on goods, 18% GST on commission, 1% TCS):

| Event | Debit | Credit |
|---|---|---|
| Payment captured | GATEWAY_CLEARING 1,000 | VENDOR_PAYABLE 1,000 |
| Commission accrued | VENDOR_PAYABLE 118 | PLATFORM_COMMISSION_INCOME 100 · GST_OUTPUT 18 |
| TCS withheld | VENDOR_PAYABLE 9.52 | TCS_PAYABLE 9.52 |
| Hold placed | VENDOR_PAYABLE 872.48 | HOLD_SUSPENSE 872.48 |
| Hold released / payout | HOLD_SUSPENSE 872.48 | GATEWAY_CLEARING 872.48 |

Ledger rows are **append-only** (§6.1). A refund is a new reversing journal entry, never an edit. This is what makes a vendor's statement, a GSTR-8 export and a dispute investigation all derivable from one immutable source.

### 10.4 Payment lifecycle

```
CREATED ─► PENDING ─► AUTHORIZED ─► CAPTURED ─► SETTLED
   │          │            │            │
   │          ▼            ▼            ▼
   └────► FAILED     VOIDED      PARTIALLY_REFUNDED ─► REFUNDED
```

Transitions are driven **only by verified webhooks**, never by the browser callback. The browser callback merely triggers a UI poll; if the customer closes the tab mid-payment, the webhook still completes the order (FR-44). Unresolved `PENDING` payments are reconciled by a scheduled job that queries Razorpay directly.

### 10.5 Correctness controls

| Risk | Control |
|---|---|
| Client tampers with the amount (SEC-02) | Server resolves every price from the database; the client never sends money values. Before fulfilment, `captured_amount == order.total` is asserted. |
| Duplicate payment / double refund | `Idempotency-Key` required; `(key, endpoint)` unique with a stored response; retries return the original result (IMP-07) |
| Forged webhook (SEC-07) | HMAC signature verification against the webhook secret; timestamp freshness; `(provider, event_id)` unique for replay suppression; the webhook body is treated as a *notification*, and the payment is re-fetched from Razorpay before acting on it |
| Webhook out-of-order or lost | Handlers are idempotent and state-machine-guarded (a `captured` event on an already-captured payment is a no-op); a reconciliation job backfills anything missed |
| Partial capture / amount mismatch | Rejected and flagged as a fraud signal |
| Refund exceeding the paid amount | Constraint: `SUM(refunds) <= payment.amount`, enforced in the database |

### 10.6 Refunds (BR-06 — policy pending)

Refunds are always to the original instrument (ASM-16). Flow: refund authorised (per the §8 matrix) → reversing journal entry → Razorpay refund API (idempotent) → hold adjusted or vendor receivable created if funds already settled → customer notified. Commission on a refunded order is reversed; commission GST is reversed in the same period where possible, else adjusted via a credit note.

### 10.7 COD (BR-09)

COD inverts the flow: the vendor collects the cash and therefore **owes** the platform its commission. On COD delivery confirmation, the ledger debits `VENDOR_RECEIVABLE_COD` and credits `PLATFORM_COMMISSION_INCOME`. The receivable is **netted against the vendor's next online-order payout**. Vendors with a COD receivable exceeding a configured ceiling have COD disabled automatically. COD eligibility itself is gated on the trust score, an order-value cap and category exclusions (ASM-10).

### 10.8 Reconciliation

A nightly job fetches Razorpay's settlement report and reconciles it line by line against `payments`, `refunds` and `ledger_entries`. Any discrepancy raises a **`RECONCILIATION_MISMATCH`** alert to FINANCE with the offending IDs. Unreconciled items block the payout run — a payout is never made from unverified data.

### 10.9 Subscription billing (FR-50)

Razorpay Subscriptions with an e-mandate. Failed charge → 7-day grace with escalating notifications → downgrade to the free/commission plan (products beyond the new quota are **unpublished, never deleted** — BR-02). Plan changes take effect at the next cycle with proration (ASM-06).

### 10.10 PCI scope

Razorpay **hosted checkout only**. Leen Mart's servers never see, transmit or store a card number, CVV or expiry. This keeps compliance at **SAQ-A** (NFR-17). Any proposal to build a custom card form must be treated as a change of regulatory scope and rejected by default.

---

## 11. Notification Architecture

### 11.1 Design

Notifications are **asynchronous, templated, preference-aware, and never in the request path** (SC-06).

```
Domain event ──► outbox_events (same TX as the business write)
                       │
              Outbox relay (worker, polls every 1s)
                       │
                 BullMQ queue: notifications
                       │
        NotificationOrchestrator
          ├─ resolve recipient + locale
          ├─ check preferences & quiet hours (FR-58)
          ├─ select channels by event priority
          ├─ render template (+ DLT template ID for SMS)
          └─ dispatch per channel, each with its own retry policy
                 │           │            │
             ┌───▼──┐   ┌────▼────┐  ┌────▼─────┐
             │ SES  │   │SMS (DLT)│  │ Web Push │
             └───┬──┘   └────┬────┘  └────┬─────┘
                 └───── delivery receipts ─┘ → notifications.status
```

### 11.2 Channel strategy

| Event | Priority | Push | SMS | Email | In-app |
|---|---|---|---|---|---|
| OTP | Critical | — | ● (never email) | — | — |
| Order confirmed (customer) | High | ● | ● | ● (with invoice) | ● |
| **New order (vendor)** | **Critical** | ● + **audible alert** | ● | — | ● |
| Payment failed | High | ● | ● | ● | ● |
| Preorder opening soon | Medium | ● | — | ● | ● |
| Preorder expiring / balance due | High | ● | ● | ● | ● |
| Pickup reminder (T-2h) | High | ● | ● | — | ● |
| Delivery slot reminder | Medium | ● | — | — | ● |
| Order cancelled / refunded | High | ● | ● | ● | ● |
| Product approved/rejected | Medium | ● | — | ● | ● |
| KYC status | High | ● | ● | ● | ● |
| Payout settled | Medium | ● | — | ● | ● |
| Fraud/hold notice | Critical | ● | ● | ● | ● |
| Review received | Low | — | — | ● (digest) | ● |
| Marketing | Low | opt-in | opt-in | opt-in | ● |

**Critical events bypass quiet hours and preferences.** Transactional messages are never suppressible; marketing always is (and is opt-in, per DPDP consent — BR-16).

### 11.3 Reliability

At-least-once delivery via the outbox; consumers are idempotent on `(event_id, channel, recipient)`. Retries: 3 attempts with exponential backoff (1 s / 10 s / 60 s), then dead-letter with an alert. **Per-channel circuit breakers** — if the SMS provider is failing, the breaker opens and traffic degrades to push+email rather than blocking the queue. SES bounce/complaint feedback via SNS automatically suppresses bad addresses.

### 11.4 India-specific constraints

**SMS requires DLT registration** of the sender header and every template with the telecom regulator; unregistered templates are silently dropped by carriers. Templates are therefore stored with their DLT template ID, and a template without one cannot be activated (FR-58). **iOS web push only works for installed PWAs (iOS 16.4+)** (AMB-20) — so push is never the sole channel for a critical event, and SMS is always the fallback. **WhatsApp Business API is the Phase-2 primary channel** (IMP-12): better delivery, better cost, no install requirement.

### 11.5 Real-time vendor alerts (FR-64)

A 6 a.m. fish order must make a noise. Web Push handles the background case; when the vendor portal is open, **Server-Sent Events** (`GET /api/v1/vendor/stream`) push new-order events to the open tab, which plays a looping audible alert until acknowledged. SSE rather than WebSockets: the traffic is one-directional, SSE reconnects automatically, and it traverses proxies without special handling.

---

## 12. File Storage Architecture

### 12.1 Buckets and classification

| Bucket | Contents | Access | Encryption | Retention |
|---|---|---|---|---|
| `leenmart-public-media` | Product images, shop logos, banners | Public via CDN | At rest (R2 default) | Life of the entity + 90 days |
| `leenmart-private-kyc` | PAN, Aadhaar, bank proof, FSSAI, shop licence | **Never public.** Presigned GET ≤ 60 s, admin-role only, every access audited | **Envelope encryption, application-side, KMS-managed key** | 8 years post-relationship, then erasure (NFR-06) |
| `leenmart-private-docs` | Invoices, settlement reports, GSTR exports | Presigned, owner or FINANCE only | At rest | 8 years (tax) |
| `leenmart-archive` | Detached partitions as Parquet, DB export archives | Internal only | At rest | Per retention policy |

### 12.2 Upload pipeline (SC-05, SEC-10)

Files **never stream through the API tier**.

```
1. Client → POST /api/v1/media/upload-intent { purpose, contentType, sizeBytes }
2. API validates: role, purpose quota, declared type in allowlist, size ≤ cap
   → returns a presigned PUT URL (5-min TTL, content-type and content-length locked)
     + a pending media_asset row (status = AWAITING_UPLOAD)
3. Client PUTs directly to R2
4. Client → POST /api/v1/media/{id}/complete
5. Worker (async):
     a. Read magic bytes — reject if they contradict the declared type
     b. REJECT SVG entirely (stored-XSS vector)
     c. Re-encode the image (destroys any embedded payload)
     d. STRIP EXIF — vendor phone photos embed GPS coordinates of the seller's home
     e. Generate variants: 200/400/800/1600 px, WebP + AVIF
     f. Malware scan
     g. Perceptual hash → duplicate/stolen-image detection signal
     h. NSFW / policy classifier → moderation queue if flagged (FR-19)
     i. status = READY  → domain event
6. Product publication is blocked while any of its media is not READY.
```

Public media is served from `cdn.leenmart.in` (Cloudflare in front of R2) with immutable, content-hashed keys and a 1-year `max-age` — safe because a new upload produces a new key. Cloudflare's **zero egress fee** is the reason R2 was chosen over S3 for an image-heavy mobile marketplace.

### 12.3 KYC document handling (SEC-05, BR-16)

Client-side envelope encryption before upload; the data key is wrapped by a KMS CMK and stored beside the object reference. Decryption is only possible through a dedicated service method that **writes an audit record before returning the presigned URL**. Documents are displayed masked by default (last 4 characters), with full view an explicit, audited action. Aadhaar carries additional statutory handling duties — **legal review is a gate on this module**. Deletion is via a scheduled erasure job that removes the object, shreds the data key, and writes a tombstone.

---

## 13. QR Pickup Flow

PRD §5.6 specifies a QR that is "valid until scanned" and states this "prevents fraud". As written it does the opposite: an unbounded-lifetime bearer token that can be screenshotted and shared (AMB-06, SEC-03). It also leaves the vendor in sole control of completion, which triggers settlement (FR-42, SEC-04). Both are fixed here.

### 13.1 Token design

The QR encodes a **compact signed token**, not an order ID:

```
Payload : { v:1, soid:<sub_order_id>, nonce:<128-bit>, iat, exp, aud:"pickup" }
Signature: Ed25519, key held only by the fulfilment module
Stored  : SHA-256(token) in pickup_tokens, plus status, exp, redeemed_at,
          redeemed_by, redemption_geo
```

Properties: **short-lived** (valid from `pickup_window_start − 30 min` to `pickup_window_end + 2 h`); **single-use** (atomic compare-and-set to `REDEEMED`); **rotating** — the customer's screen regenerates the displayed code every 60 seconds from the same reservation, so a screenshot is stale almost immediately; **unforgeable** — signature verified server-side; **non-enumerable** — a 128-bit nonce, and the sub-order ID alone is useless without a signature.

### 13.2 Flow

```
Order CONFIRMED (pickup)
   └─► pickup token issued, shown in the customer PWA (offline-capable: the signed
       token is cached so it renders without connectivity — FR-40)

T-2h  ─► pickup reminder (push + SMS)

At the counter:
   1. Customer opens the order → rotating QR
   2. Vendor scans with the vendor portal (camera API)
   3. Vendor app → POST /api/v1/pickup-tokens/redeem { token, geo }
   4. Server: verify signature → verify exp → verify sub-order status = READY_FOR_PICKUP
              → verify the scanning vendor OWNS this sub-order   ← prevents cross-vendor redemption
              → atomic UPDATE ... SET status='REDEEMED' WHERE status='ISSUED'  (0 rows = already used)
              → record geo, device, timestamp
   5. Balance due (partial-advance preorder)? → collect online BEFORE redemption succeeds
   6. Sub-order → COMPLETED; customer notified; 24h dispute window opens (ASM-13)
   7. Settlement hold released after the dispute window with no complaint
```

### 13.3 Anti-fraud controls

| Attack | Control |
|---|---|
| Screenshot shared with a third party | 60-second rotation; short validity window |
| Replay of a used token | Atomic single-use redemption; the second attempt affects 0 rows |
| Token forgery / enumeration | Ed25519 signature + 128-bit nonce |
| **Vendor marks complete without handing over goods** (SEC-04) | The vendor cannot *self*-complete — redemption requires the customer's live token. Plus: geo + timestamp recorded, and settlement held 24 h so the customer can dispute (ASM-13) |
| Vendor redeems another vendor's order | Ownership check at step 4 |
| Offline venue (fish market, 6 a.m.) | Token verification is signature-based, so the **vendor app can verify locally** and queue the redemption; the server performs the authoritative single-use check on reconnect. Conflicts (two offline redemptions) surface as a fraud signal |
| Lost phone / new device | Customer requests reissue → old token revoked, new nonce issued, event audited (FR-39) |
| Scanner broken | Manual completion by the vendor **plus** a 4-digit code read from the customer's screen; flagged in the audit log and counted as a fraud signal if frequent (FR-43) |
| No-show | Auto-transition to `PICKUP_MISSED` after the window + grace; policy per BR-07 |

---

## 14. Preorder Workflow

The flagship feature, and the hardest engineering problem in the platform.

### 14.1 Model

A **preorder campaign** attaches to a product variant (§6.3) and defines: `opens_at`, `order_cutoff_at` (the PRD's "expiry" — clarified per ASM-12 as the last moment to *order*), `fulfilment_window_start/end` (when to collect), `total_quantity`, `remaining_quantity`, `advance_percent` (0–100), `max_per_customer`, `fulfilment_mode` (pickup / delivery / both), and `cancellation_policy_id`.

### 14.2 Lifecycle

```
DRAFT ─► SCHEDULED ─(opens_at)─► OPEN ─┬─(remaining = 0)──► SOLD_OUT ─┐
                                        ├─(order_cutoff)───► CLOSED ───┤
                                        └─(vendor action)──► CANCELLED │
                                                                       ▼
                                    FULFILLING ─► COMPLETED / PARTIALLY_FULFILLED
```

`SCHEDULED → OPEN` and `OPEN → CLOSED` are driven by **delayed BullMQ jobs** scheduled at creation, with a reconciling cron sweep every minute as a safety net (a missed job must never leave a campaign open past its cutoff). This scheduler is a component the PRD does not mention but the feature requires (FR-37).

### 14.3 Customer journey

```
Browse (countdown to opens_at, "notify me")
   └─► OPEN → add to cart
        └─► CHECKOUT
             ├─ soft reservation created, TTL 10 min (ASM-11)   ← quantity held, not yet sold
             ├─ pay advance_percent of the line total
             │     · advance 100% → fully paid
             │     · advance < 100% → balance due before the fulfilment window (ASM-12)
             ├─ payment captured → reservation CONFIRMED, quantity permanently decremented
             └─ payment failed / TTL expired → reservation released, quantity returned
   └─► T-24h: balance-due reminder (if applicable)
   └─► Balance unpaid at window open → auto-cancel per policy (ASM-12)
   └─► Fulfilment window → QR pickup (§13) or delivery
```

### 14.4 Concurrency — the core problem (SC-01, PERF-03)

A fish drop at 06:00 or a limited cake batch produces hundreds of concurrent attempts against **one row**. A naïve `SELECT remaining … then UPDATE` oversells; a naïve `SELECT … FOR UPDATE` serialises every buyer behind one lock and, at scale, exhausts the connection pool and takes down endpoints unrelated to preorders. Three layers:

**Layer 1 — Redis admission gate (load shedding).** At `opens_at` the campaign's quantity is mirrored into a Redis counter. Checkout first performs an atomic `DECRBY` in a Lua script. Requests that fail here are rejected in ~1 ms and **never reach PostgreSQL**. This absorbs the thundering herd at the edge. Redis is treated as an optimistic gate, not the source of truth.

**Layer 2 — Atomic conditional decrement in PostgreSQL (correctness).** A single statement, no read-then-write:

> `UPDATE preorder_campaigns SET remaining_quantity = remaining_quantity - :qty WHERE id = :id AND status = 'OPEN' AND remaining_quantity >= :qty` — if it affects 0 rows, the sale did not happen.

Backed by `CHECK (remaining_quantity >= 0)`, so **the database itself makes overselling impossible** regardless of application bugs. The transaction contains only this statement plus the reservation insert, and is measured in single-digit milliseconds — the lock is held briefly enough that even full serialisation is survivable.

**Layer 3 — Reconciliation.** A job compares the Redis counter against the database every 30 s and after every campaign close, correcting drift (from Redis eviction, restart or a released reservation). PostgreSQL always wins.

**Soft reservations** (10-minute TTL) prevent the "paid for a slot someone else took" race (FR-22). Expiry returns quantity to both Redis and PostgreSQL in one transaction.

### 14.5 Vendor experience (FR-36)

The operational point of preorders is production planning. The vendor portal shows a **live aggregate demand view**: total units committed, breakdown by fulfilment window and slot, a printable production sheet, and a customer list per window. Without this the feature is only half-built.

### 14.6 Edge cases

| Case | Behaviour |
|---|---|
| Vendor cancels the campaign (FR-32) | All confirmed reservations cancelled, **full advance refunded** automatically, customers notified, a fraud/performance signal recorded against the vendor |
| Customer cancels | Per the cancellation policy attached to the campaign (BR-07 — policy pending) |
| Partial fulfilment | Per-reservation fulfilment; unfulfilled reservations auto-refunded |
| Customer no-show at pickup | `PICKUP_MISSED`; refund per policy; repeated no-shows reduce the customer's trust score |
| Balance unpaid | Auto-cancel at window open; advance treated per policy |
| Campaign edited after orders exist | Quantity may only be **increased**; price, cutoff and windows are **frozen** once the first reservation is confirmed |
| Clock skew at `opens_at` | Server time is authoritative; the client countdown syncs to a server timestamp on load |

---

## 15. Vendor Approval Workflow

### 15.1 Vendor onboarding

```
REGISTERED ─► KYC_SUBMITTED ─► KYC_UNDER_REVIEW ─┬─► KYC_REJECTED ─► (resubmit)
                                                  └─► APPROVED ─► ACTIVE
                                                        │
                            SUSPENDED ◄─────────────────┤
                            (risk/performance/expiry)   │
                                  │                     │
                                  └──► reinstated ──────┘
                                          TERMINATED (wind-down, BR-27)
```

**Document set (BR-26 — pending your confirmation):** PAN (mandatory), Aadhaar or equivalent identity, bank account proof with **penny-drop verification**, GSTIN (mandatory above the turnover threshold), shop/establishment proof, and **FSSAI licence with expiry — mandatory and category-conditional for any food category** (BR-17). An FSSAI expiry date drives an automatic warning at T-30 days and automatic unpublication of food listings on expiry.

**Verification checks:** PAN format + name match; GSTIN checksum + status via the GST API; bank penny-drop for name match; duplicate detection against existing vendors on PAN, bank account, phone and device (SEC-17 — ban evasion); address geocoding. Automated checks produce a recommendation; **a human makes the decision** and their identity is recorded.

On approval: a Razorpay linked account is created, the shop is published, and the vendor starts at trust tier **NEW**.

### 15.2 Product approval (PRD §6.3 + IMP-09)

Universal manual approval does not scale to pan-India (SC-02). The design is **risk-tiered**, converging on the same trust outcome at a fraction of the human cost:

| Vendor trust tier | Low-risk category | Medium-risk | Restricted (food, vehicles, second-hand, health) |
|---|---|---|---|
| **NEW** (< 30 days or < 10 orders) | Manual | Manual | Manual + licence check |
| **ESTABLISHED** | **Auto-approve** + post-publication sampling | Manual | Manual |
| **TRUSTED** (high volume, low dispute rate) | Auto | **Auto** + sampling | Manual |
| Any tier, rule-flagged | Manual, escalated | Manual, escalated | Manual, escalated |

Automatic pre-screening (always runs, regardless of tier): prohibited-keyword and category-policy check (BR-18); image NSFW and duplicate-image classification; price-anomaly detection against category norms; mandatory-field completeness (HSN, country of origin, net quantity — BR-15/BR-21); duplicate-listing detection.

**Moderation state machine:**

```
DRAFT ─► PENDING_REVIEW ─┬─► APPROVED ─► PUBLISHED ─┬─► UNPUBLISHED (vendor)
                          │                          └─► DELISTED (admin/policy)
                          └─► REJECTED (reason code + free text) ─► (edit → PENDING_REVIEW)
```

**Editing an approved product (FR-13 — the trust hole in the PRD).** Without a rule, approval is bypassed by editing after approval. The rule (ASM-14):

| Change | Effect |
|---|---|
| Title, images, category, brand, restricted attributes | **Re-enters `PENDING_REVIEW`**; the previously published version stays live meanwhile |
| Price change > ±10% | Re-review |
| Price change ≤ ±10%, stock, description formatting | Publishes immediately, logged |
| Any change by a `NEW`-tier vendor | Re-review |

A **published version** and a **draft version** are tracked separately so a pending edit never takes a live listing down.

**Rejection** always carries a structured reason code plus optional free text, is delivered to the vendor by push/email, and is appealable once. Rejection reasons feed vendor-quality analytics — a vendor with a high rejection rate is a fraud signal.

**SLA:** first review within 24 business hours; the admin queue is prioritised by vendor tier, category risk and age; queue depth and p95 review latency are monitored (§19).

---

## 16. Fraud Detection Strategy

PRD §5.10 asks for rule-based detection, transaction holds and user reporting, with no rules, thresholds or workflow defined (FR-55, AMB-15). This section supplies the framework; the **thresholds are configuration, not code**, and are tuned in production.

### 16.1 Architecture

```
Domain events + request telemetry
          │
   Signal collectors  (velocity, device, geo, behaviour, payment, content)
          │
   fraud_signals (append-only, partitioned)
          │
   Rule engine (declarative rules in JSONB, hot-reloadable, versioned)
          │
   Risk score per entity (customer / vendor / order / device)
          │
   ┌──────┴─────────────────────────────────┐
   │ score < T1 → allow                      │
   │ T1 ≤ score < T2 → allow + flag + monitor│
   │ T2 ≤ score < T3 → challenge / hold funds│
   │ score ≥ T3 → block + open case          │
   └──────┬─────────────────────────────────┘
          │
   Analyst queue (RISK_ANALYST) → decision → action → audit
                                   │
                        feedback loop tunes rule weights
```

**No automatic suspension. Ever.** Every suspension, every fund hold beyond an automatic short window, and every delisting requires a human decision by a RISK_ANALYST, recorded with a reason. This is the direct answer to AMB-15: three competitors filing reports must not be able to suspend a legitimate vendor.

### 16.2 Signal catalogue

| Category | Signals |
|---|---|
| **Velocity** | Orders per customer/hour, order value vs the customer's historic mean, new-account order value, cancellation rate, refund rate, reports received per rolling 30 days |
| **Identity** | Device fingerprint reuse across accounts, IP/ASN reputation, multiple accounts sharing a phone/PAN/bank account/address, new-account-plus-high-value |
| **Payment** | Repeated failed payments, card/UPI testing patterns, mismatch between the captured and expected amount, COD refusal rate, chargebacks |
| **Vendor behaviour** | Order acceptance latency, cancellation rate, dispute rate, delivery SLA breach rate, price anomalies vs category, sudden catalogue expansion, review-rating distribution anomaly (a burst of 5★ from new accounts) |
| **Content** | Prohibited keywords, duplicate/stolen images (perceptual hash), contact details embedded in a listing (off-platform-transaction attempt), counterfeit brand terms |
| **Fulfilment** | Manual pickup completions without a QR scan, geographic impossibility of a scan, offline redemption conflicts |
| **Reporting** | Report volume, **reporter credibility** (a reporter's historical accuracy) and reporter–reportee relationship |

### 16.3 Rules

Declarative and versioned, of the form *condition → weight → action*, hot-reloadable without deployment. Representative starting set (thresholds are placeholders for tuning):

| Rule | Condition | Weight | Action |
|---|---|---|---|
| New-vendor high-value | Vendor age < 7 d **and** order > ₹10,000 | 40 | Hold funds until delivery + 72 h |
| Report cluster | ≥ 3 **credible** reports in 30 d against one vendor | 60 | Open case; freeze new-product publication |
| Payment testing | ≥ 5 failed payments in 10 min from one device | 70 | Block checkout 1 h; open case |
| Account farm | ≥ 3 accounts on one device in 24 h | 50 | Flag all; challenge on checkout |
| Ban evasion (SEC-17) | KYC PAN/bank/device matches a terminated vendor | 100 | Block KYC; open case |
| Review manipulation | ≥ 10 five-star reviews from accounts < 48 h old on one shop | 55 | Quarantine reviews; open case |
| Pickup anomaly | Manual completions > 20% of the vendor's pickups | 45 | Open case |
| Off-platform solicitation | Contact details detected in a listing or review | 35 | Delist; warn |
| COD abuse | Customer COD refusal rate > 30% over ≥ 5 orders | 50 | Disable COD for that customer |
| Refund abuse | Customer refund rate > 40% over ≥ 5 orders | 45 | Flag; manual review of further refunds |

### 16.4 Holds (BR-20)

An automatic hold may last a **maximum of 72 hours** without a human decision, after which it auto-releases unless an analyst extends it with a recorded reason. The vendor is **notified** on placement, is told the reason category, and may appeal through the grievance channel. The hold must be authorised by the vendor agreement (BR-19) — this is a legal prerequisite, not an engineering one.

### 16.5 Reporting workflow (FR-54/56)

`SUBMITTED → TRIAGED → INVESTIGATING → RESOLVED(action) | DISMISSED`, with a 48-hour acknowledgement and 30-day resolution SLA to satisfy the Consumer Protection e-commerce rules (BR-15). Reporters are told the outcome category. **Reporter credibility is scored** — repeatedly dismissed reports reduce a reporter's weight, which is the structural defence against report weaponisation (SEC-16).

### 16.6 Trust score (IMP-10)

One computed score per vendor and per customer, recomputed on relevant events, driving four things at once: COD eligibility (ASM-10), product auto-approval tier (§15.2), settlement speed, and a search-ranking modifier. Inputs: tenure, completed order count, dispute rate, cancellation rate, delivery SLA adherence, review distribution, fraud signals, KYC completeness. Exposed to the vendor as a **tier with concrete improvement guidance**, never as a raw number — a visible numeric score invites gaming.

---

## 17. Error Handling Strategy

### 17.1 Taxonomy

| Class | Base type | HTTP | Logged as | Retryable |
|---|---|---|---|---|
| Validation | `ValidationError` | 400 | info | no |
| Authentication | `UnauthenticatedError` | 401 | info | no |
| Authorization | `ForbiddenError` | 403 | **warn** (potential attack) | no |
| Not found | `NotFoundError` | 404 | info | no |
| Conflict / state | `ConflictError` (e.g. `PREORDER_SOLD_OUT`) | 409 | info | no |
| Business rule | `DomainError` | 422 | info | no |
| Rate limit | `RateLimitError` | 429 | warn | yes, after `Retry-After` |
| Idempotency replay | — | 200 with the original response | debug | — |
| External dependency | `IntegrationError` | 502 / 503 | **error** | yes, with backoff |
| Unexpected | `InternalError` | 500 | **error** + Sentry | no |

### 17.2 Principles

**Domain errors are typed and thrown from the domain layer**, never HTTP status codes — the domain does not know HTTP exists. A single mapper in the interface layer converts a domain error to a status code and an RFC-7807 body (§9.3).

**One global error middleware.** Controllers contain no `try/catch` for error translation. Express 5 propagates async errors natively.

**Never leak internals.** Stack traces, SQL fragments, Prisma error text and third-party payloads never reach a client response. The response carries a stable `code` and the `requestId`; the detail lives in the logs, correlated by that ID.

**Fail closed on security, fail open on convenience.** If the authorisation service cannot decide → deny. If the recommendation service is down → render the page without recommendations.

**Resilience for external calls.** Every outbound integration is wrapped with a timeout (Razorpay 10 s, geocoding 3 s, SMS 5 s), retries with exponential backoff **and jitter** for idempotent operations only, a circuit breaker (open after 5 consecutive failures, half-open after 30 s), and a defined fallback. A Razorpay outage must degrade checkout gracefully, not 500 the whole API.

**Result types at boundaries where failure is expected.** Use-case methods that can fail for business reasons return a discriminated `Result<T, E>` rather than throwing, which makes the failure path visible in the type system and impossible to forget. Exceptions are reserved for genuinely exceptional conditions.

**Client-side:** an error boundary per route, RTK Query retry with backoff for idempotent GETs, offline detection with a queued-action banner, and user-facing copy that says what to do next rather than what went wrong internally.

---

## 18. Logging Strategy

### 18.1 Standards

**Structured JSON via Pino**, one line per event, to stdout — the container runtime ships it to CloudWatch Logs. No `console.log` anywhere (lint-enforced).

Mandatory fields on every line: `timestamp`, `level`, `service`, `env`, `version` (git SHA), `requestId`, `traceId`, `spanId`, `userId?`, `vendorId?`, `route`, `method`, `statusCode`, `durationMs`, `msg`.

**Levels:** `fatal` (process is dying) · `error` (unexpected, actionable, → Sentry) · `warn` (degraded or suspicious — auth failures, circuit-breaker trips, slow queries) · `info` (business events — order placed, payout released) · `debug` (development only) · `trace` (never in production).

### 18.2 Redaction (SEC-19)

Redaction is an **allowlist, not a denylist** — a denylist is guaranteed to miss the field someone adds next month. Always redacted: OTPs, passwords, tokens, refresh cookies, Razorpay signatures, card data, Aadhaar/PAN numbers, full phone numbers (last 4 only), email local parts, full addresses, bank details, KYC document URLs. Request and response bodies are **never** logged wholesale in production.

### 18.3 Log categories

| Category | Destination | Retention |
|---|---|---|
| Application logs | CloudWatch → S3 archive | 90 days hot, 1 year archived |
| **Audit log** (FR-60) | PostgreSQL `audit_logs`, **append-only, partitioned** | **8 years** |
| Access log (ALB) | S3 | 90 days |
| Security events (auth failures, RLS denials, admin actions) | CloudWatch + a dedicated alarm stream | 1 year |
| Payment/ledger events | PostgreSQL, immutable | 8 years |

### 18.4 Audit log

Distinct from application logging: it is a **domain artefact**, stored in the database, queryable by admins, and legally significant. Every entry records `actorId`, `actorRole`, `impersonatedBy?`, `action`, `entityType`, `entityId`, `before`, `after`, `reason`, `ip`, `userAgent`, `requestId`, `createdAt`.

Written for: every admin action; every vendor approval/rejection; every product moderation decision; every fund hold, release, refund and payout; every KYC document access; every role change; every impersonation session; every fraud case action; and every DPDP data request. `UPDATE` and `DELETE` are blocked by a trigger.

---

## 19. Monitoring

### 19.1 The four pillars

| Pillar | Tool | Purpose |
|---|---|---|
| Metrics | CloudWatch + OpenTelemetry | RED (Rate/Errors/Duration) + USE (Utilisation/Saturation/Errors) + business KPIs |
| Logs | CloudWatch Logs Insights | Correlated investigation by `requestId` |
| Traces | OpenTelemetry → AWS X-Ray | End-to-end latency attribution across API → DB → Redis → external |
| Errors | Sentry | Grouped exceptions with release tracking and source maps |

### 19.2 Golden signals per tier

**API:** request rate, error rate (4xx/5xx separated), p50/p95/p99 latency per route, saturation (event-loop lag, CPU, memory), in-flight requests.
**Database:** connection count vs `max_connections`, replication lag, slow queries > 500 ms, deadlocks, cache-hit ratio, table/index bloat, longest transaction.
**Redis:** memory, evictions, hit rate, blocked clients, command latency.
**Queues:** depth per queue, oldest job age, processing rate, failure rate, DLQ depth.
**Frontend (RUM):** Core Web Vitals (LCP, INP, CLS), JS error rate, API failure rate from the client, PWA install and push-permission rates.

### 19.3 Business monitoring

Technical health is necessary but not sufficient — a marketplace can be 100% "up" while losing money. Tracked as first-class metrics with alerts: orders per minute vs the same hour last week, checkout conversion, **payment success rate** (an early warning of a gateway problem invisible to infrastructure metrics), preorder sell-through, vendor order-acceptance latency, product-approval queue depth and age, open fraud cases, refund rate, notification delivery rate per channel, and **reconciliation mismatches**.

### 19.4 Alerting

| Severity | Examples | Response |
|---|---|---|
| **P1 — page immediately** | API 5xx > 2% for 5 min · payment success < 90% for 10 min · DB unreachable · reconciliation mismatch · **any successful cross-tenant access detected** · webhook processing stopped | Immediate |
| **P2 — notify within 15 min** | p95 latency > 1 s · queue depth > 1,000 · DLQ non-empty · replication lag > 30 s · circuit breaker open · disk > 80% | Business hours + on-call |
| **P3 — daily digest** | Approval queue > 100 · slow-query regressions · elevated 4xx on one route · unused index report | Next working day |

Alerts are defined with an owner and a runbook link. **An alert without a runbook is deleted** — it will be ignored in an incident anyway. Synthetic checks run the six critical journeys (browse, search, add-to-cart, checkout, vendor login, QR redeem) every 5 minutes from an Indian region. A public status page is published from Phase 2.

---

## 20. Deployment Architecture

### 20.1 Target topology (ASM-21, region `ap-south-1` Mumbai per ASM-01/BR-22)

```
                     Cloudflare (DNS · CDN · WAF · DDoS)
                                   │
                          AWS ap-south-1 (Mumbai)
        ┌──────────────────────────┼──────────────────────────┐
        │                     Public subnets                    │
        │              ┌────────────────────────┐               │
        │              │  Application LB (TLS)  │               │
        │              └───────────┬────────────┘               │
        │                  NAT GW (per AZ)                      │
        ├──────────────────────────┼──────────────────────────┤
        │                    Private subnets                    │
        │   ┌──────────────┐   ┌──────────────┐                │
        │   │ ECS Fargate  │   │ ECS Fargate  │                │
        │   │ API (AZ-a)   │   │ API (AZ-b)   │  auto-scaled   │
        │   └──────┬───────┘   └──────┬───────┘                │
        │   ┌──────▼───────────────────▼───────┐                │
        │   │ ECS Fargate — Worker (BullMQ)    │                │
        │   └──────┬───────────────────────────┘                │
        ├──────────┼────────────────────────────────────────────┤
        │                  Isolated data subnets                 │
        │   ┌──────▼────────┐  ┌───────────────┐                │
        │   │ RDS PostgreSQL│  │ ElastiCache   │                │
        │   │ Multi-AZ +    │  │ Redis         │                │
        │   │ read replica  │  │ (Multi-AZ)    │                │
        │   └───────────────┘  └───────────────┘                │
        └────────────────────────────────────────────────────────┘
                 ECR · Secrets Manager · CloudWatch · S3 (backups)
                                   │
                       Cloudflare R2 (media, KYC, docs)
```

Three subnet tiers, security groups referencing security groups (never CIDRs), no public IP on any compute or data resource, egress via NAT only.

### 20.2 Environments

| Env | Purpose | Data | Scale |
|---|---|---|---|
| **local** | Development | Docker Compose (Postgres+PostGIS, Redis, MinIO as R2 stand-in), seeded synthetic data | 1 |
| **dev** | Integration | **Anonymised** seed data, never production data (SEC-25) | Minimal, single AZ |
| **staging** | Pre-production, load tests, migration rehearsal | Production-shaped anonymised data | Production-like, scaled down |
| **production** | Live | Real | Multi-AZ, auto-scaled |

### 20.3 CI/CD (GitHub Actions)

```
PR opened
 ├─ lint (ESLint + Prettier + architecture boundary rule)
 ├─ typecheck (tsc --noEmit, strict)
 ├─ unit tests (Vitest)
 ├─ integration tests (Testcontainers: real Postgres + Redis)
 ├─ contract tests (OpenAPI ↔ implementation)
 ├─ cross-tenant authorisation suite            ← blocking (§6.6)
 ├─ SAST (CodeQL) · dependency audit · secret scan · Trivy on the image  ← blocking
 └─ bundle-size budget check                    ← blocking (PERF-11)

merge to main
 ├─ build + push image to ECR (tagged with the git SHA)
 ├─ deploy to staging
 ├─ run migrations (expand-phase only)
 ├─ E2E suite (Playwright) + smoke tests
 └─ manual approval gate
        └─ production: migrations → rolling ECS deploy (min healthy 100%)
           → automated smoke test → auto-rollback on alarm
```

Every image is immutable and SHA-tagged; deploys are rolling with health-check gating and circuit-breaker rollback. Infrastructure is **Terraform**, reviewed in PRs, with no manual console changes in production.

### 20.4 Configuration & secrets (SEC-18)

Non-secret config via environment variables from SSM Parameter Store; secrets from **AWS Secrets Manager**, injected by the ECS task definition, never baked into an image and never in the repository. Separate credentials per environment; quarterly rotation for signing keys and API credentials. Config is validated by a Zod schema **at process start** — the service refuses to boot on an invalid or missing variable, which turns a 3 a.m. production mystery into a deployment failure.

### 20.5 Zero-downtime concerns

Migrations follow expand → migrate → contract across three releases so old and new application versions can run simultaneously during a rolling deploy (§6.7). Graceful shutdown: on `SIGTERM`, stop accepting new connections, finish in-flight requests (30 s drain), let BullMQ workers complete their current job, then exit. `/readyz` returns unhealthy immediately on `SIGTERM` so the load balancer stops routing before the drain begins.

---

## 21. Scalability Strategy

### 21.1 Phased plan (aligned to PRD §13)

| | **Phase 1 — Single region** | **Phase 2 — Multi-city** | **Phase 3 — Pan-India** |
|---|---|---|---|
| Target | 1k vendors, 100k SKUs, 5k orders/day | 10k vendors, 1M SKUs, 50k orders/day | 100k+ vendors, 10M+ SKUs |
| API | 2–6 Fargate tasks | 6–15, auto-scaled | 15–40, multi-AZ |
| Database | Multi-AZ primary | + read replicas, RDS Proxy, table partitioning | + Aurora PostgreSQL, more replicas, archival tiering |
| Cache | Single Redis | Redis cluster mode | Multi-shard + local in-process L1 |
| Search | Postgres FTS | **OpenSearch/Typesense** via CDC | Sharded search cluster |
| Media | R2 + CDN | + on-the-fly transformation at the edge | + regional caching |
| Analytics | Read replica + materialised views | Nightly ELT to a warehouse | Streaming + warehouse |
| Notifications | BullMQ | Per-channel queues, dedicated workers | + WhatsApp, higher-throughput providers |

**Explicit non-goal: no database sharding.** Vertical scaling, read replicas, partitioning and archival will carry this workload comfortably to Phase 3. "Vendor clustering" (AMB-13) is interpreted as **geographic service-area grouping for discovery and operations**, not data sharding. Premature sharding is the most expensive available wrong turn (SC-15).

### 21.2 Horizontal scaling prerequisites (SC-07)

Every one of these must hold from day one, because retro-fitting them is expensive: no in-process session state; no in-memory rate-limit counters (Redis-backed only); no local file writes (R2 only); no in-process schedulers (BullMQ repeatable jobs with a distributed lock, so N workers do not run the same cron N times); idempotent job handlers; no sticky sessions.

### 21.3 Read scaling

Cache-aside in Redis for the catalogue read path with event-driven invalidation (SC-14): category tree (TTL 1 h), product detail (TTL 5 min, invalidated on `ProductUpdated`), vendor profile (10 min), search facets (5 min), homepage merchandising (1 min). CDN caches public catalogue responses at the edge (§9.5). All reporting and analytics queries are routed to a **read replica** with an explicitly separate Prisma client, so a slow dashboard query can never affect checkout (SC-04). Materialised summary tables refreshed every 1–5 minutes back the admin dashboard (PERF-04).

### 21.4 Write scaling and hot paths

The three hot rows in the system — preorder quantity, inventory, and slot capacity — all use the same pattern: **Redis admission gate → single atomic conditional `UPDATE` with a `CHECK` constraint → periodic reconciliation** (§14.4). Everything else that can be deferred is: notifications, invoice generation, search indexing, analytics writes and image processing all run in the worker tier via the outbox (SC-06, PERF-06).

Search migrates to a dedicated engine when any of these thresholds is crossed: > 200k active variants, p95 search latency > 400 ms, or a requirement for typo tolerance or personalised ranking (SC-03).

### 21.5 Frontend scale

Route-level code splitting with a **< 200 KB gzipped initial JS budget enforced in CI**; responsive images with AVIF/WebP and explicit dimensions; virtualised long lists; RTK Query deduplication and caching; service-worker precache of the app shell only (never authenticated data — SEC-14); optimistic UI on cart mutations.

### 21.6 Load testing

k6 scenarios run against staging before each phase gate, and specifically: a **preorder-drop simulation** (500 concurrent users hitting one campaign at `opens_at`) — the single most important test in the suite; a catalogue-browse soak; a checkout ramp; and a webhook burst. Each has a pass threshold tied to the NFR targets, and a regression fails the phase gate.

---

## 22. Backup & Recovery

### 22.1 Targets (ASM-22)

| | Phase 1 | Phase 3 |
|---|---|---|
| **RPO** (max data loss) | 5 minutes | 1 minute |
| **RTO** (max downtime) | 4 hours | 1 hour |
| Availability | 99.5% | 99.9% |

### 22.2 Backup regime

| Asset | Method | Frequency | Retention | Encryption |
|---|---|---|---|---|
| PostgreSQL | Automated RDS snapshots + **PITR via continuous WAL archiving** | Snapshot daily; WAL continuous (→ 5-min RPO) | 30 days PITR, monthly snapshot 12 months, year-end 8 years (tax) | KMS, separate CMK |
| PostgreSQL logical | `pg_dump` to S3 (cross-region) | Daily | 90 days | KMS |
| Redis | Not backed up | — | — | — |
| R2 media | Object versioning + lifecycle | Continuous | Versions 30 days | R2 at rest |
| R2 KYC/docs | Versioning + **cross-region replication** | Continuous | Per retention policy | Envelope + KMS |
| Secrets | Secrets Manager versioning | On change | 30 versions | KMS |
| IaC / code | Git + GitHub | On commit | Indefinite | — |

**Redis is deliberately not backed up.** It holds only derived state — cache, rate-limit counters, queue jobs and preorder admission counters — all of which are reconstructible from PostgreSQL (§14.4 layer 3). Treating Redis as durable would be a design error; treating it as disposable is what makes the recovery story simple.

### 22.3 Recovery scenarios

| Scenario | Procedure | Target |
|---|---|---|
| Single API task failure | ECS replaces automatically | < 1 min, no impact |
| AZ failure | Multi-AZ RDS failover + tasks in the surviving AZ | < 5 min |
| Bad deploy | Automated rollback to the previous image on alarm | < 10 min |
| Bad migration | Roll forward with a corrective migration (never a blind rollback of a schema change); expand/contract makes the previous version compatible | < 30 min |
| Accidental data deletion | PITR restore to a **new instance**, extract the affected rows, reconcile forward | < 4 h |
| Database corruption | PITR to just before the event; replay the outbox for lost side effects | < 4 h |
| Region failure | Cross-region logical backup restore into a standby region (Phase 3: a warm standby) | < 24 h Phase 1; < 1 h Phase 3 |
| Ransomware / credential compromise | Rotate all secrets, restore from an immutable snapshot, forensic review of audit logs | Per incident plan |

### 22.4 Verification

**A backup that has never been restored is not a backup.** Monthly automated restore drills into an isolated environment, verifying: the restore completes within RTO, row counts and ledger balances match, the application boots against the restored database, and the ledger's debits equal its credits. Drill results are recorded; a failed drill is a P1. A full DR game-day is run quarterly from Phase 2.

### 22.5 Data lifecycle (BR-16, NFR-06)

A scheduled job enforces retention: application logs 90 days hot / 1 year archived; notification records 1 year; carts abandoned > 30 days; audit, order, payment, ledger and invoice records retained **8 years** (tax and statutory), then archived. DPDP erasure requests anonymise personal data while **preserving financial records in a pseudonymised form** — the statutory retention obligation and the erasure right are reconciled by unlinking identity, not by destroying the ledger.

---

## 23. Security Best Practices

Consolidates PRD §12 with the concerns raised in `01-requirements-gap-analysis.md §6`. Mapped to OWASP Top 10 2021 and ASVS L2.

### 23.1 OWASP Top 10 coverage

| # | Risk | Controls in this design |
|---|---|---|
| **A01** Broken Access Control | Repository-enforced tenant scoping + application-layer resource authorisation + PostgreSQL RLS + automated cross-tenant CI suite (§6.6, §7.4) |
| **A02** Cryptographic Failures | TLS 1.3 (1.2 minimum), HSTS preload, Argon2id passwords, EdDSA tokens, envelope encryption for KYC with KMS, TLS in transit to RDS/Redis, no secrets in code (§12.3, §20.4) |
| **A03** Injection | Prisma parameterised queries; `$queryRaw` lint-banned outside a reviewed reporting directory; Zod `.strict()` at every boundary; output escaping + strict CSP; no `dangerouslySetInnerHTML` without DOMPurify (§24) |
| **A04** Insecure Design | Threat modelling per module before implementation; the QR redesign (§13); the preorder concurrency design (§14.4); separation of duties in the permission matrix (§8.2); rate limits by design |
| **A05** Security Misconfiguration | `helmet` defaults, strict CORS allowlist, no directory listing, no stack traces to clients, Terraform-reviewed infrastructure, no public data-tier resources, CIS-benchmarked base images |
| **A06** Vulnerable Components | Dependabot, `npm audit` and Trivy as **blocking** CI gates; pinned lockfiles; a documented patch SLA (critical ≤ 48 h) |
| **A07** Auth Failures | OTP rate limiting and hashing, refresh rotation with reuse detection, server-side session revocation, mandatory admin MFA, step-up re-auth, breached-password check, uniform responses to prevent enumeration (§7) |
| **A08** Data Integrity Failures | Signed webhooks with replay suppression, signed QR tokens, immutable ledger and audit tables, SRI on any third-party script, signed container images |
| **A09** Logging & Monitoring Failures | Structured logs with correlation, an immutable 8-year audit log, security-event alerting, P1 alert on any detected cross-tenant access (§18–19) |
| **A10** SSRF | No user-supplied URL fetching in v1; if introduced, an egress allowlist with private/link-local ranges blocked and redirects disabled (SEC-22) |

### 23.2 The controls that matter most here

Ranked by what would actually hurt Leen Mart, rather than by checklist order:

1. **Server-side price and total resolution.** The client never sends money (SEC-02, §4.2).
2. **Signed, single-use, short-lived QR tokens with vendor-ownership verification** (SEC-03/04, §13).
3. **Tenant scoping in one architectural layer, verified by generated tests** (SEC-06, §6.6).
4. **Webhook signature verification + replay suppression + re-fetch before acting** (SEC-07, §10.5).
5. **Refresh-token rotation with reuse detection and server-side revocation** (SEC-01, §7.2).
6. **KYC envelope encryption with audited, time-limited access** (SEC-05, §12.3).
7. **Admin MFA, separation of duties, and an immutable audit log** (SEC-08, §8.2, §18.4).
8. **Upload pipeline: magic-byte validation, SVG rejection, re-encode, EXIF strip** (SEC-10, §12.2).
9. **Distributed per-route rate limiting, with dedicated budgets for OTP** (SEC-09/13).
10. **Zod `.strict()` everywhere — no request body is ever spread into an ORM call** (SEC-12).

### 23.3 Rate-limit budgets (NFR-13)

| Endpoint | Limit |
|---|---|
| `POST /auth/otp/request` | 1/min, 5/hour per phone; 20/hour per IP; global spend circuit breaker |
| `POST /auth/otp/verify` | 5 per challenge, then destroy |
| `POST /auth/login` | 5/min per identity, 20/min per IP, exponential backoff |
| `POST /auth/refresh` | 10/min per session |
| `GET /search` | 60/min per IP, 120/min authenticated |
| `POST /orders` | 10/min per user |
| `POST /reviews` | 5/hour per user |
| `POST /reports` | 10/day per user |
| `POST /media/upload-intent` | 50/hour per vendor |
| `/admin/*` | 300/min per admin |
| Global per IP | 1,000/min (WAF), with Cloudflare bot management above it |

### 23.4 Process

Threat model per module before implementation (STRIDE, recorded as an ADR). Security review is a required PR check for anything touching auth, payments, ledger, KYC or the QR flow. **External penetration test before public launch and annually thereafter** (NFR-12). A documented incident-response plan with a DPDP breach-notification path (BR-16). A responsible-disclosure policy with a published security contact.

---

## 24. Coding Standards

### 24.1 TypeScript

`strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. **`any` is banned** (`unknown` + a type guard instead); an escape requires an inline justification comment and reviewer approval. No non-null assertions (`!`) outside tests. No enum-less magic strings. Discriminated unions over optional-field soup. `readonly` on domain value objects. Branded types for identifiers (`OrderId` is not assignable to `VendorId`) — this alone prevents a category of ID-mixup bugs that unit tests rarely catch.

### 24.2 Naming and structure

`PascalCase` for types, classes and React components; `camelCase` for variables and functions; `SCREAMING_SNAKE` for constants; `kebab-case` for files and directories. One exported concept per file. Use cases are named for the business action (`PlaceOrderUseCase`, `RedeemPickupTokenUseCase`), not for CRUD. Booleans read as predicates (`isEligibleForCod`, `hasActiveHold`). Functions under 40 lines and cyclomatic complexity under 10, enforced by lint.

### 24.3 Domain modelling rules

- **No primitive obsession.** `Money`, `Phone`, `Email`, `Gstin`, `Pincode`, `GeoPoint`, `Percentage` are value objects that validate on construction. An invalid `Gstin` cannot exist.
- **Entities protect their invariants.** No public setters; state changes go through named methods (`order.confirm()`, `campaign.reserve(qty)`) that enforce the state machine.
- **Aggregates have one root** and are loaded and saved whole.
- **Domain layer imports nothing external** — no Prisma, no Express, no `axios`, no `date-fns` in entities.
- **All money is `Money`.** Arithmetic on raw numbers representing currency is a lint error.
- **All times are UTC `Date`** internally; formatting happens only at the edge.

### 24.4 Architecture enforcement

`eslint-plugin-boundaries` (or `dependency-cruiser`) encodes the dependency rule as a **build-failing lint error**:

```
domain          → may import: domain
application     → may import: domain, application
infrastructure  → may import: domain, application, infrastructure
interface       → may import: all
modules         → may import another module's `index.ts` (published interface) only
```

Architecture that is documented but not enforced decays within a quarter. This rule is what makes §2.2's "boundaries without network calls" claim true.

### 24.5 Testing

| Layer | Type | Tool | Coverage target |
|---|---|---|---|
| Domain | Pure unit, no I/O | Vitest | **≥ 90%** |
| Application | Unit with in-memory repository fakes | Vitest | ≥ 85% |
| Infrastructure | Integration against **real Postgres + Redis** | Vitest + Testcontainers | ≥ 70% |
| API | Contract + integration | Supertest + OpenAPI | All endpoints |
| Authorization | Generated cross-tenant matrix | Vitest | **100% of vendor-facing routes** |
| Frontend | Component + hook | Vitest + Testing Library | ≥ 70% |
| E2E | Six critical journeys | Playwright | Browse · search · checkout · preorder · QR pickup · vendor order flow |
| Load | Preorder drop, checkout ramp, webhook burst | k6 | Per-phase thresholds |

Tests are named as behaviour (`rejects a reservation when the campaign is sold out`), follow arrange-act-assert, and never share mutable state. **No mocking of the database in repository tests** — the locking and constraint behaviour we depend on (§14.4) does not exist in a mock, so mocking it would test a fiction.

### 24.6 Git and review

Trunk-based development with short-lived branches. Conventional Commits (`feat(order): …`), which drives the changelog. PRs under ~400 lines where practical; one logical change per PR. Required: two approvals for payments, ledger, auth and fraud; one elsewhere. All CI gates green. Squash merge. **Every architecturally significant decision is recorded as an ADR** in `docs/adr/` (§27).

### 24.7 Documentation

Every module has a `README.md` stating its responsibility, published interface, owned tables and emitted events. The OpenAPI spec is generated and published. JSDoc is required on public interfaces and on any non-obvious business rule — with the rule stated **and its source cited** (`// GST TCS 1% per s.52 CGST — see SDD §10.3`). Code comments explain *why*, never *what*.

---

## 25. Folder Structure Recommendation

### 25.1 Monorepo

**pnpm workspaces + Turborepo.** A monorepo because the shared contract (Zod schemas, DTO types, domain value objects) is the single highest-value artefact in the codebase, and it must be impossible for the frontend and backend to disagree about it.

```
leen-mart/
├── apps/
│   ├── api/                     # Express API service
│   ├── worker/                  # BullMQ workers (shares src/modules with api)
│   ├── customer-pwa/            # React + Vite PWA
│   ├── vendor-portal/           # React + Vite
│   └── admin-console/           # React + Vite
├── packages/
│   ├── contracts/               # Zod schemas + inferred DTOs + OpenAPI  ← shared FE/BE
│   ├── domain-kit/              # Money, Phone, Gstin, Result, branded IDs
│   ├── ui/                      # shadcn-derived components, design tokens
│   ├── config/                  # eslint, tsconfig, tailwind, vitest presets
│   └── testing/                 # Testcontainers helpers, factories, fixtures
├── infra/
│   ├── terraform/               # envs/{dev,staging,prod} + modules/
│   └── docker/
├── docs/
│   ├── prd/                     # source PRD
│   ├── sdd/                     # this document
│   ├── adr/                     # architecture decision records
│   └── runbooks/                # one per P1/P2 alert
├── .github/workflows/
├── docker-compose.yml           # local: postgres+postgis, redis, minio, mailhog
├── turbo.json
└── pnpm-workspace.yaml
```

### 25.2 Backend module structure (Clean Architecture, repeated per module)

```
apps/api/src/
├── modules/
│   ├── order/
│   │   ├── domain/
│   │   │   ├── entities/            order.entity.ts, sub-order.entity.ts
│   │   │   ├── value-objects/       order-status.vo.ts, fulfilment-mode.vo.ts
│   │   │   ├── events/              order-placed.event.ts
│   │   │   ├── state-machines/      sub-order.state-machine.ts
│   │   │   ├── services/            order-total.service.ts
│   │   │   └── errors/              order.errors.ts
│   │   ├── application/
│   │   │   ├── use-cases/           place-order.use-case.ts, cancel-order.use-case.ts
│   │   │   ├── ports/               order.repository.ts (interface)
│   │   │   └── dto/
│   │   ├── infrastructure/
│   │   │   ├── persistence/         prisma-order.repository.ts, order.mapper.ts
│   │   │   └── gateways/
│   │   ├── interface/
│   │   │   ├── http/                order.router.ts, order.controller.ts
│   │   │   ├── schemas/             place-order.schema.ts (Zod)
│   │   │   └── jobs/                order-expiry.job.ts
│   │   ├── order.module.ts          # DI wiring
│   │   └── index.ts                 # PUBLISHED INTERFACE — the only legal import target
│   ├── catalogue/  preorder/  payment/  ledger-settlement/  fulfilment/
│   ├── vendor/  identity/  authorization/  review/  risk-fraud/
│   ├── notification/  invoicing/  pricing-tax/  search/  cart/
├── shared/
│   ├── domain/                  Entity, AggregateRoot, DomainEvent, Result
│   ├── application/             UnitOfWork, EventBus, Clock, IdGenerator
│   ├── infrastructure/          prisma client, redis, r2, razorpay, outbox relay
│   ├── interface/               error middleware, auth middleware, idempotency,
│   │                            rate limiter, request context, validation
│   └── config/                  env schema (Zod), constants
├── app.ts
└── server.ts

prisma/
├── schema.prisma                # split per module via prismaSchemaFolder
└── migrations/
```

### 25.3 Frontend structure (feature-sliced, per app)

```
apps/customer-pwa/src/
├── app/                 store.ts, router.tsx, providers.tsx
├── features/
│   ├── catalogue/       api.ts (RTK Query) · components/ · hooks/ · types.ts
│   ├── cart/  checkout/  orders/  preorder/  pickup/  reviews/  auth/  profile/
├── shared/
│   ├── ui/              re-exports from packages/ui
│   ├── lib/             formatters (money, IST dates), validators
│   ├── api/             baseQuery with auth + refresh interception
│   └── hooks/
├── pages/               route-level components (lazy-loaded)
├── service-worker.ts    Workbox — app shell only, never authenticated data
└── main.tsx
```

**The rule that keeps this maintainable:** a feature may import from `shared/`, never from another feature. Cross-feature needs are lifted into `shared/` or composed at the page level — the frontend mirror of §5.1.

---

## 26. Development Roadmap

Eight stages. Each ends in a demonstrable, deployed increment. **Duration estimates assume a team of 4–6 engineers and should be re-baselined once team size is confirmed (NFR-16).**

### Stage 0 — Decisions & foundations *(2 weeks — starts only after the P0 gate)*

**Gate: the ten P0 decisions in `01-requirements-gap-analysis.md §10` are answered.** Legal engagement for ToS, vendor agreement, privacy policy and GST position starts here in parallel — it has the longest lead time.

Monorepo scaffold, CI/CD, Terraform for dev, base Docker images, ESLint architecture boundaries, shared packages (`contracts`, `domain-kit`), logging/error/observability skeleton, Prisma baseline schema, health endpoints, and one thin vertical slice (health → DB → Redis) deployed to dev to prove the pipeline.

**Exit:** a commit reaches dev automatically, with a green pipeline including the architecture lint gate.

### Stage 1 — Identity & vendor onboarding *(3 weeks)*

Phone+OTP auth, refresh rotation with reuse detection, sessions and revocation, RBAC and the permission matrix, admin MFA, customer profile and address book with geocoding, vendor registration, KYC upload (encrypted), the KYC review queue, penny-drop and GSTIN verification, the audit log, and the vendor state machine.

**Exit:** a vendor registers, submits KYC, and an admin approves them — with every action audited.

### Stage 2 — Catalogue & moderation *(3 weeks)*

Category taxonomy with per-category attributes and HSN, products and variants with units of measure, the media pipeline (presigned upload, re-encode, EXIF strip, variants), inventory, the moderation state machine with the edit-triggers-re-review rule, the risk-tiered approval engine, rejection reason codes, and Phase-1 Postgres search with filters and cursor pagination.

**Exit:** a vendor lists a product, an admin approves it, a customer finds it by search.

### Stage 3 — Cart, checkout & payments *(4 weeks — the highest-risk stage)*

Cart with server-side price re-resolution, serviceability checks, the pricing/tax engine (GST, HSN, CGST/SGST/IGST), the commission engine per plan, the order and sub-order aggregates with state machines, multi-vendor order splitting, Razorpay integration with Route linked accounts, webhook handling with signature verification and replay suppression, the idempotency layer, the **double-entry ledger**, invoice generation with per-vendor numbering, refunds, and reconciliation.

**Exit:** a customer buys from two vendors in one payment; both sub-orders settle correctly; the ledger balances; an invoice is issued.

### Stage 4 — Fulfilment: delivery & QR pickup *(3 weeks)*

Vendor business hours, delivery slots with capacity, delivery radius with PostGIS plus the pincode fast path, the vendor order dashboard with SSE real-time alerts, the sub-order fulfilment lifecycle, signed rotating QR issuance and atomic redemption with ownership verification, offline verification, manual fallback with audit, the dispute window, and settlement hold release.

**Exit:** the full pickup journey works end to end, including offline redemption at a market stall.

### Stage 5 — Preorders *(3 weeks)*

Campaign CRUD and scheduling, the delayed-job scheduler with a cron safety net, the three-layer concurrency design, soft reservations with TTL, advance and balance collection, the vendor aggregate-demand view, all edge cases in §14.6, and **the load test in §21.6 as a hard exit gate**.

**Exit:** 500 concurrent users hit one 100-unit campaign at `opens_at`; exactly 100 sell; zero oversell; p95 stays within target.

### Stage 6 — Trust: reviews, fraud, notifications *(3 weeks)*

Verified-purchase reviews with Bayesian aggregation and vendor replies, moderation, the user reporting workflow with SLA tracking, the fraud rule engine and signal collectors, the risk score and analyst queue, fund holds with the 72-hour auto-release, the trust score feeding COD and auto-approval, the full notification system (templates, preferences, DLT-registered SMS, push, email) with per-channel circuit breakers.

**Exit:** a fraud rule fires, an analyst reviews and holds funds, the vendor is notified and can appeal.

### Stage 7 — Admin, analytics & hardening *(3 weeks)*

Admin dashboard on materialised read models, vendor management, settlement runs and payout ledger, GSTR-8 export, vendor analytics, the grievance/support module (BR-15/BR-32), CMS for banners and legal pages, subscription billing with dunning, full observability and alerting with runbooks, backup and restore drills, and the **external penetration test**.

**Exit:** operations can run the business from the admin console without database access.

### Stage 8 — Launch readiness *(2 weeks)*

Load testing at target scale, chaos and failover drills, DR game day, security remediation, PWA polish (install prompts, offline scope per ASM-24, Lighthouse ≥ 90), accessibility audit against WCAG 2.1 AA, vendor onboarding content and training, published legal pages, Razorpay live-account activation, staged rollout by pincode behind feature flags.

**Exit:** production launch to a limited pincode set with a rollback plan.

### 26.1 Critical path and risk

```
Stage 0 ─► 1 ─► 2 ─► 3 ─► 4 ─► 5 ─► 6 ─► 7 ─► 8
              (2 and 4 can partially parallelise across two sub-teams)
```

| Risk | Severity | Mitigation |
|---|---|---|
| P0 decisions delayed | **Critical** | Stage 0 cannot exit without them. Escalate weekly. |
| GST/legal complexity underestimated | **Critical** | Engage a tax consultant in Stage 0, not Stage 3. |
| Razorpay Route onboarding delays | High | Start the merchant application in Stage 0; Route KYC for linked accounts has lead time. |
| Preorder concurrency defects | High | Stage 5's load test is a hard gate; design reviewed before implementation. |
| Ledger correctness | High | Property-based tests asserting debits = credits after every operation; a finance-literate reviewer on all ledger PRs. |
| Vendor adoption without the vendor UX | Medium | Involve three pilot vendors from Stage 4 and test on their actual devices. |
| Scope creep from ASM-25 exclusions | Medium | The excluded list is contractual for v1; changes go through an SDD amendment. |

---

## 27. Appendix — Architecture Decision Record index

Each of these is to be written up as a full ADR in `docs/adr/` before the relevant stage begins. They are listed here so the decision set is visible and challengeable now.

| ADR | Decision | Section |
|---|---|---|
| 001 | Modular monolith over microservices | §2 |
| 002 | Clean Architecture with a build-enforced dependency rule | §2.3, §24.4 |
| 003 | PostgreSQL + PostGIS as the single primary datastore | §3.3 |
| 004 | Prisma, with domain entities decoupled from Prisma types | §3.4 |
| 005 | UUID v7 primary keys | §6.1 |
| 006 | Money as integer paise with a `Money` value object | §6.1 |
| 007 | **Razorpay Route instead of pooling customer funds** | §10.1 |
| 008 | **Double-entry ledger instead of mutable balances** | §10.3 |
| 009 | **Order → SubOrder split for multi-vendor carts** | §6.3 |
| 010 | Product → Variant as the sellable unit | §6.3 |
| 011 | Transactional outbox for all side effects | §4.2 |
| 012 | Three-layer preorder concurrency control | §14.4 |
| 013 | **Signed, rotating, single-use QR tokens** (replacing "valid until scanned") | §13.1 |
| 014 | In-memory access token + rotating httpOnly refresh cookie | §7.2 |
| 015 | Tenant scoping in the repository layer + RLS defence in depth | §6.6 |
| 016 | Postgres FTS behind a `SearchPort`, deferring OpenSearch | §3.6, §21.4 |
| 017 | Cloudflare R2 over S3 for media (egress cost) | §3.6 |
| 018 | ECS Fargate over Kubernetes | §20.1 |
| 019 | REST + OpenAPI contract-first over GraphQL | §9.1 |
| 020 | **Risk-tiered product approval** replacing universal manual approval | §15.2 |
| 021 | Human decision required for every suspension | §16.1 |
| 022 | No database sharding through Phase 3 | §21.1 |
| 023 | SPA PWA over Next.js SSR (revisit at Phase 3 for SEO) | §3.5 |
| 024 | Redis treated as disposable derived state | §22.2 |

---

## Approval

This SDD is complete against the requested scope and is **awaiting your approval**. No implementation code has been produced, and none will be until this document is approved.

**Before approving, please confirm or correct:**

1. The **ten P0 decisions** in `01-requirements-gap-analysis.md §10`.
2. The **twenty-five assumptions** in `01-requirements-gap-analysis.md §9`, which this SDD is built on.
3. **Team size and target launch date**, so the roadmap in §26 can be re-baselined.

On approval, the recommended next stage is the **detailed data model** — full Prisma schema with constraints, indexes, partitions and migration plan — followed by the **OpenAPI contract**, and only then implementation beginning at Stage 0.

**— End of Software Design Document —**
