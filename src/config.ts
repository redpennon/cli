import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

import type { RepoConfig } from './types.js';

export const CONFIG_RELATIVE_PATH = join('.redpennon', 'config.yml');

export const DEFAULT_CONFIG: RepoConfig = {
  clientNames: ['client'],
  variableAliases: {},
  matchPatterns: {},
  includeFiles: ['**/*.{ts,tsx,js,jsx,mjs,cjs,go,py}'],
  excludeFiles: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/vendor/**',
    '**/.git/**',
    '**/*.min.js',
  ],
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function mergePatterns(
  base: Record<string, string[]>,
  override: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const [ext, list] of Object.entries(base)) merged[ext] = [...list];
  for (const [ext, list] of Object.entries(override ?? {})) {
    merged[ext] = unique([...(merged[ext] ?? []), ...list]);
  }
  return merged;
}

/** Merge a partial config (from file or flags) over a base config. */
export function mergeConfig(
  base: RepoConfig,
  override: Partial<RepoConfig> | undefined,
): RepoConfig {
  const o = override ?? {};
  return {
    clientNames: unique([...base.clientNames, ...(o.clientNames ?? [])]),
    variableAliases: { ...base.variableAliases, ...(o.variableAliases ?? {}) },
    matchPatterns: mergePatterns(base.matchPatterns, o.matchPatterns),
    includeFiles:
      o.includeFiles && o.includeFiles.length > 0
        ? o.includeFiles
        : base.includeFiles,
    excludeFiles: unique([...base.excludeFiles, ...(o.excludeFiles ?? [])]),
  };
}

/**
 * Load `.redpennon/config.yml` from the repo root, merged over the defaults.
 * Supports both a top-level config and a DevCycle-style `codeInsights:` block.
 * Returns the defaults unchanged when no file is present.
 */
export function loadConfig(repoRoot: string): RepoConfig {
  const path = join(repoRoot, CONFIG_RELATIVE_PATH);
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };
  const raw = parse(readFileSync(path, 'utf8')) ?? {};
  const block = (raw.codeInsights ?? raw) as Partial<RepoConfig>;
  return mergeConfig(DEFAULT_CONFIG, block);
}
