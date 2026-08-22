import type { TransactionScope } from '@leen-mart/domain-kit';
import type { UserId, VendorId } from '../../../identity/index.js';
import type { PreorderReservation } from '../entities/preorder-reservation.entity.js';
import type { CampaignId } from '../value-objects/campaign-id.value-object.js';
import type { ReservationId } from '../value-objects/reservation-id.value-object.js';
import type { ReservationStatusName } from '../value-objects/reservation-status.value-object.js';

export interface ReservationListPage {
  readonly items: readonly PreorderReservation[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface ReservationRepository {
  withTransaction(scope: TransactionScope): ReservationRepository;

  create(reservation: PreorderReservation): Promise<void>;

  /**
   * Unscoped — for system/scheduler callers only
   * (`ConvertReservationToOrderUseCase`/`SweepCampaignLifecycleUseCase`'s
   * own fulfilment-processing step), which have no customer or vendor
   * context to scope by in the first place. Never call this from a
   * customer- or vendor-facing handler — `findByIdAndCustomerId`/
   * `findByIdAndVendorId` below exist exactly to keep those paths IDOR-safe;
   * this mirrors `CampaignRepository.findById`'s own identical exception.
   */
  findById(id: ReservationId): Promise<PreorderReservation | null>;

  /** Ownership-scoped — never a bare `id` lookup (IDOR protection). */
  findByIdAndCustomerId(id: ReservationId, customerId: UserId): Promise<PreorderReservation | null>;
  findByIdAndVendorId(id: ReservationId, vendorId: VendorId): Promise<PreorderReservation | null>;

  listByCustomerId(input: {
    customerId: UserId;
    limit: number;
    cursor?: string | undefined;
  }): Promise<ReservationListPage>;

  listByCampaignId(input: {
    campaignId: CampaignId;
    limit: number;
    cursor?: string | undefined;
  }): Promise<ReservationListPage>;

  /** `max_per_customer` enforcement — sum of quantity across this customer's still-active (`PENDING`/`CONFIRMED`) reservations on this campaign. */
  sumActiveQuantityForCustomer(campaignId: CampaignId, customerId: UserId): Promise<number>;

  /**
   * Conditional transition, guarded on the caller's expected current status
   * — `WHERE id=:id AND status=:expectedStatus`. Returns `false` on a lost
   * race (the exact "expiry racing with confirmation" protection): the
   * expiry sweep and a customer's confirm request can never both succeed
   * against the same row.
   */
  updateIfStatus(
    reservation: PreorderReservation,
    expectedStatus: ReservationStatusName,
  ): Promise<boolean>;

  /** Plain persistence for fields the conditional guard above doesn't cover (e.g. recording a converted order id after conversion already succeeded). */
  update(reservation: PreorderReservation): Promise<void>;

  /** The expiry sweep's own query shape — `PENDING` rows past `expiresAt`, oldest first, bounded. */
  listExpiredPending(asOf: Date, limit: number): Promise<readonly PreorderReservation[]>;

  /** The vendor demand-summary read-model's aggregate shape (mirrors `VendorEarningsQueryPort.getSummary`). */
  summarizeByCampaign(campaignId: CampaignId): Promise<{
    readonly reservationCount: number;
    readonly confirmedCount: number;
    readonly totalUnitsCommitted: number;
  }>;
}
