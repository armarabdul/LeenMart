/**
 * Additional authenticated data bound into a wrapped key.
 *
 * Left as an open `Record` on purpose. SDD 12.3 wraps the data key against the
 * object it protects, but the entities that name that object (`VendorKyc`,
 * `KycDocument`) do not exist yet — so this chunk defines the channel and
 * lets KYC-1/KYC-2 decide what travels through it, rather than hard-coding a
 * document id that has nothing to refer to.
 *
 * Whatever is supplied at `generateDataKey` must be supplied identically at
 * `unwrap`, or unwrapping fails. That is the point: a wrapped key lifted from
 * one row cannot decrypt another object.
 */
export type EncryptionContext = Readonly<Record<string, string>>;

export interface GeneratedDataKey {
  /**
   * The raw AES-256 key.
   *
   * **Never persist this and never log it.** It leaves the process exactly
   * twice — to the uploading client in the upload-intent response, and to the
   * reviewing client in the document-access response (SDD 12.3) — and is
   * `shred()`-ed as soon as the request that produced it is done with it.
   */
  readonly plaintext: Buffer;
  /** The wrapped form. This is what `kyc_documents` will store beside the object reference (SDD 12.3). */
  readonly wrapped: Buffer;
}

/**
 * Envelope-encryption key management for KYC documents (SDD 12.1/12.3:
 * "Envelope encryption, application-side, KMS-managed key" / "the data key is
 * wrapped by a KMS CMK and stored beside the object reference").
 *
 * This port mints and unwraps **keys**. It never sees a document: SDD 12.3
 * puts encryption client-side and SDD 12.2 keeps files out of the API tier, so
 * the bytes this key protects are encrypted in the browser and uploaded
 * straight to object storage.
 *
 * One data key per object, so compromise of a single wrapped key reaches a
 * single document, and so a document can be made permanently unreadable by
 * destroying its own key rather than rotating a key shared by everything.
 */
export interface DataKeyCipher {
  generateDataKey(context?: EncryptionContext): Promise<GeneratedDataKey>;

  /** Rejects if the wrapped key is corrupt, was wrapped by a different key, or the context does not match. */
  unwrap(wrapped: Buffer, context?: EncryptionContext): Promise<Buffer>;

  /**
   * Zero-fills a plaintext data key so it stops sitting in process memory once
   * the request that needed it is finished.
   *
   * Deliberately narrow, and worth being precise about: this is **not** SDD
   * 12.3's "shreds the data key" at deletion time. That means destroying the
   * *wrapped* key persisted beside the object, which no cipher can do — the
   * row holding it is the only copy, so its deletion is the shredding, and it
   * belongs to the erasure job (KYC-2 and later). A CMK is never destroyed for
   * one document; it protects every other one too.
   */
  shred(plaintext: Buffer): void;
}
