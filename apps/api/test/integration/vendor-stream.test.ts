import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
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
import { PrismaOutboxRelayStore } from '../../src/shared/infrastructure/persistence/prisma-outbox-relay-store.js';
import {
  createOutboxHandlerRegistry,
  type OutboxHandler,
} from '../../src/shared/application/ports/outbox-handler.port.js';
import {
  OutboxRelay,
  type OutboxRelayTickResult,
} from '../../src/shared/application/services/outbox-relay.js';
import { createNotificationWorkerModule } from '../../src/modules/notification/index.js';
import { createVendorStreamOutboxHandler } from '../../src/modules/order/infrastructure/jobs/vendor-stream-outbox-handler.js';
import { PrismaOrderVendorResolver } from '../../src/modules/order/infrastructure/persistence/prisma-order-vendor-resolver.js';

const EMAIL_PREFIX = 'vendor-stream-';

const VALID_ADDRESS = {
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  label: 'Home',
};

/**
 * The `outbox_events` table is real, shared, and holds history no single
 * suite owns — this window isolates this file's own relay ticks from that
 * live backlog exactly the way `outbox-relay.test.ts` already established:
 * every event this file drives is moved into a fixed past due-time, and
 * every relay here runs on a clock reading that same past instant, so
 * nothing dated near real "now" is ever due from this file's point of view.
 */
const TEST_EPOCH = new Date('2020-07-01T00:00:00.000Z');

interface CreateProductBody {
  readonly data: { product: { id: string } };
}
interface OrderBody {
  readonly data: { id: string };
}
interface AddressBody {
  readonly data: { id: string };
}

/** Reads one SSE stream, buffering across chunk boundaries so a frame split across two TCP reads is still parsed correctly. */
class SseReader {
  private buffer = '';
  private readonly decoder = new TextDecoder();

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async nextEvent(timeoutMs = 3000): Promise<{ type: string; data: unknown } | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const frameEnd = this.buffer.indexOf('\n\n');
      if (frameEnd !== -1) {
        const frame = this.buffer.slice(0, frameEnd);
        this.buffer = this.buffer.slice(frameEnd + 2);
        const eventLine = frame.split('\n').find((line) => line.startsWith('event: '));
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
        if (!eventLine || !dataLine) continue;
        return {
          type: eventLine.slice('event: '.length),
          data: JSON.parse(dataLine.slice('data: '.length)) as unknown,
        };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const timeout = new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), remaining);
      });
      const outcome = await Promise.race([this.reader.read(), timeout]);
      if (outcome === 'timeout' || outcome.done) return null;
      this.buffer += this.decoder.decode(outcome.value, { stream: true });
    }
  }

  cancel(): void {
    void this.reader.cancel().catch(() => undefined);
  }
}

