/**
 * Encrypts an MFA secret for storage in `mfa_secrets.encrypted_secret`
 * (Milestone 3 Step 5B) and decrypts it back for verification. Mirrors
 * `OtpHasher`'s shape — opaque strings in and out — except this is
 * encryption, not hashing: an MFA secret must be recovered in full to check
 * a submitted TOTP code, so it cannot be a one-way hash.
 */
export interface MfaSecretCipher {
  /** Never call with anything but a freshly generated or freshly decrypted secret. */
  encrypt(plaintext: string): string;
  /** Throws if the ciphertext was tampered with or the key does not match. */
  decrypt(ciphertext: string): string;
}
