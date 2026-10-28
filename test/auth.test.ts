import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_API_URL,
  maskToken,
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

  it('accepts https URLs', () => {
    expect(resolveApiUrl({ flag: 'https://api.example.com/' })).toBe(
      'https://api.example.com',
    );
  });

  it.each(['http://localhost:8001', 'http://127.0.0.1:8001', 'http://[::1]:8001'])(
    'allows plain http for loopback host %s',
    (url) => {
      expect(resolveApiUrl({ flag: url })).toBe(url);
    },
  );

  it('rejects plain http for non-loopback hosts', () => {
    expect(() => resolveApiUrl({ flag: 'http://api.example.com' })).toThrow(/https/);
    expect(() => resolveApiUrl({ env: { RP_API_URL: 'http://evil.test' } })).toThrow(
      /https/,
    );
  });

  it('rejects a loopback lookalike host', () => {
    expect(() => resolveApiUrl({ flag: 'http://localhost.evil.com' })).toThrow(/https/);
  });

  it('rejects non-http schemes and invalid URLs', () => {
    expect(() => resolveApiUrl({ flag: 'ftp://api.example.com' })).toThrow(/https/);
    expect(() => resolveApiUrl({ flag: 'not a url' })).toThrow(/valid URL/);
  });
});

describe('auth file permissions', () => {
  const posix = process.platform !== 'win32';

  it.skipIf(!posix)('warns when auth.json is group/world readable', () => {
    const dir = tempDir();
    const path = join(dir, 'auth.json');
    writeFileSync(path, JSON.stringify({ apiToken: 'rpa_file' }));
    chmodSync(path, 0o644);
    const warn = vi.fn();
    expect(resolveApiToken({ env: {}, configDir: dir, warn })).toBe('rpa_file');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/chmod 600/));
  });

  it.skipIf(!posix)('does not warn when auth.json is 0600', () => {
    const dir = tempDir();
    const path = join(dir, 'auth.json');
    writeFileSync(path, JSON.stringify({ apiToken: 'rpa_file' }));
    chmodSync(path, 0o600);
    const warn = vi.fn();
    resolveApiToken({ env: {}, configDir: dir, warn });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when the token comes from the flag', () => {
    const warn = vi.fn();
    resolveApiToken({ flag: 'rpa_flag', env: {}, configDir: tempDir(), warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('maskToken', () => {
  it('shows only the rpa_ prefix', () => {
    expect(maskToken('rpa_abcdef123456')).toBe('rpa_…');
  });

  it('shows no characters of a token without the rpa_ prefix', () => {
    expect(maskToken('abcdef123456')).toBe('…');
  });
});
