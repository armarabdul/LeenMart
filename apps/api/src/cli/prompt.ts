import type { ReadStream } from 'node:tty';

const ENTER = ['\r', '\n'];
const CTRL_C = '';
const BACKSPACE = ['', '\b'];

/**
 * Refuses a non-interactive stdin. A pipe or redirect would mean the secret
 * came from a file, a here-string or shell history — exactly the sources the
 * bootstrap must not accept.
 */
const requireTty = (): ReadStream => {
  if (!process.stdin.isTTY) {
    throw new Error('This command requires an interactive terminal.');
  }
  return process.stdin as ReadStream;
};

/** Reads one echoed line — used for non-secret input such as the email address. */
export const readLine = async (prompt: string): Promise<string> => {
  const stdin = requireTty();
  process.stdout.write(prompt);
  stdin.resume();
  stdin.setEncoding('utf8');

  return await new Promise<string>((resolve) => {
    const onData = (chunk: string): void => {
      stdin.removeListener('data', onData);
      stdin.pause();
      resolve(chunk.trim());
    };
    stdin.on('data', onData);
  });
};

/**
 * Reads one line without echoing it, so the secret never reaches the
 * terminal, a screen recording or a scrollback buffer.
 *
 * Raw mode is restored in every exit path — resolve, reject and Ctrl-C —
 * because leaving the terminal raw would make the operator's shell unusable.
 */
export const readHiddenLine = async (prompt: string): Promise<string> => {
  const stdin = requireTty();
  process.stdout.write(prompt);

  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return await new Promise<string>((resolve, reject) => {
    let value = '';

    const restore = (): void => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stdout.write('\n');
    };

    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (ENTER.includes(character)) {
          restore();
          resolve(value);
          return;
        }
        if (character === CTRL_C) {
          restore();
          reject(new Error('Aborted.'));
          return;
        }
        if (BACKSPACE.includes(character)) {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };

    stdin.on('data', onData);
  });
};
