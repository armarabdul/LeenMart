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
 * `Product`/`ProductVariant` join here from S2-3a: unlike `Category`, they
 * are vendor-owned rows, not platform-owned ones, and carry a `vendor_id`
 * (denormalised onto the variant too) for exactly this reason.
 *
 * `Order`/`SubOrder`/`OrderItem` join here from S3-5, alongside — not
 * instead of — their existing, unwrapped `leenmart_checkout` write path
 * (`PrismaOrderRepository`, `CheckoutTransactionRunner`). That path never
 * routes through `withTenantBoundary`, so these three joining this set
 * changes nothing for it; it only means a *new* vendor-order repository
 * built on the wrapped `prisma` client now gets `app.vendor_id` set before
 * every query, which `orders_vendor_select`/`sub_orders_vendor_select`/
 * `order_items_vendor_select` (20260816130000) require.
 *
 * `LedgerJournal`/`LedgerEntry` join here from S3-8, the same way and for
 * the same reason `Order`/`SubOrder`/`OrderItem` did: S3-7 posts them on the
 * unwrapped `leenmart_checkout` write path (`PrismaLedgerRepository` inside
 * `PostOrderPaymentJournalsUseCase`), which is untouched by this set. S3-8's
 * new `PrismaVendorEarningsQuery` is the first *reader* built on the wrapped
 * `prisma` client, and `ledger_journals_vendor_select`/
 * `ledger_entries_vendor_select` (20260817090000) both require
 * `app.vendor_id` to be set for that role to see anything at all — without
 * this entry, every query that repository issues would run with no tenant
 * context and silently return zero rows (RLS's own fail-closed behaviour),
 * not merely another vendor's data leaking.
 *
 * `PickupToken` joins here from S4-QR, for the identical reason: a vendor's
 * own redemption path (`RedeemPickupTokenUseCase`) reads/writes
 * `pickup_tokens` through the wrapped `leenmart_app` client, and
 * `pickup_tokens_vendor_select`/`pickup_tokens_vendor_redeem`
 * (20260817180000) both require `app.vendor_id`. This entry was added
 * deliberately in the same migration/PR that introduced the table, not
 * discovered afterward the way S3-8's own gap was.
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
  'ProductMedia',
  'ProductMediaVariant',
  'Order',
  'SubOrder',
  'OrderItem',
  'LedgerJournal',
  'LedgerEntry',
  'PickupToken',
  // S4-SERV: vendor-declared delivery serviceability, RLS-scoped by vendor_id.
  'ServiceablePincode',
  // S4-HOURS: vendor operating schedule and closures, RLS-scoped by vendor_id.
  'BusinessHour',
  'BusinessHourClosure',
  // S4-SLOTS: the vendor's slot offer and its dated capacity counter, both
  // RLS-scoped by vendor_id. `SlotCapacity` is written only by checkout; the
  // vendor role reads it.
  'DeliverySlot',
  'SlotCapacity',
  // S6-NOTIFY-INAPP: the first **user**-scoped member. Every other model here
  // is confined by `app.vendor_id`; `notifications` is confined by
  // `app.user_id`, which the same boundary already sets.
  'Notification',
  // S8-REVIEWS: the second user-scoped member, same reasoning as
  // `Notification` — a customer has no vendor and writes/reads their own
  // reviews by `app.user_id` alone.
  'Review',
  // Phase Next (preorder): `PreorderCampaign` is vendor-owned, RLS-scoped by
  // `app.vendor_id`, the same shape `DeliverySlot` already establishes.
  // `PreorderReservation` is written exclusively on the unwrapped
  // `leenmart_checkout` credential (mirroring `Order`/`SubOrder`/`OrderItem`'s
  // own original shape) — it joins this set only for the vendor's own
  // demand-summary *read*, built on the wrapped `prisma` client, which needs
  // `app.vendor_id` set for `preorder_reservations_vendor_select` to see
  // anything at all.
  'PreorderCampaign',
  'PreorderReservation',
]);

/**
 * Models reachable with a **user** context alone — no resolved vendor.
 *
 * `VendorProfile` is here because it is the tenant *root*: registration inserts
 * a `vendors` row at a moment when the caller has no vendor, so requiring
 * `app.vendor_id` would make the operation that creates a tenant impossible.
 * The database still constrains it — the INSERT policy demands
 * `user_id = app.user_id`, so a caller can create a vendor for themselves and
 * for nobody else.
 *
 * `Notification` is here for a different reason, and it is the first of its
 * kind: it is **user-scoped rather than vendor-scoped**. Its policies compare
 * `recipient_user_id` against `app.user_id` and never mention `app.vendor_id`,
 * so a customer — who has no vendor and never will — must still be able to read
 * their own inbox. Requiring a vendor here would lock every customer out of
 * their own notifications while protecting nothing.
 *
 * Membership is not a relaxation: every model here is still confined by a
 * policy, and the boundary still refuses a query with no context at all.
 *
 * `Review` (S8-REVIEWS) joins for the identical reason `Notification` did: a
 * customer writing and reading their own reviews has no vendor and never
 * will, so requiring one would lock every customer out while protecting
 * nothing.
 */
export const USER_ROOTED_MODELS: ReadonlySet<string> = new Set([
  'VendorProfile',
  'Notification',
  'Review',
]);

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
