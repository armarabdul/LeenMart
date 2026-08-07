import { z } from 'zod';

/**
 * Response envelopes (SDD 9.3).
 *
 * Declared once here so the API and every client agree on the shape by
 * construction rather than by convention.
 */
export const paginationMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const responseMetaSchema = z.object({
  requestId: z.string(),
  pagination: paginationMetaSchema.optional(),
});

export const successEnvelopeSchema = <TSchema extends z.ZodTypeAny>(
  data: TSchema,
): z.ZodObject<{ data: TSchema; meta: typeof responseMetaSchema }> =>
  z.object({ data, meta: responseMetaSchema });

export const errorDetailSchema = z.object({
  field: z.string().optional(),
  issue: z.string(),
});

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(errorDetailSchema).optional(),
    requestId: z.string(),
    timestamp: z.string().datetime(),
  }),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;
export type ResponseMeta = z.infer<typeof responseMetaSchema>;
export type ErrorDetailDto = z.infer<typeof errorDetailSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
