import { mergeConfig } from './config.js';
import type { RepoConfig } from './types.js';

export interface UsagesFlagInputs {
  clientName?: string[];
  matchPattern?: string[];
  varAlias?: string[];
  include?: string[];
  exclude?: string[];
}

function splitOnce(value: string, sep: string): [string, string] | null {
  const idx = value.indexOf(sep);
  if (idx === -1) return null;
  return [value.slice(0, idx).trim(), value.slice(idx + 1).trim()];
}

/** Parse `--match-pattern ext=<regex>` entries into a per-extension map. */
export function parseMatchPatterns(entries: string[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entry of entries) {
    const pair = splitOnce(entry, '=');
    if (!pair || !pair[0] || !pair[1]) {
      throw new Error(`Invalid --match-pattern "${entry}"; expected ext=<regex>.`);
    }
    const ext = pair[0].replace(/^\./, '');
    (map[ext] ??= []).push(pair[1]);
  }
  return map;
}

/** Parse `--var-alias <from>=<to>` entries into an alias map. */
export function parseVarAliases(entries: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of entries) {
    const pair = splitOnce(entry, '=');
    if (!pair || !pair[0] || !pair[1]) {
      throw new Error(`Invalid --var-alias "${entry}"; expected <from>=<to>.`);
    }
    map[pair[0]] = pair[1];
  }
  return map;
}

/** Layer CLI flag overrides on top of a base (file/default) config. */
export function applyFlagOverrides(
  base: RepoConfig,
  flags: UsagesFlagInputs,
): RepoConfig {
  return mergeConfig(base, {
    clientNames: flags.clientName ?? [],
    matchPatterns: parseMatchPatterns(flags.matchPattern ?? []),
    variableAliases: parseVarAliases(flags.varAlias ?? []),
    includeFiles: flags.include ?? [],
    excludeFiles: flags.exclude ?? [],
  });
}
