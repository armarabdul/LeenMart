import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator, toUuid } from '@leen-mart/domain-kit';
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/persistence/prisma-audit-log.repository.js';
import {
  AuditLogEntry,
  type AuditLogActor,
  type AuditLogRequestContext,
} from '../../src/modules/audit/domain/entities/audit-log-entry.entity.js';
import { toAuditLogEntryId } from '../../src/modules/audit/domain/value-objects/audit-log-entry-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';

/**
 * Direct repository-level integration test, same reasoning as
 * `prisma-mfa-challenge.repository.test.ts`: no use case writes audit entries
 * yet (this chunk is persistence-only), so there is no HTTP flow to route a
 * test through.
 *
 * Two things make this suite unlike every other integration test here.
 *
 * First, **it cannot clean up after itself.** The trigger it exists to verify
 * forbids DELETE, so `afterAll` has nothing it is allowed to do. Every run
 * therefore uses a freshly generated actor id and a run-scoped `entityType`,
 * which is what keeps concurrent or repeated runs from seeing each other's
 * rows. Leftover rows in the test database are the correct outcome, not a
 * leak.
 *
 * Second, **no `users` row is created.** `audit_logs` deliberately carries no
 * foreign key to `users`: an entry must outlive a DPDP erasure of the person
 * who acted (BR-16), so the actor id is an unenforced reference by design.
 * This suite relies on that, and would fail if a foreign key were ever added.
 */
