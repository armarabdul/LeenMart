import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { pino, type Logger as PinoLogger } from 'pino';
import { PinoLoggerAdapter, REDACTED_PATHS } from '../../src/shared/infrastructure/observability/logger.js';

const captureLine = async (write: (logger: PinoLogger) => void): Promise<string> => {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

  const logger = pino(
    { level: 'info', redact: { paths: [...REDACTED_PATHS], censor: '[REDACTED]' } },
    stream,
  );
  write(logger);
  await new Promise((resolve) => setImmediate(resolve));
  return chunks.join('');
};

describe('logging', () => {
  it('redacts credentials and PII from log output', async () => {
    const line = await captureLine((logger) => {
      logger.info(
        {
          otp: '123456',
          password: 'hunter2',
          accessToken: 'eyJhbGciOi',
          pan: 'ABCDE1234F',
          bankAccountNumber: '00112233445566',
          orderId: 'safe-to-log',
        },
        'sensitive payload',
      );
    });

    expect(line).not.toContain('123456');
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('eyJhbGciOi');
    expect(line).not.toContain('ABCDE1234F');
    expect(line).not.toContain('00112233445566');
    expect(line).toContain('safe-to-log');
    expect(line).toContain('[REDACTED]');
  });

  it('emits structured JSON, one object per line', async () => {
    const line = await captureLine((logger) => {
      logger.info({ requestId: 'req-1' }, 'hello');
    });
    const parsed = JSON.parse(line.trim()) as Record<string, unknown>;
    expect(parsed.msg).toBe('hello');
    expect(parsed.requestId).toBe('req-1');
  });

  it('adapts Pino to the framework-free Logger port', async () => {
    const stream = new PassThrough();
    const chunks: string[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

    const adapter = new PinoLoggerAdapter(pino({ level: 'info' }, stream));
    adapter.child({ module: 'catalogue' }).info({ productId: 'p-1' }, 'published');
    await new Promise((resolve) => setImmediate(resolve));

    const parsed = JSON.parse(chunks.join('').trim()) as Record<string, unknown>;
    expect(parsed.module).toBe('catalogue');
    expect(parsed.productId).toBe('p-1');
  });
});
