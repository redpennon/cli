import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js';
import { distinctKeys, scanRepository } from '../src/scanner.js';

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rp-scan-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('scanRepository', () => {
  it('scans matching files across languages and sorts results', async () => {
    const cwd = repoWith({
      'src/app.ts': "client.variable('dark-mode');",
      'pkg/main.go': 'client.Variable(ctx, "go-flag", false)',
      'svc/handler.py': "client.variable('py-flag')",
      'README.md': "client.variable('ignored-md')",
    });

    const refs = await scanRepository({ cwd, config: DEFAULT_CONFIG });
    expect(distinctKeys(refs)).toEqual(['dark-mode', 'go-flag', 'py-flag']);
    expect(refs.map((r) => r.file)).toEqual([
      'pkg/main.go',
      'src/app.ts',
      'svc/handler.py',
    ]);
  });

  it('honours excludeFiles globs', async () => {
    const cwd = repoWith({
      'src/app.ts': "client.variable('keep');",
      'dist/app.ts': "client.variable('drop');",
    });
    const refs = await scanRepository({ cwd, config: DEFAULT_CONFIG });
    expect(distinctKeys(refs)).toEqual(['keep']);
  });

  it('honours custom includeFiles globs', async () => {
    const cwd = repoWith({
      'src/app.ts': "client.variable('only-src');",
      'other/app.ts': "client.variable('not-src');",
    });
    const config = mergeConfig(DEFAULT_CONFIG, { includeFiles: ['src/**/*.ts'] });
    const refs = await scanRepository({ cwd, config });
    expect(distinctKeys(refs)).toEqual(['only-src']);
  });
});

describe('scanRepository safety limits', () => {
  it('rejects include globs with .. segments', async () => {
    const cwd = repoWith({ 'src/a.ts': "client.variable('a')" });
    const config = mergeConfig(DEFAULT_CONFIG, { includeFiles: ['../**/*.ts'] });
    await expect(scanRepository({ cwd, config })).rejects.toThrow(/outside the repository/);
  });

  it('rejects .. segments nested in braces or paths', async () => {
    const cwd = repoWith({ 'src/a.ts': "client.variable('a')" });
    for (const glob of ['src/../../x/*.ts', '{src,../other}/*.ts']) {
      const config = mergeConfig(DEFAULT_CONFIG, { includeFiles: [glob] });
      await expect(scanRepository({ cwd, config })).rejects.toThrow(/outside the repository/);
    }
  });

  it('rejects absolute include globs', async () => {
    const cwd = repoWith({ 'src/a.ts': "client.variable('a')" });
    const config = mergeConfig(DEFAULT_CONFIG, { includeFiles: ['/etc/**/*.ts'] });
    await expect(scanRepository({ cwd, config })).rejects.toThrow(/outside the repository/);
  });

  it('skips files over the size limit', async () => {
    const cwd = repoWith({
      'small.ts': "client.variable('small')",
      'big.ts': `client.variable('big')\n${'// pad\n'.repeat(200)}`,
    });
    const refs = await scanRepository({ cwd, config: DEFAULT_CONFIG, maxFileBytes: 500 });
    expect(distinctKeys(refs)).toEqual(['small']);
  });

  it('defaults the size limit to 1 MB', async () => {
    const big = `client.variable('huge')\n${'a'.repeat(1_100_000)}`;
    const cwd = repoWith({ 'huge.ts': big, 'ok.ts': "client.variable('ok')" });
    const refs = await scanRepository({ cwd, config: DEFAULT_CONFIG });
    expect(distinctKeys(refs)).toEqual(['ok']);
  });
});

