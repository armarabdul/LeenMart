import { describe, expect, it } from 'vitest';
import { extractSseFrames } from '@/features/vendor-stream/parse-sse';

describe('extractSseFrames', () => {
  it('parses a single complete frame', () => {
    const { frames, remainder } = extractSseFrames(
      'event: order.placed\ndata: {"orderId":"abc"}\n\n',
    );

    expect(frames).toEqual([{ type: 'order.placed', data: { orderId: 'abc' } }]);
    expect(remainder).toBe('');
  });

  it('parses multiple frames arriving in one chunk', () => {
    const { frames } = extractSseFrames(
      'event: order.placed\ndata: {"orderId":"a"}\n\nevent: order.placed\ndata: {"orderId":"b"}\n\n',
    );

    expect(frames).toHaveLength(2);
    expect(frames.map((f) => f.data)).toEqual([{ orderId: 'a' }, { orderId: 'b' }]);
  });

  it('leaves an incomplete frame in the remainder for the next chunk', () => {
    const { frames, remainder } = extractSseFrames('event: order.placed\ndata: {"orderId"');

    expect(frames).toEqual([]);
    expect(remainder).toBe('event: order.placed\ndata: {"orderId"');
  });

  it('completes a frame split across two chunks when the remainder is fed back in', () => {
    const first = extractSseFrames('event: order.placed\ndata: {"orderId"');
    const second = extractSseFrames(`${first.remainder}:"abc"}\n\n`);

    expect(second.frames).toEqual([{ type: 'order.placed', data: { orderId: 'abc' } }]);
  });

  it('drops a frame with an invalid JSON payload rather than throwing', () => {
    expect(() => extractSseFrames('event: order.placed\ndata: not-json\n\n')).not.toThrow();
    const { frames } = extractSseFrames('event: order.placed\ndata: not-json\n\n');
    expect(frames).toEqual([]);
  });

  it('drops a frame missing the event or data line', () => {
    const { frames } = extractSseFrames('data: {"orderId":"a"}\n\n');
    expect(frames).toEqual([]);
  });

  it('returns an empty result for an empty buffer', () => {
    expect(extractSseFrames('')).toEqual({ frames: [], remainder: '' });
  });
});