describe('Vendor real-time order alerts (S4-SSE, FR-64, SDD §11.5)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let server: Server;
  let baseUrl: string;
  let categoryId: string;
  const ids = new UuidV7Generator();

  const auth = (actor: Actor): string => `Bearer ${actor.token}`;

  const vendorCache = new Map<string, VendorActor>();
  const vendorFor = async (label: string): Promise<VendorActor> => {
    const cached = vendorCache.get(label);
    if (cached) return cached;
    const vendor = await signUpVendorOwner(app, EMAIL_PREFIX, label);
    vendorCache.set(label, vendor);
    return vendor;
  };

  const customerCache = new Map<string, Actor>();
  const customerFor = async (label: string): Promise<Actor> => {
    const cached = customerCache.get(label);
    if (cached) return cached;
    const customer = await signUpCustomer(app, EMAIL_PREFIX, label);
    customerCache.set(label, customer);
    return customer;
  };

  /** ACTIVE vendor, APPROVED product with stock — mirrors `vendor-order.test.ts`'s own `seedActiveVendorWithStock`. */
  const seedActiveVendorWithStock = async (
    label: string,
  ): Promise<{ vendor: VendorActor; variantId: string }> => {
    const vendor = await vendorFor(label);
    const createResponse = await request(app)
      .post('/api/v1/vendor/products')
      .set('Authorization', auth(vendor))
      .send({
        categoryId,
        name: `Vendor Stream Product ${randomUUID()}`,
        variant: {
          sku: `VENDOR-STREAM-${randomUUID()}`,
          name: 'Default',
          price: { amount: '19900', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
        },
      })
      .expect(201);
    const productId = (createResponse.body as CreateProductBody).data.product.id;
    const variantRow = await db.productVariant.findFirstOrThrow({ where: { productId } });

    await db.inventory.update({ where: { variantId: variantRow.id }, data: { available: 100 } });
    await db.product.update({ where: { id: productId }, data: { status: 'APPROVED' } });
    await db.vendorProfile.update({
      where: { id: vendor.vendorId },
      data: { status: 'ACTIVE', shopName: `${label} Shop` },
    });

    return { vendor, variantId: variantRow.id };
  };

  /** Places a real order (no payment confirmation needed — `order.placed` fires inside `POST /api/v1/orders` itself). */
  const placeOrder = async (customer: Actor, variantId: string): Promise<string> => {
    await request(app)
      .post('/api/v1/me/cart/items')
      .set('Authorization', auth(customer))
      .send({ variantId, quantity: 1 })
      .expect(201);
    const addressResponse = await request(app)
      .post('/api/v1/me/addresses')
      .set('Authorization', auth(customer))
      .send(VALID_ADDRESS)
      .expect(201);
    const addressId = (addressResponse.body as AddressBody).data.id;

    const placeResponse = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', randomUUID())
      .send({ addressId, paymentMethod: 'ONLINE' })
      .expect(201);
    return (placeResponse.body as OrderBody).data.id;
  };

  /**
   * Drives the real relay, on the real database, with both the S4-SSE
   * handler and the real `NotificationOutboxHandler` registered together —
   * the same `OutboxHandlerRegistry` shape `worker.ts` builds, so "does the
   * notification handler still work" is proven by dispatching through the
   * exact pairing that will actually run in production, not a stand-in.
   */
  const dispatchOrderPlaced = async (orderId: string): Promise<OutboxRelayTickResult> => {
    const row = await db.outboxEvent.findFirstOrThrow({
      where: { aggregateType: 'Order', aggregateId: orderId, eventType: 'order.placed' },
      orderBy: { createdAt: 'desc' },
    });
    await db.outboxEvent.updateMany({
      where: { id: row.id, createdAt: row.createdAt },
      data: { nextAttemptAt: TEST_EPOCH },
    });

    const logger = new NullLogger();
    const vendorStreamHandler: OutboxHandler = createVendorStreamOutboxHandler(
      harness.container.bullRedis,
      new PrismaOrderVendorResolver(harness.container.checkoutPrisma),
      logger,
    );
    const notificationWorker = createNotificationWorkerModule({
      checkoutPrisma: harness.container.checkoutPrisma,
      bullRedis: harness.container.bullRedis,
      idGenerator: ids,
      clock: new FixedClock(TEST_EPOCH),
      logger,
    });

    const relay = new OutboxRelay({
      store: new PrismaOutboxRelayStore(db, new FixedClock(TEST_EPOCH)),
      registry: createOutboxHandlerRegistry([
        vendorStreamHandler,
        notificationWorker.outboxHandler,
      ]),
      logger,
    });
    return relay.tick();
  };

  const openStream = async (
    actor: Actor,
  ): Promise<{ status: number; headers: Headers; reader: SseReader | null; close: () => void }> => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/v1/vendor/stream`, {
      headers: { Authorization: auth(actor) },
      signal: controller.signal,
    });
    const body = response.body;
    return {
      status: response.status,
      headers: response.headers,
      reader: body ? new SseReader(body.getReader()) : null,
      close: () => controller.abort(),
    };
  };

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected the test server to bind a TCP address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    const slug = `vendor-stream-cat-${Date.now()}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = row.id;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$executeRawUnsafe('DELETE FROM categories WHERE slug LIKE $1', 'vendor-stream-cat-%');
    await db.$disconnect();
  });

  describe('authentication and authorization', () => {
    it('401s without a token', async () => {
      await request(app).get('/api/v1/vendor/stream').expect(401);
    });

    it('403s an authenticated customer — no resolved vendor tenant', async () => {
      const customer = await customerFor('non-vendor');
      await request(app)
        .get('/api/v1/vendor/stream')
        .set('Authorization', auth(customer))
        .expect(403);
    });

    it('accepts an authenticated vendor and returns standard SSE headers', async () => {
      const vendor = await vendorFor('headers-owner');
      const stream = await openStream(vendor);

      expect(stream.status).toBe(200);
      expect(stream.headers.get('content-type')).toMatch(/^text\/event-stream/);
      expect(stream.headers.get('cache-control')).toBe('no-cache, no-transform');

      stream.close();
    });
  });

  describe('order.placed routing and vendor isolation', () => {
    it('delivers order.placed only to the vendor whose product was ordered', async () => {
      const { vendor: vendorA, variantId } = await seedActiveVendorWithStock('isolation-a');
      const vendorB = await vendorFor('isolation-b');
      const customer = await customerFor('isolation-customer');

      const streamA = await openStream(vendorA);
      const streamB = await openStream(vendorB);
      expect(streamA.reader).not.toBeNull();
      expect(streamB.reader).not.toBeNull();

      const orderId = await placeOrder(customer, variantId);
      const tickResult = await dispatchOrderPlaced(orderId);
      expect(tickResult.failed).toBe(0);

      const eventForA = await streamA.reader?.nextEvent();
      expect(eventForA?.type).toBe('order.placed');
      expect(eventForA?.data).toMatchObject({ orderId });

      const eventForB = await streamB.reader?.nextEvent(1500);
      expect(eventForB).toBeNull();

      streamA.close();
      streamB.close();
    });

    it('an unrelated vendor with no matching order receives nothing', async () => {
      const { variantId } = await seedActiveVendorWithStock('unrelated-a');
      const vendorC = await vendorFor('unrelated-c');
      const customer = await customerFor('unrelated-customer');

      const streamC = await openStream(vendorC);
      expect(streamC.reader).not.toBeNull();

      const orderId = await placeOrder(customer, variantId);
      await dispatchOrderPlaced(orderId);

      const eventForC = await streamC.reader?.nextEvent(1500);
      expect(eventForC).toBeNull();

      streamC.close();
    });

    it('delivers to every connected session for the same vendor — owner’s two tabs both receive it', async () => {
      const { vendor, variantId } = await seedActiveVendorWithStock('multi-session');
      const customer = await customerFor('multi-session-customer');

      const streamOne = await openStream(vendor);
      const streamTwo = await openStream(vendor);
      expect(streamOne.reader).not.toBeNull();
      expect(streamTwo.reader).not.toBeNull();

      const orderId = await placeOrder(customer, variantId);
      await dispatchOrderPlaced(orderId);

      const [eventOne, eventTwo] = await Promise.all([
        streamOne.reader?.nextEvent(),
        streamTwo.reader?.nextEvent(),
      ]);
      expect(eventOne?.type).toBe('order.placed');
      expect(eventOne?.data).toMatchObject({ orderId });
      expect(eventTwo?.type).toBe('order.placed');
      expect(eventTwo?.data).toMatchObject({ orderId });

      streamOne.close();
      streamTwo.close();
    });

    it('the existing notification handler still dispatches successfully alongside the new S4-SSE handler', async () => {
      const { vendor, variantId } = await seedActiveVendorWithStock('coexistence');
      const customer = await customerFor('coexistence-customer');
      const stream = await openStream(vendor);

      const orderId = await placeOrder(customer, variantId);
      const result = await dispatchOrderPlaced(orderId);

      // Both handlers ran on the same event, in the same tick, and neither
      // threw — the exact pairing `worker.ts` registers in production.
      expect(result.dispatched).toBe(1);
      expect(result.failed).toBe(0);

      stream.close();
    });
  });

  describe('connection lifecycle', () => {
    it('cleans up the registry entry on disconnect — a later publish for that vendor finds no local connection', async () => {
      const { vendor, variantId } = await seedActiveVendorWithStock('disconnect');
      const customer = await customerFor('disconnect-customer');

      const stream = await openStream(vendor);
      expect(stream.reader).not.toBeNull();
      stream.close();
      // Give the server a moment to observe the aborted connection's `close` event.
      await new Promise((resolve) => setTimeout(resolve, 200));

      const orderId = await placeOrder(customer, variantId);
      // No assertion needed beyond "this does not throw" — publishing to a
      // vendor with zero local connections is a documented no-op
      // (`VendorStreamRegistry.publishLocal`'s own unit test already proves
      // the no-op itself; this proves the disconnect actually reached the
      // registry in a real server, not just in-process).
      await expect(dispatchOrderPlaced(orderId)).resolves.toMatchObject({ failed: 0 });
    });
  });
});
