export type FulfilmentModeName = 'DELIVERY' | 'PICKUP';

/**
 * Which of the two independent fulfilment paths a `SubOrder` follows
 * (S4-QR, SDD §13). Lives on `SubOrder`, not `Order`: fulfilment is already
 * "a genuinely per-vendor fact" in this codebase (see `SubOrder`'s own doc
 * comment, SDD 6.3's "N independent fulfilment lifecycles") — `SHIPPED`/
 * `DELIVERED` already exist only on `SubOrder`, and mode is the same
 * category of fact one step earlier. A multi-vendor order may freely mix
 * `DELIVERY` and `PICKUP` sub-orders; nothing enforces a single mode across
 * one `Order` (locked decision: do not invent a same-mode-for-all-vendors
 * rule).
 *
 * A plain value object, not a rich state machine like `OrderStatus` — mode
 * is chosen once at checkout and never changes afterward, so there is
 * nothing to transition.
 */
export class FulfilmentMode {
  private constructor(public readonly name: FulfilmentModeName) {}

  static readonly DELIVERY = new FulfilmentMode('DELIVERY');
  static readonly PICKUP = new FulfilmentMode('PICKUP');

  private static readonly BY_NAME: Readonly<Record<FulfilmentModeName, FulfilmentMode>> = {
    DELIVERY: FulfilmentMode.DELIVERY,
    PICKUP: FulfilmentMode.PICKUP,
  };

  static fromName(name: string): FulfilmentMode {
    const mode = (FulfilmentMode.BY_NAME as Record<string, FulfilmentMode | undefined>)[name];
    if (!mode) {
      throw new TypeError(`Not a valid fulfilment mode: "${name}"`);
    }
    return mode;
  }

  equals(other: FulfilmentMode): boolean {
    return this.name === other.name;
  }
}
