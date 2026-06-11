import type { RepoConfig } from './types.js';

export interface UsagePattern {
  /** File extensions (without leading dot) this pattern applies to. */
  extensions: string[];
  /** Global regex; capture group 1 is the key (single) or the array body (array). */
  regex: RegExp;
  kind: 'single' | 'array';
  /** Human label, surfaced by `--show-regex`. */
  label: string;
}

const TS_EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];
const PY_EXTS = ['py'];
const GO_EXTS = ['go'];

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
      regex: new RegExp(
        `\\b(?:${clients})\\.(?:variable|variableValue)\\(\\s*['"]([\\w-]+)['"]`,
        'g',
      ),
    },
    {
      extensions: TS_EXTS,
      kind: 'array',
      label: 'node:batch',
      regex: new RegExp(`\\b(?:${clients})\\.variables\\(\\s*\\[([^\\]]*)\\]`, 'g'),
    },
    {
      extensions: PY_EXTS,
      kind: 'single',
      label: 'python:single',
      regex: new RegExp(
        `\\b(?:${clients})\\.(?:variable|variable_value)\\(\\s*['"]([\\w-]+)['"]`,
        'g',
      ),
    },
    {
      extensions: PY_EXTS,
      kind: 'array',
      label: 'python:batch',
      regex: new RegExp(`\\b(?:${clients})\\.variables\\(\\s*\\[([^\\]]*)\\]`, 'g'),
    },
    {
      extensions: GO_EXTS,
      kind: 'single',
      label: 'go:single',
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
