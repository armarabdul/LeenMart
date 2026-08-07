# Leen Mart — Requirements Gap Analysis & Architectural Review

**Document ID:** LM-GAP-001
**Version:** 1.0 (Draft for review)
**Date:** 07 August 2026
**Author:** Lead Software Architect
**Input:** Leen Mart Product Requirements Document (PRD), 10 pages, sections 1–16
**Status:** Awaiting stakeholder sign-off. **No development should begin until this document is resolved.**

---

## 0. How to read this document

The PRD is a good *product vision*. It is not yet a *buildable specification*. It describes roughly 40% of what a production multi-vendor marketplace needs, and several of the things it does describe are stated at a level of detail that permits multiple mutually incompatible implementations.

This document does four things:

1. **Section 1** lists **missing business requirements** — commercial, legal and policy decisions that only you can make. These are listed separately and first, as requested. Several of them are **legally mandatory in India** and block go-live.
2. **Sections 2–7** list missing functional requirements, missing non-functional requirements, ambiguities/conflicts, scalability, security and performance concerns.
3. **Section 8** proposes improvements.
4. **Section 9** is the **Assumptions Register** — for every gap, the explicit assumption the SDD (`02-leen-mart-sdd.md`) has been built on. Correct any assumption and I will amend the SDD accordingly.

**Severity key:**

| Level | Meaning |
|---|---|
| **P0 — Blocker** | Cannot design or legally launch without a decision. Architecture changes materially. |
| **P1 — High** | Must be resolved before the affected module is built. |
| **P2 — Medium** | Can be deferred to a later phase but must be designed for now. |
| **P3 — Low** | Nice to have; note and revisit. |

---

# PART A — MISSING BUSINESS REQUIREMENTS

These are **commercial, legal and policy** gaps, not technical ones. They are listed separately because they require your decision, not my design.

## 1.1 Monetisation & money movement

