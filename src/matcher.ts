import type { CodeReference, RepoConfig } from './types.js';
import { buildPatterns, extractArrayKeys, type UsagePattern } from './patterns.js';

export function extensionOf(file: string): string {
  const base = file.split('/').pop() ?? file;
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  return text.slice(start, end).trim();
}

/**
 * Scan a single file's text for variable-key references using the supplied
 * patterns. Applies `variableAliases` to captured keys and de-duplicates
 * identical `(key, file, line)` occurrences.
 */
export function scanText(
  text: string,
  file: string,
  patterns: UsagePattern[],
  aliases: Record<string, string> = {},
): CodeReference[] {
  const ext = extensionOf(file);
  const seen = new Set<string>();
  const refs: CodeReference[] = [];

  const add = (rawKey: string, index: number) => {
    const key = aliases[rawKey] ?? rawKey;
    const line = lineNumberAt(text, index);
    const dedupe = `${key}\u0000${line}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    refs.push({ key, file, line_number: line, snippet: lineAt(text, index) });
  };

  for (const pattern of patterns) {
    if (!pattern.extensions.includes(ext)) continue;
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      if (pattern.kind === 'array') {
        for (const key of extractArrayKeys(match[1] ?? '')) add(key, match.index);
      } else if (match[1]) {
        add(match[1], match.index);
      }
      if (match.index === pattern.regex.lastIndex) pattern.regex.lastIndex++;
    }
  }

  return refs;
}

export function scanTextWithConfig(
  text: string,
  file: string,
  config: RepoConfig,
): CodeReference[] {
  return scanText(text, file, buildPatterns(config), config.variableAliases);
}
