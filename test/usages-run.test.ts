import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../src/config.js';
import {
  applyFlagOverrides,
  parseMatchPatterns,
  parseVarAliases,
} from '../src/flag-config.js';
import { formatRegex, formatUsages, runUsages } from '../src/usages-run.js';
import { buildSnapshot } from '../src/publish.js';
import type { CodeReference } from '../src/types.js';

const refs: CodeReference[] = [
  { key: 'dark-mode', file: 'a.ts', line_number: 2, snippet: "client.variable('dark-mode')" },
];

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rp-usages-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('flag parsing', () => {
  it('parses match patterns into a per-extension map', () => {
    expect(parseMatchPatterns(['ts=foo\\(([\\w-]+)\\)', '.go=bar'])).toEqual({
      ts: ['foo\\(([\\w-]+)\\)'],
      go: ['bar'],
    });
  });

  it('rejects a malformed match pattern', () => {
    expect(() => parseMatchPatterns(['nope'])).toThrow(/ext=/);
  });

  it('parses var aliases', () => {
    expect(parseVarAliases(['A=a', 'B=b'])).toEqual({ A: 'a', B: 'b' });
  });

  it('layers overrides onto the base config', () => {
    const config = applyFlagOverrides(DEFAULT_CONFIG, {
      clientName: ['rpClient'],
      include: ['src/**/*.ts'],
    });
    expect(config.clientNames).toContain('rpClient');
    expect(config.includeFiles).toEqual(['src/**/*.ts']);
  });
});

describe('formatUsages', () => {
  it('emits JSON with a references array', () => {
    expect(JSON.parse(formatUsages(refs, 'json'))).toEqual({ references: refs });
  });

  it('emits a console header and rows', () => {
    const out = formatUsages(refs, 'console');
    expect(out).toContain('Found 1 reference(s):');
    expect(out).toContain('dark-mode');
  });

  it('omits the header in headless mode', () => {
    expect(formatUsages(refs, 'console', true)).not.toContain('Found');
  });

  it('reports an empty result clearly', () => {
    expect(formatUsages([], 'console')).toBe('No variable references found.');
  });
});

describe('formatRegex', () => {
  it('lists the built-in pattern labels', () => {
    const out = formatRegex(DEFAULT_CONFIG);
    expect(out).toContain('node:single');
    expect(out).toContain('go:single');
    expect(out).toContain('python:batch');
  });
});

describe('runUsages', () => {
  it('scans and formats from the working tree', async () => {
    const cwd = repoWith({ 'a.ts': "client.variable('dark-mode')" });
    const result = await runUsages({ cwd, config: DEFAULT_CONFIG, format: 'json' });
    expect(result.references.map((r) => r.key)).toEqual(['dark-mode']);
  });

  it('filters to only unused keys when given project keys', async () => {
    const cwd = repoWith({
      'a.ts': "client.variable('known'); client.variable('orphan');",
    });
    const result = await runUsages({
      cwd,
      config: DEFAULT_CONFIG,
      format: 'json',
      onlyUnusedAgainst: ['known'],
    });
    expect(result.references.map((r) => r.key)).toEqual(['orphan']);
  });
});

describe('buildSnapshot', () => {
  it('assembles the ingest payload from git context', () => {
    const snapshot = buildSnapshot({
      project: 'web',
      git: { repository: 'acme/web', branch: 'main', commit_sha: 'abc' },
      references: refs,
    });
    expect(snapshot).toEqual({
      project: 'web',
      provider: 'github',
      repository: 'acme/web',
      branch: 'main',
      commit_sha: 'abc',
      references: refs,
    });
  });
});
