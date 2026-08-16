export type PaymentAttemptStatusName = 'INITIATED' | 'SUCCEEDED' | 'FAILED';

/**
 * A payment attempt's lifecycle (S3-3B). Deliberately three states, not the
 * SDD 10.4 gateway lifecycle (`CREATED/PENDING/AUTHORIZED/CAPTURED/SETTLED`
 * plus refund states) — that full lifecycle exists to model a real
 * asynchronous gateway with webhooks, partial capture and settlement, none
 * of which S3-3B builds. `INITIATED` covers everything up to a decision;
 * `SUCCEEDED`/`FAILED` is that decision, returned synchronously by the mock
 * gateway. Only *which* state this is; the allowed transitions belong to
 * `PaymentAttempt`, the same split every other status value object in this
 * codebase already keeps.
 */
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
      throw new TypeError(`Not a valid payment attempt status: "${name}"`);
    }
    return status;
  }

  equals(other: PaymentAttemptStatus): boolean {
    return this.name === other.name;
  }
}
