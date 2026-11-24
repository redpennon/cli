import type { CodeReference, RepoConfig } from './types.js';
import { buildPatterns, extractArrayKeys, type UsagePattern } from './patterns.js';

export function extensionOf(file: string): string {
  const base = file.split('/').pop() ?? file;
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
}

/** Start offset of every line, so a match index maps to a line by binary search. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }
  return starts;
}

/** 1-based line number containing `index`. */
function lineNumberAt(starts: number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export const MAX_SNIPPET_LENGTH = 200;

const REDACTED = '[REDACTED]';

/**
 * Longest stretch of the line, either side of the matched call, that is
 * inspected for secrets. The stored snippet is capped at MAX_SNIPPET_LENGTH
 * anyway, so scanning the rest of an arbitrarily long line only gives a
 * hostile file a way to make the regexes backtrack (SAST #31).
 */
const REDACTION_WINDOW = 400;

// Every quantifier is bounded so no pattern can backtrack super-linearly
// on a long run of identifier characters.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/\brpa_[A-Za-z0-9_-]{8,256}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED],
  [/\bBearer\s{1,8}[A-Za-z0-9._~+/=-]{8,512}/gi, `Bearer ${REDACTED}`],
  [
    /([\w.-]{0,64}(?:password|passwd|secret|token|api[_-]?key)[\w.-]{0,64}\s{0,8}[:=]\s{0,8})(['"]?)[^\s'",;)]{1,512}\2/gi,
    `$1${REDACTED}`,
  ],
  // Payment, source-host, chat and cloud credentials with a recognisable prefix.
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,256}/g, REDACTED],
  [/\b(?:pk|whsec)_(?:live_)?[A-Za-z0-9]{16,256}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,256}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,256}/g, REDACTED],
  [/\bglpat-[A-Za-z0-9_-]{16,256}/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,256}/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}/g, REDACTED],
  // JWTs: three base64url segments, the first two starting "eyJ".
  [/\beyJ[A-Za-z0-9_-]{4,512}\.eyJ[A-Za-z0-9_-]{4,512}\.[A-Za-z0-9_-]{0,512}/g, REDACTED],
  // Credentials embedded in a URL: scheme://user:password@host
  [/(\b[a-z][a-z0-9+.-]{1,16}:\/\/)[^\s/@:'"]{1,128}:[^\s/@'"]{1,128}@/gi, `$1${REDACTED}@`],
  // PEM private key armour.
  [/-----BEGIN [A-Z ]{0,32}PRIVATE KEY-----/g, REDACTED],
];

/** Mask recognisable secret shapes (tokens, cloud and payment keys, key=value credentials, URL credentials). */
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
  const col = index - start;
  const matchLen = Math.min(matchText.split('\n')[0].length, end - start - col);

  // Only a bounded window around the match is read and redacted.
  const preFrom = Math.max(start, index - REDACTION_WINDOW);
  const postTo = Math.min(end, index + matchLen + REDACTION_WINDOW);
  const pre = redactSecrets(text.slice(preFrom, index));
  const mid = text.slice(index, index + matchLen);
  const post = redactSecrets(text.slice(index + matchLen, postTo));
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
  const starts = lineStarts(text);
  const seen = new Set<string>();
  const refs: CodeReference[] = [];

  const onCommentLine = (pattern: UsagePattern, index: number): boolean => {
    if (!pattern.commentPrefixes) return false;
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    const before = text.slice(lineStart, index).trimStart();
    // Only a *leading* comment marker counts; the match must sit on that comment line.
    return before === '' ? false : pattern.commentPrefixes.some((p) => before.startsWith(p));
  };

  const add = (rawKey: string, index: number, matchText: string) => {
    const key = aliases[rawKey] ?? rawKey;
    const line = lineNumberAt(starts, index);
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
      if (onCommentLine(pattern, match.index)) {
        if (match.index === pattern.regex.lastIndex) pattern.regex.lastIndex++;
        continue;
      }
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