| ID | Gap | Severity | Why it matters |
|---|---|---|---|
| BR-01 | **No commission rates defined.** PRD says "category-based commission (e.g., food, electronics, vehicles)" but gives no rates, no category list, and no rule for who bears payment-gateway fees. | P0 | Commission is computed on every order line. Without a rate card the order/ledger schema cannot be finalised, and unit economics are unknown. |
| BR-02 | **Subscription tiers undefined.** "Basic (limited products) / Pro (medium scale) / Enterprise (large catalog)" — no price, no product limits, no billing cycle, no proration, no downgrade behaviour (what happens to product #501 when Pro→Basic?). | P0 | Quota enforcement is a hard gate in the product-creation path. Downgrade behaviour is a data-destruction decision. |
| BR-03 | **Commission vs subscription is stated as "OR" — is it exclusive?** Does an Enterprise subscriber pay 0% commission? A reduced commission? Both? Can a vendor switch mid-month? | P0 | This is the single largest revenue-model ambiguity. It determines whether `commission_rate` lives on the vendor, the plan, the category, or all three with a precedence rule. |
| BR-04 | **Settlement policy absent.** No settlement cycle (T+1/T+3/T+7), no minimum payout threshold, no payout schedule, no handling of settlements while a dispute or fraud hold is open, no reserve/rolling-reserve policy. | P0 | Vendors will not onboard without a published payout SLA. Determines whether we need a full internal ledger (we do — see IMP-09). |
| BR-05 | **"Payments go to platform first, settlement to vendors later" has regulatory consequences.** Collecting customer funds and disbursing them later makes Leen Mart a de-facto payment intermediary. Under RBI's Payment Aggregator guidelines, non-bank entities may not hold customer funds without authorisation; funds must sit in an escrow/nodal account operated by a licensed PA. | **P0 — legal** | Two compliant paths exist: **(a)** Razorpay Route / linked-accounts split settlement, where Razorpay holds and splits the funds (recommended, no licence needed); **(b)** apply for PA authorisation (12–24 months, capital requirements). This choice changes the entire payment module. |
| BR-06 | **Refund and cancellation policy is completely absent.** No cancellation window, no who-may-cancel matrix, no partial refunds, no refund SLA, no restocking, no refund of delivery charges, no refund of commission already accrued. | **P0** | Refunds touch payments, orders, ledger, notifications and vendor payouts. This is the most conspicuous omission in the PRD. |
| BR-07 | **Preorder advance refundability undefined.** If a vendor cancels a preorder, is the advance refunded in full? If the *customer* cancels, is the advance forfeited? Is forfeiture legal under the Consumer Protection Act? | **P0** | Preorders are the flagship differentiator; the money rules must be explicit and printed at checkout. |
| BR-08 | **Return policy for second-hand goods.** Second-hand goods are explicitly in scope but have no returns, warranty, condition-grading or misrepresentation policy. | P1 | Highest dispute category in every marketplace. |
| BR-09 | **COD reconciliation.** How does cash collected by the vendor get reconciled against platform commission? Does the platform invoice the vendor for commission on COD orders? What is the COD order value cap? Who bears COD fraud loss? | P0 | COD inverts the money flow — the vendor holds the cash and owes the platform. Requires a receivables ledger. |
| BR-10 | **Delivery charge ownership.** Vendor sets the charge — but is it commissionable? Does it settle to the vendor 100%? Is it refunded on cancellation? | P1 | Affects every order-total calculation. |
| BR-11 | **No coupons, discounts, promotions or campaign mechanics anywhere in the PRD.** No vendor-funded vs platform-funded split. | P1 | Every marketplace needs this by month 3. Retro-fitting a promotions engine into a finalised order/pricing model is expensive; we must at least design the seam now. |
| BR-12 | **No wallet / store credit** concept. Refunds must go somewhere; wallet is the cheapest refund rail. | P2 | Decide now: refund-to-source only, or wallet? |

## 1.2 Legal, tax and statutory compliance (India)

**This entire subsection is missing from the PRD and every item is go-live blocking.**

| ID | Gap | Severity | Why it matters |
|---|---|---|---|
| BR-13 | **GST is not mentioned once.** As an e-commerce operator Leen Mart must: collect **TCS at 1%** under s.52 CGST on the net taxable value of supplies; deduct **TDS at 0.1%** under s.194-O of the Income Tax Act; capture vendor **GSTIN** at KYC; store **HSN/SAC codes** per product; determine tax rate per category; and file **GSTR-8** monthly. | **P0 — legal** | Tax cannot be bolted on. It changes the product model (HSN, tax rate), the order-item model (taxable value, CGST/SGST/IGST split, cess), the invoice, and the settlement calculation. This is the single most impactful omission in the PRD. |
| BR-14 | **Invoicing responsibility undefined.** In a marketplace the *vendor* is the supplier of record and issues the tax invoice; the platform issues a commission invoice to the vendor. Who generates, numbers, stores and serves each? Invoice numbering must be sequential and per-vendor per-financial-year. | **P0 — legal** | Requires an invoice service and immutable numbering sequence per vendor. |
| BR-15 | **Consumer Protection (E-Commerce) Rules, 2020 obligations absent.** Mandatory: display of seller's legal name, principal geographic address and contact; **country of origin** on every listing; a named **Grievance Officer** with contact details published on the site; **acknowledgement of complaints within 48 hours** and **resolution within one month**; no manipulation of price; no misleading ads. | **P0 — legal** | Requires a full grievance/ticketing module that the PRD does not contain at all, plus new mandatory product and vendor fields. |
| BR-16 | **DPDP Act 2023 (Digital Personal Data Protection) obligations absent.** Requires: itemised consent notice, purpose limitation, the right to access/correct/erase, consent withdrawal, breach notification to the Data Protection Board and affected users, and reasonable security safeguards. KYC documents are highly sensitive personal data. | **P0 — legal** | Requires consent records, a data-subject-request workflow, retention/erasure jobs, and encryption of KYC artefacts. Affects data model and storage architecture. |
| BR-17 | **FSSAI licensing for food vendors.** The PRD's two flagship preorder examples are **cake** and **fish** — both are regulated food. Selling food online requires a valid FSSAI licence/registration from the seller, and marketplaces are required to verify and display it. | **P0 — legal** | Adds a category-conditional KYC requirement, licence number + expiry storage, expiry-driven auto-suspension, and licence display on listings. |
| BR-18 | **No prohibited/restricted product policy.** Nothing prevents a vendor listing drugs, alcohol, tobacco, weapons, wildlife products, counterfeits, or age-restricted goods. "Vehicles" is named as a commission category — vehicle sale involves RC transfer and is heavily regulated. | **P0 — legal** | Needs a category policy engine, a prohibited-keyword screen and an admin escalation path. |
| BR-19 | **Terms of Service, Vendor Agreement, Privacy Policy, Return & Refund Policy, Shipping Policy do not exist.** Razorpay will not activate a live account without published policy pages. | **P0 — launch blocker** | Also required: the vendor agreement must explicitly authorise transaction holds (BR-20), otherwise holding a vendor's money is a contractual breach. |
| BR-20 | **"Transaction hold capability" has no legal basis defined.** Maximum hold duration, notification to the vendor, appeal mechanism, and auto-release rules are all unspecified. | P0 | Without contractual authority and a defined appeal path, holds create legal exposure. |
| BR-21 | **Legal Metrology (Packaged Commodities) Rules** require net quantity, MRP, manufacturer/packer details and consumer-care contact on listed packaged goods. | P1 | Additional mandatory product fields. |
| BR-22 | **Data residency.** No statement on where data is stored. Sectoral guidance and the DPDP framework push toward India-region storage for payment and personal data. | P1 | Determines AWS region (`ap-south-1`) and R2 jurisdiction. Cheap now, expensive later. |

## 1.3 Marketplace operating policy

| ID | Gap | Severity | Why it matters |
|---|---|---|---|
| BR-23 | **"Trusted vendor" is undefined.** COD is gated on it. What makes a vendor trusted — order count, age, rating, dispute rate, manual flag? | P0 | Gates a core checkout path. Also conflicts with the Customer Journey wording (see AMB-04). |
| BR-24 | **Vendor performance SLA and penalties.** Vendor-managed delivery is a named risk in the PRD (§14) but there is no late-delivery, no-show, or cancellation-rate policy and no consequence ladder (warning → reduced visibility → COD removal → suspension). | P1 | Vendor autonomy without accountability is the top cause of marketplace churn. |
| BR-25 | **Dispute resolution ownership.** §3.3 says Admin handles disputes *and* is a "non-mediator role" — see AMB-01. If the platform does not arbitrate, who does, and how are funds released? | **P0** | Directly contradictory; blocks the entire refund and hold design. |
| BR-26 | **KYC document set unspecified.** Which documents — PAN, Aadhaar, GSTIN, bank proof, shop licence, FSSAI? Is bank-account penny-drop verification required? Is there re-KYC, or a KYC expiry? | P0 | Determines the KYC data model, the third-party verification vendor, and the encryption requirements. |
| BR-27 | **Vendor offboarding.** What happens to open orders, undelivered preorders, held funds, reviews and product data when a vendor leaves or is suspended? | P1 | Needs an explicit wind-down state machine. |
| BR-28 | **Can a Customer sell?** Second-hand goods are in scope, but the role model only permits Vendors to sell. If a private individual can list a used item, the platform is C2C and KYC/GST/settlement rules differ entirely. | **P0** | Materially changes the role model, KYC burden and tax treatment. |
| BR-29 | **Multi-vendor cart.** Can a customer buy from two vendors in one checkout? The PRD never says. | **P0** | This is the highest-impact unstated architectural requirement in the document. It determines whether Order:Vendor is 1:1 or 1:N, how payments split, how cancellation works and how fulfilment is tracked. |
| BR-30 | **Service area / launch geography.** "A regional market" is never named. No pincode/city list, no serviceability rules. | P1 | Determines whether we need PostGIS from day one or a pincode allowlist. |
| BR-31 | **Language & localisation.** A "regional market" strongly implies a non-English-first audience. No language requirement is stated. | P1 | Retro-fitting i18n is one of the most expensive frontend refactors. Decide now. |
| BR-32 | **Customer support model.** No channel (phone/chat/email), no hours, no ticketing, no escalation matrix — yet BR-15 makes a grievance process legally mandatory. | P0 | Needs a support/ticketing module absent from the PRD. |
| BR-33 | **Business KPIs undefined.** "Revenue" appears on the admin dashboard with no definition — GMV, net revenue, take-rate? | P2 | Dashboard cannot be built against an undefined metric. |
| BR-34 | **Referral, loyalty and vendor-acquisition mechanics** absent. | P3 | Note for Phase 2. |
| BR-35 | **Insurance / liability** for goods damaged in vendor-managed delivery. | P2 | Vendor-managed delivery pushes liability to the vendor — say so in the agreement. |

---

# PART B — TECHNICAL GAP ANALYSIS

## 2. Missing functional requirements

### 2.1 Identity & accounts

| ID | Gap | Severity |
|---|---|---|
| FR-01 | **No signup/login method is specified.** Phone+OTP, email+password, social login? For an India-first mobile-first PWA, phone+OTP is the norm — but OTP costs money and needs TRAI DLT template registration. Not stated. | **P0** |
| FR-02 | No password reset / account recovery flow. | P0 |
| FR-03 | No MFA requirement — particularly for Admin and for vendor payout-detail changes. | P0 |
| FR-04 | No session management: concurrent sessions, device list, remote logout, forced logout on suspension. | P1 |
| FR-05 | No user profile management, no customer **address book** (multiple saved addresses) — yet checkout requires an "exact location". | P0 |
| FR-06 | No account deletion / data export (required by BR-16). | P1 |
| FR-07 | No email/phone verification and change flow. | P1 |
| FR-08 | **No vendor staff sub-accounts.** A shop with three employees cannot share one login safely. | P1 |
| FR-09 | **No granular admin roles.** "Admin" is monolithic; a real operation needs Super Admin, Catalogue Moderator, Finance/Settlements, Fraud/Risk, Support Agent — with least privilege. | P0 |

### 2.2 Catalogue

| ID | Gap | Severity |
|---|---|---|
| FR-10 | **No product variants.** Size/colour/weight/grade are not modelled. Fish sold "per kg" vs "per piece" is unrepresentable. This is a schema-level omission. | **P0** |
| FR-11 | **No units of measure or quantity-step** (e.g. 250 g increments). Essential for the food/fish use case. | P0 |
| FR-12 | **No general inventory/stock model.** Stock is only mentioned inside preorders. What tracks stock for a normal product? | **P0** |
| FR-13 | **No behaviour defined for editing an approved product.** Does a price change trigger re-approval? A description change? An image change? Without this rule, approval is trivially bypassed by editing after approval. | **P0 — trust hole** |
| FR-14 | No category taxonomy management: nesting depth, per-category attributes, per-category commission linkage, category CRUD. | P0 |
| FR-15 | No product media rules: min/max images, aspect ratio, size limits, ordering, video. | P1 |
| FR-16 | No bulk product upload (CSV/Excel) — implicitly required by the "Enterprise (large catalog)" tier. | P1 |
| FR-17 | **No search specification at all**, despite "Browse/search products" appearing in the customer journey. No filters, sorting, relevance rules, synonyms, typo tolerance, geo-filtering, pagination. | **P0** |
| FR-18 | No product Q&A, no comparison, no recently viewed, no recommendations. | P3 |
| FR-19 | No content moderation of uploaded images (NSFW, counterfeit, stolen imagery). | P1 |

### 2.3 Cart, checkout & orders

| ID | Gap | Severity |
|---|---|---|
| FR-20 | **Cart and checkout are never specified as features** — they only appear implicitly in the offline-support line. No cart rules, no merge-on-login, no stale-price handling. | **P0** |
| FR-21 | **No order status model.** Statuses are never enumerated. Delivery, pickup and preorder need three different lifecycles. | **P0** |
| FR-22 | **No stock reservation during checkout.** Two customers can pay for the last preorder slot. | **P0** |
| FR-23 | No order cancellation/modification flow (who, when, what happens to the money). | P0 |
| FR-24 | No order history, no reorder, no order detail/tracking view. | P1 |
| FR-25 | No invoice generation or download. | P0 (see BR-14) |
| FR-26 | **No serviceability check.** A customer can add a product to the cart from a vendor who does not deliver to their address; nothing validates address-within-radius before payment. | **P0** |
| FR-27 | **No vendor business hours, holidays, or slot capacity model.** "Choose time slot" implies all three. What limits how many orders fit in the 07:00–08:00 slot? | **P0** |
| FR-28 | No timezone handling statement (assume IST, but state it). | P2 |
| FR-29 | No partial fulfilment / partial cancellation of a multi-item order. | P1 |
| FR-30 | No wishlist/favourites, no follow-a-shop. | P3 |

### 2.4 Preorder (flagship feature — under-specified)

| ID | Gap | Severity |
|---|---|---|
| FR-31 | **Balance payment collection is undefined.** Advance is "% configurable" — when and how is the remainder collected? Online before pickup? Cash at pickup? What if it is never paid? | **P0** |
| FR-32 | **Vendor-initiated preorder cancellation** (the cake could not be made) has no flow, no refund rule, no penalty. | P0 |
| FR-33 | Preorder **fulfilment window** vs pickup slot relationship is unclear. "Expiry date/time" — is that the last moment to *order*, or the last moment to *collect*? | **P0 — ambiguity** |
| FR-34 | No preorder waitlist / notify-me when a slot frees up. | P2 |
| FR-35 | No handling of a preorder customer who never collects (no-show). Is the advance forfeited? Is the goods disposal the vendor's loss? | P1 |
| FR-36 | No vendor view of aggregate preorder demand (the operational reason to run preorders — "I need to bake 40 cakes tomorrow"). | P1 |
| FR-37 | "Preorder start time" implies a **scheduled visibility flip** — a cron/scheduler component the PRD never mentions. | P1 |

### 2.5 Pickup / QR

| ID | Gap | Severity |
|---|---|---|
| FR-38 | **QR has no expiry** ("valid until scanned"). See AMB-06 and SEC-03. | **P0** |
| FR-39 | No QR regeneration if the customer loses it or changes device. | P1 |
| FR-40 | No offline-scan capability — a fish market at 6 a.m. may have poor connectivity. | P1 |
| FR-41 | No pickup no-show handling or pickup-window enforcement. | P1 |
| FR-42 | **No protection against a vendor marking pickup complete without handing over goods.** Scanning is entirely vendor-side. | **P0 — fraud hole** |
| FR-43 | No manual/fallback completion path (scanner broken, damaged screen) with audit trail. | P1 |

### 2.6 Payments

| ID | Gap | Severity |
|---|---|---|
| FR-44 | **No webhook handling specified.** Razorpay is asynchronous; relying on the browser callback loses payments whenever the user closes the tab. | **P0** |
| FR-45 | **No idempotency strategy** for payment creation, capture or refund. Double-charge risk. | **P0** |
| FR-46 | No payment reconciliation against Razorpay settlement reports. | P0 |
| FR-47 | No failed/pending/abandoned-payment recovery flow. | P1 |
| FR-48 | No saved payment methods / UPI intent / instrument preferences. | P2 |
| FR-49 | No vendor payout ledger, statement or downloadable settlement report. | P0 |
| FR-50 | No subscription billing engine (recurring mandate, dunning, grace period, auto-suspend on failure). | P0 |

### 2.7 Reviews, fraud, notifications, admin

| ID | Gap | Severity |
|---|---|---|
| FR-51 | **No verified-purchase requirement for reviews.** Anyone can review anything. | **P0** |
| FR-52 | No review edit window, deletion, or vendor right-of-reply. | P1 |
| FR-53 | **No rating aggregation rule.** A simple average lets one 5★ review outrank a 4.8★ shop with 900 reviews. Needs a Bayesian/weighted rule and a recency decay. | P1 |
| FR-54 | No review moderation queue or profanity screening; "abuse reporting" has no workflow, states or SLA. | P1 |
| FR-55 | **Fraud rules are entirely unspecified.** "Multiple complaints" — how many, in what window, weighted how? No rule engine, no thresholds, no scoring, no appeal. | **P0** |
| FR-56 | No manual review queue for flagged entities, no case management, no analyst notes. | P0 |
| FR-57 | No ban-evasion controls (same person, new phone number) — no device fingerprinting or identity linking. | P1 |
| FR-58 | No notification preference centre, opt-out, or quiet hours. **SMS in India additionally requires DLT registration of headers and templates.** | **P0** |
| FR-59 | No notification templating, localisation, retry/backoff, or delivery-status tracking. | P1 |
| FR-60 | **No admin audit log.** Every approve/reject/suspend/hold/refund must be attributable and immutable. | **P0** |
| FR-61 | No admin impersonation ("view as vendor") for support, with audit. | P2 |
| FR-62 | No vendor-facing analytics (sales, top products, conversion) despite "Monitor performance" appearing in the admin scope. | P1 |
| FR-63 | No CMS for banners, homepage merchandising, static/legal pages. | P1 |
| FR-64 | No real-time order notification to the vendor (a new order at 6 a.m. must make a noise). Polling is insufficient. | P1 |

---

## 3. Missing non-functional requirements

The PRD contains **no measurable NFR whatsoever**. §12 lists five security mechanisms and §13 lists three deployment phases; neither contains a number. Every item below must be quantified before we can size infrastructure or write acceptance tests.

| ID | Gap | Proposed target (assumption) |
|---|---|---|
| NFR-01 | No latency targets | p95 < 300 ms for catalogue reads, < 800 ms for checkout writes, < 2.5 s LCP on 4G mid-range Android |
| NFR-02 | No throughput / concurrency targets | Phase 1: 500 concurrent users, 50 orders/min sustained, **2,000 req/s burst at preorder-drop time** |
| NFR-03 | No availability target | 99.5% Phase 1 → 99.9% Phase 3 |
| NFR-04 | No RTO / RPO | RTO 4 h, RPO 5 min (see §22 of the SDD) |
| NFR-05 | No data volume projections | Phase 1: 1k vendors, 100k SKUs, 5k orders/day |
| NFR-06 | No data retention or purge policy | Orders 8 years (tax), KYC 8 years post-relationship, logs 90 days hot / 1 year archive, PII erasure on DPDP request |
| NFR-07 | No browser/device support matrix | Android Chrome ≥ 100, iOS Safari ≥ 15, 360 px min width |
| NFR-08 | No accessibility requirement | WCAG 2.1 AA |
| NFR-09 | No internationalisation requirement | English + one regional language (see BR-31) |
| NFR-10 | No observability requirement | Structured JSON logs, distributed tracing, RED metrics, error tracking, uptime checks |
| NFR-11 | No test coverage or quality gates | ≥ 80% on domain/application layers, contract tests for all external integrations, E2E for the 6 critical journeys |
| NFR-12 | No security testing cadence | SAST + dependency scan on every PR; external pen-test before launch and annually |
| NFR-13 | No rate-limit specifics ("Rate limiting APIs" is the entire requirement) | Per-endpoint budgets — see SDD §24 |
| NFR-14 | No environment strategy | dev / staging / production, no production data in lower environments |
| NFR-15 | No cost/budget constraint | Materially affects AWS topology (single AZ vs Multi-AZ, ECS vs EKS) |
| NFR-16 | No team size, skills or timeline | Materially affects the modular-monolith-vs-microservices decision |
| NFR-17 | No compliance target (PCI-DSS scope) | SAQ-A only, achieved by never touching card data (Razorpay hosted checkout) |
| NFR-18 | No PWA offline scope boundary | See AMB-07 |
| NFR-19 | No API versioning or deprecation policy | URI versioning `/api/v1`, 6-month deprecation window |
| NFR-20 | No maximum image upload size / format policy | 5 MB, JPEG/PNG/WebP only, server-side re-encode |

---

## 4. Ambiguities and conflicting requirements

| ID | Location | The conflict | Impact |
|---|---|---|---|
| **AMB-01** | §3.3 | *"Handle disputes (non-mediator role)"* — Admin is simultaneously assigned dispute handling **and** declared not a mediator. These cannot both be true. | **P0.** Blocks refund, hold and dispute design. If the platform does not arbitrate, refunds cannot be forced and the fraud module has no teeth. **Needs your decision.** |
| **AMB-02** | §5.7 vs Indian regulation | *"Payments go to platform first, settlement to vendors later"* conflicts with RBI PA guidelines for a non-licensed entity. | **P0.** See BR-05. Recommend Razorpay Route. |
| **AMB-03** | §4.1 | Commission **OR** subscription — exclusivity, precedence and switching are undefined. | **P0.** See BR-03. |
| **AMB-04** | §5.7 vs §7.1 | §5.7: *"COD only for **trusted** vendors."* §7.1: *"Cash on Delivery (Only on **approved** vendors)."* Approved (passed KYC) and trusted (earned reputation) are different states used interchangeably. | **P0.** Two different gates. Which one governs COD? |
| **AMB-05** | §5.3 | *"Once quantity exceeded → Out of Stock"* — "exceeded" is off-by-one language. Does the limit mean units, or orders? Are cancelled preorders returned to the pool? Do unpaid/pending-payment carts consume quantity? | **P0.** Directly affects the concurrency design. |
| **AMB-06** | §5.6 | *"QR valid until scanned"* is stated as a fraud-prevention rule, but an unbounded-lifetime bearer token is the **opposite** of fraud prevention. Also unclear: is the QR shown by the customer and scanned by the vendor, or vice versa? | **P0.** See SEC-03. |
| **AMB-07** | §11 vs §5.3 | Offline caching of product listings conflicts with preorder correctness — a cached listing shows a price and availability that may be hours stale, and the preorder may have expired. | **P1.** Must define what is cacheable and for how long, and re-validate at checkout. |
| **AMB-08** | §8 | The "High-Level Flow" is a vertical chain: PWA → API → PostgreSQL → R2 → Razorpay → AWS. This is not an architecture. R2 and Razorpay are not downstream of PostgreSQL, and AWS is not a layer. | **P2.** Cosmetic, but signals the architecture has not been designed. Replaced in SDD §4. |
| **AMB-09** | §10 vs project standards | PRD stack: React, **Redux Toolkit + RTK Query**, Tailwind, shadcn, Node/Express, PostgreSQL, AWS + R2. Project standing instructions add: **TypeScript everywhere, Vite, Prisma**. The PRD mentions none of these three, and does not mention Vite or a build tool at all. | **P1.** Needs explicit reconciliation. SDD assumes the standing instructions win (ASM-19). |
| **AMB-10** | §10 | *"AWS (EC2 / RDS / **S3 alternatives**)"* and *"Cloudflare R2 (image storage)"* — two object stores named. | P2. Assume R2 only (egress-free), S3 not used. |
| **AMB-11** | §5.2 | *"Services (optional future)"* — in or out of v1 scope? | P1. Assume out of v1, but the catalogue model must not preclude it. |
| **AMB-12** | §5.2 vs §3 | Second-hand goods are in scope, but only Vendors can sell. See BR-28. | **P0.** |
| **AMB-13** | §13 Phase 2 | *"Vendor clustering"* is undefined — geographic grouping? Database sharding? Delivery zoning? | P1. |
| **AMB-14** | §12 | *"Encrypted user data"* — at rest, in transit, or field-level? All data or specific fields? With what key management? | P1. |
| **AMB-15** | §5.10 | *"Multiple complaints → auto-flag vendor"* — no threshold, no window, no weighting. As written, three competitors filing complaints can suspend a legitimate vendor. | **P0.** Abuse vector. |
| **AMB-16** | §5.5 | Vendor sets a delivery **radius**, but the customer *"enters exact location"* — free-text address, map pin, or geocoded? Radius from what origin — shop coordinates? Straight-line or road distance? | **P0.** Determines whether PostGIS is required. |
| **AMB-17** | §5.8 | Rating 1–5 with no aggregation rule, no verified-purchase gate, and no distinction between product rating and shop rating when a shop has one product. | P1. |
| **AMB-18** | Document | Section numbering jumps from **14 to 16** — section 15 is missing entirely. Was a section (likely "Timeline" or "Success Metrics") dropped? | P1. Please confirm nothing was lost. |
| **AMB-19** | §5.7 | *"Cash on Delivery (restricted)"* — restricted by vendor, by order value, by category, by customer history, or by geography? | P1. |
| **AMB-20** | §5.9 | Push notifications "(PWA)" — **iOS Safari only supports web push for *installed* PWAs (iOS 16.4+)**. A large share of users will silently never receive push. | P1. Needs an SMS/WhatsApp fallback strategy. |

---

## 5. Scalability concerns

| ID | Concern | Analysis | Mitigation (detailed in SDD §21) |
|---|---|---|---|
| SC-01 | **Preorder drop = flash sale.** "Fish for morning pickup" and "limited stock" create a thundering herd on a single row at a known instant. | Hundreds of concurrent `UPDATE preorders SET remaining = remaining - 1` on one row serialise on a row lock. At 500 concurrent buyers this queues, connections exhaust, and the whole API stalls — not just preorders. | Atomic conditional decrement with a `CHECK (remaining >= 0)` constraint; short transactions; a Redis pre-gate counter to shed load before it reaches Postgres; queue-based admission for high-demand drops. |
| SC-02 | **Manual admin approval is a human bottleneck.** Every product needs manual approval; PRD targets pan-India. | At 1,000 vendors × 50 products, that is 50,000 manual reviews. This does not scale and will become the primary growth constraint. | Risk-tiered approval: auto-approve for trusted vendors in low-risk categories, manual only for new vendors, restricted categories, or rule-flagged listings. Post-publication sampling audit. |
| SC-03 | **Search on PostgreSQL `ILIKE`** will not scale past ~50k SKUs with filters. | Sequential scans; no relevance ranking; no typo tolerance. | Phase 1: `pg_trgm` + GIN indexes + `tsvector`. Phase 2: OpenSearch/Typesense with CDC from Postgres. Design the search interface as a port from day one so the adapter can be swapped. |
| SC-04 | **Analytics on the OLTP database.** Admin dashboard aggregates (total orders, revenue, active vendors) scanned live will lock and slow the transactional path. | Dashboard queries are the classic cause of production incidents in young marketplaces. | Read replica for reporting; materialised summary tables refreshed on a schedule; later a warehouse. |
| SC-05 | **File uploads proxied through the API.** Vendors upload 5 MB phone photos; if these stream through Express, each upload occupies a Node worker for seconds. | Node's event loop and memory suffer; horizontal scaling becomes upload-bound rather than request-bound. | Presigned direct-to-R2 uploads; async post-processing worker for resize/re-encode/EXIF-strip. |
| SC-06 | **Synchronous notification fan-out** inside the request path. Email + SMS + push on order confirmation adds 1–3 s and couples order success to third-party uptime. | An SMS provider outage would fail order placement. | Transactional outbox + BullMQ workers; notifications never block the commit. |
| SC-07 | **Stateful API prevents horizontal scaling.** In-memory rate limiting, in-memory sessions or local file storage all break behind more than one instance. | | Stateless services; Redis for all shared state; sticky sessions never used. |
| SC-08 | **Geospatial radius queries** ("delivery radius") computed in application code across all vendors is O(n) per request. | | PostGIS `geography` column + GiST index; plus a pincode-serviceability fast path for the common case. |
| SC-09 | **Multi-tenant data isolation.** Every vendor query must be scoped; a single missing `where: { vendorId }` leaks another vendor's orders. | This is both a scale and a security concern. | Repository-level tenant scoping enforced in one place, never in controllers; integration tests that assert cross-tenant denial. |
| SC-10 | **Prisma N+1 and over-fetching** on list endpoints (product → vendor → category → reviews). | The single most common Node/ORM performance failure. | Explicit `select`, dataloader-style batching, query budgets in tests, `slow query` logging. |
| SC-11 | **Connection pool exhaustion.** Each API instance opens its own Prisma pool; RDS has a hard `max_connections`. | 10 instances × 20 connections = 200 connections, exceeding a small RDS instance. | PgBouncer (transaction pooling) or RDS Proxy from Phase 2; bounded per-instance pool. |
| SC-12 | **Image delivery without a CDN.** R2 direct-serving to mobile users on 4G. | | Cloudflare CDN in front of R2 (free egress), responsive variants, WebP/AVIF, lazy loading. |
| SC-13 | **Time-slot capacity contention** — same hot-row problem as SC-01, at every popular vendor's peak slot. | | Same mitigation; slot capacity as a row with an atomic conditional decrement. |
| SC-14 | **No caching layer named anywhere in the PRD.** | Catalogue reads will dominate traffic 20:1 over writes. | Redis cache-aside for category trees, vendor profiles, product detail; event-driven invalidation. |
| SC-15 | **"Vendor clustering" (Phase 2) is undefined** and may imply sharding. | Premature sharding is the most expensive wrong turn available here. | Recommend: scale vertically + read replicas + partitioning by date on orders/events before ever considering sharding. |

---

## 6. Security concerns

Section 12 of the PRD lists five controls. It is a starting point, not a security requirement set. Below are the concerns, ordered by exploitability.

### 6.1 Critical

| ID | Concern | Detail |
|---|---|---|
| **SEC-01** | **JWT design is under-specified and the default implementation is unsafe.** "JWT-based authentication" with no refresh strategy, no revocation, no expiry, and no storage guidance. The common implementation stores a long-lived JWT in `localStorage`, which any XSS turns into full account takeover, and which cannot be revoked when a vendor is suspended. | Short-lived (10–15 min) access token held **in memory only**; refresh token in an `httpOnly`, `Secure`, `SameSite=Strict` cookie with **rotation and reuse detection**; a server-side session record so suspension takes effect immediately; `jti` denylist in Redis. |
| **SEC-02** | **Payment amount tampering.** Nothing in the PRD says the server recomputes the order total. If the client sends the amount, a user pays ₹1 for a ₹10,000 item. | Server-side price resolution from the database at order creation; the client never sends prices; verify Razorpay signature; verify the captured amount equals the stored order amount before fulfilment. |
| **SEC-03** | **The QR code is a bearer token with no expiry.** "Valid until scanned" means a screenshot shared in a WhatsApp group is a valid claim ticket forever. If the QR encodes only an order ID, it is also trivially forgeable/enumerable. | QR must contain a **signed, single-use, short-lived token** (HMAC or Ed25519 JWS: order ID + nonce + `exp` tied to the pickup window). Server-side atomic redemption ("compare-and-set to REDEEMED"). Rotate the displayed code every 30–60 s in the app. |
| **SEC-04** | **Vendor can complete a pickup without handing over goods** (FR-42) — the vendor controls the scanner and therefore controls completion, which triggers settlement. | Invert or double-bind the handshake: vendor displays a code the **customer** scans, or require a customer-side confirmation, or geofence + timestamp the scan and hold settlement until a dispute window elapses. |
| **SEC-05** | **KYC documents are the highest-value target in the system.** PAN, Aadhaar, bank proofs. The PRD says only "encrypted user data". | Private R2 bucket, no public URLs ever; envelope encryption with a KMS-managed key; time-limited presigned GETs (≤ 60 s); every access written to an audit log; masked display by default; retention/erasure job per BR-16. Aadhaar in particular carries specific statutory handling duties — legal review required. |
| **SEC-06** | **IDOR / broken object-level authorisation** is the dominant vulnerability class in multi-vendor systems. `GET /orders/:id` must not return another vendor's order. | Tenant scoping enforced centrally in the data-access layer, derived from the authenticated principal — never from a request parameter or body. Automated cross-tenant tests in CI. |
| **SEC-07** | **Webhook forgery and replay.** An unauthenticated `/payments/webhook` that marks orders paid is a direct path to free goods. | Verify the Razorpay signature; reject stale timestamps; store `event_id` for replay suppression; process idempotently; never trust webhook body fields over a server-side fetch of the payment. |
| **SEC-08** | **Admin panel has no stated hardening.** One password protects approvals, suspensions, fund holds and refunds. | Separate auth surface; **mandatory MFA**; optional IP allowlist; separate short session TTL; per-action authorisation; immutable audit log (FR-60); no shared accounts; break-glass procedure. |
| **SEC-09** | **OTP abuse (if phone+OTP is chosen).** Unrate-limited OTP endpoints are both a cost attack (each SMS costs money) and an enumeration vector. | Per-phone, per-IP and global budgets; exponential backoff; CAPTCHA after N attempts; OTP hashed at rest, 5-min TTL, max 5 verification attempts, single use. |

### 6.2 High

| ID | Concern | Mitigation |
|---|---|---|
| SEC-10 | **Malicious file upload.** No file validation stated. | Validate magic bytes (not just Content-Type or extension); **reject SVG** (stored XSS); cap size; re-encode all images server-side (destroys embedded payloads); **strip EXIF** — vendor phone photos carry GPS coordinates of the seller's home; malware scan; serve from a separate origin. |
| SEC-11 | **Stored XSS** via product titles, descriptions and reviews rendered into the PWA and the admin panel. | Sanitise on input, escape on output, strict CSP with nonces, no `dangerouslySetInnerHTML` without DOMPurify. |
| SEC-12 | **Mass assignment.** `prisma.user.update({ data: req.body })` lets a user set `role: 'ADMIN'`. | Zod schemas with `.strict()` at every boundary; explicit field allowlists; never spread request bodies into ORM calls. |
| SEC-13 | **Rate limiting is one bullet point.** Different endpoints need wildly different budgets. | Per-route, per-identity distributed limits in Redis (login, OTP, password reset, search, review post, report submit, checkout, admin actions). |
| SEC-14 | **PWA service-worker cache leaks data on shared devices.** Cached authenticated responses persist after logout. | Never cache authenticated responses in the service worker; purge caches and unregister on logout. |
| SEC-15 | **Account enumeration** via login/signup/OTP responses ("this number is not registered"). | Uniform responses and uniform timing. |
| SEC-16 | **Fraud-report weaponisation** (AMB-15): competitors mass-report a vendor to trigger auto-suspension. | Weight reports by reporter trust and purchase history; require a human decision before suspension; rate-limit reporting; track reporter accuracy. |
| SEC-17 | **Ban evasion.** A banned vendor re-registers with a new phone number. | Link identities on PAN/bank account/device fingerprint/address; block at KYC. |
| SEC-18 | **Secrets management.** No statement. `.env` files in the repo are the default failure. | AWS Secrets Manager / SSM Parameter Store; secret scanning in CI; rotation policy; separate credentials per environment. |
| SEC-19 | **PII in logs.** Phone numbers, addresses, OTPs, tokens and payment identifiers routinely end up in request logs. | Structured logging with a redaction allowlist; never log request bodies wholesale; log retention per NFR-06. |
| SEC-20 | **`$queryRaw` SQL injection.** Prisma is safe until someone reaches for raw SQL for a report. | Ban `$queryRaw` with interpolation; require parameterised `$queryRaw` tagged templates; lint rule. |
| SEC-21 | **CSRF** — applies once refresh tokens live in cookies. | `SameSite=Strict`, double-submit token on state-changing routes, `Origin` validation. |
| SEC-22 | **SSRF** if any feature fetches a vendor-supplied URL (image import, webhook callback). | Allowlist egress, block link-local/private ranges, no redirects. |
| SEC-23 | **No dependency, container or IaC scanning** stated. | `npm audit` / Dependabot, Trivy on images, secret scanning, SAST in CI — all blocking. |
| SEC-24 | **Transport & headers** unspecified. | TLS 1.2+ only, HSTS with preload, strict CORS allowlist, `helmet` defaults, no wildcard origins. |
| SEC-25 | **Backups are unencrypted/unrestricted by default** and lower environments often get a copy of production data. | Encrypted snapshots, separate KMS key, least-privilege restore role, **anonymised** seed data for dev/staging, restore drills. |
| SEC-26 | **No password policy / credential-stuffing defence** (if passwords are used at all). | Argon2id, min 10 chars, breached-password check (k-anonymity API), lockout with backoff, login alerts. |

---

## 7. Performance bottlenecks

| ID | Bottleneck | Root cause | Fix |
|---|---|---|---|
| PERF-01 | Catalogue/home page latency | No caching layer specified; every listing render hits Postgres and joins vendor/category/rating | Redis cache-aside, denormalised list projections, `select` only the fields the card needs |
| PERF-02 | Mobile page weight | Unoptimised vendor-uploaded images served directly from R2 | CDN + responsive variants generated on upload + AVIF/WebP + lazy loading + explicit dimensions to avoid CLS |
| PERF-03 | Preorder drop spike | Hot-row lock contention (SC-01) | Redis admission counter, atomic conditional SQL update, minimal transaction scope, backpressure |
| PERF-04 | Admin dashboard | Live `COUNT(*)`/`SUM()` over orders and payments | Materialised aggregates refreshed every 1–5 min; read replica |
| PERF-05 | Search | `ILIKE '%term%'` cannot use a B-tree index | `pg_trgm` GIN index → dedicated search engine at Phase 2 |
| PERF-06 | Order placement latency | Notifications, invoice PDF generation and analytics writes done inline | Outbox + async workers; commit fast, fan out after |
| PERF-07 | Rating display | Recomputing `AVG(rating)` per product on every render | Denormalised `rating_sum` / `rating_count` on the product, updated transactionally |
| PERF-08 | Payload size | No pagination caps; deep nested includes | Mandatory `limit` with a hard ceiling, cursor pagination, sparse field sets |
| PERF-09 | Slot availability | Computed on demand across all orders in a window | Precomputed slot rows with a `booked` counter |
| PERF-10 | Cold starts / pool churn | Per-instance Prisma pools against RDS (SC-11) | PgBouncer/RDS Proxy, tuned pool size, keep-warm |
| PERF-11 | Frontend bundle | Redux Toolkit + RTK Query + shadcn + charts shipped in one bundle | Route-level code splitting, tree-shaking, `< 200 KB` gzipped initial JS budget enforced in CI |
| PERF-12 | Geospatial filtering | Application-side distance computation | PostGIS GiST index; pincode fast path |

---

## 8. Recommended improvements

| ID | Recommendation | Rationale |
|---|---|---|
| IMP-01 | **Adopt Razorpay Route (linked accounts) for split settlement** rather than pooling funds in a platform account. | Removes the regulatory exposure in BR-05/AMB-02, removes the need to operate a nodal account, and Razorpay handles the split and payout mechanics. The platform still controls timing via on-hold transfers. |
| IMP-02 | **Build a double-entry ledger for all money movement** instead of mutable balance columns. | Commission, TCS/TDS, refunds, holds, COD receivables and payouts are impossible to reconcile with mutable balances. An append-only ledger with entries that must sum to zero is the only auditable design, and it is far cheaper to build now than to retrofit. |
| IMP-03 | **Modular monolith, not microservices, for Phase 1–2.** | The PRD gives no team size, but a marketplace at this stage does not have the operational maturity for distributed transactions. Enforce module boundaries in code (Clean Architecture, no cross-module imports except through published interfaces) so modules can be extracted later without rewrite. Justified in SDD §2. |
| IMP-04 | **Transactional outbox pattern** for every side effect (notifications, search indexing, analytics, webhooks). | Guarantees "if the order committed, the notification will eventually send" without distributed transactions. |
| IMP-05 | **Explicit order state machine** with allowed transitions declared in one place and enforced at the domain layer. | Three fulfilment modes (delivery/pickup/preorder) × payment states will otherwise produce untestable `if` chains and orders stuck in impossible states. |
| IMP-06 | **Store money as integer paise (`BigInt`), never floating point.** Currency code stored explicitly. | Non-negotiable. Floating-point currency errors in a settlement system are unrecoverable. |
| IMP-07 | **Idempotency-Key middleware** on all state-changing POSTs, not just payments. | Mobile networks retry. Double orders and double refunds are otherwise guaranteed. |
| IMP-08 | **OpenAPI-first contract**, with Zod schemas shared between backend validation and the generated typed client. | Single source of truth; eliminates FE/BE drift; enables contract testing. |
| IMP-09 | **Risk-tiered product approval** rather than universal manual approval. | Addresses SC-02, the biggest scaling constraint in the PRD. |
| IMP-10 | **Trust score as a first-class vendor attribute** driving COD eligibility, auto-approval, settlement speed and search ranking. | Resolves BR-23/AMB-04 with one coherent mechanism instead of ad-hoc flags. |
| IMP-11 | **Pincode serviceability table as a fast path**, with PostGIS radius as the precise check. | 95% of serviceability checks resolve from a cheap lookup. |
| IMP-12 | **WhatsApp Business API as the primary notification channel** for India, with SMS fallback. | Higher open rates, lower cost than SMS, and works around the iOS web-push limitation (AMB-20). |
| IMP-13 | **Feature flags from day one.** | Enables dark launches, per-city rollout (directly supports the Phase 2/3 plan) and instant kill switches. |
| IMP-14 | **Soft deletes + full audit tables on all financial and moderation entities.** | Regulatory and dispute defence. |
| IMP-15 | **Design search behind a port interface** even while the Phase 1 adapter is Postgres. | Lets us swap in OpenSearch at Phase 2 with no domain changes. |
| IMP-16 | **Do not build a mobile app; the PWA decision is correct** — but plan a Capacitor/TWA wrapper for the Play Store to get native push on Android and store presence. | Cheap, and resolves half of AMB-20. |
| IMP-17 | **Separate the vendor app UX for a phone in a fish market**: one-handed, large targets, works on 3G, loud audible new-order alert. | The vendor is the operationally critical user and is usually under-designed for. |
| IMP-18 | **Reconsider "Admin as non-mediator" (AMB-01).** Every successful marketplace arbitrates. A hands-off stance is commercially attractive and operationally untenable once money is held. | Recommend: platform arbitrates within a defined policy, with published SLAs. |

---

## 9. Assumptions register

Per your instruction, the SDD is built on the following explicit assumptions. **Each is a decision awaiting your confirmation.** Correcting any of these will change the SDD.

| ID | Assumption | Affects |
|---|---|---|
| ASM-01 | Launch market is a single Indian region; currency **INR only**; timezone **IST only**; AWS region **ap-south-1 (Mumbai)**. | Infrastructure, data model |
| ASM-02 | **Razorpay Route** is used for split settlement; Leen Mart does **not** hold customer funds. Platform controls payout timing via on-hold transfers. | Payment architecture |
| ASM-03 | **Multi-vendor cart is supported.** One customer Order may contain items from several vendors, split into per-vendor **Sub-Orders**, each with its own fulfilment lifecycle, settlement and cancellation. | **Core data model** |
| ASM-04 | Only KYC-verified **Vendors** may sell. Customers may **not** list second-hand goods (C2C is out of scope for v1). | Role model |
| ASM-05 | Authentication is **phone number + OTP** for Customers and Vendors; **email + password + mandatory TOTP MFA** for Admins. | Auth architecture |
| ASM-06 | Vendor monetisation: a vendor is on **exactly one** plan at a time — `COMMISSION` or `SUBSCRIPTION` — with the plan determining an effective commission rate (a subscription plan may set 0%). Plan changes take effect at the next billing cycle. | Pricing, ledger |
| ASM-07 | **GST is in scope for v1**: HSN per product, tax-inclusive pricing, CGST/SGST/IGST split stored per order line, **TCS 1%** and **TDS 0.1%** withheld at settlement, GSTR-8 export from the admin panel. | Catalogue, orders, ledger, invoicing |
| ASM-08 | The **vendor is the supplier of record** and the tax invoice is issued in the vendor's name (generated by the platform on the vendor's behalf, with per-vendor sequential numbering). The platform issues a separate commission invoice to the vendor. | Invoicing |
| ASM-09 | The **platform arbitrates disputes** under a published policy, with a defined refund authority and a 48h-acknowledge / 30-day-resolve grievance SLA (per BR-15). This overrides the "non-mediator" wording pending your decision on AMB-01. | Dispute, refund, hold modules |
| ASM-10 | **COD eligibility** is governed by a computed **vendor trust score** plus an order-value cap plus category exclusions. "Approved" (KYC) is a necessary but not sufficient condition. | Checkout, risk |
| ASM-11 | Preorder **quantity is decremented at successful payment authorisation**, held for 10 minutes during checkout as a soft reservation, and returned to the pool on cancellation or reservation expiry. | Preorder concurrency |
| ASM-12 | Preorder **`expiry` is the last moment a customer may place an order**; a separate `fulfilment_window` governs collection. Balance payment (where advance < 100%) is collected **online before the pickup window opens**; failure to pay cancels the preorder and forfeits nothing beyond a defined cancellation fee. | Preorder |
| ASM-13 | The **QR is displayed by the customer and scanned by the vendor**, contains a signed single-use token bound to the pickup window, and settlement for pickup orders is held for a 24-hour dispute window after redemption. | Pickup, settlement |
| ASM-14 | **Editing an approved product** re-enters the approval queue if the change touches title, images, category, price beyond a ±10% band, or restricted attributes. Other edits publish immediately. | Catalogue moderation |
| ASM-15 | **Product variants are supported** (Product → Variant, with variant-level SKU, price, stock, unit of measure and quantity step). | **Core data model** |
| ASM-16 | **Refunds** are initiated to the original payment source; a wallet is **out of scope** for v1. | Payments |
| ASM-17 | **Serviceability**: vendor stores a geocoded shop location plus a delivery radius; customer addresses are geocoded at save time; serviceability is checked at cart, re-checked at checkout. PostGIS is used from day one. | Delivery |
| ASM-18 | **Fraud detection is rule-based only** in v1 (no ML), with a configurable rule set, a score, an analyst queue and a mandatory human decision before any suspension. | Fraud module |
| ASM-19 | **Technology stack reconciliation**: the project standing instructions take precedence over the PRD. Stack is **TypeScript everywhere, React + Vite + Tailwind + shadcn/ui + Redux Toolkit/RTK Query (per PRD), Node + Express + TypeScript, PostgreSQL + Prisma, Redis, BullMQ, Cloudflare R2, AWS ap-south-1, Docker, GitHub Actions**. UUID (v7) primary keys throughout. | Everything |
| ASM-20 | **Notifications**: transactional email (SES), SMS via a DLT-registered Indian provider, Web Push for installed PWAs, with WhatsApp Business API planned for Phase 2. | Notification architecture |
| ASM-21 | **Deployment**: Docker containers on AWS ECS Fargate behind an ALB, RDS PostgreSQL Multi-AZ, ElastiCache Redis, all in ap-south-1. Not Kubernetes in Phase 1. | Deployment |
| ASM-22 | **Availability target 99.5%**, RTO 4 h, RPO 5 min for Phase 1. | DR |
| ASM-23 | **Modular monolith** deployed as two runtime services (API + worker), with strict internal module boundaries permitting later extraction. | Architecture style |
| ASM-24 | **Offline PWA scope** is limited to: browsing previously viewed catalogue pages, viewing past orders, and holding a local cart. Prices, stock and preorder availability are always re-validated online at checkout; preorder items are never sold offline. | PWA |
| ASM-25 | **v1 scope excludes**: services listings, C2C selling, coupons/promotions, wallet, loyalty, referrals, multi-language, vendor multi-location, and bulk CSV upload — but the data model must not preclude them. | Roadmap |

