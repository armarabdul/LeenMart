import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import {
  createIntegrationHarness,
  disposeIntegrationHarness,
  type IntegrationHarness,
} from '../support/integration-app.js';
import {
  signUpCustomer,
  signUpVendorOwner,
  type Actor,
  type VendorActor,
} from '../support/actors.js';
import { PrismaNotificationWriteRepository } from '../../src/modules/notification/infrastructure/persistence/prisma-notification.repository.js';
import type {
  NewNotification,
  NotificationWriteOutcome,
} from '../../src/modules/notification/domain/repositories/notification.repository.js';

const EMAIL_PREFIX = 'notifications-';
const NOW = new Date('2026-08-19T10:00:00.000Z');

interface ListBody {
  readonly data: {
    items: { id: string; readAt: string | null; title: string }[];
    nextCursor: string | null;
  };
}
interface CountBody {
  readonly data: { unread: number };
}
interface MarkBody {
  readonly data: { updated: boolean | number };
}

/**
 * In-app notifications (S6-NOTIFY-INAPP, SDD 5 module 16, SDD 11).
 *
 * The properties this file exists to hold are all facts about real rows under
 * real policies: that one user cannot see or touch another's inbox, that the
 * public role cannot read the table at all, that the worker's credential can
 * write but the request path cannot, and that a redelivered event produces one
 * row rather than two. None of those can be proved against a mock.
 */
