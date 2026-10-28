import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import RepoInit from '../../src/commands/repo/init.js';
import { runCommand } from '../helpers/command.js';
import { tempRepo } from '../helpers/fs.js';

describe('rp repo init', () => {
  it('scaffolds .redpennon/config.yml', async () => {
    const cwd = tempRepo();
    const { stdout, error } = await runCommand(RepoInit, [], { cwd });
    expect(error).toBeUndefined();
    expect(stdout.join('\n')).toContain('Created .redpennon/config.yml');
    expect(existsSync(join(cwd, '.redpennon', 'config.yml'))).toBe(true);
  });

  it('refuses to overwrite without --force', async () => {
    const cwd = tempRepo({ '.redpennon/config.yml': 'clientNames: [mine]\n' });
    const { error } = await runCommand(RepoInit, [], { cwd });
    expect(error?.message).toMatch(/already exists/);
    expect(readFileSync(join(cwd, '.redpennon', 'config.yml'), 'utf8')).toBe(
      'clientNames: [mine]\n',
    );
  });

  it('overwrites with --force', async () => {
    const cwd = tempRepo({ '.redpennon/config.yml': 'clientNames: [mine]\n' });
    const { error } = await runCommand(RepoInit, ['--force'], { cwd });
    expect(error).toBeUndefined();
    expect(readFileSync(join(cwd, '.redpennon', 'config.yml'), 'utf8')).toContain('codeInsights');
  });
});
