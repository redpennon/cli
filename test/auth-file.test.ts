import { existsSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { AUTH_FILE_NAME, removeAuthFile, resolveApiToken, writeAuthFile } from '../src/auth.js';
import { promptSecret } from '../src/prompt.js';

const posix = process.platform !== 'win32';
const tempDir = () => mkdtempSync(join(tmpdir(), 'rp-authfile-'));

describe('writeAuthFile', () => {
  it('writes the clientCredentials format that resolveApiToken reads back', () => {
    const dir = tempDir();
    const path = writeAuthFile(dir, 'rpa_abc12345');
    expect(path).toBe(join(dir, AUTH_FILE_NAME));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      clientCredentials: { apiToken: 'rpa_abc12345' },
    });
    expect(resolveApiToken({ env: {}, configDir: dir })).toBe('rpa_abc12345');
  });

  it.skipIf(!posix)('creates the file with mode 0600', () => {
    const dir = tempDir();
    const path = writeAuthFile(dir, 'rpa_abc12345');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it.skipIf(!posix)('tightens permissions of an existing permissive file', () => {
    const dir = tempDir();
    const path = join(dir, AUTH_FILE_NAME);
    writeFileSync(path, '{}');
    chmodSync(path, 0o644);
    writeAuthFile(dir, 'rpa_abc12345');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('creates the config directory when missing', () => {
    const dir = join(tempDir(), 'nested', 'cfg');
    writeAuthFile(dir, 'rpa_abc12345');
    expect(existsSync(join(dir, AUTH_FILE_NAME))).toBe(true);
  });
});

describe('removeAuthFile', () => {
  it('deletes the file and reports it', () => {
    const dir = tempDir();
    writeAuthFile(dir, 'rpa_abc12345');
    expect(removeAuthFile(dir)).toBe(true);
    expect(existsSync(join(dir, AUTH_FILE_NAME))).toBe(false);
  });

  it('returns false when there is nothing to remove', () => {
    expect(removeAuthFile(tempDir())).toBe(false);
  });
});

describe('promptSecret', () => {
  it('reads a line from a non-TTY stream without echoing it', async () => {
    const input = new PassThrough();
    const written: string[] = [];
    const output = new Writable({
      write(chunk, _enc, cb) {
        written.push(chunk.toString());
        cb();
      },
    });
    const pending = promptSecret('Token: ', { input, output });
    input.write('rpa_secret123\n');
    expect(await pending).toBe('rpa_secret123');
    expect(written.join('')).toContain('Token: ');
    expect(written.join('')).not.toContain('rpa_secret123');
  });

  it('resolves with an empty string when the stream ends', async () => {
    const input = new PassThrough();
    const output = new Writable({ write: (_c, _e, cb) => cb() });
    const pending = promptSecret('Token: ', { input, output });
    input.end();
    expect(await pending).toBe('');
  });
});