describe('In-app notifications (S6-NOTIFY-INAPP)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let writer: PrismaNotificationWriteRepository;

  const ids = new UuidV7Generator();
  const auth = (actor: Actor): string => `Bearer ${actor.token}`;

  // Cached actors, for the LOGIN_PER_IP reason every sibling suite documents.
  const customerCache = new Map<string, Actor>();
  const customerFor = async (label: string): Promise<Actor> => {
    const cached = customerCache.get(label);
    if (cached) return cached;
    const customer = await signUpCustomer(app, EMAIL_PREFIX, label);
    customerCache.set(label, customer);
    return customer;
  };

  let vendor: VendorActor;

  /** Writes through the real orchestrator-side repository, on the real credential. */
  const deliver = (
    overrides: Partial<NewNotification> & { recipientUserId: string },
  ): Promise<NotificationWriteOutcome> =>
    writer.createIfAbsent({
      recipientKind: 'CUSTOMER',
      outboxEventId: randomUUID(),
      channel: 'IN_APP',
      eventType: 'order.confirmed',
      payload: { orderId: randomUUID() },
      title: 'Order confirmed',
      body: 'Your order has been confirmed.',
      ...overrides,
    });

  const list = (actor: Actor, query = 'kind=CUSTOMER'): request.Test =>
    request(app).get(`/api/v1/me/notifications?${query}`).set('Authorization', auth(actor));

  const unreadCount = (actor: Actor, kind = 'CUSTOMER'): request.Test =>
    request(app)
      .get(`/api/v1/me/notifications/unread-count?kind=${kind}`)
      .set('Authorization', auth(actor));

  const markRead = (actor: Actor, id: string): request.Test =>
    request(app).post(`/api/v1/me/notifications/${id}/read`).set('Authorization', auth(actor));

  const markAllRead = (actor: Actor, kind = 'CUSTOMER'): request.Test =>
    request(app)
      .post(`/api/v1/me/notifications/read-all?kind=${kind}`)
      .set('Authorization', auth(actor));

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    writer = new PrismaNotificationWriteRepository(
      harness.container.checkoutPrisma,
      ids,
      new FixedClock(NOW),
    );
    vendor = await signUpVendorOwner(app, EMAIL_PREFIX, 'seller');
  });

  afterEach(async () => {
    const users = await db.user.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { id: true },
    });
    await db.notification.deleteMany({
      where: { recipientUserId: { in: users.map((user) => user.id) } },
    });
  });

  afterAll(async () => {
    const users = await db.user.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { id: true },
    });
    // `notifications` has a RESTRICT foreign key to `users`, so its rows go
    // before the harness removes the accounts, exactly as `slot_capacity` does.
    await db.notification.deleteMany({
      where: { recipientUserId: { in: users.map((user) => user.id) } },
    });
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
  });

  describe('schema and RLS', () => {
    it('has row security enabled and never forced', async () => {
      const rows = await db.$queryRawUnsafe<
        { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
      >(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'notifications'`);

      expect(rows[0]?.relrowsecurity).toBe(true);
      expect(rows[0]?.relforcerowsecurity).toBe(false);
    });

    it('is partitioned by month, as SDD 6.5 requires', async () => {
      const parts = await db.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM pg_inherits i
         JOIN pg_class parent ON parent.oid = i.inhparent WHERE parent.relname = 'notifications'`,
      );

      expect(parts[0]?.n).toBeGreaterThan(1);
    });

    it('grants the worker credential insert and select, and nothing more', async () => {
      const rows = await db.$queryRawUnsafe<{ privilege_type: string }[]>(
        `SELECT privilege_type FROM information_schema.role_table_grants
         WHERE table_name = 'notifications' AND grantee = 'leenmart_checkout' ORDER BY 1`,
      );

      // No UPDATE: read state belongs to the recipient, not the worker.
      expect(rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT']);
    });

    it('gives the public catalogue role no reach at all', async () => {
      const rows = await db.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM information_schema.role_table_grants
         WHERE table_name = 'notifications' AND grantee IN ('leenmart_public', 'PUBLIC')`,
      );

      expect(rows[0]?.n).toBe(0);
    });

    it('refuses a read to the public role', async () => {
      await expect(
        harness.container.publicPrisma.$queryRawUnsafe('SELECT count(*) FROM notifications'),
      ).rejects.toThrow();
    });

    it('has no admin policy — these are personal records', async () => {
      const rows = await db.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM pg_policies
         WHERE tablename = 'notifications' AND 'leenmart_admin' = ANY(roles)`,
      );

      expect(rows[0]?.n).toBe(0);
    });
  });

  describe('ownership isolation', () => {
    it('shows a user only their own notifications', async () => {
      const owner = await customerFor('owner');
      const other = await customerFor('other');
      await deliver({ recipientUserId: owner.userId, title: 'Owner only' });
      await deliver({ recipientUserId: other.userId, title: 'Other only' });

      const response = await list(owner).expect(200);

      const titles = (response.body as ListBody).data.items.map((item) => item.title);
      expect(titles).toContain('Owner only');
      expect(titles).not.toContain('Other only');
    });

    it('counts only the caller’s own unread notifications', async () => {
      const owner = await customerFor('owner');
      const other = await customerFor('other');
      await deliver({ recipientUserId: owner.userId });
      await deliver({ recipientUserId: other.userId });
      await deliver({ recipientUserId: other.userId });

      const response = await unreadCount(owner).expect(200);

      expect((response.body as CountBody).data.unread).toBe(1);
    });

    it('cannot mark another user’s notification read', async () => {
      // RLS makes the row invisible, so the write affects nothing and the
      // answer is `updated: false` rather than a 404 that would confirm it
      // exists.
      const owner = await customerFor('owner');
      const attacker = await customerFor('other');
      await deliver({ recipientUserId: owner.userId });
      const victimRow = await db.notification.findFirstOrThrow({
        where: { recipientUserId: owner.userId },
      });

      const response = await markRead(attacker, victimRow.id).expect(200);

      expect((response.body as MarkBody).data.updated).toBe(false);
      const after = await db.notification.findFirstOrThrow({ where: { id: victimRow.id } });
      expect(after.readAt).toBeNull();
    });

    it('cannot mark another user’s notifications read in bulk', async () => {
      const owner = await customerFor('owner');
      const attacker = await customerFor('other');
      await deliver({ recipientUserId: owner.userId });

      await markAllRead(attacker).expect(200);

      const victim = await db.notification.findFirstOrThrow({
        where: { recipientUserId: owner.userId },
      });
      expect(victim.readAt).toBeNull();
    });

    it('refuses an unauthenticated caller', async () => {
      await request(app).get('/api/v1/me/notifications?kind=CUSTOMER').expect(401);
      await request(app).get('/api/v1/me/notifications/unread-count?kind=CUSTOMER').expect(401);
      await request(app).post(`/api/v1/me/notifications/${randomUUID()}/read`).expect(401);
    });
  });

  describe('customer and vendor inboxes are separate', () => {
    it('keeps one person’s two inboxes apart', async () => {
      // A vendor owner buys as a customer and sells as a vendor on one account.
      await deliver({
        recipientUserId: vendor.userId,
        recipientKind: 'CUSTOMER',
        title: 'As buyer',
      });
      await deliver({
        recipientUserId: vendor.userId,
        recipientKind: 'VENDOR',
        eventType: 'order.placed',
        title: 'As seller',
      });

      const asCustomer = await list(vendor, 'kind=CUSTOMER').expect(200);
      const asVendor = await list(vendor, 'kind=VENDOR').expect(200);

      expect((asCustomer.body as ListBody).data.items.map((i) => i.title)).toEqual(['As buyer']);
      expect((asVendor.body as ListBody).data.items.map((i) => i.title)).toEqual(['As seller']);
    });

    it('counts each inbox separately', async () => {
      await deliver({ recipientUserId: vendor.userId, recipientKind: 'CUSTOMER' });
      await deliver({
        recipientUserId: vendor.userId,
        recipientKind: 'VENDOR',
        eventType: 'order.placed',
      });
      await deliver({
        recipientUserId: vendor.userId,
        recipientKind: 'VENDOR',
        eventType: 'order.placed',
      });

      expect((await unreadCount(vendor, 'CUSTOMER').expect(200)).body).toMatchObject({
        data: { unread: 1 },
      });
      expect((await unreadCount(vendor, 'VENDOR').expect(200)).body).toMatchObject({
        data: { unread: 2 },
      });
    });

    it('marks all read in one inbox without touching the other', async () => {
      await deliver({ recipientUserId: vendor.userId, recipientKind: 'CUSTOMER' });
      await deliver({
        recipientUserId: vendor.userId,
        recipientKind: 'VENDOR',
        eventType: 'order.placed',
      });

      await markAllRead(vendor, 'VENDOR').expect(200);

      expect((await unreadCount(vendor, 'CUSTOMER').expect(200)).body).toMatchObject({
        data: { unread: 1 },
      });
      expect((await unreadCount(vendor, 'VENDOR').expect(200)).body).toMatchObject({
        data: { unread: 0 },
      });
    });
  });

  describe('idempotency (SDD 11.3)', () => {
    it('writes one row when the same event is delivered twice', async () => {
      const owner = await customerFor('owner');
      const outboxEventId = randomUUID();

      const first = await deliver({ recipientUserId: owner.userId, outboxEventId });
      const second = await deliver({ recipientUserId: owner.userId, outboxEventId });

      expect(first).toBe('created');
      expect(second).toBe('already-present');
      expect(await db.notification.count({ where: { outboxEventId } })).toBe(1);
    });

    it('reports a vanished recipient as permanent rather than failing the job', async () => {
      // A job that can never succeed must not be retried three times and
      // dead-lettered; the real backlog contains events whose subject was
      // deleted long after the event was written.
      const outcome = await deliver({ recipientUserId: randomUUID() });

      expect(outcome).toBe('recipient-missing');
    });

    it('writes one row per recipient for one event', async () => {
      // Two vendors on one order each get their own notification, and neither
      // collides with the other on the shared event id.
      const owner = await customerFor('owner');
      const other = await customerFor('other');
      const outboxEventId = randomUUID();

      await deliver({ recipientUserId: owner.userId, outboxEventId });
      await deliver({ recipientUserId: other.userId, outboxEventId });

      expect(await db.notification.count({ where: { outboxEventId } })).toBe(2);
    });

    it('is keyed on the event, not on the wording', async () => {
      const owner = await customerFor('owner');
      const outboxEventId = randomUUID();
      await deliver({ recipientUserId: owner.userId, outboxEventId, title: 'First' });

      const second = await deliver({
        recipientUserId: owner.userId,
        outboxEventId,
        title: 'Rewritten',
      });

      expect(second).toBe('already-present');
      const rows = await db.notification.findMany({ where: { outboxEventId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.title).toBe('First');
    });

    it('has a unique index covering the logical key plus the partition key', async () => {
      const rows = await db.$queryRawUnsafe<{ indexdef: string }[]>(
        `SELECT indexdef FROM pg_indexes
         WHERE tablename = 'notifications' AND indexname = 'uq_notifications_event_channel_recipient'`,
      );

      const definition = rows[0]?.indexdef ?? '';
      expect(definition).toContain('UNIQUE');
      expect(definition).toContain('outbox_event_id');
      expect(definition).toContain('recipient_user_id');
      // `created_at` is present because PostgreSQL requires the partition key,
      // which is why the application check is the real guarantee.
      expect(definition).toContain('created_at');
    });
  });

  describe('read state', () => {
    it('starts unread', async () => {
      const owner = await customerFor('owner');
      await deliver({ recipientUserId: owner.userId });

      const response = await list(owner).expect(200);

      expect((response.body as ListBody).data.items[0]?.readAt).toBeNull();
    });

    it('does not mark anything read merely because the list was opened', async () => {
      const owner = await customerFor('owner');
      await deliver({ recipientUserId: owner.userId });

      await list(owner).expect(200);
      await list(owner).expect(200);

      expect((await unreadCount(owner).expect(200)).body).toMatchObject({ data: { unread: 1 } });
    });

    it('marks one read explicitly', async () => {
      const owner = await customerFor('owner');
      await deliver({ recipientUserId: owner.userId });
      const row = await db.notification.findFirstOrThrow({
        where: { recipientUserId: owner.userId },
      });

      const response = await markRead(owner, row.id).expect(200);

      expect((response.body as MarkBody).data.updated).toBe(true);
      expect((await unreadCount(owner).expect(200)).body).toMatchObject({ data: { unread: 0 } });
    });

    it('does not move the read timestamp when a notification is marked twice', async () => {
      const owner = await customerFor('owner');
      await deliver({ recipientUserId: owner.userId });
      const row = await db.notification.findFirstOrThrow({
        where: { recipientUserId: owner.userId },
      });
      await markRead(owner, row.id).expect(200);
      const firstRead = (await db.notification.findFirstOrThrow({ where: { id: row.id } })).readAt;

      const second = await markRead(owner, row.id).expect(200);

      expect((second.body as MarkBody).data.updated).toBe(false);
      const after = await db.notification.findFirstOrThrow({ where: { id: row.id } });
      expect(after.readAt?.getTime()).toBe(firstRead?.getTime());
    });

    it('marks every unread notification read in bulk, and reports how many', async () => {
      const owner = await customerFor('owner');
      await deliver({ recipientUserId: owner.userId });
      await deliver({ recipientUserId: owner.userId });

      const response = await markAllRead(owner).expect(200);

      expect((response.body as MarkBody).data.updated).toBe(2);
      expect((await unreadCount(owner).expect(200)).body).toMatchObject({ data: { unread: 0 } });
    });

    it('filters to unread when asked', async () => {
      const owner = await customerFor('owner');
      await deliver({ recipientUserId: owner.userId, title: 'Read one' });
      await deliver({ recipientUserId: owner.userId, title: 'Unread one' });
      const readRow = await db.notification.findFirstOrThrow({ where: { title: 'Read one' } });
      await markRead(owner, readRow.id).expect(200);

      const response = await list(owner, 'kind=CUSTOMER&unreadOnly=true').expect(200);

      expect((response.body as ListBody).data.items.map((i) => i.title)).toEqual(['Unread one']);
    });
  });

  describe('listing', () => {
    it('returns newest first', async () => {
      const owner = await customerFor('owner');
      await deliver({ recipientUserId: owner.userId, title: 'Older' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await deliver({ recipientUserId: owner.userId, title: 'Newer' });

      const response = await list(owner).expect(200);

      expect((response.body as ListBody).data.items.map((i) => i.title)).toEqual([
        'Newer',
        'Older',
      ]);
    });

    it('pages with a cursor rather than an offset', async () => {
      const owner = await customerFor('owner');
      for (let i = 0; i < 3; i += 1) {
        await deliver({ recipientUserId: owner.userId, title: `Item ${i}` });
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const first = await list(owner, 'kind=CUSTOMER&limit=2').expect(200);
      const firstBody = (first.body as ListBody).data;
      expect(firstBody.items).toHaveLength(2);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await list(
        owner,
        `kind=CUSTOMER&limit=2&cursor=${encodeURIComponent(firstBody.nextCursor ?? '')}`,
      ).expect(200);
      const secondBody = (second.body as ListBody).data;

      expect(secondBody.items).toHaveLength(1);
      expect(secondBody.nextCursor).toBeNull();
      const seen = [...firstBody.items, ...secondBody.items].map((i) => i.id);
      expect(new Set(seen).size).toBe(3);
    });

    it('refuses a page larger than the shared ceiling', async () => {
      const owner = await customerFor('owner');

      await list(owner, 'kind=CUSTOMER&limit=500').expect(400);
    });

    it('requires the inbox kind rather than guessing one', async () => {
      const owner = await customerFor('owner');

      await request(app)
        .get('/api/v1/me/notifications')
        .set('Authorization', auth(owner))
        .expect(400);
    });

    it('rejects an unknown inbox kind', async () => {
      const owner = await customerFor('owner');

      await list(owner, 'kind=ADMIN').expect(400);
    });

    it('returns an empty page for a user with no notifications', async () => {
      const fresh = await customerFor('empty');

      const response = await list(fresh).expect(200);

      expect((response.body as ListBody).data).toEqual({ items: [], nextCursor: null });
    });
  });
});
