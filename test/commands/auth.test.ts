import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Login from '../../src/commands/auth/login.js';
import Logout from '../../src/commands/auth/logout.js';
import { resolveApiToken } from '../../src/auth.js';
import { runCommand } from '../helpers/command.js';

afterEach(() => vi.restoreAllMocks());

describe('rp auth login', () => {
  it('stores --api-token in auth.json without echoing it', async () => {
    const { stdout, configDir, error } = await runCommand(Login, ['--api-token', 'rpa_flagtoken1']);
    expect(error).toBeUndefined();
    const file = join(configDir, 'auth.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      clientCredentials: { apiToken: 'rpa_flagtoken1' },
    });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(stdout.join('\n')).toContain(file);
    expect(stdout.join('\n')).not.toContain('flagtoken1');
    expect(resolveApiToken({ env: {}, configDir })).toBe('rpa_flagtoken1');
  });

  it('prompts for the token when no flag is given', async () => {
    vi.spyOn(Login.prototype as never, 'readToken').mockResolvedValue('rpa_prompted123' as never);
    const { configDir, error } = await runCommand(Login, []);
    expect(error).toBeUndefined();
    expect(resolveApiToken({ env: {}, configDir })).toBe('rpa_prompted123');
  });

  it('rejects an empty token', async () => {
    vi.spyOn(Login.prototype as never, 'readToken').mockResolvedValue('  ' as never);
    const { configDir, error } = await runCommand(Login, []);
    expect(error?.message).toMatch(/token is required/i);
    expect(existsSync(join(configDir, 'auth.json'))).toBe(false);
  });

  it('rejects a token without the rpa_ prefix', async () => {
    const { configDir, error } = await runCommand(Login, ['--api-token', 'abc123']);
    expect(error?.message).toMatch(/rpa_/);
    expect(existsSync(join(configDir, 'auth.json'))).toBe(false);
  });
});

describe('rp auth logout', () => {
  it('removes the stored credentials', async () => {
    const first = await runCommand(Login, ['--api-token', 'rpa_flagtoken1']);
    const { stdout, error } = await runCommand(Logout, [], { configDir: first.configDir });
    expect(error).toBeUndefined();
    expect(stdout.join('\n')).toMatch(/Removed/);
    expect(existsSync(join(first.configDir, 'auth.json'))).toBe(false);
  });

  it('is a no-op when not logged in', async () => {
    const { stdout, error } = await runCommand(Logout, []);
    expect(error).toBeUndefined();
    expect(stdout.join('\n')).toMatch(/Not logged in/);
  });
});
