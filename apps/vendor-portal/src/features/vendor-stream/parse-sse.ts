/** One parsed SSE frame — `type` is the wire `event:` field, `data` the JSON-decoded `data:` field. */
export interface SseFrame {
  readonly type: string;
  readonly data: unknown;
}

/**
 * Extracts every complete frame from `buffer` and returns whatever
 * incomplete tail remains for the next chunk to complete — the client-side
 * mirror of the server's own frame-buffering discipline (a `write()` call
 * boundary on the server is not guaranteed to land on a `read()` boundary
 * here), so a frame split across two network reads still parses correctly.
 *
 * A frame missing either line, or whose `data:` is not valid JSON, is
 * silently dropped rather than throwing — one malformed frame must never
 * take the whole connection down.
 */
export const extractSseFrames = (buffer: string): { frames: SseFrame[]; remainder: string } => {
  const frames: SseFrame[] = [];
  let rest = buffer;
  let frameEnd = rest.indexOf('\n\n');

  while (frameEnd !== -1) {
    const raw = rest.slice(0, frameEnd);
    rest = rest.slice(frameEnd + 2);

    const eventLine = raw.split('\n').find((line) => line.startsWith('event: '));
    const dataLine = raw.split('\n').find((line) => line.startsWith('data: '));
    if (eventLine && dataLine) {
      try {
        frames.push({
          type: eventLine.slice('event: '.length),
          data: JSON.parse(dataLine.slice('data: '.length)) as unknown,
        });
      } catch {
        // Malformed data payload — dropped, not thrown.
      }
    }

    frameEnd = rest.indexOf('\n\n');
  }

  return { frames, remainder: rest };
};
