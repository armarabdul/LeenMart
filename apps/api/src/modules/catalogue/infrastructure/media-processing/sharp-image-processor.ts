import sharp from 'sharp';
import {
  PRODUCT_MEDIA_VARIANT_FORMATS,
  PRODUCT_MEDIA_VARIANT_WIDTHS,
} from '../../domain/entities/product-media-variant.entity.js';
import {
  ImageDecodeError,
  type GeneratedVariant,
  type ImageMetadata,
  type ImageProcessor,
} from '../../application/ports/image-processor.port.js';

/** WebP's own quality scale (0–100); a conservative default, not SDD-mandated. */
const WEBP_QUALITY = 82;
/** AVIF's scale reads differently from WebP's at the same visual quality — a lower number here is not a lower-quality choice. */
const AVIF_QUALITY = 60;

/**
 * `sharp`-backed `ImageProcessor` (S2-6b D-S2-6-E). The only file in this
 * module that imports `sharp` — `ProcessProductMediaUseCase` depends on the
 * port, never this class directly, the same boundary `S3ObjectStore` keeps
 * from the AWS SDK.
 */
export class SharpImageProcessor implements ImageProcessor {
  async readMetadata(bytes: Buffer): Promise<ImageMetadata> {
    try {
      const metadata = await sharp(bytes).metadata();
      if (!metadata.format || !metadata.width || !metadata.height) {
        throw new Error('Sharp reported no decodable format or dimensions.');
      }
      return { format: metadata.format, width: metadata.width, height: metadata.height };
    } catch (error) {
      throw new ImageDecodeError(error);
    }
  }

  /**
   * `.rotate()` with no argument auto-orients from the EXIF orientation tag
   * before resizing, then bakes the correction into pixels — this is the
   * re-encode's EXIF *read*, immediately followed by the metadata never
   * being written back: Sharp strips EXIF/GPS/ICC by default and only
   * preserves it if `.withMetadata()` is called, which nothing here does
   * (SDD 12.2 step 5d, "STRIP EXIF").
   *
   * `.clone()` per output reuses the one decode across all 8 variants rather
   * than re-decoding `bytes` eight times.
   */
  async generateVariants(bytes: Buffer): Promise<readonly GeneratedVariant[]> {
    const source = sharp(bytes).rotate();
    const variants: GeneratedVariant[] = [];

    for (const width of PRODUCT_MEDIA_VARIANT_WIDTHS) {
      for (const format of PRODUCT_MEDIA_VARIANT_FORMATS) {
        // `fit: 'inside'` + `withoutEnlargement: true`: preserves aspect
        // ratio, never distorts, and never upscales past the source's own
        // dimensions — a narrower original simply yields a narrower "1600".
        const pipeline = source.clone().resize({ width, fit: 'inside', withoutEnlargement: true });
        const encoded =
          format === 'WEBP'
            ? pipeline.webp({ quality: WEBP_QUALITY })
            : pipeline.avif({ quality: AVIF_QUALITY });
        // eight small, sequential re-encodes of one already-decoded source; no benefit to parallelising CPU-bound libvips work here.
        const outputBytes = await encoded.toBuffer();
        variants.push({ width, format, bytes: outputBytes });
      }
    }

    return variants;
  }
}
