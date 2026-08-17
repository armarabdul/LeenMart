import type { UserId, VendorId } from '../../../identity/index.js';
import {
  VendorStatus,
  type VendorStatusName,
} from '../value-objects/vendor-status.value-object.js';
import { InvalidVendorStatusTransitionError } from '../errors/vendor-errors.js';

/**
 * S3-2, ASM-06: "a vendor is on exactly one plan at a time — `COMMISSION` or
 * `SUBSCRIPTION`." A plain string-literal union rather than a rich
 * transition-guarded class, mirroring `ProductStatusName` — there is no
 * `changePlan()` here yet (see the class doc comment below), so there is no
 * state machine to model.
 */
export type VendorPlanName = 'COMMISSION' | 'SUBSCRIPTION';

export interface VendorProfileProps {
  readonly id: VendorId;
  readonly userId: UserId;
  readonly status: VendorStatus;
  readonly plan: VendorPlanName;
  /**
   * The customer-safe shop display name (S3-3A, decision D-S3-03). `null`
   * until the vendor sets one — never backfilled or guessed, since a name
   * nobody chose is invented data. Plain `string`, not a dedicated value
   * object: like `Address.recipientName`, it carries no behaviour beyond
   * format validation, which happens once at the HTTP boundary
   * (`setVendorShopNameRequestSchema`).
   */
  readonly shopName: string | null;
  /**
   * Whether this vendor offers pickup fulfilment (S4-QR). `false` for every
   * pre-existing vendor and every newly registered one — pickup is opt-in,
   * never assumed, so a customer's `PICKUP` checkout selection has something
   * real to check it against (`PickupNotSupportedByVendorError` otherwise).
   */
  readonly supportsPickup: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * SDD 15.1's onboarding lifecycle, transcribed edge-for-edge:
 *
 *   REGISTERED ─► KYC_SUBMITTED ─► KYC_UNDER_REVIEW ─┬─► KYC_REJECTED ─► (resubmit)
 *                                                     └─► APPROVED ─► ACTIVE
 *                                                           │
 *                               SUSPENDED ◄─────────────────┤
 *                               (risk/performance/expiry)   │
 *                                     │                     │
 *                                     └──► reinstated ──────┘
 *
 * A table rather than a chain of `if`s in each method, for the same reason
 * `PERMISSION_MATRIX` transcribes SDD 8.2 as a table: it can be read
 * side-by-side against the diagram, and `satisfies` turns a transition added
 * without a source state into a compile error rather than a silent gap.
 *
 * Keyed by intent rather than by target state, because two edges land on
 * ACTIVE from different places and mean different things. `activate()` is
 * only ever the step after KYC approval and `reinstate()` only ever the way
 * back from suspension; collapsing them into "anything that reaches ACTIVE"
 * would let a suspended vendor be quietly activated as though they had just
 * cleared KYC.
 *
 * The diagram's `APPROVED` is this enum's `KYC_APPROVED` — the same mapping
 * `schema.prisma` already documents.
 *
 * TERMINATED appears in neither a `from` nor a `to`: SDD 15.1 annotates it
 * "(wind-down, BR-27)", and BR-27 — what becomes of open orders, undelivered
 * preorders, held funds, reviews and product data when a vendor leaves — is
 * an unanswered P1 question. Which states may terminate, and what
 * termination does, are exactly what it asks, so the edge is left undrawn
 * rather than guessed at.
 */
const TRANSITIONS = {
  SUBMIT_KYC: { from: ['REGISTERED', 'KYC_REJECTED'], to: VendorStatus.KYC_SUBMITTED },
  START_KYC_REVIEW: { from: ['KYC_SUBMITTED'], to: VendorStatus.KYC_UNDER_REVIEW },
  APPROVE_KYC: { from: ['KYC_UNDER_REVIEW'], to: VendorStatus.KYC_APPROVED },
  REJECT_KYC: { from: ['KYC_UNDER_REVIEW'], to: VendorStatus.KYC_REJECTED },
  ACTIVATE: { from: ['KYC_APPROVED'], to: VendorStatus.ACTIVE },
  SUSPEND: { from: ['ACTIVE'], to: VendorStatus.SUSPENDED },
  REINSTATE: { from: ['SUSPENDED'], to: VendorStatus.ACTIVE },
} satisfies Record<string, { from: readonly VendorStatusName[]; to: VendorStatus }>;

type VendorTransition = keyof typeof TRANSITIONS;

/**
 * A vendor's onboarding record (SDD 15.1), kept separate from `User`: KYC
 * state and the vendor lifecycle apply only to vendors, and every `User`
 * load would otherwise carry fields that mean nothing for a customer or
 * admin. `userId` is the link back to the authenticated account that
 * registered (SDD 6.7 permits a foreign key to `users`).
 *
 * Every transition returns a new instance and stamps `updatedAt` from the
 * supplied clock, following `User`'s lifecycle methods exactly — the
 * receiver is never mutated, so a rejected transition cannot leave a
 * half-changed aggregate behind.
 *
 * None of these transitions has a caller yet. What each one *means* beyond
 * the status change — the KYC documents behind a submission, the Razorpay
 * linked account and shop publication SDD 15.1 requires on approval, the
 * risk signal behind a suspension — belongs to the chunks that own those
 * concerns. This is the machine itself, and nothing more.
 */
export class VendorProfile {
  private constructor(private readonly props: VendorProfileProps) {}

