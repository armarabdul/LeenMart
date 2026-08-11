import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { MfaSecretCipher } from '../../domain/services/mfa-secret-cipher.service.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * AES-256-GCM, application-side — not the KMS-managed envelope encryption
 * SDD 12.1/12.3 requires for KYC documents; no KMS exists in this codebase,
 * and mfa_secrets isn't in that requirement's scope. The key comes from
 * `MFA_ENCRYPTION_KEY`, following the exact env-var convention already
 * established for `JWT_ACCESS_SECRET` (insecure dev default, refused in
 * production).
 *
 * `mfa_secrets.encrypted_secret` (Milestone 3 Step 5B) is a single opaque
 * string column, so `iv || authTag || ciphertext` is packed into one base64
 * blob rather than three columns.
 */
export class AesGcmMfaSecretCipher implements MfaSecretCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new RangeError(`MFA encryption key must be exactly ${KEY_LENGTH_BYTES} bytes.`);
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(ciphertext: string): string {
    const blob = Buffer.from(ciphertext, 'base64');
    const iv = blob.subarray(0, IV_LENGTH_BYTES);
    const authTag = blob.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
    const encrypted = blob.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
