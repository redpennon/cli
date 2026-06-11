import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
