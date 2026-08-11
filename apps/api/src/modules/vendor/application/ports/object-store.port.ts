/**
 * A presigned upload, plus the constraints the URL itself enforces.
 *
 * The constraints are echoed back so a caller can show them to a client, not
 * so a caller can choose them — they are baked into the signature and a client
 * that violates them is rejected by the store, not by us.
 */
export interface PresignedUpload {
  readonly url: string;
  readonly expiresAt: Date;
  /** The exact `Content-Type` the client must send. Any other value fails the signature. */
  readonly contentType: string;
  /** The exact `Content-Length` the client must send. */
  readonly contentLength: number;
}

export interface PresignedDownload {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface StoredObject {
  readonly sizeBytes: number;
  readonly contentType: string;
}

export interface PresignPutInput {
  readonly key: string;
  readonly contentType: string;
  readonly contentLength: number;
}

/**
 * Object storage for content that must never pass through the API tier
 * (SDD 12.2: "Files **never stream through the API tier**").
 *
 * Deliberately **not** a general file API: there is no `put`, no `get`, and no
 * stream anywhere on this interface, because offering one would make it
 * possible to violate SDD 12.2 by accident. Bytes move directly between the
 * client and the store; the application only ever mints time-limited,
 * condition-bound URLs and inspects metadata.
 *
 * It also performs **no encryption**. KYC objects are encrypted client-side
 * before upload (SDD 12.3), so as far as this port is concerned every payload
 * is opaque ciphertext. Key handling lives behind `DataKeyCipher`.
 *
 * Note what is *absent* from `presignGet`: a TTL parameter. SDD 12.1 caps a
 * KYC download URL at 60 seconds, and a cap a caller can pass is a cap a
 * caller can raise. The lifetime is the implementation's to decide, so the
 * limit cannot be argued with from a use case.
 */
export interface ObjectStore {
  /**
   * Mints an upload URL bound to exactly one content type and one byte length.
   *
   * Rejects anything outside the configured allowlist or size cap rather than
   * signing it — a URL is a capability, and one that permits a 2 GB upload of
   * an arbitrary type is that capability regardless of what the caller
   * intended (SDD 12.2: "declared type in allowlist, size ≤ cap").
   */
  presignPut(input: PresignPutInput): Promise<PresignedUpload>;

  /** Mints a short-lived download URL. The lifetime is fixed by the implementation (SDD 12.1). */
  presignGet(key: string): Promise<PresignedDownload>;

  /** Metadata only — never content. `null` when the object does not exist. */
  head(key: string): Promise<StoredObject | null>;

  /** Idempotent: deleting an absent object is not an error. */
  delete(key: string): Promise<void>;
}
