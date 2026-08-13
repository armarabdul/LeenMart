import { AsyncLocalStorage } from 'node:async_hooks';
import type { UserId, VendorId } from '../../../modules/identity/index.js';

/**
 * The Prisma models protected by row-level security (KYC-2B-3), and which
 * therefore may not be queried without a tenant context.
 *
 * Deliberately an explicit allowlist rather than "anything with a user_id".
 * The authentication tables — `users`, `refresh_tokens`, `otps`,
 * `mfa_secrets`, `mfa_challenges` — are *not* tenant-scoped: a login happens
 * before any tenant is known, so making them tenant-scoped would make
 * authentication impossible rather than safe.
 *
 * `sub_orders`, `payments` and `ledger_entries` join this set when those
 * tables exist (SDD 6.6 names them alongside `kyc_documents`).
 *
 * `Product`/`ProductVariant` join here from S2-3a: unlike `Category`, they
 * are vendor-owned rows, not platform-owned ones, and carry a `vendor_id`
 * (denormalised onto the variant too) for exactly this reason.
 *
 * Prisma model names, not table names — this is matched against the `model`
 * field the query extension receives.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'VendorProfile',
  'VendorKycSubmission',
  'KycDocument',
  'Product',
  'ProductVariant',
  'Inventory',
]);

/**
 * The tenant *root*: reachable with a user context alone, because that is the
 * only way a vendor can ever come into existence.
 *
 * Registration inserts a `vendors` row at a moment when the caller has no
 * vendor, so requiring `app.vendor_id` would make the operation that creates a
 * tenant impossible. The database still constrains it — the INSERT policy
 * demands `user_id = app.user_id`, so a caller can create a vendor for
 * themselves and for nobody else, and the SELECT policy lets them read back
 * only their own row. Every other model needs a resolved vendor.
 */
export const USER_ROOTED_MODELS: ReadonlySet<string> = new Set(['VendorProfile']);

/**
 * Who a unit of work is running as, for the purpose of database isolation.
 *
 * Three states, distinguished on purpose:
 *
 *   * **absent** — no store at all. An unauthenticated request, or code that
 *     never established a context. Tenant-scoped queries are refused.
 *   * **`authenticated`** — a verified caller. `userId` always; `vendorId`
 *     only once a vendor profile has been resolved for them, and `null` for a
 *     customer or an admin. These become `app.user_id` and `app.vendor_id`
 *     for the duration of one transaction.
 *   * **`system`** — a background job, migration or CLI. Carries neither id
 *     and grants nothing: tenant-scoped queries are refused just as firmly as
 *     with no context. It exists so that "this is deliberately not a user
 *     request" is expressible and greppable, rather than looking identical to
 *     code that forgot.
 *
 * There is no `isAdmin` flag, and there will not be one. Elevated access is a
 * separate database credential (`adminPrisma`, KYC-2B-1) — a boolean set by
 * the same process the policies exist to constrain would be worth nothing.
 *
 * Carries identity only. No tokens, no session ids, no credentials: this
 * object exists to reach PostgreSQL, and the minimum that has to reach
 * PostgreSQL is who the caller is and which vendor they act for.
 */
export type TenantContext =
  | {
      readonly kind: 'authenticated';
      readonly userId: UserId;
      readonly vendorId: VendorId | null;
      readonly inTransaction: boolean;
    }
  | { readonly kind: 'system'; readonly reason: string };

const storage = new AsyncLocalStorage<TenantContext>();

/** The ambient tenant context, or `undefined` outside any established scope. */
export const getTenantContext = (): TenantContext | undefined => storage.getStore();

/**
 * Runs `callback` as a verified caller. Everything awaited inside — including
 * repository calls several layers down — sees this context, which is what
 * keeps `userId`/`vendorId` out of every use-case and repository signature.
 *
 * `vendorId` is `null` for a caller with no vendor profile. That is not a
 * denial: it means the caller reaches the tenant root — to register, or to
 * read their own row — and nothing else.
 */
export const runWithTenant = <T>(
  identity: { userId: UserId; vendorId: VendorId | null },
  callback: () => T | Promise<T>,
): Promise<T> =>
  // `Promise.resolve(callback())` rather than an async wrapper: the callback is
  // invoked synchronously inside `run`, which is what puts it in the context,
  // and normalising the result here means a caller with a synchronous body does
  // not have to fake an `await` to satisfy the signature.
  storage.run(
    {
      kind: 'authenticated',
      userId: identity.userId,
      vendorId: identity.vendorId,
      inTransaction: false,
    },
    () => Promise.resolve(callback()),
  );

/**
 * Runs `callback` as the platform rather than as a caller. Grants no access to
 * tenant-scoped models; it only records intent.
 */
export const runAsSystem = <T>(reason: string, callback: () => T | Promise<T>): Promise<T> =>
  storage.run({ kind: 'system', reason }, () => Promise.resolve(callback()));

/**
 * Marks the current context as being inside a sanctioned tenant transaction,
 * so the query extension knows both GUCs are already set on the connection its
 * query will run on and must not open a second transaction.
 *
 * Internal to the persistence layer — application code reaches this only
 * through `runInTenantTransaction`.
 */
export const runInsideTenantTransaction = <T>(
  context: Extract<TenantContext, { kind: 'authenticated' }>,
  callback: () => T | Promise<T>,
): Promise<T> =>
  storage.run({ ...context, inTransaction: true }, () => Promise.resolve(callback()));
