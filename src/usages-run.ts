import { buildPatterns } from './patterns.js';
import { scanRepository } from './scanner.js';
import type { CodeReference, RepoConfig } from './types.js';

export type UsagesFormat = 'console' | 'json';

export interface UsagesRunOptions {
  cwd: string;
  config: RepoConfig;
  format: UsagesFormat;
  /** When set, keep only keys NOT present in this project-keys list. */
  onlyUnusedAgainst?: string[];
  /** Suppress the human header line (machine-friendly). */
  headless?: boolean;
}

export interface UsagesRunResult {
  references: CodeReference[];
  output: string;
}

/** Render the effective patterns, one per line (`--show-regex`). */
export function formatRegex(config: RepoConfig): string {
  return buildPatterns(config)
    .map((p) => `${p.label} [${p.extensions.join(',')}] ${p.regex.source}`)
    .join('\n');
}

export function formatUsages(
  refs: CodeReference[],
  format: UsagesFormat,
  headless = false,
): string {
  if (format === 'json') {
    return JSON.stringify({ references: refs }, null, 2);
  }
  const lines = refs.map(
    (r) => `${r.key}\t${r.file}:${r.line_number}\t${r.snippet}`,
  );
  if (headless) return lines.join('\n');
  const header =
    refs.length === 0
      ? 'No variable references found.'
      : `Found ${refs.length} reference(s):`;
  return [header, ...lines].join('\n');
}

function filterUnused(
  refs: CodeReference[],
  projectKeys: string[],
): CodeReference[] {
  const known = new Set(projectKeys);
  return refs.filter((r) => !known.has(r.key));
}

export async function runUsages(
  opts: UsagesRunOptions,
): Promise<UsagesRunResult> {
  let references = await scanRepository({ cwd: opts.cwd, config: opts.config });
  if (opts.onlyUnusedAgainst) {
    references = filterUnused(references, opts.onlyUnusedAgainst);
  }
  return {
    references,
    output: formatUsages(references, opts.format, opts.headless),
  };
}
