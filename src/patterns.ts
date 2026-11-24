import type { RepoConfig } from './types.js';

export interface UsagePattern {
  /** File extensions (without leading dot) this pattern applies to. */
  extensions: string[];
  /** Global regex; capture group 1 is the key (single) or the array body (array). */
  regex: RegExp;
  kind: 'single' | 'array';
  /** Human label, surfaced by `--show-regex`. */
  label: string;
  /** Matches on a line starting with one of these (after indent) are ignored. Built-ins only. */
  commentPrefixes?: string[];
}

const TS_EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];
const PY_EXTS = ['py'];
const GO_EXTS = ['go'];

const C_COMMENTS = ['//', '/*', '*'];
const PY_COMMENTS = ['#'];

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clientGroup(clientNames: string[]): string {
  const names = clientNames.length > 0 ? clientNames : ['client'];
  return names.map(escape).join('|');
}

/**
 * Build the effective pattern set: the built-in SDK shapes for Node, Go, and
 * Python (single + batch array calls) plus any custom per-extension regexes
 * from config. Matching is pattern-capture — no list of keys is required.
 */
export function buildPatterns(config: RepoConfig): UsagePattern[] {
  const clients = clientGroup(config.clientNames);
  const patterns: UsagePattern[] = [
    {
      extensions: TS_EXTS,
      kind: 'single',
      label: 'node:single',
      commentPrefixes: C_COMMENTS,
      regex: new RegExp(
        `\\b(?:${clients})\\.(?:variable|variableValue)\\(\\s*['"]([\\w-]+)['"]`,
        'g',
      ),
    },
    {
      extensions: TS_EXTS,
      kind: 'array',
      label: 'node:batch',
      commentPrefixes: C_COMMENTS,
      regex: new RegExp(`\\b(?:${clients})\\.variables\\(\\s*\\[([^\\]]*)\\]`, 'g'),
    },
    {
      extensions: PY_EXTS,
      kind: 'single',
      label: 'python:single',
      commentPrefixes: PY_COMMENTS,
      regex: new RegExp(
        `\\b(?:${clients})\\.(?:variable|variable_value)\\(\\s*['"]([\\w-]+)['"]`,
        'g',
      ),
    },
    {
      extensions: PY_EXTS,
      kind: 'array',
      label: 'python:batch',
      commentPrefixes: PY_COMMENTS,
      regex: new RegExp(`\\b(?:${clients})\\.variables\\(\\s*\\[([^\\]]*)\\]`, 'g'),
    },
    {
      extensions: GO_EXTS,
      kind: 'single',
      label: 'go:single',
      commentPrefixes: C_COMMENTS,
      regex: new RegExp(
        `\\b(?:${clients})\\.(?:Variable|VariableValue)\\([^,]*,\\s*"([\\w-]+)"`,
        'g',
      ),
    },
  ];

  for (const [ext, regexes] of Object.entries(config.matchPatterns)) {
    for (const raw of regexes) {
      patterns.push({
        extensions: [ext.replace(/^\./, '')],
        kind: 'single',
        label: `custom:${ext}`,
        regex: new RegExp(raw, 'g'),
      });
    }
  }

  return patterns;
}

/**
 * True when `raw` repeats a group that itself repeats or branches, e.g.
 * `(a+)+`, `(a*)*`, `(a|aa)+`, `(.*a){12}`. These are the shapes whose
 * backtracking is exponential: a hostile `.redpennon/config.yml` could hang
 * every scan with one (SAST #32). Conservative by design — a few exotic
 * but safe patterns are refused, and the error says how to rewrite them.
 */
