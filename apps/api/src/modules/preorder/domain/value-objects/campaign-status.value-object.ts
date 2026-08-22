export type CampaignStatusName =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'OPEN'
  | 'SOLD_OUT'
  | 'CLOSED'
  | 'CANCELLED'
  | 'FULFILLING'
  | 'COMPLETED'
  | 'PARTIALLY_FULFILLED';

/**
 * SDD §14.2's exact lifecycle, transcribed verbatim — no invented states.
 * Only *which* state this is; the allowed transitions belong to
 * `PreorderCampaign` itself, the same split `OrderStatus`/`SubOrder`
 * establish.
 */
export class CampaignStatus {
  private constructor(public readonly name: CampaignStatusName) {}

  static readonly DRAFT = new CampaignStatus('DRAFT');
  static readonly SCHEDULED = new CampaignStatus('SCHEDULED');
  static readonly OPEN = new CampaignStatus('OPEN');
  static readonly SOLD_OUT = new CampaignStatus('SOLD_OUT');
  static readonly CLOSED = new CampaignStatus('CLOSED');
  static readonly CANCELLED = new CampaignStatus('CANCELLED');
  static readonly FULFILLING = new CampaignStatus('FULFILLING');
  static readonly COMPLETED = new CampaignStatus('COMPLETED');
  static readonly PARTIALLY_FULFILLED = new CampaignStatus('PARTIALLY_FULFILLED');

  private static readonly BY_NAME: Readonly<Record<CampaignStatusName, CampaignStatus>> = {
    DRAFT: CampaignStatus.DRAFT,
    SCHEDULED: CampaignStatus.SCHEDULED,
    OPEN: CampaignStatus.OPEN,
    SOLD_OUT: CampaignStatus.SOLD_OUT,
    CLOSED: CampaignStatus.CLOSED,
    CANCELLED: CampaignStatus.CANCELLED,
    FULFILLING: CampaignStatus.FULFILLING,
    COMPLETED: CampaignStatus.COMPLETED,
    PARTIALLY_FULFILLED: CampaignStatus.PARTIALLY_FULFILLED,
  };

  static fromName(name: string): CampaignStatus {
    const status = (CampaignStatus.BY_NAME as Record<string, CampaignStatus | undefined>)[name];
    if (!status) {
      throw new TypeError(`Not a valid preorder campaign status: "${name}"`);
    }
    return status;
  }

  equals(other: CampaignStatus): boolean {
    return this.name === other.name;
  }
}
