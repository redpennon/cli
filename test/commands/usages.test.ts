import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Usages from '../../src/commands/usages.js';
import { runCommand } from '../helpers/command.js';
import { jsonResponse, tempRepo } from '../helpers/fs.js';

afterEach(() => vi.unstubAllGlobals());

const repo = () =>
  tempRepo({
    'src/a.ts': "client.variable('dark-mode');\nclient.variable('old-flag');",
  });

describe('rp usages', () => {
  it('prints a console report', async () => {
    const { stdout, error } = await runCommand(Usages, [], { cwd: repo() });
    expect(error).toBeUndefined();
    expect(stdout[0]).toContain('Found 2 reference(s):');
    expect(stdout[0]).toContain('dark-mode\tsrc/a.ts:1');
  });

  it('prints JSON with --format json', async () => {
    const { stdout } = await runCommand(Usages, ['--format', 'json'], { cwd: repo() });
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.references.map((r: { key: string }) => r.key)).toEqual(['dark-mode', 'old-flag']);
  });

  it('omits the header with --headless', async () => {
    const { stdout } = await runCommand(Usages, ['--headless'], { cwd: repo() });
    expect(stdout[0]).not.toContain('Found');
  });

  it('writes to a file with --output', async () => {
    const cwd = repo();
    const out = join(cwd, 'out.json');
    const { stdout } = await runCommand(Usages, ['--format', 'json', '-o', out], { cwd });
    expect(stdout[0]).toBe(`Wrote ${out}`);
    expect(JSON.parse(readFileSync(out, 'utf8')).references).toHaveLength(2);
  });

  it('prints effective patterns with --show-regex', async () => {
    const { stdout } = await runCommand(Usages, ['--show-regex'], { cwd: repo() });
    expect(stdout[0]).toContain('node:single');
  });

  it('applies --client-name and --match-pattern', async () => {
    const cwd = tempRepo({ 'a.ts': "rp.variable('via-client');\ngetFlag(\"via-pattern\")" });
    const { stdout } = await runCommand(
      Usages,
      ['--client-name', 'rp', '--match-pattern', 'ts=getFlag\\("([^"]+)"', '--headless'],
      { cwd },
    );
    expect(stdout[0]).toContain('via-client');
    expect(stdout[0]).toContain('via-pattern');
  });

  it('rejects an invalid --match-pattern', async () => {
    const { error } = await runCommand(Usages, ['--match-pattern', 'ts=(a)(b)'], { cwd: repo() });
    expect(error?.message).toMatch(/exactly one capture group/);
  });

  it('lists only keys missing from the project with --only-unused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { keys: ['dark-mode'] })));
    const { stdout } = await runCommand(Usages, ['--only-unused', '-p', 'web', '--headless'], {
      cwd: repo(),
      env: { RP_API_TOKEN: 'rpa_x' },
    });
    expect(stdout[0]).toContain('old-flag');
    expect(stdout[0]).not.toContain('dark-mode');
  });

  it('--only-unused needs a token unless --no-api', async () => {
    const { error } = await runCommand(Usages, ['--only-unused', '-p', 'web'], { cwd: repo() });
    expect(error?.message).toMatch(/needs an API token/);
  });

  it('--only-unused needs a project', async () => {
    const { error } = await runCommand(Usages, ['--only-unused'], {
      cwd: repo(),
      env: { RP_API_TOKEN: 'rpa_x' },
    });
    expect(error?.message).toMatch(/needs a project/);
  });
});
