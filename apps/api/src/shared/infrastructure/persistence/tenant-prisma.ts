import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError, type TransactionRunner, type TransactionScope } from '@leen-mart/domain-kit';
import {
  TENANT_SCOPED_MODELS,
  USER_ROOTED_MODELS,
  getTenantContext,
  runInsideTenantTransaction,
  type TenantContext,
} from './tenant-context.js';

/**
 * A tenant-scoped query was attempted with no context to run it under.
 *
 * A 500, not a 4xx: this is never the caller's fault. It means a code path
 * reached a tenant-scoped model without the middleware or job wrapper that was
 * supposed to establish who it is running as, and the only correct response is
 * to fail the request rather than to guess a tenant or fall back to an
 * unrestricted connection.
 *
 * Names the model, never the caller — the message reaches logs and error
 * reporting, and a tenant or user id there is a correlation key nobody asked
 * for.
 */
export class MissingTenantContextError extends AppError {
  readonly kind = 'INTERNAL' as const;
  readonly code = 'MISSING_TENANT_CONTEXT';

  constructor(model: string) {
    super(`A tenant-scoped query on ${model} was attempted without a tenant context.`);
  }
}

type AuthenticatedContext = Extract<TenantContext, { kind: 'authenticated' }>;

/** A verified caller, with or without a resolved vendor. */
const requireAuthenticated = (what: string): AuthenticatedContext => {
  const context = getTenantContext();
  if (context?.kind !== 'authenticated') {
    throw new MissingTenantContextError(what);
  }
  return context;
};

/**
 * The context a tenant-scoped query may run under, or a thrown error.
 *
 * `VendorProfile` is the tenant root and needs only a user: registration
 * creates the vendor, so demanding one first would make it unreachable. Every
 * other model needs a resolved `vendorId`, because their policies compare
 * against `app.vendor_id` and a null one would match nothing — silently
 * returning zero rows instead of failing, which is the worst outcome
 * available.
 */
const requireContext = (model: string): AuthenticatedContext => {
  const context = getTenantContext();
  // Fail closed. Not "fall back to the owner client", not "treat as system",
  // not "null tenant" — every one of those is a cross-tenant read waiting to
  // happen.
  if (context?.kind !== 'authenticated') {
    throw new MissingTenantContextError(model);
  }
  if (!context.vendorId && !USER_ROOTED_MODELS.has(model)) {
    throw new MissingTenantContextError(model);
  }
  return context;
};

/**
 * Both session settings, transaction-locally.
 *
 * `app.vendor_id` is set to the empty string when the caller has no vendor,
 * never omitted. Every policy reads it as `nullif(current_setting(…), '')`, so
 * an empty string is "no vendor" — whereas leaving the previous request's
 * value in place would be a cross-tenant read. Both are `set_config(…, TRUE)`,
 * so PostgreSQL discards them at COMMIT *and* ROLLBACK.
 */
const configureSession = (
  client: PrismaClient,
  context: AuthenticatedContext,
): Prisma.PrismaPromise<unknown>[] => [
  client.$executeRaw`SELECT set_config('app.user_id', ${context.userId}, TRUE)`,
  client.$executeRaw`SELECT set_config('app.vendor_id', ${context.vendorId ?? ''}, TRUE)`,
];

/**
 * Wraps a Prisma client so every query against a tenant-scoped model carries
 * `app.user_id` and `app.vendor_id` on the connection it runs on.
 *
 * **Two paths, because Prisma requires two** — this is not a preference, it is
 * what the client's behaviour forces, and both halves were verified
 * experimentally against PostgreSQL 16 before this was written:
 *
 *  1. **Ordinary query.** The extension opens an *array* transaction —
 *     `$transaction([set_config, set_config, query])` — which Prisma runs as
 *     one transaction on one connection.
 *
 *  2. **Inside `runInTenantTransaction`.** The settings are already on the
 *     interactive transaction's pinned connection, so the extension passes
 *     straight through. It **must not** open a nested transaction here: the
 *     `query(args)` it receives is bound to the interactive transaction's
 *     connection, while a nested `$transaction` would acquire a *different*
 *     one and configure that instead. The query would then run with no tenant
 *     context and quietly return zero rows rather than failing. Under a small
 *     pool it also deadlocks, waiting for a connection the outer transaction
 *     is holding.
 *
 * Models outside `TENANT_SCOPED_MODELS` pass through untouched and need no
 * context, which is what keeps login, refresh and OTP working.
 *
 * **Known gap, deliberate:** `$allModels` does not intercept
 * `$queryRaw`/`$executeRaw`, so raw SQL against a tenant table bypasses this
 * boundary. The RLS policies still apply — they are enforced by PostgreSQL,
 * not by this extension — but raw SQL runs with whatever settings the
 * connection happens to carry, which for an unconfigured connection means no
 * rows. No repository does this today and a test asserts it stays that way.
 */
