export type PaymentAttemptStatusName = 'INITIATED' | 'SUCCEEDED' | 'FAILED';

/** Mirrors the order module's own `PaymentAttemptStatus` exactly — kept as its own type since a reservation's payment attempt is a different entity entirely. */
export class PaymentAttemptStatus {
  private constructor(public readonly name: PaymentAttemptStatusName) {}

  static readonly INITIATED = new PaymentAttemptStatus('INITIATED');
  static readonly SUCCEEDED = new PaymentAttemptStatus('SUCCEEDED');
  static readonly FAILED = new PaymentAttemptStatus('FAILED');

  private static readonly BY_NAME: Readonly<
    Record<PaymentAttemptStatusName, PaymentAttemptStatus>
  > = {
    INITIATED: PaymentAttemptStatus.INITIATED,
    SUCCEEDED: PaymentAttemptStatus.SUCCEEDED,
    FAILED: PaymentAttemptStatus.FAILED,
  };

  static fromName(name: string): PaymentAttemptStatus {
    const status = (
      PaymentAttemptStatus.BY_NAME as Record<string, PaymentAttemptStatus | undefined>
    )[name];
    if (!status) {
      throw new TypeError(`Not a valid preorder payment attempt status: "${name}"`);
    }
    return status;
  }

  equals(other: PaymentAttemptStatus): boolean {
    return this.name === other.name;
  }
}
