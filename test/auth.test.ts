import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_API_URL,
  resolveApiToken,
  resolveApiUrl,
  resolveProject,
} from '../src/auth.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'rp-auth-'));
}

describe('resolveApiToken', () => {
  it('prefers the flag over env and file', () => {
    expect(
      resolveApiToken({ flag: 'rpa_flag', env: { RP_API_TOKEN: 'rpa_env' } }),
    ).toBe('rpa_flag');
  });

  it('falls back to RP_API_TOKEN', () => {
    expect(resolveApiToken({ env: { RP_API_TOKEN: 'rpa_env' } })).toBe('rpa_env');
  });

  it('reads the clientCredentials auth file', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'auth.json'),
      JSON.stringify({ clientCredentials: { apiToken: 'rpa_file' } }),
    );
    expect(resolveApiToken({ env: {}, configDir: dir })).toBe('rpa_file');
  });

  it('reads a flat apiToken auth file', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'auth.json'), JSON.stringify({ apiToken: 'rpa_flat' }));
    expect(resolveApiToken({ env: {}, configDir: dir })).toBe('rpa_flat');
  });

  it('returns undefined when nothing is set', () => {
    expect(resolveApiToken({ env: {}, configDir: tempDir() })).toBeUndefined();
  });

  it('ignores a malformed auth file', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'auth.json'), 'not json');
    expect(resolveApiToken({ env: {}, configDir: dir })).toBeUndefined();
  });
});

describe('resolveProject', () => {
  it('prefers the flag', () => {
    expect(resolveProject({ flag: 'web', env: { RP_PROJECT_KEY: 'api' } })).toBe(
      'web',
    );
  });

  it('falls back to RP_PROJECT_KEY', () => {
    expect(resolveProject({ env: { RP_PROJECT_KEY: 'api' } })).toBe('api');
  });
});

describe('resolveApiUrl', () => {
  it('defaults to the hosted API', () => {
    expect(resolveApiUrl({ env: {} })).toBe(DEFAULT_API_URL);
  });

  it('strips a trailing slash from an override', () => {
    expect(resolveApiUrl({ flag: 'http://localhost:8001/' })).toBe(
      'http://localhost:8001',
    );
  });
});
