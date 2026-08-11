import { InvalidKycIdentifierError } from '../errors/kyc-errors.js';
import type { KycDocumentId } from '../value-objects/kyc-document-id.value-object.js';
import type { KycDocumentType } from '../value-objects/kyc-document-type.value-object.js';

/** Where an uploaded object has got to. */
export type KycDocumentStatusName = 'AWAITING_UPLOAD' | 'UPLOADED';

export interface KycDocumentProps {
  readonly id: KycDocumentId;
  readonly type: KycDocumentType;
  /** Where the ciphertext lives in the private bucket (SDD 12.1). */
  readonly objectKey: string;
  /** The data key, wrapped by the KMS CMK — "stored beside the object reference" (SDD 12.3). */
  readonly wrappedDataKey: Buffer;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly status: KycDocumentStatusName;
  readonly uploadedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * One encrypted KYC document — **metadata only**.
 *
 * Three things this entity deliberately never holds, each for a reason:
 *
 *  * **The document bytes.** SDD 12.2 keeps files out of the API tier
 *    entirely; they move directly between the browser and object storage, and
 *    this row only records where they went.
 *  * **A plaintext data key.** SDD 12.3 encrypts client-side. The plaintext
 *    key exists for one request and is never persisted; only its wrapped form
 *    lives here.
 *  * **The identifier on the document.** A PAN or account number is reduced to
 *    a fingerprint and last four characters on `VendorKyc` before it reaches
 *    persistence.
 *
 * `wrappedDataKey` *is* key material, even though it is useless without the
 * CMK — so `toJSON` redacts it. Without that, a `logger.info({ document })`
 * anywhere would put wrapped keys into log storage, where the redaction
 * allowlist would not know to look for them under an arbitrary field name.
 */
export class KycDocument {
  private constructor(private readonly props: KycDocumentProps) {}

  /**
   * Records an upload intent: the object key is reserved and the data key
   * wrapped, but nothing has been uploaded yet. The document only becomes
   * `UPLOADED` once the client confirms and the store agrees.
   */
  static awaitUpload(props: {
    id: KycDocumentId;
    type: KycDocumentType;
    objectKey: string;
    wrappedDataKey: Buffer;
    contentType: string;
    sizeBytes: number;
    now: Date;
  }): KycDocument {
    if (props.objectKey.trim().length === 0) {
      throw new InvalidKycIdentifierError('objectKey', 'must not be empty');
    }
    if (props.wrappedDataKey.length === 0) {
      throw new InvalidKycIdentifierError('wrappedDataKey', 'must not be empty');
    }
    if (!Number.isInteger(props.sizeBytes) || props.sizeBytes <= 0) {
      throw new InvalidKycIdentifierError('sizeBytes', 'must be a positive whole number of bytes');
    }
    if (props.contentType.trim().length === 0) {
      throw new InvalidKycIdentifierError('contentType', 'must not be empty');
    }

    return new KycDocument({
      ...props,
      status: 'AWAITING_UPLOAD',
      uploadedAt: null,
      createdAt: props.now,
    });
  }

  /** Rehydrates a persisted row, applying no defaults and no validation — an old row must always load. */
  static reconstitute(props: KycDocumentProps): KycDocument {
    return new KycDocument(props);
  }

  /** Immutable transition, matching every other entity here: the receiver is never mutated. */
  markUploaded(now: Date): KycDocument {
    return new KycDocument({ ...this.props, status: 'UPLOADED', uploadedAt: now });
  }

  get id(): KycDocumentId {
    return this.props.id;
  }

  get type(): KycDocumentType {
    return this.props.type;
  }

  get objectKey(): string {
    return this.props.objectKey;
  }

  /** Never log or serialise this. It is redacted from `toJSON` precisely because it is easy to forget. */
  get wrappedDataKey(): Buffer {
    return this.props.wrappedDataKey;
  }

  get contentType(): string {
    return this.props.contentType;
  }

  get sizeBytes(): number {
    return this.props.sizeBytes;
  }

  get status(): KycDocumentStatusName {
    return this.props.status;
  }

  get uploadedAt(): Date | null {
    return this.props.uploadedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  isUploaded(): boolean {
    return this.props.status === 'UPLOADED';
  }

  /**
   * The safe shape. `JSON.stringify` on a class with a private `props` field
   * would otherwise emit every property, wrapped key included — which is
   * exactly what happens the first time someone passes an entity to a logger.
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.props.id,
      type: this.props.type.name,
      objectKey: this.props.objectKey,
      wrappedDataKey: '[REDACTED]',
      contentType: this.props.contentType,
      sizeBytes: this.props.sizeBytes,
      status: this.props.status,
      uploadedAt: this.props.uploadedAt,
      createdAt: this.props.createdAt,
    };
  }
}
