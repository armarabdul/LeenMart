export type CampaignFulfilmentModeName = 'DELIVERY' | 'PICKUP' | 'BOTH';

/**
 * SDD §14.1: "fulfilment_mode (pickup / delivery / both)" — a *campaign's*
 * declared mode, distinct from the order module's own `FulfilmentMode`
 * (`DELIVERY`/`PICKUP` only), which is a `SubOrder`'s single chosen mode.
 * When a campaign declares `BOTH`, the customer's actual choice is captured
 * on the `PreorderReservation` itself at creation time (`allows()` below is
 * what `CreateReservationUseCase` validates it against) — the same moment
 * `PlaceOrderUseCase` captures `pickupVendorIds` for an ordinary order,
 * never inferred later. `ConvertReservationToOrderUseCase` reads that
 * captured choice straight off the reservation; `BOTH` itself never reaches
 * a `SubOrder`.
 */
export class CampaignFulfilmentMode {
  private constructor(public readonly name: CampaignFulfilmentModeName) {}

  static readonly DELIVERY = new CampaignFulfilmentMode('DELIVERY');
  static readonly PICKUP = new CampaignFulfilmentMode('PICKUP');
  static readonly BOTH = new CampaignFulfilmentMode('BOTH');

  private static readonly BY_NAME: Readonly<
    Record<CampaignFulfilmentModeName, CampaignFulfilmentMode>
  > = {
    DELIVERY: CampaignFulfilmentMode.DELIVERY,
    PICKUP: CampaignFulfilmentMode.PICKUP,
    BOTH: CampaignFulfilmentMode.BOTH,
  };

  static fromName(name: string): CampaignFulfilmentMode {
    const mode = (
      CampaignFulfilmentMode.BY_NAME as Record<string, CampaignFulfilmentMode | undefined>
    )[name];
    if (!mode) {
      throw new TypeError(`Not a valid preorder campaign fulfilment mode: "${name}"`);
    }
    return mode;
  }

  /** Whether `candidate` (a real `SubOrder`-level mode) is permitted by this campaign's declared mode. */
  allows(candidate: 'DELIVERY' | 'PICKUP'): boolean {
    return this.name === 'BOTH' || this.name === candidate;
  }

  equals(other: CampaignFulfilmentMode): boolean {
    return this.name === other.name;
  }
}
