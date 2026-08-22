export type ReservationStatusName =
  | 'PENDING'
  | 'CONFIRMED'
  | 'EXPIRED'
  | 'PAYMENT_FAILED'
  | 'CANCELLED';

/**
 * Not given a formal enum by the SDD — only the §14.3 narrative flow is
 * specified. This is the discovery report's own approved, narrative-grounded
 * inference ("Phase Next", the one explicit architectural note), kept
 * deliberately isolated to this module so it can change later without
 * touching anything outside `preorder`.
 */
export class ReservationStatus {
  private constructor(public readonly name: ReservationStatusName) {}

  static readonly PENDING = new ReservationStatus('PENDING');
  static readonly CONFIRMED = new ReservationStatus('CONFIRMED');
  static readonly EXPIRED = new ReservationStatus('EXPIRED');
  static readonly PAYMENT_FAILED = new ReservationStatus('PAYMENT_FAILED');
  static readonly CANCELLED = new ReservationStatus('CANCELLED');

  private static readonly BY_NAME: Readonly<Record<ReservationStatusName, ReservationStatus>> = {
    PENDING: ReservationStatus.PENDING,
    CONFIRMED: ReservationStatus.CONFIRMED,
    EXPIRED: ReservationStatus.EXPIRED,
    PAYMENT_FAILED: ReservationStatus.PAYMENT_FAILED,
    CANCELLED: ReservationStatus.CANCELLED,
  };

  static fromName(name: string): ReservationStatus {
    const status = (ReservationStatus.BY_NAME as Record<string, ReservationStatus | undefined>)[
      name
    ];
    if (!status) {
      throw new TypeError(`Not a valid preorder reservation status: "${name}"`);
    }
    return status;
  }

  equals(other: ReservationStatus): boolean {
    return this.name === other.name;
  }
}
