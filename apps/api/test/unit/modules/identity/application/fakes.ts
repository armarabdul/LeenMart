import { NullLogger } from '@leen-mart/domain-kit';
import type { SessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import type { UserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { OtpId } from '../../../../../src/modules/identity/domain/value-objects/otp-id.value-object.js';
import type { MfaSecretId } from '../../../../../src/modules/identity/domain/value-objects/mfa-secret-id.value-object.js';
import type { MfaChallengeId } from '../../../../../src/modules/identity/domain/value-objects/mfa-challenge-id.value-object.js';
import type { PhoneNumber } from '../../../../../src/modules/identity/domain/value-objects/phone-number.value-object.js';
import type { RoleName } from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import type {
  AccessTokenClaims,
  AccessTokenService,
  AccessTokenSubject,
  SignedAccessToken,
} from '../../../../../src/modules/identity/application/ports/access-token.port.js';
import type { SessionDenylist } from '../../../../../src/modules/identity/application/ports/session-denylist.port.js';
import type {
  AuditWriter,
  AuditWriterInput,
} from '../../../../../src/modules/audit/application/ports/audit-writer.port.js';
import type {
  OutboxWriter,
  OutboxWriterInput,
} from '../../../../../src/shared/application/ports/outbox-writer.port.js';
import type { PasswordHasher } from '../../../../../src/modules/identity/application/ports/password-hasher.port.js';
import type { RefreshTokenHasher } from '../../../../../src/modules/identity/application/ports/refresh-token-hasher.port.js';
import type { RefreshTokenRepository } from '../../../../../src/modules/identity/application/ports/refresh-token-repository.port.js';
import type { UserRepository } from '../../../../../src/modules/identity/application/ports/user-repository.port.js';
import type { OtpGenerator } from '../../../../../src/modules/identity/domain/services/otp-generator.service.js';
import type { OtpHasher } from '../../../../../src/modules/identity/domain/services/otp-hasher.service.js';
import type { OtpRepository } from '../../../../../src/modules/identity/domain/repositories/otp.repository.js';
import type { MfaSecretRepository } from '../../../../../src/modules/identity/domain/repositories/mfa-secret.repository.js';
import type { MfaChallengeRepository } from '../../../../../src/modules/identity/domain/repositories/mfa-challenge.repository.js';
import type { TotpService } from '../../../../../src/modules/identity/domain/services/totp.service.js';
import type { MfaSecretCipher } from '../../../../../src/modules/identity/domain/services/mfa-secret-cipher.service.js';
import type { RefreshToken } from '../../../../../src/modules/identity/domain/entities/refresh-token.entity.js';
import type { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import type { Otp } from '../../../../../src/modules/identity/domain/entities/otp.entity.js';
import type { MfaSecret } from '../../../../../src/modules/identity/domain/entities/mfa-secret.entity.js';
import type { MfaChallenge } from '../../../../../src/modules/identity/domain/entities/mfa-challenge.entity.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import { OtpCode } from '../../../../../src/modules/identity/domain/value-objects/otp-code.value-object.js';

export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<UserId, User>();

  /** In-memory writes share one map, so a "transaction" is the same store. */
  withTransaction(): UserRepository {
    return this;
  }

  /** Lets a fake transaction runner roll the store back on failure. */
  snapshot(): Map<UserId, User> {
    return new Map(this.byId);
  }

  restore(state: Map<UserId, User>): void {
    this.byId.clear();
    for (const [id, user] of state) this.byId.set(id, user);
  }

  create(user: User): Promise<void> {
    this.byId.set(user.id, user);
    return Promise.resolve();
  }

  update(user: User): Promise<void> {
    this.byId.set(user.id, user);
    return Promise.resolve();
  }

  findByEmail(email: string): Promise<User | null> {
    for (const user of this.byId.values()) {
      if (user.email === email) return Promise.resolve(user);
    }
    return Promise.resolve(null);
  }

  findByPhone(phone: PhoneNumber): Promise<User | null> {
    for (const user of this.byId.values()) {
      if (user.phone?.equals(phone)) return Promise.resolve(user);
    }
    return Promise.resolve(null);
  }

  findById(id: UserId): Promise<User | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  existsWithAnyRole(roles: readonly RoleName[]): Promise<boolean> {
    for (const user of this.byId.values()) {
      if (roles.includes(user.role.name)) return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private readonly byId = new Map<SessionId, RefreshToken>();

  revokeAllForUser(userId: UserId, now: Date): Promise<readonly SessionId[]> {
    const killed: SessionId[] = [];
    for (const [id, token] of this.byId) {
      if (token.userId === userId && !token.isRevoked()) {
        this.byId.set(id, token.revoke(now));
        killed.push(id);
      }
    }
    return Promise.resolve(killed);
  }

  findSessionIdsByUserId(userId: UserId): Promise<readonly SessionId[]> {
    return Promise.resolve(
      [...this.byId.values()].filter((token) => token.userId === userId).map((token) => token.id),
    );
  }

  create(token: RefreshToken): Promise<void> {
    this.byId.set(token.id, token);
    return Promise.resolve();
  }

  update(token: RefreshToken): Promise<void> {
    this.byId.set(token.id, token);
    return Promise.resolve();
  }

  findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    for (const token of this.byId.values()) {
      if (token.tokenHash === tokenHash) return Promise.resolve(token);
    }
    return Promise.resolve(null);
  }

  /** Mirrors the Prisma adapter: only live rows are touched, and the returned ids are what actually died. */
  revokeFamily(familyId: SessionId, now: Date): Promise<readonly SessionId[]> {
    const revoked: SessionId[] = [];
    for (const [id, token] of this.byId) {
      if (token.familyId === familyId && !token.isRevoked()) {
        this.byId.set(id, token.revoke(now));
        revoked.push(id);
      }
    }
    return Promise.resolve(revoked);
  }

  /** Mirrors the Prisma adapter: no revoked filter — dead sessions are exactly what this is for. */
  findFamilySessionIds(familyId: SessionId): Promise<readonly SessionId[]> {
    const ids: SessionId[] = [];
    for (const [id, token] of this.byId) {
      if (token.familyId === familyId) ids.push(id);
    }
    return Promise.resolve(ids);
  }

  /** Test-only view of stored state, so assertions can inspect a whole family. */
  all(): readonly RefreshToken[] {
    return [...this.byId.values()];
  }
}

/** Deliberately not a real hash — fast and inspectable for assertions. */
export class FakePasswordHasher implements PasswordHasher {
  hash(plaintext: string): Promise<PasswordHash> {
    return Promise.resolve(PasswordHash.create(`hashed:${plaintext}`));
  }

  verify(hash: PasswordHash, plaintext: string): Promise<boolean> {
    return Promise.resolve(hash.value === `hashed:${plaintext}`);
  }
}

export class FakeAccessTokenService implements AccessTokenService {
  /** Every subject this service was asked to sign, so tests can assert on `sid`/`jti` wiring. */
  readonly signed: AccessTokenSubject[] = [];

  constructor(private readonly signedToken: SignedAccessToken) {}

  sign(subject: AccessTokenSubject): SignedAccessToken {
    this.signed.push(subject);
    return this.signedToken;
  }

  verify(): AccessTokenClaims {
    throw new Error('Not implemented: no identity use case verifies an access token today.');
  }
}

/**
 * In-memory `SessionDenylist`. Records the TTL each session was denied with,
 * so tests can assert SDD 7.2's "never longer than the remaining access-token
 * life" bound without reaching for a real Redis.
 */
export class InMemorySessionDenylist implements SessionDenylist {
  readonly denied = new Map<SessionId, number>();

  deny(sessionId: SessionId, ttlSeconds: number): Promise<void> {
    this.denied.set(sessionId, ttlSeconds);
    return Promise.resolve();
  }

  isDenied(sessionId: SessionId): Promise<boolean> {
    return Promise.resolve(this.denied.has(sessionId));
  }
}

/** Hands out predictable, incrementing raw tokens so rotation is easy to assert on. */
export class SequentialRefreshTokenHasher implements RefreshTokenHasher {
  private counter = 0;

  generate(): string {
    this.counter += 1;
    return `raw-token-${this.counter}`;
  }

  hash(rawToken: string): string {
    return `hash:${rawToken}`;
  }
}

export class InMemoryOtpRepository implements OtpRepository {
  private readonly byId = new Map<OtpId, Otp>();

  create(otp: Otp): Promise<void> {
    this.byId.set(otp.id, otp);
    return Promise.resolve();
  }

  update(otp: Otp): Promise<void> {
    this.byId.set(otp.id, otp);
    return Promise.resolve();
  }

  findById(id: OtpId): Promise<Otp | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  findActiveByUserId(userId: UserId): Promise<Otp | null> {
    // Map iteration is insertion order, so the last match is the most
    // recent — same "most recent unconsumed" semantics as the Prisma
    // implementation's `ORDER BY created_at DESC` without needing a
    // createdAt getter on the entity (it doesn't expose one, same as Session).
    let mostRecent: Otp | null = null;
    for (const otp of this.byId.values()) {
      if (otp.userId === userId && !otp.isConsumed()) {
        mostRecent = otp;
      }
    }
    return Promise.resolve(mostRecent);
  }
}

/** Hands out predictable codes so tests can assert exactly what gets hashed. */
export class FakeOtpGenerator implements OtpGenerator {
  private index = 0;

  constructor(private readonly codes: readonly string[] = ['123456']) {}

  generate(): OtpCode {
    const code = this.codes[this.index % this.codes.length];
    this.index += 1;
    return OtpCode.create(code ?? '123456');
  }
}

/** Deliberately not a real hash — fast and inspectable for assertions. */
export class FakeOtpHasher implements OtpHasher {
  hash(rawCode: string): Promise<string> {
    return Promise.resolve(`hashed:${rawCode}`);
  }

  verify(hash: string, rawCode: string): Promise<boolean> {
    return Promise.resolve(hash === `hashed:${rawCode}`);
  }
}

export class InMemoryMfaSecretRepository implements MfaSecretRepository {
  private readonly byId = new Map<MfaSecretId, MfaSecret>();

  create(mfaSecret: MfaSecret): Promise<void> {
    this.byId.set(mfaSecret.id, mfaSecret);
    return Promise.resolve();
  }

  update(mfaSecret: MfaSecret): Promise<void> {
    this.byId.set(mfaSecret.id, mfaSecret);
    return Promise.resolve();
  }

  findById(id: MfaSecretId): Promise<MfaSecret | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  findByUserId(userId: UserId): Promise<MfaSecret | null> {
    for (const secret of this.byId.values()) {
      if (secret.userId === userId) return Promise.resolve(secret);
    }
    return Promise.resolve(null);
  }
}

export class InMemoryMfaChallengeRepository implements MfaChallengeRepository {
  private readonly byId = new Map<MfaChallengeId, MfaChallenge>();

  create(mfaChallenge: MfaChallenge): Promise<void> {
    this.byId.set(mfaChallenge.id, mfaChallenge);
    return Promise.resolve();
  }

  update(mfaChallenge: MfaChallenge): Promise<void> {
    this.byId.set(mfaChallenge.id, mfaChallenge);
    return Promise.resolve();
  }

  findByTokenHash(tokenHash: string): Promise<MfaChallenge | null> {
    for (const challenge of this.byId.values()) {
      if (challenge.tokenHash === tokenHash) return Promise.resolve(challenge);
    }
    return Promise.resolve(null);
  }

  /** Single-threaded JS makes this trivially atomic — the real assertion of DB-level atomicity lives in the Postgres integration test. */
  consumeIfActive(id: MfaChallengeId, now: Date): Promise<boolean> {
    const challenge = this.byId.get(id);
    if (!challenge?.isActive(now)) {
      return Promise.resolve(false);
    }
    this.byId.set(id, challenge.consume(now));
    return Promise.resolve(true);
  }
}

/** Deliberately not real TOTP — checks the submitted code against a fixed expected value, ignoring `secret`/`now`. Real TOTP correctness is `OtplibTotpService`'s own test's job. */
export class FakeTotpService implements TotpService {
  constructor(private readonly validCode = '123456') {}

  generateSecret(): string {
    return 'FAKESECRETFAKESECRETFAKE';
  }

  verify(params: { secret: string; token: string; now: Date }): Promise<boolean> {
    return Promise.resolve(params.token === this.validCode);
  }

  generateEnrollmentUri(params: { secret: string; accountLabel: string; issuer: string }): string {
    return `otpauth://totp/${params.issuer}:${params.accountLabel}?secret=${params.secret}&issuer=${params.issuer}`;
  }
}

/** Deliberately not real encryption — a recognisable prefix, fast and inspectable for assertions. */
export class FakeMfaSecretCipher implements MfaSecretCipher {
  encrypt(plaintext: string): string {
    return `encrypted:${plaintext}`;
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith('encrypted:')) {
      throw new Error('FakeMfaSecretCipher: not a value this fake encrypted');
    }
    return ciphertext.slice('encrypted:'.length);
  }
}

export const nullLogger = new NullLogger();

/**
 * Captures what each use case asked to audit. Deliberately does not read the
 * ambient request context — that is `AmbientAuditWriter`'s job, covered by its
 * own tests; these assertions are about *what* callers record, not how the
 * transport facts are gathered.
 */
export class RecordingAuditWriter implements AuditWriter {
  readonly entries: AuditWriterInput[] = [];

  // No caller in this module needs a scoped instance to behave any
  // differently — there is no in-memory "transaction" to bind to, so this
  // returns the same recorder rather than fabricating one.
  withTransaction(): AuditWriter {
    return this;
  }

  record(input: AuditWriterInput): Promise<void> {
    this.entries.push(input);
    return Promise.resolve();
  }
}

/**
 * Captures what each use case asked to publish to the outbox
 * (S6-NOTIFY-LIFECYCLE). Same shape and same reasoning as
 * `RecordingAuditWriter` above: there is no in-memory transaction to bind to,
 * so `withTransaction` returns the same recorder. The rollback assertions are
 * driven by the fake transaction runner, not by this.
 */
export class RecordingOutboxWriter implements OutboxWriter {
  readonly events: OutboxWriterInput[] = [];

  withTransaction(): OutboxWriter {
    return this;
  }

  write(input: OutboxWriterInput): Promise<void> {
    this.events.push(input);
    return Promise.resolve();
  }
}

/** An audit writer whose persistence always fails, for the fail-closed assertions. */
export class FailingAuditWriter implements AuditWriter {
  withTransaction(): AuditWriter {
    return this;
  }

  record(): Promise<void> {
    return Promise.reject(new Error('audit log unavailable'));
  }
}
