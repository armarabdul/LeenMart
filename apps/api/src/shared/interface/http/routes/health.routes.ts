import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Clock } from '@leen-mart/domain-kit';
import type { DependencyStatus, LivenessResponse, ReadinessResponse } from '@leen-mart/contracts';
import type { Env } from '../../../config/env.js';
import { checkDatabase } from '../../../infrastructure/persistence/prisma.js';
import { checkRedis } from '../../../infrastructure/cache/redis.js';
import { asyncHandler } from '../middleware/async-handler.js';

export interface HealthDependencies {
  readonly env: Env;
  readonly prisma: PrismaClient;
  readonly redis: Redis;
  readonly clock: Clock;
}

/**
 * Liveness and readiness are different questions and must not share an endpoint
 * (SDD 20.5).
 *
 * `/healthz` answers "is the process alive?" — if it fails, the orchestrator
 * should restart the task. `/readyz` answers "can this instance serve traffic?"
 * — if it fails, the load balancer should stop routing but the task should be
 * left alone. Conflating them turns a brief database blip into a restart storm.
 */
export const createHealthRouter = ({ env, prisma, redis, clock }: HealthDependencies): Router => {
  const router = Router();
  const startedAt = Date.now();

  router.get('/healthz', (_req, res) => {
    const body: LivenessResponse = {
      status: 'ok',
      service: env.SERVICE_NAME,
      version: env.APP_VERSION,
      environment: env.NODE_ENV,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: clock.now().toISOString(),
    };
    res.status(200).json(body);
  });

  router.get(
    '/readyz',
    asyncHandler(async (_req, res) => {
      const [database, cache] = await Promise.all([checkDatabase(prisma), checkRedis(redis)]);

      const dependencies: DependencyStatus[] = [
        {
          name: 'postgres',
          status: database.healthy ? 'up' : 'down',
          latencyMs: database.latencyMs,
          ...(database.error ? { error: database.error } : {}),
        },
        {
          name: 'redis',
          status: cache.healthy ? 'up' : 'down',
          latencyMs: cache.latencyMs,
          ...(cache.error ? { error: cache.error } : {}),
        },
      ];

      const ready = dependencies.every((dependency) => dependency.status === 'up');
      const body: ReadinessResponse = {
        status: ready ? 'ok' : 'degraded',
        service: env.SERVICE_NAME,
        version: env.APP_VERSION,
        environment: env.NODE_ENV,
        timestamp: clock.now().toISOString(),
        dependencies,
      };

      res.status(ready ? 200 : 503).json(body);
    }),
  );

  return router;
};
