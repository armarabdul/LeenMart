import type { TransactionScope } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';
import type { PreorderCampaign } from '../entities/preorder-campaign.entity.js';
import type { CampaignId } from '../value-objects/campaign-id.value-object.js';
import type { CampaignStatusName } from '../value-objects/campaign-status.value-object.js';

export interface CampaignListPage {
  readonly items: readonly PreorderCampaign[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface CampaignRepository {
  withTransaction(scope: TransactionScope): CampaignRepository;

  create(campaign: PreorderCampaign): Promise<void>;

  findById(id: CampaignId): Promise<PreorderCampaign | null>;
  /** Ownership-scoped — never a bare `id` lookup (mirrors `CartItemRepository`'s own rule). */
  findByIdAndVendorId(id: CampaignId, vendorId: VendorId): Promise<PreorderCampaign | null>;

  listByVendorId(input: {
    vendorId: VendorId;
    limit: number;
    cursor?: string | undefined;
  }): Promise<CampaignListPage>;

  /** Public browse — every non-`DRAFT` campaign, `leenmart_public`-bound. */
  listPublic(input: { limit: number; cursor?: string | undefined }): Promise<CampaignListPage>;
  findPublicById(id: CampaignId): Promise<PreorderCampaign | null>;

  /**
   * Plain persistence of every field except `remainingQuantity` transitions
   * that need the atomic conditional guard below — an ordinary vendor edit
   * (dates, `advancePercent`, etc.) or a status transition goes through
   * this, mirroring `ActivateVendorUseCase`'s own unconditional-write
   * pattern for non-hot-row fields.
   */
  update(campaign: PreorderCampaign): Promise<void>;

  /**
   * The SDD §14.4 layer-2 correctness path: one atomic conditional `UPDATE`
   * (`WHERE status='OPEN' AND remaining_quantity >= :qty`), never a
   * read-then-write. Returns `false` when the row didn't match (campaign
   * not `OPEN`, or insufficient remaining quantity) — the caller decides
   * what that means, never a silent partial success.
   */
  decrementRemainingIfAvailable(id: CampaignId, quantity: number): Promise<boolean>;

  /** The compensating release on expiry/failure/cancel — a plain, unconditional increment (each release returns exactly what its own reservation validly held). */
  incrementRemaining(id: CampaignId, quantity: number): Promise<void>;

  /** The scheduler sweeps' own query shape. */
  listByStatusDue(
    status: CampaignStatusName,
    field: 'opensAt' | 'orderCutoffAt' | 'fulfilmentWindowStart',
    asOf: Date,
    limit: number,
  ): Promise<readonly PreorderCampaign[]>;

  /** `DRAFT -> SCHEDULED`'s own unconditional query shape — see `PreorderCampaign.schedule()`'s own doc comment for why there is no "due" field to filter by. */
  listDraft(limit: number): Promise<readonly PreorderCampaign[]>;

  /** `OPEN -> SOLD_OUT`'s own query shape: every still-`OPEN` campaign whose `remainingQuantity` has already reached zero. */
  listSoldOutCandidates(limit: number): Promise<readonly PreorderCampaign[]>;

  /**
   * The reconciliation sweep's own query shape (SDD §14.4 layer 3): every
   * currently-`OPEN` campaign, up to `limit`. Not paginated across ticks —
   * a deliberate, documented scale boundary (`ReconcileRedisQuantityUseCase`'s
   * own doc comment) rather than a real cursor, matching this milestone's
   * "smallest isolated implementation" principle.
   */
  listOpen(limit: number): Promise<readonly PreorderCampaign[]>;
}
