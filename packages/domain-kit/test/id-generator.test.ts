import { describe, expect, it } from 'vitest';
import { UuidV4Generator, UuidV7Generator } from '../src/ports/id-generator.js';
import { isUuid, toUuid } from '../src/primitives/branded.js';

describe('UuidV7Generator', () => {
  const generator = new UuidV7Generator();

  it('produces well-formed UUIDs', () => {
    const id = generator.generate();
    expect(isUuid(id)).toBe(true);
    expect(() => toUuid(id)).not.toThrow();
  });

  it('sets version 7 and the RFC 4122 variant', () => {
    const id = generator.generate();
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('is time-ordered, which is why it is preferred over v4 for primary keys', async () => {
    const first = generator.generate();
    await new Promise((resolve) => setTimeout(resolve, 3));
    const second = generator.generate();
    expect(second > first).toBe(true);
  });

  it('does not collide across a burst', () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => generator.generate()));
    expect(ids.size).toBe(5_000);
  });
});

describe('branded ids', () => {
  it('rejects a malformed identifier', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(() => toUuid('not-a-uuid')).toThrow(TypeError);
  });

  it('accepts a v4 identifier too', () => {
    expect(isUuid(new UuidV4Generator().generate())).toBe(true);
  });
});
