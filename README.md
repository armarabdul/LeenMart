# Leen Mart

Production-grade foundation for the Leen Mart multi-vendor marketplace.

**This is a scaffold, not a product.** Authentication, vendors, products,
orders, payments and every other business module are deliberately absent. What
exists is the substrate they will be built on: architecture enforcement,
configuration, logging, error handling, validation, health checks, testing,
containers and CI.

Architecture decisions are recorded in `docs/adr/`. The full design this
scaffold implements is `02-leen-mart-sdd.md`, and the open questions it depends
on are in `01-requirements-gap-analysis.md`.

---

## Quick start

```bash
# 1. Prerequisites: Node 22+, pnpm 9+, Docker
corepack enable && corepack prepare pnpm@9.15.4 --activate

# 2. Install. This generates pnpm-lock.yaml — commit it in your first commit,
#    because CI runs `pnpm install --frozen-lockfile` and will fail without it.
pnpm install

# 3. Configure
cp apps/api/.env.example apps/api/.env
cp apps/customer-pwa/.env.example apps/customer-pwa/.env

# 4. Start Postgres, Redis, MinIO and Mailpit
pnpm infra:up

# 5. Generate the Prisma client and apply migrations
pnpm db:generate
pnpm db:migrate

# 6. Run everything
pnpm dev
```

| Service       | URL                                                        |
| ------------- | ---------------------------------------------------------- |
| Customer PWA  | http://localhost:5173                                      |
| API           | http://localhost:4000                                      |
| Liveness      | http://localhost:4000/healthz                              |
| Readiness     | http://localhost:4000/readyz                               |
| MinIO console | http://localhost:9001 (`leenmart` / `leenmart-dev-secret`) |
| Mailpit       | http://localhost:8025                                      |

The PWA home page renders live platform status. If it shows every dependency as
**Up**, the whole stack is wired correctly.

---

## Repository layout

```
leen-mart/
├── apps/
│   ├── api/                    Express API — Clean Architecture
│   │   ├── src/
│   │   │   ├── modules/        business modules go here (empty by design)
│   │   │   ├── shared/
│   │   │   │   ├── config/         env schema, validated at boot
│   │   │   │   ├── domain/         cross-cutting domain primitives
│   │   │   │   ├── application/    cross-cutting application services
│   │   │   │   ├── infrastructure/ Prisma, Redis, Pino adapters
│   │   │   │   └── interface/      middleware, routers
│   │   │   ├── app.ts          Express assembly (testable, no port binding)
│   │   │   ├── container.ts    composition root
│   │   │   └── server.ts       bootstrap + graceful shutdown
│   │   ├── prisma/             schema, migrations, conventions
│   │   └── test/{unit,integration}
│   └── customer-pwa/           React + Vite + Tailwind PWA
│       └── src/
│           ├── app/            store, router, typed hooks
│           ├── features/       feature slices (empty by design)
│           ├── pages/          route-level components, lazy-loaded
│           ├── components/     shared components
│           └── shared/         api client, config, ui, lib
├── packages/
│   ├── config/                 ESLint + tsconfig presets
│   ├── domain-kit/             Money, Result, branded ids, Clock, ports
│   └── contracts/              Zod schemas shared by API and clients
├── infra/docker/               compose + production Dockerfiles
├── docs/adr/                   architecture decision records
└── .github/workflows/          CI pipeline
```

---

## Commands

| Command                                         | What it does                                       |
| ----------------------------------------------- | -------------------------------------------------- |
| `pnpm dev`                                      | Run API and PWA together                           |
| `pnpm build`                                    | Build every package in dependency order            |
| `pnpm lint`                                     | ESLint, including the architecture dependency rule |
| `pnpm typecheck`                                | `tsc --noEmit` across the workspace                |
| `pnpm test`                                     | Unit tests (fast, no I/O)                          |
| `pnpm format`                                   | Prettier write                                     |
| `pnpm infra:up` / `infra:down` / `infra:reset`  | Local backing services                             |
| `pnpm db:generate` / `db:migrate` / `db:studio` | Prisma                                             |
| `pnpm --filter @leen-mart/api test:integration` | Integration tests (needs `infra:up`)               |

