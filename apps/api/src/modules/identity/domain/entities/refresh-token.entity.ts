import type { Uuid } from '@leen-mart/domain-kit';

export interface RefreshTokenProps {
  readonly id: Uuid;
  readonly userId: Uuid;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedByTokenId: Uuid | null;
  readonly createdAt: Date;
}

/**
 * A refresh session, identified only by the hash of its opaque token (SDD 6.1).
 *
 * Rotation is modelled explicitly: `revoke()` records both that a token died
 * and, when it died because it was exchanged for a new one, which token
 * replaced it. That distinction is what lets a reused, already-rotated token
 * be recognised as token theft rather than an ordinary expiry.
 */
export class RefreshToken {
  private constructor(private readonly props: RefreshTokenProps) {}

  static issue(props: { id: Uuid; userId: Uuid; tokenHash: string; expiresAt: Date; now: Date }): RefreshToken {
    return new RefreshToken({
      id: props.id,
      userId: props.userId,
      tokenHash: props.tokenHash,
      expiresAt: props.expiresAt,
      revokedAt: null,
      replacedByTokenId: null,
      createdAt: props.now,
    });
  }

  static reconstitute(props: RefreshTokenProps): RefreshToken {
    return new RefreshToken(props);
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

  revoke(now: Date, replacedByTokenId: Uuid | null = null): RefreshToken {
    return new RefreshToken({ ...this.props, revokedAt: now, replacedByTokenId });
  }
}
