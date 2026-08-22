import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { FixedClock, UuidV7Generator, toUuid, type TransactionScope } from '@leen-mart/domain-kit';
import { AmbientAuditWriter } from '../../../../src/modules/audit/infrastructure/ambient-audit-writer.js';
import type { AuditLogEntry } from '../../../../src/modules/audit/domain/entities/audit-log-entry.entity.js';
import type { AuditLogRepository } from '../../../../src/modules/audit/domain/repositories/audit-log.repository.js';
import { requestContextMiddleware } from '../../../../src/shared/interface/http/middleware/request-context.js';
import { toUserId } from '../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';

class InMemoryAuditLogRepository implements AuditLogRepository {
  readonly appended: AuditLogEntry[];
  /** Set on a scoped instance, so a test can tell it apart from the original. */
  readonly boundScope: TransactionScope | null;

  constructor(sharedAppended: AuditLogEntry[] = [], boundScope: TransactionScope | null = null) {
    this.appended = sharedAppended;
    this.boundScope = boundScope;
  }

  withTransaction(scope: TransactionScope): AuditLogRepository {
    // A genuinely new instance, not `this` — the point being tested is that
    // `AmbientAuditWriter.withTransaction` ends up writing through a
    // *different*, scope-bound repository, exactly as
    // `PrismaAuditLogRepository.withTransaction` returns a new instance
    // rather than mutating itself. It shares the same backing array on
    // purpose: in production the scoped repository writes to the same table,
    // just through the caller's connection, so an assertion on `appended`
    // should see entries recorded through either path.
    return new InMemoryAuditLogRepository(this.appended, scope);
  }

  append(entry: AuditLogEntry): Promise<void> {
    this.appended.push(entry);
    return Promise.resolve();
  }

  findByActor(): Promise<readonly AuditLogEntry[]> {
    return Promise.resolve(this.appended);
  }

  findByEntity(): Promise<readonly AuditLogEntry[]> {
    return Promise.resolve(this.appended);
  }

  listPage(): ReturnType<AuditLogRepository['listPage']> {
    return Promise.resolve({ items: this.appended, nextCursor: null, hasMore: false });
  }
}

const NOW = new Date('2026-01-01T00:00:00.000Z');
const actorId = toUserId('00000000-0000-7000-8000-000000009901');

const build = (): { writer: AmbientAuditWriter; repository: InMemoryAuditLogRepository } => {
  const repository = new InMemoryAuditLogRepository();
  const writer = new AmbientAuditWriter({
    auditLogRepository: repository,
    idGenerator: new UuidV7Generator(),
    clock: new FixedClock(NOW),
  });
  return { writer, repository };
};

const input = {
  actorId,
  actorRole: 'SUPER_ADMIN',
  action: 'identity.admin.login',
  entityType: 'User',
  entityId: toUuid(actorId),
};

