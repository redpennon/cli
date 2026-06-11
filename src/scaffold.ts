import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { CONFIG_RELATIVE_PATH } from './config.js';

export const CONFIG_SCAFFOLD = `# RedPennon code references configuration.
# Docs: https://docs.redpennon.dev/cli/usages
codeInsights:
  # SDK client variable names whose .variable(...) calls are scanned.
  clientNames:
    - client
  # Rewrite a captured key to a canonical key, e.g. "FLAGS.DARK": dark-mode
  variableAliases: {}
  # Extra per-extension regexes (exactly one capture group = the variable key).
  matchPatterns: {}
  # Globs to scan / skip (defaults already cover ts/js/go/py + common build dirs).
  includeFiles:
    - "**/*.{ts,tsx,js,jsx,mjs,cjs,go,py}"
  excludeFiles:
    - "**/node_modules/**"
    - "**/dist/**"
`;

export interface ScaffoldResult {
  path: string;
  created: boolean;
}

/** Write the default `.redpennon/config.yml`. No-op (created:false) if it
 * already exists and `force` is not set. */
export function writeScaffold(cwd: string, force = false): ScaffoldResult {
  const path = join(cwd, CONFIG_RELATIVE_PATH);
  if (existsSync(path) && !force) {
    return { path, created: false };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, CONFIG_SCAFFOLD);
  return { path, created: true };
}
