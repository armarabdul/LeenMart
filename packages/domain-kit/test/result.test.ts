import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, mapError, mapResult, ok, unwrap, unwrapOr } from '../src/result/result.js';

describe('Result', () => {
  it('narrows a success', () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it('narrows a failure', () => {
    const result = err('SOLD_OUT');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBe('SOLD_OUT');
    }
  });

  it('maps only the success branch', () => {
    expect(mapResult(ok(2), (n) => n * 2)).toEqual(ok(4));
    expect(mapResult(err<string>('E'), (n: number) => n * 2)).toEqual(err('E'));
  });

  it('maps only the failure branch', () => {
    expect(mapError(err('E'), (e) => `${e}!`)).toEqual(err('E!'));
    expect(mapError(ok(1), (e: string) => `${e}!`)).toEqual(ok(1));
  });

  it('unwraps a success and throws on a failure', () => {
    expect(unwrap(ok('value'))).toBe('value');
    expect(() => unwrap(err('boom'))).toThrow(/unwrap/);
    expect(unwrapOr(err<string>('boom'), 'fallback')).toBe('fallback');
  });
});
