import { randomInt } from 'node:crypto';
import type { PickupCodeGenerator } from '../../application/ports/pickup-code-generator.port.js';

const UPPER_BOUND = 10_000; // 10^4 — exclusive upper bound for randomInt
const CODE_LENGTH = 4;

/** Mirrors `CryptoOtpGenerator` exactly — `randomInt`'s rejection sampling, not modulo, is what keeps this uniform across [0, 9999]. */
export class CryptoPickupCodeGenerator implements PickupCodeGenerator {
  generate(): string {
    return randomInt(0, UPPER_BOUND).toString().padStart(CODE_LENGTH, '0');
  }
}
