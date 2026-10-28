import { createInterface } from 'node:readline';

export interface PromptStreams {
  input?: NodeJS.ReadableStream;
  /** Where the question is written. Defaults to stderr so stdout stays clean. */
  output?: NodeJS.WritableStream;
}

/**
 * Read a secret from the user without echoing it. On a TTY the keystrokes are
 * consumed in raw mode; otherwise (piped stdin, e.g. `echo $TOKEN | rp auth
 * login`) the first line is read. Resolves with '' if the stream ends first.
 */
export function promptSecret(question: string, streams: PromptStreams = {}): Promise<string> {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stderr;
  output.write(question);

  const tty = input as NodeJS.ReadStream;
  if (tty.isTTY && typeof tty.setRawMode === 'function') {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const finish = (action: () => void) => {
        tty.removeListener('data', onData);
        tty.setRawMode(false);
        tty.pause();
        output.write('\n');
        action();
      };
      const onData = (chunk: Buffer | string) => {
        for (const ch of chunk.toString('utf8')) {
          if (ch === '\r' || ch === '\n' || ch === '\u0004') return finish(() => resolve(buffer));
          if (ch === '\u0003') return finish(() => reject(new Error('Cancelled.')));
          if (ch === '\u007f' || ch === '\b') buffer = buffer.slice(0, -1);
          else buffer += ch;
        }
      };
      tty.setRawMode(true);
      tty.resume();
      tty.on('data', onData);
    });
  }

  return new Promise((resolve) => {
    const rl = createInterface({ input, terminal: false });
    let answered = false;
    rl.once('line', (line) => {
      answered = true;
      rl.close();
      resolve(line);
    });
    rl.once('close', () => {
      if (!answered) resolve('');
    });
  });
}
