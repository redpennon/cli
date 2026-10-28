import { afterEach, describe, expect, it, vi } from 'vitest';

import Keys from '../../src/commands/keys.js';
import { jsonResponse } from '../helpers/fs.js';
import { runCommand } from '../helpers/command.js';

afterEach(() => vi.unstubAllGlobals());

describe('rp keys', () => {
  it('prints one key per line', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { keys: ['a', 'b'] }));
    vi.stubGlobal('fetch', fetchMock);
    const { stdout, error } = await runCommand(Keys, ['--project', 'web'], {
      env: { RP_API_TOKEN: 'rpa_x' },
    });
    expect(error).toBeUndefined();
    expect(stdout).toEqual(['a\nb']);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.redpennon.dev/v1/code-references/keys?project=web',
    );
  });

  it('prints JSON with --format json', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { keys: ['a'] })));
    const { stdout } = await runCommand(Keys, ['-p', 'web', '--format', 'json'], {
      env: { RP_API_TOKEN: 'rpa_x' },
    });
    expect(JSON.parse(stdout[0])).toEqual({ keys: ['a'] });
  });

  it('requires an API token', async () => {
    const { error } = await runCommand(Keys, ['--project', 'web']);
    expect(error?.message).toMatch(/API token is required/);
  });

  it('requires a project', async () => {
    const { error } = await runCommand(Keys, [], { env: { RP_API_TOKEN: 'rpa_x' } });
    expect(error?.message).toMatch(/project is required/);
  });

  it('surfaces API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'bad token' })));
    const { error } = await runCommand(Keys, ['-p', 'web'], { env: { RP_API_TOKEN: 'rpa_x' } });
    expect(error?.message).toBe('bad token');
  });
});
