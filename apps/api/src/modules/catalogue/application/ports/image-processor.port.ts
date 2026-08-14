import type {
  ProductMediaVariantFormat,
  ProductMediaVariantWidth,
} from '../../domain/entities/product-media-variant.entity.js';

/**
 * The real, decoded shape of an image (S2-6b, SDD 12.2 step 5a: "read magic
 * bytes — reject if they contradict the declared type"). `format` is
 * whatever the decoder itself determined from the bytes — never the
 * declared `Content-Type` and never the original filename or extension,
 * which `SharpImageProcessor` never even receives.
 */
export interface ImageMetadata {
  /**
   * The decoder's own name for the format it found — `'jpeg' | 'png' |
   * 'webp' | 'svg' | ...` for Sharp specifically. Deliberately untyped
   * beyond `string`: this port does not know every value its implementation
   * might report, only that the caller compares it against the declared
   * type and against `'svg'` explicitly.
   */
  readonly format: string;
  readonly width: number;
  readonly height: number;
}

/** One re-encoded output of SDD 12.2's variant matrix (D-S2-6-F). */
export interface GeneratedVariant {
  readonly width: ProductMediaVariantWidth;
  readonly format: ProductMediaVariantFormat;
  readonly bytes: Buffer;
}

/**
 * Thrown when `bytes` cannot be decoded as an image at all — a genuinely
 * malformed or truncated upload, distinct from a successfully-decoded image
 * whose format simply does not match what was declared (that comparison is
 * the caller's job, using `readMetadata`'s honest answer).
 */
export class ImageDecodeError extends Error {
  constructor(cause: unknown) {
    super('The uploaded object could not be decoded as an image.');
    this.name = 'ImageDecodeError';
    this.cause = cause;
  }
}

/**
 * Image decoding and re-encoding (S2-6b, SDD 12.2 steps 5a–5f). A port, not
 * a direct `sharp(...)` call from the use case — `SharpImageProcessor` is
 * the only file that imports `sharp` (D-S2-6-E), the same boundary
 * `ObjectStore` keeps between application code and the AWS SDK.
 */
export interface ImageProcessor {
  /**
   * Decodes just enough to report the real format and dimensions —
   * magic-byte-based, from the library that actually parses the container
   * format, never a guess from the declared `Content-Type` or a filename.
   * Throws `ImageDecodeError` if `bytes` is not a decodable image at all
   * (which is also how a disguised SVG surfaces here without a separate
   * SVG-sniffing routine: an SVG decodes with `format === 'svg'`, and
   * anything that isn't a well-formed image of any kind throws).
   */
  readMetadata(bytes: Buffer): Promise<ImageMetadata>;

  /**
   * Re-encodes `bytes` into the full SDD 12.2 variant matrix — 200/400/800/
   * 1600 px, WebP and AVIF, 8 outputs (D-S2-6-F). Every output is freshly
   * decoded and re-encoded (never a copy of the input bytes), auto-oriented
   * before resizing and without embedded metadata in the result — Sharp's
   * own default is to drop EXIF/GPS/ICC unless `.withMetadata()` is called,
   * which nothing here does. Never upscales past the original's own
   * dimensions: a narrower source simply yields a narrower "1600" variant.
   */
  generateVariants(bytes: Buffer): Promise<readonly GeneratedVariant[]>;
}
