import { describe, expect, it } from 'vitest';
import { toUuid } from '@leen-mart/domain-kit';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toAuditLogEntryId } from '../../../../../src/modules/audit/domain/value-objects/audit-log-entry-id.value-object.js';
import {
  AuditLogEntry,
  type AuditLogActor,
  type AuditLogRequestContext,
} from '../../../../../src/modules/audit/domain/entities/audit-log-entry.entity.js';

const id = toAuditLogEntryId('00000000-0000-7000-8000-0000000000a1');
const actorId = toUserId('00000000-0000-7000-8000-0000000000a2');
const adminId = toUserId('00000000-0000-7000-8000-0000000000a3');
const entityId = toUuid('00000000-0000-7000-8000-0000000000a4');
const now = new Date('2026-01-01T00:00:00.000Z');

const actor: AuditLogActor = {
  actorId,
  actorRole: 'RISK_ANALYST',
  impersonatedBy: null,
};

const context: AuditLogRequestContext = {
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (admin console)',
  requestId: 'req-01950000-0000-7000-8000-000000000001',
};

const record = (
  overrides: Partial<Parameters<typeof AuditLogEntry.record>[0]> = {},
): AuditLogEntry =>
  AuditLogEntry.record({
    id,
    actor,
    action: 'VENDOR_KYC_APPROVED',
    entityType: 'VendorProfile',
    entityId,
    before: { status: 'KYC_UNDER_REVIEW' },
    after: { status: 'KYC_APPROVED' },
    reason: 'PAN and bank proof verified',
    context,
    now,
    ...overrides,
  });

describe('AuditLogEntry', () => {
  it('records every SDD 18.4 field exactly as supplied', () => {
    const entry = record();

    expect(entry.id).toBe(id);
    expect(entry.actorId).toBe(actorId);
    expect(entry.actorRole).toBe('RISK_ANALYST');
    expect(entry.impersonatedBy).toBeNull();
    expect(entry.action).toBe('VENDOR_KYC_APPROVED');
    expect(entry.entityType).toBe('VendorProfile');
    expect(entry.entityId).toBe(entityId);
    expect(entry.before).toEqual({ status: 'KYC_UNDER_REVIEW' });
    expect(entry.after).toEqual({ status: 'KYC_APPROVED' });
    expect(entry.reason).toBe('PAN and bank proof verified');
    expect(entry.ipAddress).toBe('203.0.113.7');
    expect(entry.userAgent).toBe('Mozilla/5.0 (admin console)');
    expect(entry.requestId).toBe(context.requestId);
  });

  it('stamps createdAt from the supplied clock reading, never from the wall clock', () => {
    expect(record().createdAt).toEqual(now);
  });

  it('accepts an entry with no actor — not every audited action has a signed-in human', () => {
    const entry = record({
      actor: { actorId: null, actorRole: 'SUPER_ADMIN', impersonatedBy: null },
    });

    expect(entry.actorId).toBeNull();
    expect(entry.actorRole).toBe('SUPER_ADMIN');
  });

  it('accepts an entry with no request context — a scheduled job has no request behind it', () => {
    const entry = record({
      context: { ipAddress: null, userAgent: null, requestId: null },
    });

    expect(entry.ipAddress).toBeNull();
    expect(entry.userAgent).toBeNull();
    expect(entry.requestId).toBeNull();
  });

  it('accepts an entry with no target, no snapshots and no reason', () => {
    const entry = record({ entityId: null, before: null, after: null, reason: null });

    expect(entry.entityId).toBeNull();
    expect(entry.before).toBeNull();
    expect(entry.after).toBeNull();
    expect(entry.reason).toBeNull();
  });

  it('accepts a role name outside the current role set, so old rows stay recordable', () => {
    // `actorRole` is VARCHAR(50), not the Role enum: an eight-year retention
    // window outlives any given spelling of a role.
    expect(record({ actor: { ...actor, actorRole: 'LEGACY_OPS_ADMIN' } }).actorRole).toBe(
      'LEGACY_OPS_ADMIN',
    );
  });

  describe('impersonation (SDD 8.2)', () => {
    it('is not impersonated when the actor acts as themselves', () => {
      expect(record().isImpersonated()).toBe(false);
    });

    it('records the admin behind a support impersonation session', () => {
      const entry = record({
        actor: { actorId, actorRole: 'SUPPORT_AGENT', impersonatedBy: adminId },
      });

      expect(entry.impersonatedBy).toBe(adminId);
      expect(entry.isImpersonated()).toBe(true);
    });
  });

  describe('required text', () => {
    it.each([
      ['action', { action: '' }],
      ['action', { action: '   ' }],
      ['entityType', { entityType: '' }],
      ['entityType', { entityType: '\t' }],
    ])('rejects a blank %s', (_field, overrides) => {
      expect(() => record(overrides)).toThrow(TypeError);
    });

    it('rejects a blank actorRole', () => {
      expect(() => record({ actor: { ...actor, actorRole: '  ' } })).toThrow(TypeError);
    });
  });

  describe('reconstitute', () => {
    it('rehydrates persisted state verbatim', () => {
      const entry = AuditLogEntry.reconstitute({
        id,
        actorId,
        actorRole: 'FINANCE_ADMIN',
        impersonatedBy: null,
        action: 'REFUND_ISSUED',
        entityType: 'Order',
        entityId,
        before: null,
        after: { refundedMinor: 50_000 },
        reason: null,
        ipAddress: null,
        userAgent: null,
        requestId: null,
        createdAt: now,
      });

      expect(entry.action).toBe('REFUND_ISSUED');
      expect(entry.after).toEqual({ refundedMinor: 50_000 });
      expect(entry.createdAt).toEqual(now);
    });

    it('applies no validation, so a row written under older rules still loads', () => {
      // The mirror of the `record()` guards above: an audit trail that refuses
      // to load the entry someone is asking about has failed at its one job.
      const entry = AuditLogEntry.reconstitute({
        id,
        actorId: null,
        actorRole: '',
        impersonatedBy: null,
        action: '',
        entityType: '',
        entityId: null,
        before: null,
        after: null,
        reason: null,
        ipAddress: null,
        userAgent: null,
        requestId: null,
        createdAt: now,
      });

      expect(entry.action).toBe('');
      expect(entry.actorRole).toBe('');
    });
  });

  it('exposes no mutator: a correction is a new entry, never an edit', () => {
    const entry = record();
    const mutators = ['update', 'revise', 'correct', 'delete', 'redact'];

    for (const name of mutators) {
      expect(entry).not.toHaveProperty(name);
    }
  });
});