  /**
   * Entry point of SDD 15.1's lifecycle: a new vendor always starts
   * REGISTERED. `plan` is not a parameter — every new vendor starts on
   * `COMMISSION` (S3-2, D-S3-01), the same default the migration backfills
   * onto every pre-existing row, so there is exactly one place this decision
   * is made rather than one for new vendors and another for old ones.
   */
  static register(props: { id: VendorId; userId: UserId; now: Date }): VendorProfile {
    return new VendorProfile({
      id: props.id,
      userId: props.userId,
      status: VendorStatus.REGISTERED,
      plan: 'COMMISSION',
      shopName: null,
      supportsPickup: false,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  /** Rehydrates from persisted state. Never applies registration defaults. */
  static reconstitute(props: VendorProfileProps): VendorProfile {
    return new VendorProfile(props);
  }

  get id(): VendorId {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get status(): VendorStatus {
    return this.props.status;
  }

  get plan(): VendorPlanName {
    return this.props.plan;
  }

  get shopName(): string | null {
    return this.props.shopName;
  }

  get supportsPickup(): boolean {
    return this.props.supportsPickup;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /**
   * The single gate every transition passes through. Reading the source
   * state off `this` rather than taking it as an argument is what makes an
   * illegal move impossible to express: a caller cannot claim to be in a
   * state it is not.
   */
  private transition(name: VendorTransition, now: Date): VendorProfile {
    const { from, to } = TRANSITIONS[name];
    if (!(from as readonly VendorStatusName[]).includes(this.props.status.name)) {
      throw new InvalidVendorStatusTransitionError(this.props.status.name, to.name);
    }
    return new VendorProfile({ ...this.props, status: to, updatedAt: now });
  }

  /**
   * Vendor submits their KYC pack for review. Legal from `REGISTERED` (the
   * first attempt) and from `KYC_REJECTED` — SDD 15.1's `(resubmit)`, which
   * is what stops a rejection from being a dead end.
   */
  submitKyc(now: Date): VendorProfile {
    return this.transition('SUBMIT_KYC', now);
  }

  /** A reviewer picks the submission up. Separate from submission so the queue has a state to claim. */
  startKycReview(now: Date): VendorProfile {
    return this.transition('START_KYC_REVIEW', now);
  }

  /**
   * The reviewer's decision to approve. Reaches `KYC_APPROVED`, not `ACTIVE`:
   * SDD 15.1 draws those as two states, and everything it lists as happening
   * "on approval" — the Razorpay linked account, shop publication, the NEW
   * trust tier — sits between them.
   */
  approveKyc(now: Date): VendorProfile {
    return this.transition('APPROVE_KYC', now);
  }

  /**
   * The reviewer's decision to reject. Carries no reason argument: `vendors`
   * has no column to hold one, and the rejection reason belongs to the
   * audit log and to the KYC verification record a later chunk adds — not to
   * a field invented here with nowhere to be written.
   */
  rejectKyc(now: Date): VendorProfile {
    return this.transition('REJECT_KYC', now);
  }

  /** Goes live. Only ever the step after KYC approval — a suspended vendor comes back via `reinstate()`. */
  activate(now: Date): VendorProfile {
    return this.transition('ACTIVATE', now);
  }

  /** Taken offline for risk, performance or expiry (SDD 15.1). Only an active vendor can be suspended. */
  suspend(now: Date): VendorProfile {
    return this.transition('SUSPEND', now);
  }

  /** Returns a suspended vendor to service. Lands straight on `ACTIVE`: they already cleared KYC. */
  reinstate(now: Date): VendorProfile {
    return this.transition('REINSTATE', now);
  }

  /**
   * Sets or changes the customer-safe shop display name (S3-3A, decision
   * D-S3-03). Not a lifecycle transition — `shopName` is a mutable display
   * attribute, not a state the SDD 15.1 diagram draws an edge for — so this
   * does not go through `transition()` and carries no `from`/`to` guard.
   * Callable from any status: a vendor may set their shop name before,
   * during or after KYC, and nothing about this milestone's approved scope
   * ties it to a particular stage of onboarding.
   */
  updateShopName(shopName: string, now: Date): VendorProfile {
    return new VendorProfile({ ...this.props, shopName, updatedAt: now });
  }

  /**
   * Sets or changes whether this vendor offers pickup (S4-QR). Same shape as
   * `updateShopName` — a mutable capability flag, not a lifecycle state, so
   * it does not go through `transition()` and is callable from any status.
   */
  updatePickupCapability(supportsPickup: boolean, now: Date): VendorProfile {
    return new VendorProfile({ ...this.props, supportsPickup, updatedAt: now });
  }
}
