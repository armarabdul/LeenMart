import type { VendorId } from '../../../identity/index.js';
import type { KycId } from '../../domain/value-objects/kyc-id.value-object.js';

/**
 * The document-level encryption context: the same three facts
 * `DataKeyCipher`'s key-wrapping AAD is already bound to (`vendorId`,
 * `kycId`, `documentType`), applied a second time to the file bytes
 * themselves.
 *
 * A closed, three-field shape rather than `DataKeyCipher`'s open
 * `EncryptionContext` record on purpose: that one is a `Record<string,
 * string>` because it was defined before the entities it names existed (see
 * its own comment); this one is defined *for* `DocumentCipher`, on a fixed,
 * already-known field set, so there is nothing open-ended left to express.
 */
export interface DocumentEncryptionContext {
  readonly vendorId: VendorId;
  readonly kycId: KycId;
  readonly documentType: string;
}

/**
 * Field separator for the canonical encoding below. A pipe, not `&` or `=`:
 * those two already appear inside every `name=value` pair, so using either
 * as the separator too would make the encoding ambiguous. A pipe cannot
 * appear in a UUID (`vendorId`/`kycId`) or in the closed three-member
 * `KycDocumentType` enum (`documentType`), so it introduces no such
 * ambiguity here.
 */
const FIELD_SEPARATOR = '|';

/**
 * The one canonical byte representation of a `DocumentEncryptionContext`,
 * used as AEAD additional authenticated data by both `encrypt` and
 * `decrypt` — the same function, not two implementations kept in sync by
 * hand, which is what makes "the wrong context fails to decrypt" a property
 * of the algorithm rather than of remembering to call two things identically.
 *
 * Deliberately not `JSON.stringify`: object-key order is not part of any
 * spec for a plain object literal in JavaScript, so two structurally
 * identical contexts could in principle serialise differently across engines
 * or a future refactor that changes field declaration order — and an AAD
 * that isn't reproduced byte-for-byte fails authentication regardless of
 * whether the *meaning* matched. Fixed field order and an explicit
 * `name=value` shape sidestep that entirely: order is chosen once, here, and
 * never contributed by the object literal.
 */
export const encodeDocumentEncryptionContext = (context: DocumentEncryptionContext): Buffer =>
  Buffer.from(
    [
      `vendorId=${context.vendorId}`,
      `kycId=${context.kycId}`,
      `documentType=${context.documentType}`,
    ].join(FIELD_SEPARATOR),
    'utf8',
  );

/**
 * Encrypts and decrypts KYC document *bytes* (SDD 12.3's "client-side
 * envelope encryption," reproduced server-side for KYC-7 document access).
 *
 * **Newly defined by this commit — not a pre-existing capability.** No prior
 * code in this repository encrypted or decrypted a document's contents:
 * `DataKeyCipher` wraps and unwraps the 256-bit key that protects a
 * document, and has never seen the document itself (see that port's own
 * comment). This port is `DataKeyCipher`'s natural companion, not a
 * replacement or an extension of it — the key comes from
 * `DataKeyCipher.unwrap()`, already plaintext, before it ever reaches here.
 *
 * Framing is fixed by this port, not negotiable per call: `IV(12 bytes) ||
 * AUTH_TAG(16 bytes) || CIPHERTEXT`. The same layout `DevDataKeyCipher` and
 * `AesGcmMfaSecretCipher` already use for their own AES-256-GCM payloads —
 * extended here to a third kind of secret, not invented fresh.
 */
export interface DocumentCipher {
  /** Encrypts `plaintext` under `key` (a document's *unwrapped* data key), bound to `context`. */
  encrypt(plaintext: Buffer, key: Buffer, context: DocumentEncryptionContext): Buffer;

  /**
   * Reverses `encrypt`. Fails closed — never returns partial or
   * unauthenticated plaintext — when the input is too short to contain an
   * IV and a tag, the tag does not authenticate the ciphertext, or `context`
   * does not reproduce what encryption was given.
   */
  decrypt(ciphertext: Buffer, key: Buffer, context: DocumentEncryptionContext): Buffer;
}