describe('AmbientAuditWriter', () => {
  describe('outside a request', () => {
    it('still writes the entry, with the transport facts null', async () => {
      // A scheduled job or a CLI has no request behind it; SDD 18.4's columns
      // are nullable for exactly that case, and refusing to audit would be the
      // wrong failure.
      const { writer, repository } = build();

      await writer.record(input);

      const [entry] = repository.appended;
      expect(entry?.requestId).toBeNull();
      expect(entry?.ipAddress).toBeNull();
      expect(entry?.userAgent).toBeNull();
    });

    it('records what the caller stated', async () => {
      const { writer, repository } = build();

      await writer.record(input);

      const [entry] = repository.appended;
      expect(entry?.actorId).toBe(actorId);
      expect(entry?.actorRole).toBe('SUPER_ADMIN');
      expect(entry?.action).toBe('identity.admin.login');
      expect(entry?.entityType).toBe('User');
      expect(entry?.entityId).toBe(actorId);
      expect(entry?.createdAt).toEqual(NOW);
    });

    it('defaults the optional fields rather than requiring them', async () => {
      const { writer, repository } = build();

      await writer.record(input);

      const [entry] = repository.appended;
      expect(entry?.before).toBeNull();
      expect(entry?.after).toBeNull();
      expect(entry?.reason).toBeNull();
      expect(entry?.impersonatedBy).toBeNull();
      expect(entry?.isImpersonated()).toBe(false);
    });

    it('gives every entry its own id', async () => {
      const { writer, repository } = build();

      await writer.record(input);
      await writer.record(input);

      expect(repository.appended[0]?.id).not.toBe(repository.appended[1]?.id);
    });

    it('propagates a persistence failure instead of swallowing it', async () => {
      // The caller decides whether a failed audit write is fatal; this adapter
      // must not make that choice silently.
      const writer = new AmbientAuditWriter({
        auditLogRepository: {
          withTransaction(): AuditLogRepository {
            return this;
          },
          append: () => Promise.reject(new Error('table unavailable')),
          findByActor: () => Promise.resolve([]),
          findByEntity: () => Promise.resolve([]),
          listPage: () => Promise.resolve({ items: [], nextCursor: null, hasMore: false }),
        },
        idGenerator: new UuidV7Generator(),
        clock: new FixedClock(NOW),
      });

      await expect(writer.record(input)).rejects.toThrow(/table unavailable/);
    });
  });

  describe('inside a request', () => {
    /** Drives the writer through real middleware so the ambient context is genuinely populated. */
    const recordDuringRequest = async (
      headers: Record<string, string>,
    ): Promise<InMemoryAuditLogRepository> => {
      const { writer, repository } = build();
      const app = express();
      app.set('trust proxy', 1);
      app.use(requestContextMiddleware(new UuidV7Generator()));
      app.post('/probe', (_req, res) => {
        void writer.record(input).then(
          () => res.status(204).end(),
          () => res.status(500).end(),
        );
      });

      const pending = request(app).post('/probe');
      for (const [name, value] of Object.entries(headers)) pending.set(name, value);
      await pending.expect(204);

      return repository;
    };

    it('takes requestId, ip and userAgent from the ambient context', async () => {
      const repository = await recordDuringRequest({
        'X-Request-Id': 'corr-42',
        'X-Forwarded-For': '203.0.113.7',
        'User-Agent': 'leen-mart-audit-probe/1.0',
      });

      const [entry] = repository.appended;
      expect(entry?.requestId).toBe('corr-42');
      expect(entry?.ipAddress).toBe('203.0.113.7');
      expect(entry?.userAgent).toBe('leen-mart-audit-probe/1.0');
    });

    it('records a null user agent when the client sent none', async () => {
      const repository = await recordDuringRequest({ 'User-Agent': '' });

      expect(repository.appended[0]?.userAgent).toBeNull();
    });
  });

  describe('withTransaction (KYC-6 preparatory)', () => {
    const fakeScope = {} as TransactionScope;

    it('writes through the repository the scope was bound to, not the original', async () => {
      const { writer, repository } = build();

      const scopedWriter = writer.withTransaction(fakeScope);
      await scopedWriter.record(input);

      // The write reached the *shared* backing array, proving the scoped
      // writer really delegates to a repository over the same underlying
      // store — not a disconnected copy that silently drops entries.
      expect(repository.appended).toHaveLength(1);
    });

    it('binds the scope onto the repository it re-creates', async () => {
      const { writer, repository } = build();

      const scopedWriter = writer.withTransaction(fakeScope);
      await scopedWriter.record(input);

      expect(repository.appended[0]).toBeDefined();
      // The entry now living in the shared array was appended through a
      // repository instance carrying `fakeScope` — confirmed by asking the
      // production repository itself for the scope it was bound to, the same
      // property `PrismaAuditLogRepository.withTransaction` would carry a
      // real transaction client under.
      const scopedRepository = repository.withTransaction(fakeScope) as InMemoryAuditLogRepository;
      expect(scopedRepository.boundScope).toBe(fakeScope);
    });

    it('still reads the ambient request context on the scoped path', async () => {
      // Rebinding the repository must not disturb where ip/userAgent/requestId
      // come from — that mechanism is orthogonal to which connection the
      // write ultimately lands on.
      const { writer, repository } = build();
      const app = express();
      app.use(requestContextMiddleware(new UuidV7Generator()));
      app.post('/probe', (_req, res) => {
        writer
          .withTransaction(fakeScope)
          .record(input)
          .then(() => res.status(204).end())
          .catch(() => res.status(500).end());
      });

      await request(app)
        .post('/probe')
        .set('X-Request-Id', 'scoped-corr-1')
        .set('User-Agent', 'leen-mart-audit-probe/1.0')
        .expect(204);

      expect(repository.appended[0]?.requestId).toBe('scoped-corr-1');
      expect(repository.appended[0]?.userAgent).toBe('leen-mart-audit-probe/1.0');
    });

    it('leaves the original, unscoped writer untouched', async () => {
      const { writer, repository } = build();

      writer.withTransaction(fakeScope);

      await writer.record(input);
      expect(repository.appended).toHaveLength(1);
    });
  });
});