---

## 10. Recommended decision sequence

Nothing should be built until the **P0** items are resolved. In order of urgency:

1. **AMB-01 / BR-25** — Does the platform arbitrate disputes? *(Blocks refunds, holds, fraud, and the vendor agreement.)*
2. **BR-05 / AMB-02** — Razorpay Route vs pooled funds. *(Blocks the entire payment module and possibly a licence application.)*
3. **BR-29 / ASM-03** — Multi-vendor cart, yes or no? *(Blocks the core order schema.)*
4. **BR-13 / BR-14** — GST/TCS/TDS and invoicing model. *(Blocks the catalogue, order-line and ledger schemas.)*
5. **BR-28** — Can customers sell second-hand goods? *(Blocks the role model.)*
6. **BR-01/02/03** — The commercial rate card. *(Blocks the ledger and quota enforcement.)*
7. **BR-06/07** — Refund and cancellation policy. *(Blocks order and payment state machines.)*
8. **FR-01** — Authentication method. *(Blocks everything user-facing.)*
9. **FR-10/12** — Variants and inventory. *(Blocks the catalogue schema.)*
10. **BR-15/16/17/19** — Legal and statutory compliance work should start **in parallel today**, as it has the longest lead time and is a hard launch gate.

---

**End of document.** Proceed to `02-leen-mart-sdd.md`, which is written against the assumptions in §9.
