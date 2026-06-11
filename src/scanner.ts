import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import { buildPatterns } from './patterns.js';
import { scanText } from './matcher.js';
import type { CodeReference, RepoConfig } from './types.js';

export interface ScanOptions {
  cwd: string;
  config: RepoConfig;
}

/**
 * Walk the working tree under `cwd` (bounded by the config's include/exclude
 * globs) and return every variable-key reference, sorted by file then line.
 * Side-effect-free — reads files only; never posts.
 */
export async function scanRepository(opts: ScanOptions): Promise<CodeReference[]> {
  const files = await fg(opts.config.includeFiles, {
    cwd: opts.cwd,
    ignore: opts.config.excludeFiles,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
  });

  const patterns = buildPatterns(opts.config);
  const refs: CodeReference[] = [];
  for (const rel of files.sort()) {
    let text: string;
    try {
      text = readFileSync(join(opts.cwd, rel), 'utf8');
    } catch {
      continue;
    }
    refs.push(...scanText(text, rel, patterns, opts.config.variableAliases));
  }

  refs.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line_number - b.line_number,
  );
  return refs;
}

/** Distinct keys present in a reference list, sorted. */
export function distinctKeys(refs: CodeReference[]): string[] {
  return [...new Set(refs.map((r) => r.key))].sort();
}
