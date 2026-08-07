import { randomUUID } from 'node:crypto';
import type { Uuid } from '../primitives/branded.js';

/**
 * Identifier generation as a port (SDD 6.1 / ADR-005).
 *
 * UUID v7 rather than v4: v7 is time-ordered, so B-tree index inserts stay
 * roughly sequential instead of scattering writes across the index, which is
 * what causes fragmentation and write amplification on high-insert tables.
 */
export interface IdGenerator {
  generate(): Uuid;
}

/**
 * Minimal UUID v7 generator (RFC 9562): 48-bit big-endian timestamp, 4-bit
 * version, 12 bits of randomness, 2-bit variant, 62 bits of randomness.
 *
 * Implemented here rather than pulled from a dependency so the id format is a
 * documented, testable property of the platform.
 */
export class UuidV7Generator implements IdGenerator {
  generate(): Uuid {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);

    const timestamp = BigInt(Date.now());
    bytes[0] = Number((timestamp >> 40n) & 0xffn);
    bytes[1] = Number((timestamp >> 32n) & 0xffn);
    bytes[2] = Number((timestamp >> 24n) & 0xffn);
    bytes[3] = Number((timestamp >> 16n) & 0xffn);
    bytes[4] = Number((timestamp >> 8n) & 0xffn);
    bytes[5] = Number(timestamp & 0xffn);

    // Version 7
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
    // Variant 10xx (RFC 4122)
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-') as Uuid;
  }
}

/** Random v4 ids, for tests and non-persisted correlation values. */
export class UuidV4Generator implements IdGenerator {
  generate(): Uuid {
    return randomUUID() as Uuid;
  }
}
