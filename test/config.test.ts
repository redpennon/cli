import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, loadConfig, mergeConfig } from '../src/config.js';

function tempRepo(configYaml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rp-config-'));
  if (configYaml !== undefined) {
    mkdirSync(join(dir, '.redpennon'), { recursive: true });
    writeFileSync(join(dir, '.redpennon', 'config.yml'), configYaml);
  }
  return dir;
}

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    expect(loadConfig(tempRepo())).toEqual(DEFAULT_CONFIG);
  });

  it('reads a codeInsights block', () => {
    const dir = tempRepo(
      [
        'codeInsights:',
        '  clientNames:',
        '    - rpClient',
        '  excludeFiles:',
        '    - "fixtures/**"',
      ].join('\n'),
    );
    const config = loadConfig(dir);
    expect(config.clientNames).toContain('client');
    expect(config.clientNames).toContain('rpClient');
    expect(config.excludeFiles).toContain('fixtures/**');
  });

  it('reads a top-level config', () => {
    const dir = tempRepo('clientNames:\n  - topLevelClient\n');
    expect(loadConfig(dir).clientNames).toContain('topLevelClient');
  });
});

describe('mergeConfig', () => {
  it('replaces includeFiles when provided', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { includeFiles: ['src/**/*.ts'] });
    expect(merged.includeFiles).toEqual(['src/**/*.ts']);
  });

  it('unions excludeFiles and client names', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      clientNames: ['extra'],
      excludeFiles: ['custom/**'],
    });
    expect(merged.clientNames).toContain('client');
    expect(merged.clientNames).toContain('extra');
    expect(merged.excludeFiles).toContain('custom/**');
    expect(merged.excludeFiles).toContain('**/node_modules/**');
  });
});

describe('matchPatterns validation', () => {
  it('accepts a valid single-capture-group pattern', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      matchPatterns: { ts: ['getFlag\\(\\s*"([^"]*)"'] },
    });
    expect(merged.matchPatterns.ts).toHaveLength(1);
  });

  it('rejects a regex that does not compile', () => {
    expect(() => mergeConfig(DEFAULT_CONFIG, { matchPatterns: { ts: ['(unclosed'] } })).toThrow(
      /Invalid matchPattern for "ts".*does not compile/s,
    );
  });

  it('rejects a pattern with no capture group', () => {
    expect(() => mergeConfig(DEFAULT_CONFIG, { matchPatterns: { ts: ['getFlag'] } })).toThrow(
      /exactly one capture group.*found 0/s,
    );
  });

  it('rejects a pattern with more than one capture group', () => {
    expect(() => mergeConfig(DEFAULT_CONFIG, { matchPatterns: { ts: ['(a)(b)'] } })).toThrow(
      /exactly one capture group.*found 2/s,
    );
  });

  it('does not count non-capturing groups or escaped parens', () => {
    expect(() =>
      mergeConfig(DEFAULT_CONFIG, { matchPatterns: { ts: ['get(?:Flag)\\(([a-z]+)'] } }),
    ).not.toThrow();
  });

  it('rejects an over-long pattern', () => {
    const long = `(${'a'.repeat(600)})`;
    expect(() => mergeConfig(DEFAULT_CONFIG, { matchPatterns: { ts: [long] } })).toThrow(
      /at most 500 characters/,
    );
  });

  it('rejects too many patterns', () => {
    const many = Array.from({ length: 51 }, (_, i) => `(k${i})`);
    expect(() => mergeConfig(DEFAULT_CONFIG, { matchPatterns: { ts: many } })).toThrow(
      /at most 50 match patterns/,
    );
  });

  it('applies to file config too', () => {
    const dir = tempRepo('matchPatterns:\n  ts:\n    - "(a)(b)"\n');
    expect(() => loadConfig(dir)).toThrow(/exactly one capture group/);
  });
});

describe('custom pattern backtracking safety (SAST #32)', () => {
  it.each([
    '(a+)+$',
    '(a*)*b',
    '(a|aa)+$',
    '((a+))+x',
    '(.*a){12}x(k)',
    '(\\w+\\s?)*(k)',
    '(x+x+)+(y)',
  ])('rejects %s', async (raw) => {
    const { validateMatchPatterns } = await import('../src/patterns.js');
    const withGroup = raw.includes('(k)') || raw.includes('(y)') ? raw : `${raw}(k)`;
    expect(() => validateMatchPatterns({ txt: [withGroup] })).toThrow(/backtrack|nested|unsafe/i);
  });

  it.each([
    'variable\\("([^"]+)"\\)',
    'getFlag\\([\'"]([\\w-]+)[\'"]',
    '(?:flags|toggles)\\.([a-z_]+)',
    '@flag\\(([A-Za-z0-9_-]+)\\)',
    'feature\\s*=\\s*"([^"]*)"',
  ])('still accepts %s', async (raw) => {
    const { validateMatchPatterns } = await import('../src/patterns.js');
    expect(() => validateMatchPatterns({ txt: [raw] })).not.toThrow();
  });
});


describe('loadConfig symlinks (SAST #29)', () => {
  it('refuses a config file that is a symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-config-'));
    mkdirSync(join(dir, '.redpennon'), { recursive: true });
    const elsewhere = join(dir, 'elsewhere.yml');
    writeFileSync(elsewhere, 'includeFiles: ["**/*.ts"]\n');
    symlinkSync(elsewhere, join(dir, '.redpennon', 'config.yml'));
    expect(() => loadConfig(dir)).toThrow(/symlink/i);
  });
});