export const withTenantBoundary = (client: PrismaClient): PrismaClient =>
  client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const context = requireContext(model);
          if (context.inTransaction) {
            return query(args);
          }

          const results = await client.$transaction([
            ...configureSession(client, context),
            query(args),
          ]);
          return results[results.length - 1];
        },
      },
    },
    // The extension changes the client's shape; the cast keeps repositories
    // typed against `PrismaClient` so this is a drop-in replacement rather
    // than a type change rippling through every constructor.
  }) as unknown as PrismaClient;

/**
 * **The sanctioned way to run several tenant-scoped writes atomically.**
 *
 * Use this — never a bare `prisma.$transaction` — whenever a unit of work
 * touches a model in `TENANT_SCOPED_MODELS`. A bare `$transaction` gives the
 * extension no way to reach the pinned connection, for the reason set out
 * above, and the failure is silent rather than loud.
 *
 * The callback receives the transaction client and **must** use it for every
 * statement inside; a call made on the outer client would run on a different
 * connection and outside the transaction.
 *
 * Sets both settings on `tx` as its first statements, so every subsequent
 * query on that client — nested repository calls included — sees the same
 * values, and PostgreSQL discards them on COMMIT or ROLLBACK.
 */
export const runInTenantTransaction = async <R>(
  client: PrismaClient,
  callback: (tx: PrismaClient) => Promise<R>,
): Promise<R> => {
  // Only an authenticated context is required to *open* the transaction — not
  // a resolved vendor. Vendor registration is the case that forces this: it
  // creates the tenant, so there is no `vendorId` to demand, and the tenant
  // root's INSERT policy is written against `app.user_id` precisely for that.
  //
  // This is not a relaxation of enforcement. Every query inside still passes
  // through `requireContext(model)` before the `inTransaction` short-circuit,
  // so a leaf model like `VendorKycSubmission` is refused here exactly as it
  // is outside a transaction. The transaction-level check was strictly
  // redundant with the per-query one; only the per-query one knows which model
  // is being touched, which is the only place the distinction can be made.
  const context = requireAuthenticated('a tenant transaction');

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${context.userId}, TRUE)`;
    await tx.$executeRaw`SELECT set_config('app.vendor_id', ${context.vendorId ?? ''}, TRUE)`;
    return runInsideTenantTransaction(context, () => callback(tx as unknown as PrismaClient));
  });
};

/**
 * `TransactionRunner` over the tenant-aware client (SDD 2.3).
 *
 * The application layer gets "run these writes atomically" without learning
 * what a Prisma client is; the scope it hands back is the transaction client,
 * opaque until a repository adapter unwraps it in `withTransaction`.
 */
export class PrismaTransactionRunner implements TransactionRunner {
  constructor(private readonly prisma: PrismaClient) {}

  async run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T> {
    return runInTenantTransaction(this.prisma, (tx) => work(tx as unknown as TransactionScope));
  }
}

/**
 * `TransactionRunner` for the **admin credential**, which needs no tenant
 * settings.
 *
 * A second adapter of the same port rather than a change to the one above,
 * because the two answer to different authorities. `PrismaTransactionRunner`
 * serves the vendor-facing client, whose RLS policies compare `vendor_id` to
 * `app.vendor_id` — so it must refuse to open without a tenant context, and
 * that refusal is what makes a missing context fail closed instead of
 * returning another vendor's rows.
 *
 * `leenmart_admin`'s policies are `USING (true)`: there is no setting for them
 * to read, so demanding one would only require inventing a tenant an
 * administrator does not have. The admin routes deliberately establish no
 * tenant context (KYC-5 Commit 2), and this is the transaction boundary that
 * fact requires.
 *
 * Still one transaction, so a decision and the vendor's lifecycle transition
 * commit or roll back together — the atomicity guarantee is identical, only
 * the session configuration differs.
 */
export class AdminTransactionRunner implements TransactionRunner {
  constructor(private readonly adminPrisma: PrismaClient) {}

  async run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T> {
    return this.adminPrisma.$transaction((tx) => work(tx as unknown as TransactionScope));
  }
}

/**
 * `TransactionRunner` for the **checkout credential** (`leenmart_checkout`,
 * S3-3A) — structurally identical to `AdminTransactionRunner` (a plain
 * `$transaction`, no session GUCs to set), but kept as its own class rather
 * than reused under the `Admin` name: the two credentials answer to
 * different authorities, and a checkout transaction masquerading as an
 * "admin" one would misdescribe exactly the distinction §6.6/KYC-2B-1 exist
 * to draw.
 *
 * No tenant context because none of this role's RLS policies read one —
 * `vendors_checkout_read` and `inventory_checkout_decrement` are both
 * `USING (true)`, and the order module's own tables carry no RLS at all
 * (customer-owned, ownership enforced in application code, the same
 * `carts`/`addresses` convention). A multi-vendor `PlaceOrderUseCase`
 * transaction could not express itself through the single-`vendor_id`
 * session mechanism `PrismaTransactionRunner` requires even if it wanted
 * to — this is the credential built for exactly that gap.
 */
export class CheckoutTransactionRunner implements TransactionRunner {
  constructor(private readonly checkoutPrisma: PrismaClient) {}

  async run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T> {
    return this.checkoutPrisma.$transaction((tx) => work(tx as unknown as TransactionScope));
  }
}