---

## What is already enforced

These are not conventions to remember. They fail the build.

**The Clean Architecture dependency rule.** `domain/` cannot import Express,
Prisma, Redis or Pino. `application/` cannot import an adapter. Cross-module
imports must go through the module's `index.ts`. See ADR-0002.

**Type strictness.** `strict`, plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes` and `noImplicitOverride`. `any` is an error, as are
non-null assertions and floating promises.

**Configuration validity.** The API validates its environment against a Zod
schema at process start and refuses to boot on a bad value, listing every
failure at once. Production additionally rejects pretty logging and a localhost
CORS origin.

**Log hygiene.** Pino redacts OTPs, tokens, passwords, PAN, Aadhaar and bank
details via an allowlist. Request and response bodies are never logged wholesale.

**Error discipline.** One global handler maps domain errors to status codes.
Stack traces, SQL and provider payloads never reach a client; every response
carries the request id that correlates it to the logs.

**Input validation.** `validate()` parses body, query, params and headers with
Zod and replaces the payload with the parsed result. Schemas are `.strict()`, so
an unrecognised field is rejected rather than ignored — which is what closes the
mass-assignment hole.

---

## Conventions for the first business module

1. Create `apps/api/src/modules/<name>/` with `domain/`, `application/`,
   `infrastructure/`, `interface/`, `<name>.module.ts` and `index.ts`.
2. Model the domain first, with no imports outside `domain/`. Lint will tell you
   if you slip.
3. Define ports in `application/ports/`; implement them in `infrastructure/`.
4. Add request schemas to `packages/contracts` so the PWA shares them.
5. Export only what other modules may use from `index.ts`.
6. Mount the router in `app.ts`.
7. Write unit tests against in-memory fakes and integration tests against real
   PostgreSQL. Do not mock the database in a repository test — the locking and
   constraint behaviour this platform depends on does not exist in a mock.

Run `pnpm lint && pnpm typecheck && pnpm test` before pushing; the pre-push hook
runs the last two anyway.

---

## Git workflow

Conventional Commits, enforced by commitlint:

```
feat(catalogue): add product variant aggregate
fix(api): return 409 rather than 500 on duplicate SKU
chore(deps): bump prisma to 6.3.1
```

Allowed scopes: `root`, `api`, `web`, `config`, `domain-kit`, `contracts`,
`infra`, `docs`, `deps`, `ci`.

Husky hooks: `pre-commit` runs lint-staged, `commit-msg` runs commitlint,
`pre-push` runs typecheck and unit tests.

---

## Status

| Requirement                            | State                                         |
| -------------------------------------- | --------------------------------------------- |
| Monorepo (pnpm + Turborepo)            | Done                                          |
| Backend: Node + Express 5 + TypeScript | Done                                          |
| Frontend: React + Vite + TypeScript    | Done                                          |
| PostgreSQL + PostGIS                   | Done (compose + Prisma datasource)            |
| Prisma ORM                             | Done (baseline schema: outbox + audit log)    |
| Redis                                  | Done (client, health check, rate-limit store) |
| Docker                                 | Done (compose + production Dockerfiles)       |
| Environment configuration              | Done (Zod-validated, fails fast)              |
| ESLint                                 | Done (incl. architecture enforcement)         |
| Prettier                               | Done                                          |
| Husky                                  | Done (3 hooks)                                |
| Health endpoint                        | Done (`/healthz` + `/readyz`)                 |
| Global error handler                   | Done                                          |
| Logging                                | Done (Pino, structured, redacted)             |
| Validation                             | Done (Zod middleware)                         |
| Clean Architecture folder structure    | Done                                          |
| Business modules                       | **Not implemented, by design**                |
