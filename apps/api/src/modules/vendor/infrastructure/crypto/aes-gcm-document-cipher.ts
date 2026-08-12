import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { IntegrationError } from '@leen-mart/domain-kit';
import {
  encodeDocumentEncryptionContext,
  type DocumentCipher,
  type DocumentEncryptionContext,
} from '../../application/ports/document-cipher.port.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * AES-256-GCM over document bytes — the KYC-7 file-encryption contract this
 * commit defines. Framing: `IV(12) || AUTH_TAG(16) || CIPHERTEXT`, the same
 * layout `DevDataKeyCipher` and `AesGcmMfaSecretCipher` already use for their
 * own AES-256-GCM payloads, applied here to a document's bytes rather than a
 * key or a TOTP secret.
 *
 * Node's built-in `node:crypto` only — no new dependency, matching both of
 * those adapters. Synchronous, unlike `DataKeyCipher`: there is no network
 * call here to make asynchronous, and `IdentifierFingerprinter` (this
 * module's other local-computation port) is synchronous for the same reason.
 */
export class AesGcmDocumentCipher implements DocumentCipher {
  encrypt(plaintext: Buffer, key: Buffer, context: DocumentEncryptionContext): Buffer {
    requireKeyLength(key);

    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(encodeDocumentEncryptionContext(context));
    const sealed = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    return Buffer.concat([iv, cipher.getAuthTag(), sealed]);
  }

  decrypt(ciphertext: Buffer, key: Buffer, context: DocumentEncryptionContext): Buffer {
    requireKeyLength(key);

    if (ciphertext.length < IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
      throw new IntegrationError('document-cipher', 'Could not decrypt this document.', {
        cause: new TypeError('Ciphertext is too short to contain an IV and an authentication tag.'),
      });
    }

    const iv = ciphertext.subarray(0, IV_LENGTH_BYTES);
    const authTag = ciphertext.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
    const sealed = ciphertext.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAAD(encodeDocumentEncryptionContext(context));
      decipher.setAuthTag(authTag);
      // `update` + `final` both run before either half of the plaintext is
      // handed back — GCM's `final()` is where tag verification actually
      // happens, and it throws before this `return` is ever reached, so a
      // caller can never observe bytes that failed authentication.
      return Buffer.concat([decipher.update(sealed), decipher.final()]);
    } catch (error) {
      throw new IntegrationError('document-cipher', 'Could not decrypt this document.', {
        cause: error,
      });
    }
  }
}

const requireKeyLength = (key: Buffer): void => {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new RangeError(`A document data key must be exactly ${KEY_LENGTH_BYTES} bytes.`);
  }
};
