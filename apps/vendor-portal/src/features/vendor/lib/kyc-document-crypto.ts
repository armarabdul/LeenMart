/**
 * Client-side envelope encryption for a KYC document (SDD 12.3, Phase J).
 *
 * The server's own cipher (`apps/api/.../infrastructure/crypto/aes-gcm-document-cipher.ts`)
 * is the sole source of truth for this format — nothing here is invented:
 *
 *   - AES-256-GCM, a 12-byte random IV per document, a 16-byte auth tag.
 *   - The object PUT to storage is framed `IV(12) || TAG(16) || CIPHERTEXT`
 *     — the tag comes *before* the ciphertext, which is the opposite of what
 *     `SubtleCrypto.encrypt('AES-GCM', ...)` returns (`CIPHERTEXT || TAG`),
 *     so the browser's output must be split and reassembled before upload.
 *   - The additional authenticated data is the pipe-delimited UTF-8 string
 *     `vendorId=<uuid>|kycId=<uuid>|documentType=<TYPE>`. A mismatch on any
 *     one of the three fails the server's decrypt closed rather than open.
 *   - `sizeBytes` sent to the API (both the upload-intent request and the
 *     submission request) is the *ciphertext* length — `plaintext.length + 28`
 *     — never the original file size, since GCM adds no padding.
 */

const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
export const KYC_ENCRYPTION_OVERHEAD_BYTES = IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES;

/** The exact byte length the server will see for a plaintext of this size. */
export const ciphertextSizeBytes = (plaintextSizeBytes: number): number =>
  plaintextSizeBytes + KYC_ENCRYPTION_OVERHEAD_BYTES;

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

/**
 * Builds the exact AAD string `AesGcmDocumentCipher.decrypt()` expects for
 * one document, so encryption here and decryption there are bound to the
 * same `{vendorId, kycId, documentType}` triple.
 */
export const encodeKycDocumentContext = (context: {
  readonly vendorId: string;
  readonly kycId: string;
  readonly documentType: string;
}): string =>
  `vendorId=${context.vendorId}|kycId=${context.kycId}|documentType=${context.documentType}`;

/**
 * Encrypts one file with its own per-document `dataKey` (the plaintext
 * AES-256 key minted by `POST /vendors/me/kyc/documents`, base64-encoded) and
 * returns the exact bytes to `PUT` to the presigned `uploadUrl` —
 * `IV || TAG || CIPHERTEXT`, framed as the server's cipher requires.
 */
export const encryptKycDocument = async (
  file: File,
  dataKeyBase64: string,
  context: { readonly vendorId: string; readonly kycId: string; readonly documentType: string },
): Promise<Uint8Array> => {
  const keyBytes = base64ToBytes(dataKeyBase64);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const additionalData = new TextEncoder().encode(encodeKycDocumentContext(context));

  // SubtleCrypto returns `ciphertext || tag` (tag last, 16 bytes, 128-bit
  // default tagLength) — the reverse of the server's expected framing.
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData, tagLength: AUTH_TAG_LENGTH_BYTES * 8 },
      key,
      plaintext,
    ),
  );
  const tag = sealed.slice(sealed.length - AUTH_TAG_LENGTH_BYTES);
  const ciphertext = sealed.slice(0, sealed.length - AUTH_TAG_LENGTH_BYTES);

  const framed = new Uint8Array(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES + ciphertext.length);
  framed.set(iv, 0);
  framed.set(tag, IV_LENGTH_BYTES);
  framed.set(ciphertext, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  return framed;
};
