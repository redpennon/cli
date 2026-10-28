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

export const MAX_SNIPPET_LENGTH = 200;

const REDACTED = '[REDACTED]';

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\brpa_[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`],
  [
    /([\w.-]*(?:password|passwd|secret|token|api[_-]?key)[\w.-]*\s*[:=]\s*)(['"]?)[^\s'",;)]+\2/gi,
    `$1${REDACTED}`,
  ],
];

/** Mask obvious secret shapes (rpa_ tokens, AWS keys, Bearer tokens, key=value credentials). */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [re, replacement]) => acc.replace(re, replacement), text);
}

/**
 * Build the stored snippet for a match: the source line, secrets redacted
 * (the matched call itself is kept verbatim), capped at MAX_SNIPPET_LENGTH
 * with the window centred on the match.
 */
function snippetAt(text: string, index: number, matchText: string): string {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  const line = text.slice(start, end);
  const col = index - start;
  const matchLen = Math.min(matchText.split('\n')[0].length, line.length - col);

  const pre = redactSecrets(line.slice(0, col));
  const mid = line.slice(col, col + matchLen);
  const post = redactSecrets(line.slice(col + matchLen));
  const full = pre + mid + post;
  if (full.length <= MAX_SNIPPET_LENGTH) return full.trim();

  const from = Math.max(0, Math.min(pre.length - 40, full.length - MAX_SNIPPET_LENGTH));
  return full.slice(from, from + MAX_SNIPPET_LENGTH).trim();
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

  const add = (rawKey: string, index: number, matchText: string) => {
    const key = aliases[rawKey] ?? rawKey;
    const line = lineNumberAt(text, index);
    const dedupe = `${key}\u0000${line}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    refs.push({ key, file, line_number: line, snippet: snippetAt(text, index, matchText) });
  };

  for (const pattern of patterns) {
    if (!pattern.extensions.includes(ext)) continue;
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      if (pattern.kind === 'array') {
        for (const key of extractArrayKeys(match[1] ?? '')) add(key, match.index, match[0]);
      } else if (match[1]) {
        add(match[1], match.index, match[0]);
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
