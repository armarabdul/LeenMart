import type { Brand } from '@leen-mart/domain-kit';

/**
 * A one-way fingerprint of a sensitive identifier, used for SEC-17 duplicate
 * detection ("Link identities on PAN/bank account/device fingerprint/address;
 * block at KYC").
 *
 * Branded rather than a bare `string` so a plaintext PAN cannot be passed
 * where a fingerprint is expected — the two are both strings, and the
 * compiler is the only thing that reliably tells them apart at every call
 * site.
 *
 * A plain digest would not be enough here and the distinction matters: a PAN
 * has a fixed ten-character shape and roughly 10^12 possibilities, so an
 * unkeyed SHA-256 of every PAN is enumerable offline by anyone holding the
 * table. The computation is therefore keyed, and lives behind
 * `IdentifierFingerprinter` because the key is a secret the domain must not
 * hold.
 */
export type SensitiveFingerprint = Brand<string, 'SensitiveFingerprint'>;
