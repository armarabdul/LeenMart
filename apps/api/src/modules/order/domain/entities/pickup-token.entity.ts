import type { UserId, VendorId } from '../../../identity/index.js';
import { PickupTokenAlreadyRedeemedError } from '../errors/order-errors.js';
import type { PickupTokenId } from '../value-objects/pickup-token-id.value-object.js';
import type { SubOrderId } from '../value-objects/sub-order-id.value-object.js';

export type PickupTokenStatusName = 'ISSUED' | 'REDEEMED';

export interface PickupTokenProps {
  readonly id: PickupTokenId;
  readonly subOrderId: SubOrderId;
  /** Denormalised, the same reason `LedgerJournal.vendorId` is (S3-7) — a direct RLS column comparison rather than a subquery through `SubOrder`. */
  readonly vendorId: VendorId;
  readonly status: PickupTokenStatusName;
  /** SHA-256 (hex) of the most recently issued signed token — SDD 13.1: "Stored: SHA-256(token) in pickup_tokens". Informational/audit only; redemption validates the *presented* token's own signature, not a hash match (see `RedeemPickupTokenUseCase`'s own doc comment). */
  readonly tokenHash: string;
  /** The 128-bit nonce embedded in the most recently issued token (SDD 13.1: "non-enumerable"). Informational only, same reason as `tokenHash`. */
  readonly nonce: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly redeemedAt: Date | null;
  readonly redeemedByUserId: UserId | null;
  /** Optimistic-concurrency guard for the *rotate* path only — the same `Inventory.version`/`SubOrder.version` idiom. Redemption's own single-use guarantee comes from the `status` compare-and-set (`PrismaPickupTokenRepository.redeemIfIssued`), not from this. */
  readonly version: number;
  /** Argon2id hash of the current 4-digit manual/scanner-broken fallback code (S4-QR-FALLBACK, SDD 13.3) — rotated in lockstep with `tokenHash`/`nonce`. Null until the first issue/rotate under this feature. */
  readonly manualCodeHash: string | null;
  /** Mirrors `Otp.attempts` — capped by `MAX_MANUAL_CODE_ATTEMPTS`, reset to 0 on every rotation alongside `manualCodeHash`. */
  readonly manualCodeAttempts: number;
  readonly createdAt: Date;
}

/**
 * A pickup credential for exactly one `SubOrder` (S4-QR, SDD §13.1) — one
 * row per sub-order, its `tokenHash`/`nonce`/`expiresAt` overwritten on each
 * rotation rather than appended as a log, since only the *current* token is
 * ever meaningful for redemption. `status` is the entity's single-use gate:
 * once `REDEEMED`, nothing rotates or redeems it again.
 *
 * Always constructed with an already-signed token's hash and nonce — this
 * entity never signs anything itself (`Ed25519PickupTokenSigner` does that,
 * infrastructure-side); it only records what was issued and enforces the
 * redemption state machine.
 */
export class PickupToken {
  /** Mirrors `Otp.MAX_ATTEMPTS` — a 4-digit code is only 10,000 possibilities, so the attempt budget (not the hash strength alone) is what makes brute force impractical. */
  static readonly MAX_MANUAL_CODE_ATTEMPTS = 5;

  private constructor(private readonly props: PickupTokenProps) {}

  static issue(props: {
    id: PickupTokenId;
    subOrderId: SubOrderId;
    vendorId: VendorId;
    tokenHash: string;
    nonce: string;
    issuedAt: Date;
    expiresAt: Date;
    manualCodeHash: string;
  }): PickupToken {
    return new PickupToken({
      id: props.id,
      subOrderId: props.subOrderId,
      vendorId: props.vendorId,
      status: 'ISSUED',
      tokenHash: props.tokenHash,
      nonce: props.nonce,
      issuedAt: props.issuedAt,
      expiresAt: props.expiresAt,
      redeemedAt: null,
      redeemedByUserId: null,
      version: 1,
      manualCodeHash: props.manualCodeHash,
      manualCodeAttempts: 0,
      createdAt: props.issuedAt,
    });
  }

