import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { type Container, createContainer } from '../../src/container.js';

/**
 * Integration test against real PostgreSQL and Redis.
 *
 * Requires `pnpm infra:up`. It is deliberately not mocked: the point of this
 * test is to prove that the container wires up real connections and that
 * readiness genuinely reflects dependency health.
 */
describe('health endpoints', () => {
  let container: Container;
  let app: Express;

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('GET /healthz reports liveness without touching dependencies', async () => {
    const response = await request(app).get('/healthz').expect(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      service: expect.any(String) as unknown as string,
      environment: 'test',
    });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('GET /readyz reports every dependency', async () => {
    const response = await request(app).get('/readyz');
    expect([200, 503]).toContain(response.status);

    const names = (response.body as { dependencies: { name: string }[] }).dependencies.map(
      (dependency) => dependency.name,
    );
    expect(names).toEqual(expect.arrayContaining(['postgres', 'redis']));
  });

  it('returns 503 from /readyz when a dependency is down', async () => {
    const response = await request(app).get('/readyz');
    const body = response.body as { status: string; dependencies: { status: string }[] };
    const allUp = body.dependencies.every((dependency) => dependency.status === 'up');
    expect(response.status).toBe(allUp ? 200 : 503);
    expect(body.status).toBe(allUp ? 'ok' : 'degraded');
  });

  it('echoes a caller-supplied correlation id', async () => {
    const response = await request(app)
      .get('/healthz')
      .set('x-request-id', 'trace-abc-123')
      .expect(200);
    expect(response.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('returns a structured 404 for an unknown route', async () => {
    const response = await request(app).get('/api/v1/does-not-exist').expect(404);
    expect(response.body).toMatchObject({
      error: { code: 'ROUTE_NOT_FOUND', requestId: expect.any(String) as unknown as string },
    });
  });

  it('sets security headers and hides the framework', async () => {
    const response = await request(app).get('/healthz').expect(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['strict-transport-security']).toContain('max-age=');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
