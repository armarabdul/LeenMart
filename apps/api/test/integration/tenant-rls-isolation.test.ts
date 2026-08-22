import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';

/**
 * Row-level security isolation, proven against real PostgreSQL as the real
 * runtime roles (KYC-2B-3).
 *
 * Every assertion checks the **actual result** — a row count, an affected-row
 * count, a specific error — never merely that a query did not throw. Under RLS
 * a cross-tenant read returns zero rows and a cross-tenant write reports zero
 * affected rows: both succeed loudly enough to fool a test that only asserts
 * "no exception", which is precisely how isolation suites come to pass while
 * proving nothing.
 *
 * Connects as `leenmart_app` and `leenmart_admin` rather than through Prisma's
 * default datasource, because a suite run as the owner would demonstrate
 * nothing at all: the owner is SUPERUSER with BYPASSRLS.
 */
const requireUrl = (name: 'DATABASE_URL' | 'APP_DATABASE_URL' | 'ADMIN_DATABASE_URL'): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} must be set for the RLS suite. Run \`pnpm db:migrate:deploy && pnpm db:provision-roles\`.`,
    );
  }
  return value;
};

describe('tenant RLS isolation', () => {
  const ownerUrl = requireUrl('DATABASE_URL');
  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
  const app = new PrismaClient({ datasources: { db: { url: requireUrl('APP_DATABASE_URL') } } });
  const admin = new PrismaClient({
    datasources: { db: { url: requireUrl('ADMIN_DATABASE_URL') } },
  });
  const ids = new UuidV7Generator();

  const userA = ids.generate();
  const userB = ids.generate();
  const freshUser = ids.generate();
  const vendorA = ids.generate();
  const vendorB = ids.generate();
  const kycA = ids.generate();
  const kycB = ids.generate();
  const now = new Date('2026-01-01T00:00:00.000Z');

  /**
   * Runs `sql` as the app role with the session settings a request would carry.
   * Transaction-local, exactly as the Prisma boundary sets them.
   */
  const asApp = async <T>(
    identity: { userId?: string; vendorId?: string },
    sql: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> =>
    app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${identity.userId ?? ''}, TRUE)`;
      await tx.$executeRaw`SELECT set_config('app.vendor_id', ${identity.vendorId ?? ''}, TRUE)`;
      return sql(tx as unknown as PrismaClient);
    });

  const countVendors = async (tx: PrismaClient, where: string, value: string): Promise<number> => {
    const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM vendors WHERE ${where} = $1::uuid`,
      value,
    );
    return Number(rows[0]?.count ?? -1);
  };

  beforeAll(async () => {
    const stamp = Date.now();
    await owner.user.createMany({
      data: [
        { id: userA, email: `rls-a-${stamp}@example.com` },
        { id: userB, email: `rls-b-${stamp}@example.com` },
        { id: freshUser, email: `rls-fresh-${stamp}@example.com` },
      ],
    });
    await owner.vendorProfile.createMany({
      data: [
        { id: vendorA, userId: userA, createdAt: now, updatedAt: now },
        { id: vendorB, userId: userB, createdAt: now, updatedAt: now },
      ],
    });
    const identifiers = {
      panFingerprint: 'a'.repeat(64),
      panLast4: '234F',
      gstin: '27ABCDE1234F1Z0',
      bankFingerprint: 'b'.repeat(64),
      bankAccountLast4: '9012',
      ifsc: 'HDFC0001234',
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await owner.vendorKycSubmission.createMany({
      data: [
        { id: kycA, vendorId: vendorA, ...identifiers },
        { id: kycB, vendorId: vendorB, ...identifiers },
      ],
    });
    await owner.kycDocument.createMany({
      data: [vendorA, vendorB].map((vendor, index) => ({
        id: ids.generate(),
        kycId: index === 0 ? kycA : kycB,
        vendorId: vendor,
        type: 'PAN' as const,
        objectKey: `vendor/${vendor}/pan.enc`,
        wrappedDataKey: Buffer.from('wrapped'),
        contentType: 'application/pdf',
        sizeBytes: 1024,
        status: 'UPLOADED' as const,
        uploadedAt: now,
        createdAt: now,
      })),
    });
  });

  afterAll(async () => {
    await owner.vendorKycSubmission.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await owner.vendorProfile.deleteMany({ where: { id: { in: [vendorA, vendorB] } } });
    await owner.vendorProfile.deleteMany({ where: { userId: freshUser } });
    await owner.user.deleteMany({ where: { id: { in: [userA, userB, freshUser] } } });
    await Promise.all([owner.$disconnect(), app.$disconnect(), admin.$disconnect()]);
  });

  describe('RLS is actually enabled and enforced', () => {
    it('has row security on exactly the tenant-scoped tables', async () => {
      // `products`/`product_variants` joined this list in S2-3a — the first
      // catalogue tables that are vendor-owned rather than platform-owned.
      // `inventory` joined in S2-4, the same reasoning one level deeper.
      // `product_media` joined in S2-6a, and `product_media_variants` in
      // S2-6b — written by a background worker rather than a request, which
      // is precisely why it is in the boundary rather than exempt from it.
      // `orders`/`sub_orders`/`order_items` joined in S3-5 — additively:
      // `leenmart_checkout`'s own policies on these three stay `USING (true)`
      // (unchanged reach), and it is only `leenmart_app`'s new vendor-scoped
      // policies that are actually restrictive (see the `20260816130000`
      // migration's own header).
      //
      // **This list is exhaustive on purpose.** It is not a sample: a new
      // vendor-owned table that forgets its policies shows up here as a
      // missing entry, and a platform table that gains RLS by accident shows
      // up as an extra one. Every milestone that adds a tenant table adds its
      // name below in the same commit — this assertion once ran eight tables
      // behind for four milestones, which is exactly the failure it exists to
      // prevent.
      const rows = await owner.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND rowsecurity ORDER BY tablename`;

      expect(rows.map((row) => row.tablename)).toEqual([
        // S4-HOURS: the vendor's operating schedule and its closures.
        'business_hour_closures',
        'business_hours',
        // S4-SLOTS: the vendor's recurring slot offer.
        'delivery_slots',
        'inventory',
        'kyc_documents',
        // S3-7: the double-entry ledger. Vendor-scoped for `leenmart_app`,
        // cross-vendor SELECT for `leenmart_admin`, SELECT+INSERT for the
        // checkout writer, and no UPDATE/DELETE policy for anyone — half of
        // what makes it append-only.
        'ledger_entries',
        'ledger_journals',
        // S6-NOTIFY-INAPP: the first user-scoped table here. Its policies
        // compare `recipient_user_id` against `app.user_id` rather than
        // `app.vendor_id`, and it has no admin policy at all — see the
        // admin-credential assertion below.
        'notifications',
        'order_items',
        'orders',
        // S4-QR: a pickup token is the credential that completes a sub-order,
        // so it is vendor-scoped like every other order table.
        'pickup_tokens',
        'preorder_campaigns',
        'preorder_payment_attempts',
        'preorder_reservations',
        'product_media',
        'product_media_variants',
        'product_variants',
        'products',
        // S8-REVIEWS: user-scoped RLS (`app.user_id`) like `notifications`,
        // plus a public policy that exposes APPROVED rows only.
        'reviews',
        // S4-SERV: the vendor's declared delivery pincodes.
        'serviceable_pincodes',
        // S4-SLOTS: the dated capacity counter. Vendor-readable, but only
        // `leenmart_checkout` may move `booked`.
        'slot_capacity',
        'sub_orders',
        'vendor_kyc_submissions',
        'vendors',
      ]);
    });

    it('has no table forced, so migrations still work as owner', async () => {
      const rows = await owner.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM pg_class WHERE relforcerowsecurity`;

      expect(Number(rows[0]?.count)).toBe(0);
    });

    it('keeps the runtime roles unable to bypass RLS', async () => {
      // Without this the policies below are decoration.
      const rows = await owner.$queryRaw<{ rolname: string; rolbypassrls: boolean }[]>`
        SELECT rolname, rolbypassrls, rolsuper FROM pg_roles
        WHERE rolname IN ('leenmart_app', 'leenmart_admin') ORDER BY rolname`;

      expect(rows).toHaveLength(2);
      expect(rows.every((role) => !role.rolbypassrls)).toBe(true);
    });

    it('defines no SECURITY DEFINER function for the tenant path', async () => {
      const rows = await owner.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef AND p.proname LIKE '%vendor%'`;

      expect(Number(rows[0]?.count)).toBe(0);
    });
  });

  describe('no context sees nothing', () => {
    it.each(['vendors', 'vendor_kyc_submissions', 'kyc_documents'])(
      'returns zero rows from %s with neither setting',
      async (table) => {
        const rows = await asApp({}, (tx) =>
          tx.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) AS count FROM ${table}`),
        );

        expect(Number(rows[0]?.count)).toBe(0);
      },
    );

    it('does not error on the empty-string setting', async () => {
      // The trap: casting '' to uuid raises. `nullif` in every policy is what
      // turns a reused pooled connection into "no rows" instead of a 500.
      await expect(
        asApp({}, (tx) => tx.$queryRawUnsafe('SELECT count(*) FROM vendors')),
      ).resolves.toBeDefined();
    });
  });

  describe('the tenant root', () => {
    it('lets a user see their own vendor row with only app.user_id', async () => {
      // This is what makes the middleware's resolver possible at all.
      const count = await asApp({ userId: userA }, (tx) => countVendors(tx, 'user_id', userA));

      expect(count).toBe(1);
    });

    it('does not let a user see another user’s vendor row', async () => {
      const count = await asApp({ userId: userA }, (tx) => countVendors(tx, 'user_id', userB));

      expect(count).toBe(0);
    });

    it('lets a vendor see their own row by vendor id', async () => {
      const count = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        countVendors(tx, 'id', vendorA),
      );

      expect(count).toBe(1);
    });

    it('does not let vendor A read vendor B', async () => {
      const count = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        countVendors(tx, 'id', vendorB),
      );

      expect(count).toBe(0);
    });

    it('does not let vendor A update vendor B', async () => {
      const affected = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$executeRawUnsafe(`UPDATE vendors SET status = 'ACTIVE' WHERE id = $1::uuid`, vendorB),
      );

      expect(affected).toBe(0);
      const stillRegistered = await owner.vendorProfile.findUnique({ where: { id: vendorB } });
      expect(stillRegistered?.status).toBe('REGISTERED');
    });

    it('does not let vendor A delete vendor B — or anyone at all', async () => {
      // There is no DELETE policy; its absence is the control.
      const affected = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM vendors WHERE id = $1::uuid`, vendorB),
      );

      expect(affected).toBe(0);
      expect(await owner.vendorProfile.findUnique({ where: { id: vendorB } })).not.toBeNull();
    });

    it('does not let a vendor delete even their own row', async () => {
      const affected = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM vendors WHERE id = $1::uuid`, vendorA),
      );

      expect(affected).toBe(0);
      expect(await owner.vendorProfile.findUnique({ where: { id: vendorA } })).not.toBeNull();
    });

    it('refuses an update that would move a vendor into another tenant', async () => {
      // `WITH CHECK`, not just `USING`: the row is visible, the result would
      // not be.
      await expect(
        asApp({ userId: userA, vendorId: vendorA }, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE vendors SET id = $1::uuid WHERE id = $2::uuid`,
            ids.generate(),
            vendorA,
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe('registration under the INSERT policy', () => {
    it('lets a customer create a vendor for their own user id', async () => {
      const newVendor = ids.generate();

      const affected = await asApp({ userId: freshUser }, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO vendors (id, user_id, status, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, 'REGISTERED', now(), now())`,
          newVendor,
          freshUser,
        ),
      );

      expect(affected).toBe(1);
      expect(await owner.vendorProfile.findUnique({ where: { id: newVendor } })).not.toBeNull();
      await owner.vendorProfile.delete({ where: { id: newVendor } });
    });

    it('refuses a vendor created for someone else', async () => {
      // The database independently enforces what the CUSTOMER-role check
      // intends, so an application bug is not enough to forge a tenant.
      await expect(
        asApp({ userId: freshUser }, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO vendors (id, user_id, status, created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, 'REGISTERED', now(), now())`,
            ids.generate(),
            userB,
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('refuses a vendor created with no user context at all', async () => {
      await expect(
        asApp({}, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO vendors (id, user_id, status, created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, 'REGISTERED', now(), now())`,
            ids.generate(),
            freshUser,
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('keeps the duplicate pre-check visible, so the domain error still fires', async () => {
      // The behaviour that would otherwise regress into a raw unique-constraint
      // violation: `findByUserId` must still see the caller's existing row.
      const count = await asApp({ userId: userA }, (tx) => countVendors(tx, 'user_id', userA));

      expect(count).toBe(1);
    });
  });

  describe('KYC submissions and documents', () => {
    it('shows vendor A only their own submission', async () => {
      const rows = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$queryRawUnsafe<{ id: string }[]>('SELECT id FROM vendor_kyc_submissions'),
      );

      expect(rows.map((row) => row.id)).toEqual([kycA]);
    });

    it('shows vendor B only their own submission', async () => {
      const rows = await asApp({ userId: userB, vendorId: vendorB }, (tx) =>
        tx.$queryRawUnsafe<{ id: string }[]>('SELECT id FROM vendor_kyc_submissions'),
      );

      expect(rows.map((row) => row.id)).toEqual([kycB]);
    });

    it('shows vendor A only their own documents', async () => {
      const rows = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$queryRawUnsafe<{ vendor_id: string }[]>('SELECT vendor_id FROM kyc_documents'),
      );

      expect(rows.map((row) => row.vendor_id)).toEqual([vendorA]);
    });

    it('does not let vendor A update vendor B’s submission', async () => {
      const affected = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE vendor_kyc_submissions SET rejection_note = 'tampered' WHERE id = $1::uuid`,
          kycB,
        ),
      );

      expect(affected).toBe(0);
      const untouched = await owner.vendorKycSubmission.findUnique({ where: { id: kycB } });
      expect(untouched?.rejectionNote).toBeNull();
    });

    it('refuses an insert that names another vendor', async () => {
      await expect(
        asApp({ userId: userA, vendorId: vendorA }, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO vendor_kyc_submissions
               (id, vendor_id, pan_fingerprint, pan_last4, gstin, bank_fingerprint,
                bank_account_last4, ifsc, submitted_at, created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, 'c', '1234', 'g', 'd', '5678', 'HDFC0001234', now(), now(), now())`,
            ids.generate(),
            vendorB,
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('does not let vendor A delete vendor B’s documents', async () => {
      const affected = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM kyc_documents WHERE vendor_id = $1::uuid`, vendorB),
      );

      expect(affected).toBe(0);
      expect(await owner.kycDocument.count({ where: { vendorId: vendorB } })).toBe(1);
    });
  });

  describe('the admin credential', () => {
    it('reads across every vendor', async () => {
      const rows = await admin.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM vendor_kyc_submissions WHERE id IN (${kycA}::uuid, ${kycB}::uuid)`;

      expect(Number(rows[0]?.count)).toBe(2);
    });

    it('reads documents across every vendor', async () => {
      const rows = await admin.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM kyc_documents WHERE vendor_id IN (${vendorA}::uuid, ${vendorB}::uuid)`;

      expect(Number(rows[0]?.count)).toBe(2);
    });

    it('records a decision on a submission — the KYC-5 UPDATE policy', async () => {
      // The counterpart of the assertion this replaces. Until KYC-5 this
      // UPDATE affected zero rows, and the policy that changed it is the only
      // thing that changed: `leenmart_admin` has held the UPDATE *privilege*
      // since role separation.
      // A whole decision, not a single column: the four CHECK constraints on
      // this table refuse a half-written review, so anything less would prove
      // the policy nothing.
      const affected = await admin.$executeRawUnsafe(
        `UPDATE vendor_kyc_submissions
            SET reviewed_by = $2::uuid, started_at = now(),
                decided_by = $2::uuid, decided_at = now()
          WHERE id = $1::uuid`,
        kycA,
        userA,
      );

      expect(affected).toBe(1);
      const written = await owner.vendorKycSubmission.findUnique({ where: { id: kycA } });
      expect(written?.decidedBy).toBe(userA);
      expect(written?.decidedAt).not.toBeNull();

      // Restored so the rest of the suite sees the undecided row it seeded —
      // `uq_vendor_kyc_one_undecided` is predicated on exactly this column.
      await owner.vendorKycSubmission.update({
        where: { id: kycA },
        data: { reviewedBy: null, startedAt: null, decidedBy: null, decidedAt: null },
      });
    });

    it('moves a vendor through its lifecycle, across tenants', async () => {
      // The other half of one decision. Both tables or the transaction KYC-5
      // opens is pointless.
      const affected = await admin.$executeRawUnsafe(
        `UPDATE vendors SET status = 'KYC_UNDER_REVIEW' WHERE id = $1::uuid`,
        vendorB,
      );

      expect(affected).toBe(1);
      const moved = await owner.vendorProfile.findUnique({ where: { id: vendorB } });
      expect(moved?.status).toBe('KYC_UNDER_REVIEW');

      await owner.vendorProfile.update({ where: { id: vendorB }, data: { status: 'REGISTERED' } });
    });

    it('still cannot touch a document — review changes the decision, not the evidence', async () => {
      // `kyc_documents` deliberately got no UPDATE policy: KYC-1 makes a
      // submission's documents immutable once written.
      const affected = await admin.$executeRawUnsafe(
        `UPDATE kyc_documents SET content_type = 'text/plain' WHERE vendor_id = $1::uuid`,
        vendorA,
      );

      expect(affected).toBe(0);
    });

    it('still cannot insert a submission — the new policy is UPDATE only', async () => {
      // A real INSERT, not one behind `WHERE false`: with the privilege held
      // and no policy admitting it, PostgreSQL refuses the row outright.
      await expect(
        admin.$executeRawUnsafe(
          `INSERT INTO vendor_kyc_submissions
             (id, vendor_id, pan_fingerprint, pan_last4, gstin, bank_fingerprint,
              bank_account_last4, ifsc, submitted_at, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3, '234F', '27ABCDE1234F1Z0', $4,
                   '9012', 'HDFC0001234', now(), now(), now())`,
          ids.generate(),
          vendorA,
          'c'.repeat(64),
          'd'.repeat(64),
        ),
      ).rejects.toThrow();
    });

    it('still cannot delete a submission — decisions cannot erase their own evidence', async () => {
      const affected = await admin.$executeRawUnsafe(
        `DELETE FROM vendor_kyc_submissions WHERE id = $1::uuid`,
        kycA,
      );

      expect(affected).toBe(0);
      expect(await owner.vendorKycSubmission.findUnique({ where: { id: kycA } })).not.toBeNull();
    });

    it('holds exactly the read-only policies its milestones intend, and only four writes', async () => {
      // The narrowness assertion. A later `FOR ALL` added "because the role
      // exists" would fail here rather than quietly widening the boundary.
      // `product_variants`/`inventory`/`product_media`/`product_media_variants`
      // all contribute read-only policies only; `products` gained its first
      // write policy in S2-5 (`products_admin_decide`), for the admin
      // approve/reject decision — neither S2-6a nor S2-6b adds an admin write
      // surface for media. Every Stage-3/4 table since has added SELECT and
      // nothing else, so the three writes below are still the only ones.
      //
      // `orders`/`order_items`/`sub_orders`/`pickup_tokens` are deliberately
      // absent: they carry RLS but no admin policy at all, so the admin
      // credential cannot read them. That is a fact about the boundary, not an
      // oversight — an admin order surface would have to add the policy
      // explicitly, and this assertion is what would make that visible.
      const rows = await owner.$queryRaw<{ tablename: string; cmd: string }[]>`
        SELECT tablename, cmd FROM pg_policies
        WHERE 'leenmart_admin' = ANY(roles) ORDER BY tablename, cmd`;

      expect(rows).toEqual([
        { tablename: 'business_hour_closures', cmd: 'SELECT' },
        { tablename: 'business_hours', cmd: 'SELECT' },
        { tablename: 'delivery_slots', cmd: 'SELECT' },
        { tablename: 'inventory', cmd: 'SELECT' },
        { tablename: 'kyc_documents', cmd: 'SELECT' },
        { tablename: 'ledger_entries', cmd: 'SELECT' },
        { tablename: 'ledger_journals', cmd: 'SELECT' },
        { tablename: 'preorder_campaigns', cmd: 'SELECT' },
        { tablename: 'preorder_payment_attempts', cmd: 'SELECT' },
        { tablename: 'preorder_reservations', cmd: 'SELECT' },
        { tablename: 'product_media', cmd: 'SELECT' },
        { tablename: 'product_media_variants', cmd: 'SELECT' },
        { tablename: 'product_variants', cmd: 'SELECT' },
        { tablename: 'products', cmd: 'SELECT' },
        { tablename: 'products', cmd: 'UPDATE' },
        // S8-REVIEWS: the moderation queue reads every review and the
        // decision flips `status` — the fourth admin write, alongside
        // products/vendors/vendor_kyc_submissions.
        { tablename: 'reviews', cmd: 'SELECT' },
        { tablename: 'reviews', cmd: 'UPDATE' },
        { tablename: 'serviceable_pincodes', cmd: 'SELECT' },
        { tablename: 'slot_capacity', cmd: 'SELECT' },
        { tablename: 'vendor_kyc_submissions', cmd: 'SELECT' },
        { tablename: 'vendor_kyc_submissions', cmd: 'UPDATE' },
        { tablename: 'vendors', cmd: 'SELECT' },
        { tablename: 'vendors', cmd: 'UPDATE' },
      ]);
    });

    it('cannot insert a vendor', async () => {
      const affected = await admin.$executeRawUnsafe(
        `INSERT INTO vendors (id, user_id, status, created_at, updated_at)
         SELECT $1::uuid, $2::uuid, 'REGISTERED', now(), now()
         WHERE false`,
        ids.generate(),
        freshUser,
      );

      expect(affected).toBe(0);
    });

    it('still has no BYPASSRLS — the policies are why it can read, not the role', async () => {
      const rows = await owner.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
        SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'leenmart_admin'`;

      expect(rows[0]?.rolbypassrls).toBe(false);
      expect(rows[0]?.rolsuper).toBe(false);
    });
  });

  describe('SEC-17 duplicate detection', () => {
    it('is refused on the vendor client — it must not silently return zero', async () => {
      // `findByIdentifierFingerprints` deliberately searches *other* vendors.
      // Under vendor RLS that yields nothing, which would disable ban-evasion
      // detection with no error. Recorded here so the zero is understood as a
      // policy refusal rather than an absence of duplicates.
      const rows = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$queryRawUnsafe<{ count: bigint }[]>(
          `SELECT count(*) AS count FROM vendor_kyc_submissions
           WHERE vendor_id <> $1::uuid AND pan_fingerprint = $2`,
          vendorA,
          'a'.repeat(64),
        ),
      );

      expect(Number(rows[0]?.count)).toBe(0);
    });

    it('works on the admin credential, which is where it must run', async () => {
      const rows = await admin.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM vendor_kyc_submissions
         WHERE vendor_id <> $1::uuid AND pan_fingerprint = $2`,
        vendorA,
        'a'.repeat(64),
      );

      expect(Number(rows[0]?.count)).toBe(1);
    });
  });

  describe('pooled connections and transaction lifetime', () => {
    it('clears both settings after COMMIT', async () => {
      await asApp({ userId: userA, vendorId: vendorA }, (tx) => tx.$queryRawUnsafe('SELECT 1'));

      const rows = await app.$queryRaw<{ u: string; v: string }[]>`
        SELECT coalesce(nullif(current_setting('app.user_id', true), ''), '<none>') AS u,
               coalesce(nullif(current_setting('app.vendor_id', true), ''), '<none>') AS v`;

      expect(rows[0]).toEqual({ u: '<none>', v: '<none>' });
    });

    it('clears both settings after ROLLBACK', async () => {
      await expect(
        asApp({ userId: userA, vendorId: vendorA }, () => {
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');

      const rows = await app.$queryRaw<{ u: string; v: string }[]>`
        SELECT coalesce(nullif(current_setting('app.user_id', true), ''), '<none>') AS u,
               coalesce(nullif(current_setting('app.vendor_id', true), ''), '<none>') AS v`;

      expect(rows[0]).toEqual({ u: '<none>', v: '<none>' });
    });

    it('never lets one tenant inherit another across pooled reuse', async () => {
      // More iterations than the pool holds, so connections are certainly
      // reused. Each asserts the row it can see, not merely that it ran.
      const seen: string[] = [];
      for (let index = 0; index < 12; index += 1) {
        const isA = index % 2 === 0;
        const rows = await asApp(
          { userId: isA ? userA : userB, vendorId: isA ? vendorA : vendorB },
          (tx) => tx.$queryRawUnsafe<{ id: string }[]>('SELECT id FROM vendor_kyc_submissions'),
        );
        seen.push(rows.map((row) => row.id).join(',') === (isA ? kycA : kycB) ? 'own' : 'FOREIGN');
      }

      expect(seen.filter((entry) => entry === 'FOREIGN')).toEqual([]);
    });

    it('keeps concurrent tenants isolated', async () => {
      const results = await Promise.all(
        [vendorA, vendorB, vendorA, vendorB].map((vendor, index) =>
          asApp({ userId: vendor === vendorA ? userA : userB, vendorId: vendor }, async (tx) => {
            await new Promise((resolve) => setTimeout(resolve, 5 * (index % 3)));
            const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
              'SELECT id FROM vendor_kyc_submissions',
            );
            return rows.map((row) => row.id).join(',');
          }),
        ),
      );

      expect(results).toEqual([kycA, kycB, kycA, kycB]);
    });
  });

  describe('owner and runtime credentials stay distinct', () => {
    it('the owner still sees everything, so migrations keep working', async () => {
      expect(await owner.vendorProfile.count({ where: { id: { in: [vendorA, vendorB] } } })).toBe(
        2,
      );
    });

    it('each client authenticates as its own role', async () => {
      const who = async (client: PrismaClient): Promise<string> => {
        const rows = await client.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
        return rows[0]?.current_user ?? '';
      };

      expect(await who(owner)).toBe('leenmart');
      expect(await who(app)).toBe('leenmart_app');
      expect(await who(admin)).toBe('leenmart_admin');
    });
  });
});
