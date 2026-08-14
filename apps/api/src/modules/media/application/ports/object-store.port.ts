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

/** One temporary object this store wrote on the caller's behalf. */
export interface TemporaryObject {
  /**
   * Server-generated and unpredictable — never derived from `vendorId`,
   * `kycId` or `documentType`, and never accepted from a caller. A caller
   * that could name this key could point it at the permanent KYC object.
   */
  readonly key: string;
}

/**
 * Object storage for content that must never pass through the API tier
 * (SDD 12.2: "Files **never stream through the API tier**").
 *
 * Was **not** a general file API through KYC-6: no `put`, no `get`, no
 * stream, because offering one made it possible to violate SDD 12.2 by
 * accident — bytes moved directly between the client and the store, and the
 * application only ever minted time-limited, condition-bound URLs and
 * inspected metadata.
 *
 * **KYC-7 narrowed that boundary, deliberately and by exactly two methods.**
 * Document access (SDD 12.3) requires the server itself to read one
 * ciphertext object, decrypt it, and stage the plaintext somewhere a
 * presigned URL can reach — none of which is possible through metadata and
 * signed URLs alone. `getObject` and `writeTemporaryObject` are that
 * narrowing, held to the same discipline the rest of this port already
 * keeps: `getObject` takes a caller-supplied key (used only on an already
 * looked-up, already `head()`-verified, ≤`KYC_MAX_OBJECT_BYTES` permanent
 * object — never a byte range, never a stream, never proxied to an
 * unauthenticated caller), and `writeTemporaryObject` accepts no key at all,
 * so the one write this port allows can never land on a caller-chosen path,
 * permanent or otherwise.
 *
 * **S2-6b narrows it once more, by one method.** The async media-processing
 * worker (SDD 12.2 step 5) reads one uploaded object, generates 8 derived
 * variants, and must write each one to a *permanent* key of its own — a case
 * `writeTemporaryObject` cannot serve (its whole point is refusing a
 * permanent address) and that streaming through the API tier would violate
 * outright. `putObject` is that write, held to the same restraint as every
 * caller-named key this port accepts elsewhere (`getObject`): the key must
 * already be server-derived from ids the caller does not control, never
 * client input — `ProcessProductMediaUseCase` computes it the same way
 * `CreateProductMediaUploadIntentUseCase.objectKeyFor` computes the
 * original's.
 *
 * It also performs **no encryption**. KYC objects are encrypted client-side
 * before upload (SDD 12.3), so as far as this port is concerned every payload
 * is opaque ciphertext (or, for `writeTemporaryObject`, opaque plaintext the
 * caller already decrypted elsewhere). Key handling lives behind
 * `DataKeyCipher`; document-byte encryption lives behind `DocumentCipher`.
 *
 * Note what is *absent* from `presignGet`: a TTL parameter. SDD 12.1 caps a
 * KYC download URL at 60 seconds, and a cap a caller can pass is a cap a
 * caller can raise. The lifetime is the implementation's to decide, so the
 * limit cannot be argued with from a use case. `presignGet` on a temporary
 * object's key uses this exact same method and the exact same ceiling —
 * nothing about it changes for KYC-7.
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

  /**
   * The object's bytes. `null` when it does not exist — the same convention
   * `head` uses, for the same reason.
   *
   * KYC-7's one caller passes only a key that already came from an
   * authorised, `head()`-verified document lookup — this method does not
   * itself limit size or re-check anything `presignPut`'s original upload
   * already enforced.
   */
  getObject(key: string): Promise<Buffer | null>;

  /**
   * Writes `bytes` to a fresh, server-generated, private object under a
   * dedicated temporary-delivery prefix distinct from every permanent KYC
   * object's own prefix — structurally, not by caller discipline, since
   * nothing here accepts a key to write to.
   *
   * Deletion (cleanup on failure, or once a presigned URL to it has expired)
   * is the existing `delete(key)`, called with the returned `key` — no
   * separate temporary-object deletion method is needed.
   */
  writeTemporaryObject(bytes: Buffer, contentType: string): Promise<TemporaryObject>;

  /**
   * Writes `bytes` to a permanent object at a server-derived `key` (S2-6b).
   * The caller is responsible for `key` never having come from a client —
   * this method itself enforces nothing about the key's shape, the same
   * trust boundary `getObject` already draws.
   */
  putObject(key: string, bytes: Buffer, contentType: string): Promise<void>;

  /** Idempotent: deleting an absent object is not an error. */
  delete(key: string): Promise<void>;
}
