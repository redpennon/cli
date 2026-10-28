import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import Status from '../../src/commands/status.js';
import { runCommand } from '../helpers/command.js';

describe('rp status', () => {
  it('shows defaults when nothing is configured', async () => {
    const { stdout, error } = await runCommand(Status, []);
    expect(error).toBeUndefined();
    expect(stdout.join('\n')).toContain('API URL:  https://api.redpennon.dev');
    expect(stdout.join('\n')).toContain('Project:  (not set)');
    expect(stdout.join('\n')).toContain('Token:    (not set)');
  });

  it('shows only the rpa_ prefix of the token', async () => {
    const { stdout } = await runCommand(Status, ['--project', 'web'], {
      env: { RP_API_TOKEN: 'rpa_supersecretvalue' },
    });
    const text = stdout.join('\n');
    expect(text).toContain('configured (rpa_…)');
    expect(text).not.toContain('supersecret');
    expect(text).toContain('Project:  web');
  });

  it('warns on a group-readable auth file', async () => {
    if (process.platform === 'win32') return;
    const configDir = mkdtempSync(join(tmpdir(), 'rp-status-'));
    const file = join(configDir, 'auth.json');
    writeFileSync(file, JSON.stringify({ clientCredentials: { apiToken: 'rpa_filetoken1' } }));
    chmodSync(file, 0o644);
    const { stderr, stdout } = await runCommand(Status, [], { configDir });
    expect(stderr.join('\n')).toContain('chmod 600');
    expect(stdout.join('\n')).toContain('configured (rpa_…)');
  });

  it('rejects an insecure --api-url', async () => {
    const { error } = await runCommand(Status, ['--api-url', 'http://api.example.com']);
    expect(error?.message).toMatch(/https/);
  });
});
