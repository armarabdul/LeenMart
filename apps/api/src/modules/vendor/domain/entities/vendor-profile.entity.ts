import type { UserId, VendorId } from '../../../identity/index.js';
import {
  VendorStatus,
  type VendorStatusName,
} from '../value-objects/vendor-status.value-object.js';
import { InvalidVendorStatusTransitionError } from '../errors/vendor-errors.js';

export interface VendorProfileProps {
  readonly id: VendorId;
  readonly userId: UserId;
  readonly status: VendorStatus;
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

  /** Entry point of SDD 15.1's lifecycle: a new vendor always starts REGISTERED. */
  static register(props: { id: VendorId; userId: UserId; now: Date }): VendorProfile {
    return new VendorProfile({
      id: props.id,
      userId: props.userId,
      status: VendorStatus.REGISTERED,
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
}
