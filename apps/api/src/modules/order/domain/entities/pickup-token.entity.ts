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
  private constructor(private readonly props: PickupTokenProps) {}

  static issue(props: {
    id: PickupTokenId;
    subOrderId: SubOrderId;
    vendorId: VendorId;
    tokenHash: string;
    nonce: string;
    issuedAt: Date;
    expiresAt: Date;
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

  get createdAt(): Date {
    return this.props.createdAt;
  }

  isExpired(now: Date): boolean {
    return now.getTime() >= this.props.expiresAt.getTime();
  }

  /**
   * Replaces the hash/nonce/validity window with a freshly signed token
   * (SDD 13.1's 60-second rotation) — only while still `ISSUED`. A `REDEEMED`
   * token is terminal; rotating it would resurrect a spent credential.
   */
  rotate(props: {
    tokenHash: string;
    nonce: string;
    issuedAt: Date;
    expiresAt: Date;
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