  static reconstitute(props: PickupTokenProps): PickupToken {
    return new PickupToken(props);
  }

  get id(): PickupTokenId {
    return this.props.id;
  }

  get subOrderId(): SubOrderId {
    return this.props.subOrderId;
  }

  get vendorId(): VendorId {
    return this.props.vendorId;
  }

  get status(): PickupTokenStatusName {
    return this.props.status;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get nonce(): string {
    return this.props.nonce;
  }

  get issuedAt(): Date {
    return this.props.issuedAt;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get redeemedAt(): Date | null {
    return this.props.redeemedAt;
  }

  get redeemedByUserId(): UserId | null {
    return this.props.redeemedByUserId;
  }

  get version(): number {
    return this.props.version;
  }

  get manualCodeHash(): string | null {
    return this.props.manualCodeHash;
  }

  get manualCodeAttempts(): number {
    return this.props.manualCodeAttempts;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  isExpired(now: Date): boolean {
    return now.getTime() >= this.props.expiresAt.getTime();
  }

  hasExceededManualCodeAttempts(): boolean {
    return this.props.manualCodeAttempts >= PickupToken.MAX_MANUAL_CODE_ATTEMPTS;
  }

  /**
   * Replaces the hash/nonce/validity window with a freshly signed token
   * (SDD 13.1's 60-second rotation) — only while still `ISSUED`. A `REDEEMED`
   * token is terminal; rotating it would resurrect a spent credential.
   *
   * The manual/scanner-broken fallback code (S4-QR-FALLBACK) rotates in the
   * same call, for the same reason the QR itself does: a code that outlived
   * the QR's own validity window would be a longer-lived bearer secret than
   * the credential it exists to back up. `manualCodeAttempts` resets to 0 —
   * a fresh code earns a fresh attempt budget.
   */
  rotate(props: {
    tokenHash: string;
    nonce: string;
    issuedAt: Date;
    expiresAt: Date;
    manualCodeHash: string;
  }): PickupToken {
    if (this.props.status !== 'ISSUED') {
      throw new PickupTokenAlreadyRedeemedError();
    }
    return new PickupToken({
      ...this.props,
      tokenHash: props.tokenHash,
      nonce: props.nonce,
      issuedAt: props.issuedAt,
      expiresAt: props.expiresAt,
      manualCodeHash: props.manualCodeHash,
      manualCodeAttempts: 0,
    });
  }

  /**
   * Records a wrong manual-code guess (S4-QR-FALLBACK). Mirrors
   * `Otp.recordFailedAttempt()` — throws rather than silently incrementing
   * past redemption, the same invariant `rotate()` above already enforces.
   */
  recordFailedManualCodeAttempt(): PickupToken {
    if (this.props.status !== 'ISSUED') {
      throw new PickupTokenAlreadyRedeemedError();
    }
    return new PickupToken({
      ...this.props,
      manualCodeAttempts: this.props.manualCodeAttempts + 1,
    });
  }

  /**
   * Domain-level record of redemption — a second, cheap correctness check
   * alongside the repository's own atomic `status = 'ISSUED' -> 'REDEEMED'`
   * compare-and-set, which is what actually makes concurrent redemption
   * impossible (see `PrismaPickupTokenRepository.redeemIfIssued`). This
   * method throws the same way if called on an already-`REDEEMED` instance,
   * so unit tests can prove the domain rule without a database.
   */
  redeem(props: { redeemedAt: Date; redeemedByUserId: UserId }): PickupToken {
    if (this.props.status !== 'ISSUED') {
      throw new PickupTokenAlreadyRedeemedError();
    }
    return new PickupToken({
      ...this.props,
      status: 'REDEEMED',
      redeemedAt: props.redeemedAt,
      redeemedByUserId: props.redeemedByUserId,
    });
  }
}
