import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_API_URL = 'https://api.redpennon.dev';
export const AUTH_FILE_NAME = 'auth.json';

export interface ResolveInputs {
  flag?: string;
  env?: NodeJS.ProcessEnv;
  configDir?: string;
  /** Receives non-fatal warnings (e.g. a too-permissive auth file). */
  warn?: (message: string) => void;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Warn (non-Windows) when the auth file is readable by group or others. */
function warnIfInsecure(path: string, warn: ((message: string) => void) | undefined): void {
  if (!warn || process.platform === 'win32') return;
  try {
    const mode = statSync(path).mode & 0o777;
    if (mode & 0o077) {
      warn(
        `${path} is readable by other users (mode ${mode.toString(8)}). Run: chmod 600 "${path}"`,
      );
    }
  } catch {
    // Unreadable stat is not worth failing over.
  }
}

/** Display form of a token that reveals only the `rpa_` prefix. */
export function maskToken(token: string): string {
  return token.startsWith('rpa_') ? 'rpa_…' : '…';
}

/**
 * Resolve the organisation API token in precedence order:
 * 1. `--api-token` flag, 2. `RP_API_TOKEN` env, 3. the auth file in the
 * oclif config directory (`{ "clientCredentials": { "apiToken": "rpa_..." } }`
 * or a flat `{ "apiToken": "rpa_..." }`).
 */
export function resolveApiToken(inputs: ResolveInputs = {}): string | undefined {
  const { flag, env = process.env, configDir, warn } = inputs;
  const fromFlag = clean(flag);
  if (fromFlag) return fromFlag;
  const fromEnv = clean(env.RP_API_TOKEN);
  if (fromEnv) return fromEnv;
  if (configDir) {
    const path = join(configDir, AUTH_FILE_NAME);
    if (existsSync(path)) {
      warnIfInsecure(path, warn);
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

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Validate that the API URL is https (plain http only for loopback hosts). */
function assertSecureApiUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid API URL "${url}": not a valid URL.`);
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return;
  throw new Error(
    `Insecure API URL "${url}": the API token would be sent in clear text. ` +
      'Use an https:// URL (plain http:// is only allowed for localhost, 127.0.0.1 and [::1]).',
  );
}

/**
 * API base URL from `--api-url` then `RP_API_URL`, default hosted; no trailing
 * slash. Must be https unless it targets a loopback host.
 */
export function resolveApiUrl(inputs: ResolveInputs = {}): string {
  const { flag, env = process.env } = inputs;
  const url = clean(flag) ?? clean(env.RP_API_URL) ?? DEFAULT_API_URL;
  assertSecureApiUrl(url);
  return url.replace(/\/+$/, '');
}
