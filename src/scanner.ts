import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import fg from 'fast-glob';

import { buildPatterns } from './patterns.js';
import { scanText } from './matcher.js';
import type { CodeReference, RepoConfig } from './types.js';

/** Files larger than this are skipped (generated bundles, data dumps). */
export const DEFAULT_MAX_FILE_BYTES = 1_000_000;

export interface ScanOptions {
  cwd: string;
  config: RepoConfig;
  /** Skip files larger than this many bytes. Defaults to 1 MB. */
  maxFileBytes?: number;
}

function assertInsideCwd(globs: string[]): void {
  for (const glob of globs) {
    const pattern = glob.replace(/^!/, '');
    const escapes =
      isAbsolute(pattern) ||
      /^[a-zA-Z]:[\\/]/.test(pattern) ||
      pattern.split(/[\\/{},]/).includes('..');
    if (escapes) {
      throw new Error(
        `Include glob "${glob}" points outside the repository; include globs must be relative to the repository root and contain no ".." segments.`,
      );
    }
  }
}

/**
 * Walk the working tree under `cwd` (bounded by the config's include/exclude
 * globs) and return every variable-key reference, sorted by file then line.
 * Side-effect-free — reads files only; never posts.
 */
export async function scanRepository(opts: ScanOptions): Promise<CodeReference[]> {
  assertInsideCwd(opts.config.includeFiles);
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
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
      const full = join(opts.cwd, rel);
      if (statSync(full).size > maxBytes) continue;
      text = readFileSync(full, 'utf8');
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
