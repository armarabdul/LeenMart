import type { Uuid } from '@leen-mart/domain-kit';

export interface SessionProps {
  readonly id: Uuid;
  readonly userId: Uuid;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedByTokenId: Uuid | null;
  readonly createdAt: Date;
}

/**
 * A login session, identified only by the hash of its opaque refresh token
 * (SDD 6.1). Formerly named `RefreshToken` — same entity, same invariants;
 * "session" is the domain concept, "refresh token" was the implementation
 * detail it was originally named after. See refresh-token.entity.ts for the
 * backward-compatible alias existing callers still use.
 *
 * Rotation is modelled explicitly: `revoke()` records both that a token died
 * and, when it died because it was exchanged for a new one, which token
 * replaced it. That distinction is what lets a reused, already-rotated token
 * be recognised as token theft rather than an ordinary expiry.
 *
 * `id`/`userId` remain the generic `Uuid` rather than `SessionId`/`UserId`
 * for now: existing application/infrastructure code constructs this entity
 * with plain `Uuid` values, and this milestone is domain-only — retyping
 * these would ripple into layers this milestone doesn't touch.
 */
export class Session {
  private constructor(private readonly props: SessionProps) {}

  static issue(props: { id: Uuid; userId: Uuid; tokenHash: string; expiresAt: Date; now: Date }): Session {
    return new Session({
      id: props.id,
      userId: props.userId,
      tokenHash: props.tokenHash,
      expiresAt: props.expiresAt,
      revokedAt: null,
      replacedByTokenId: null,
      createdAt: props.now,
    });
  }

  static reconstitute(props: SessionProps): Session {
    return new Session(props);
  }

  get id(): Uuid {
    return this.props.id;
  }

  get userId(): Uuid {
    return this.props.userId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }

  get replacedByTokenId(): Uuid | null {
    return this.props.replacedByTokenId;
  }

  isExpired(now: Date): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  isActive(now: Date): boolean {
    return !this.isExpired(now) && !this.isRevoked();
  }

  revoke(now: Date, replacedByTokenId: Uuid | null = null): Session {
    return new Session({ ...this.props, revokedAt: now, replacedByTokenId });
  }
}
