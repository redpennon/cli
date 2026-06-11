import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_API_URL = 'https://api.redpennon.dev';
export const AUTH_FILE_NAME = 'auth.json';

export interface ResolveInputs {
  flag?: string;
  env?: NodeJS.ProcessEnv;
  configDir?: string;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve the organisation API token in precedence order:
 * 1. `--api-token` flag, 2. `RP_API_TOKEN` env, 3. the auth file in the
 * oclif config directory (`{ "clientCredentials": { "apiToken": "rpa_..." } }`
 * or a flat `{ "apiToken": "rpa_..." }`).
 */
export function resolveApiToken(inputs: ResolveInputs = {}): string | undefined {
  const { flag, env = process.env, configDir } = inputs;
  const fromFlag = clean(flag);
  if (fromFlag) return fromFlag;
  const fromEnv = clean(env.RP_API_TOKEN);
  if (fromEnv) return fromEnv;
  if (configDir) {
    const path = join(configDir, AUTH_FILE_NAME);
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf8'));
        const token = data?.clientCredentials?.apiToken ?? data?.apiToken;
        const fromFile = clean(typeof token === 'string' ? token : undefined);
        if (fromFile) return fromFile;
      } catch {
        // Malformed auth file is treated as "no token".
      }
    }
  }
  return undefined;
}

/** Project key from `--project` then `RP_PROJECT_KEY`. */
export function resolveProject(inputs: ResolveInputs = {}): string | undefined {
  const { flag, env = process.env } = inputs;
  return clean(flag) ?? clean(env.RP_PROJECT_KEY);
}

/** API base URL from `--api-url` then `RP_API_URL`, default hosted; no trailing slash. */
export function resolveApiUrl(inputs: ResolveInputs = {}): string {
  const { flag, env = process.env } = inputs;
  const url = clean(flag) ?? clean(env.RP_API_URL) ?? DEFAULT_API_URL;
  return url.replace(/\/+$/, '');
}