export function hasNestedQuantifier(raw: string): boolean {
  interface Frame { repeats: boolean }
  const stack: Frame[] = [];
  let i = 0;

  /** Does the quantifier starting at `at` allow more than one repetition? Returns [multi, length]. */
  const quantifierAt = (at: number): [boolean, number] => {
    const ch = raw[at];
    if (ch === '*' || ch === '+') return [true, 1 + (raw[at + 1] === '?' ? 1 : 0)];
    if (ch === '?') return [false, 1 + (raw[at + 1] === '?' ? 1 : 0)];
    if (ch === '{') {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(raw.slice(at));
      if (m) {
        const max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : Number(m[1]);
        return [max > 1, m[0].length + (raw[at + m[0].length] === '?' ? 1 : 0)];
      }
    }
    return [false, 0];
  };

  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '[') {
      i++;
      while (i < raw.length && raw[i] !== ']') i += raw[i] === '\\' ? 2 : 1;
      i++;
      const [multi, len] = quantifierAt(i);
      if (multi && stack.length) stack[stack.length - 1].repeats = true;
      i += len;
      continue;
    }
    if (ch === '(') { stack.push({ repeats: false }); i++; continue; }
    if (ch === '|') { if (stack.length) stack[stack.length - 1].repeats = true; i++; continue; }
    if (ch === ')') {
      const frame = stack.pop();
      i++;
      const [multi, len] = quantifierAt(i);
      if (multi && frame?.repeats) return true;
      if (stack.length && (multi || frame?.repeats)) stack[stack.length - 1].repeats = true;
      i += len;
      continue;
    }
    const [multi, len] = quantifierAt(i);
    if (len > 0) {
      if (multi && stack.length) stack[stack.length - 1].repeats = true;
      i += len;
      continue;
    }
    // A plain atom (literal, `.`, class escape) followed by a quantifier is handled above
    // on the next iteration; here just advance, noting a quantified atom.
    const [atomMulti, atomLen] = quantifierAt(i + 1);
    if (atomMulti && stack.length) stack[stack.length - 1].repeats = true;
    i += 1 + atomLen;
  }
  return false;
}

export const MAX_PATTERN_LENGTH = 500;
export const MAX_MATCH_PATTERNS = 50;

/**
 * Validate custom per-extension regexes: each must be a string of bounded
 * length, compile, and contain exactly one capture group (the variable key).
 * Total count is bounded too. Throws a descriptive Error on the first problem.
 */
export function validateMatchPatterns(patterns: Record<string, string[]>): void {
  let total = 0;
  for (const [ext, list] of Object.entries(patterns)) {
    if (!Array.isArray(list)) {
      throw new Error(`Invalid matchPatterns for "${ext}": expected a list of regex strings.`);
    }
    for (const raw of list) {
      total++;
      if (total > MAX_MATCH_PATTERNS) {
        throw new Error(`Too many matchPatterns: at most ${MAX_MATCH_PATTERNS} match patterns are allowed.`);
      }
      if (typeof raw !== 'string') {
        throw new Error(`Invalid matchPattern for "${ext}": expected a regex string.`);
      }
      if (raw.length > MAX_PATTERN_LENGTH) {
        throw new Error(
          `Invalid matchPattern for "${ext}": pattern must be at most ${MAX_PATTERN_LENGTH} characters (got ${raw.length}).`,
        );
      }
      let groups: number;
      try {
        // Appending an empty alternative makes the regex match "", so the result
        // length is 1 + the number of capture groups.
        groups = (new RegExp(`${raw}|`).exec('') as RegExpExecArray).length - 1;
        new RegExp(raw);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid matchPattern for "${ext}": "${raw}" does not compile (${reason}).`);
      }
      if (hasNestedQuantifier(raw)) {
        throw new Error(
          `Invalid matchPattern for "${ext}": "${raw}" repeats a group that already repeats or branches (for example "(a+)+"), ` +
            'which can backtrack catastrophically. Rewrite it without nested quantifiers.',
        );
      }
      if (groups !== 1) {
        throw new Error(
          `Invalid matchPattern for "${ext}": "${raw}" must have exactly one capture group (the variable key), found ${groups}.`,
        );
      }
    }
  }
}

/** Quoted strings inside a batch array body, e.g. `'a', "b"` -> ['a','b']. */
export function extractArrayKeys(body: string): string[] {
  const keys: string[] = [];
  const re = /['"]([\w-]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}