describe('PrismaAuditLogRepository', () => {
  const prisma = new PrismaClient();
  const repository = new PrismaAuditLogRepository(prisma);
  const idGenerator = new UuidV7Generator();

  const run = Date.now();
  const actorId = toUserId(idGenerator.generate());
  const impersonatorId = toUserId(idGenerator.generate());
  const entityType = `AuditRepoTest-${run}`;
  const entityId = toUuid(idGenerator.generate());

  const actor: AuditLogActor = { actorId, actorRole: 'RISK_ANALYST', impersonatedBy: null };
  const context: AuditLogRequestContext = {
    ipAddress: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (admin console)',
    requestId: `req-${run}`,
  };

  const append = async (
    overrides: Partial<Parameters<typeof AuditLogEntry.record>[0]> = {},
  ): Promise<AuditLogEntry> => {
    const entry = AuditLogEntry.record({
      id: toAuditLogEntryId(idGenerator.generate()),
      actor,
      action: 'VENDOR_KYC_APPROVED',
      entityType,
      entityId,
      before: { status: 'KYC_UNDER_REVIEW' },
      after: { status: 'KYC_APPROVED' },
      reason: 'PAN and bank proof verified',
      context,
      now: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    });
    await repository.append(entry);
    return entry;
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    // Deliberately no cleanup — see the suite comment. Deleting is precisely
    // what this table forbids.
    await prisma.$disconnect();
  });

  it('round-trips every SDD 18.4 field', async () => {
    const entry = await append({
      actor: { actorId, actorRole: 'SUPPORT_AGENT', impersonatedBy: impersonatorId },
    });

    const row = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.actorId).toBe(actorId);
    expect(row.actorRole).toBe('SUPPORT_AGENT');
    expect(row.impersonatedBy).toBe(impersonatorId);
    expect(row.action).toBe('VENDOR_KYC_APPROVED');
    expect(row.entityType).toBe(entityType);
    expect(row.entityId).toBe(entityId);
    expect(row.reason).toBe('PAN and bank proof verified');
    expect(row.userAgent).toBe('Mozilla/5.0 (admin console)');
    expect(row.requestId).toBe(`req-${run}`);
    expect(row.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));

    const [found] = await repository.findByEntity(entityType, entityId, 1);
    expect(found?.id).toBe(entry.id);
    expect(found?.actorId).toBe(actorId);
    expect(found?.impersonatedBy).toBe(impersonatorId);
    expect(found?.isImpersonated()).toBe(true);
    expect(found?.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('persists the domain clock reading, not the moment of the INSERT', async () => {
    const recordedAt = new Date('2025-06-15T09:30:00.000Z');
    const entry = await append({ now: recordedAt });

    const row = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.createdAt).toEqual(recordedAt);
  });

  it('round-trips nullable fields as SQL NULL', async () => {
    const entry = await append({
      actor: { actorId: null, actorRole: 'SUPER_ADMIN', impersonatedBy: null },
      entityId: null,
      before: null,
      after: null,
      reason: null,
      context: { ipAddress: null, userAgent: null, requestId: null },
    });

    const row = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.actorId).toBeNull();
    expect(row.impersonatedBy).toBeNull();
    expect(row.entityId).toBeNull();
    expect(row.before).toBeNull();
    expect(row.after).toBeNull();
    expect(row.reason).toBeNull();
    expect(row.ipAddress).toBeNull();
    expect(row.userAgent).toBeNull();
    expect(row.requestId).toBeNull();

    const [found] = await repository.findByEntity(`${entityType}-none`, entityId, 1);
    expect(found).toBeUndefined();
  });

  describe('JSONB before/after', () => {
    it('round-trips nested objects, arrays, numbers, booleans and nulls', async () => {
      const before = {
        status: 'KYC_UNDER_REVIEW',
        documents: ['PAN', 'BANK_PROOF'],
        checks: { pan: true, pennyDrop: false, attempts: 2 },
        reviewedBy: null,
      };
      const after = {
        status: 'KYC_APPROVED',
        documents: ['PAN', 'BANK_PROOF'],
        checks: { pan: true, pennyDrop: true, attempts: 3 },
        reviewedBy: impersonatorId,
      };

      const entry = await append({ before, after });

      const row = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
      expect(row.before).toEqual(before);
      expect(row.after).toEqual(after);

      const [found] = await repository.findByEntity(entityType, entityId, 1);
      expect(found?.before).toEqual(before);
      expect(found?.after).toEqual(after);
    });

    it('distinguishes an absent snapshot from one holding a JSON null', async () => {
      const entry = await append({ before: null, after: { reviewedBy: null } });

      const row = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
      expect(row.before).toBeNull();
      expect(row.after).toEqual({ reviewedBy: null });
    });
  });

  describe('INET ip_address', () => {
    it('round-trips an IPv4 address', async () => {
      const entry = await append({ context: { ...context, ipAddress: '198.51.100.42' } });

      const row = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
      expect(row.ipAddress).toBe('198.51.100.42');
    });

    it('round-trips an IPv6 address', async () => {
      const entry = await append({ context: { ...context, ipAddress: '2001:db8::8a2e:370:7334' } });

      const row = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
      expect(row.ipAddress).toBe('2001:db8::8a2e:370:7334');
    });

    it('lets PostgreSQL reject a malformed address rather than re-checking in the domain', async () => {
      await expect(append({ context: { ...context, ipAddress: 'not-an-ip' } })).rejects.toThrow();
    });
  });

  describe('queries', () => {
    it('finds by actor, newest first, bounded by the limit', async () => {
      const queryActorId = toUserId(idGenerator.generate());
      const queryActor: AuditLogActor = {
        actorId: queryActorId,
        actorRole: 'FINANCE_ADMIN',
        impersonatedBy: null,
      };

      await append({ actor: queryActor, action: 'OLDEST', now: new Date('2026-02-01T00:00:00Z') });
      await append({ actor: queryActor, action: 'MIDDLE', now: new Date('2026-02-02T00:00:00Z') });
      await append({ actor: queryActor, action: 'NEWEST', now: new Date('2026-02-03T00:00:00Z') });

      const all = await repository.findByActor(queryActorId, 10);
      expect(all.map((entry) => entry.action)).toEqual(['NEWEST', 'MIDDLE', 'OLDEST']);

      const bounded = await repository.findByActor(queryActorId, 2);
      expect(bounded.map((entry) => entry.action)).toEqual(['NEWEST', 'MIDDLE']);
    });

    it('finds by entity, newest first, scoped to both entityType and entityId', async () => {
      const scopedEntityId = toUuid(idGenerator.generate());

      await append({
        entityId: scopedEntityId,
        action: 'FIRST',
        now: new Date('2026-03-01T00:00:00Z'),
      });
      await append({
        entityId: scopedEntityId,
        action: 'SECOND',
        now: new Date('2026-03-02T00:00:00Z'),
      });
      // Same id, different type — must not be returned below.
      await append({
        entityType: `${entityType}-other`,
        entityId: scopedEntityId,
        action: 'OTHER',
      });

      const found = await repository.findByEntity(entityType, scopedEntityId, 10);
      expect(found.map((entry) => entry.action)).toEqual(['SECOND', 'FIRST']);
    });

    it('returns an empty list for an actor with no entries', async () => {
      const stranger = toUserId(idGenerator.generate());
      expect(await repository.findByActor(stranger, 10)).toEqual([]);
    });
  });

  describe('immutability (SDD 18.4)', () => {
    it('rejects an UPDATE', async () => {
      const entry = await append({ action: 'UPDATE_TARGET' });

      await expect(
        prisma.auditLog.update({ where: { id: entry.id }, data: { reason: 'tampered' } }),
      ).rejects.toThrow();

      const row = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
      expect(row.reason).toBe('PAN and bank proof verified');
    });

    it('rejects a raw UPDATE, so the guarantee is the database and not the ORM', async () => {
      const entry = await append({ action: 'RAW_UPDATE_TARGET' });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "audit_logs" SET "reason" = 'tampered' WHERE "id" = $1`,
          entry.id,
        ),
      ).rejects.toThrow();
    });

    it('rejects a DELETE', async () => {
      const entry = await append({ action: 'DELETE_TARGET' });

      await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow();
      await expect(prisma.auditLog.deleteMany({ where: { id: entry.id } })).rejects.toThrow();

      const survivor = await prisma.auditLog.findUnique({ where: { id: entry.id } });
      expect(survivor).not.toBeNull();
    });

    it('rejects a raw DELETE', async () => {
      const entry = await append({ action: 'RAW_DELETE_TARGET' });

      await expect(
        prisma.$executeRawUnsafe(`DELETE FROM "audit_logs" WHERE "id" = $1`, entry.id),
      ).rejects.toThrow();

      const survivor = await prisma.auditLog.findUnique({ where: { id: entry.id } });
      expect(survivor).not.toBeNull();
    });

    it('rejects a TRUNCATE, which row-level triggers do not see', async () => {
      const entry = await append({ action: 'TRUNCATE_TARGET' });

      await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs"')).rejects.toThrow();

      const survivor = await prisma.auditLog.findUnique({ where: { id: entry.id } });
      expect(survivor).not.toBeNull();
    });
  });
});
