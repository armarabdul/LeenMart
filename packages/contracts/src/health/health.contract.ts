import { z } from 'zod';

export const dependencyStatusSchema = z.object({
  name: z.string(),
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
});

/** GET /healthz — liveness. Answers "is the process alive?" and nothing else. */
export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string().datetime(),
});

/** GET /readyz — readiness. Answers "can this instance serve traffic?" */
export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  timestamp: z.string().datetime(),
  dependencies: z.array(dependencyStatusSchema),
});

export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
