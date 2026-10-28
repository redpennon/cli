import { existsSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { resolveApiUrl } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { DEFAULT_MAX_REFERENCES, publishReferences } from '../src/publish.js';
import { scanRepository } from '../src/scanner.js';

export interface ActionDeps {
  getInput: (name: string, opts?: { required?: boolean }) => string;
  info: (message: string) => void;
  warning: (message: string) => void;
  setOutput: (name: string, value: string | number) => void;
  setFailed: (message: string) => void;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fetchImpl?: typeof fetch;
}

/** Resolve `working-directory` against the workspace; it must stay inside it. */
function resolveWorkingDirectory(base: string, input: string | undefined): string {
  if (!input) return base;
  const dir = resolve(base, input);
  const rel = relative(base, dir);
  if (rel.startsWith('..') || resolve(base, rel) !== dir) {
    throw new Error(`working-directory "${input}" is outside the workspace.`);
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`working-directory "${input}" does not exist or is not a directory.`);
  }
  return dir;
}

function parseMaxReferences(input: string | undefined): number {
  if (!input) return DEFAULT_MAX_REFERENCES;
  const value = Number(input);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`max-references must be a positive integer (got "${input}").`);
  }
  return value;
}

/**
 * The side-effecting half of the workflow: scan the checked-out repo, resolve
 * the Git context, and POST the snapshot. Dependency-injected so it can be
 * tested without the GitHub Actions runtime.
 */
export async function runAction(deps: ActionDeps): Promise<void> {
  try {
    const apiToken = deps.getInput('api-token', { required: true });
    const project = deps.getInput('project', { required: true });
    const apiUrlInput = deps.getInput('api-url') || undefined;
    const failOnUnknown = deps.getInput('fail-on-unknown').trim().toLowerCase() === 'true';
    const maxReferences = parseMaxReferences(deps.getInput('max-references').trim());
    const cwd = resolveWorkingDirectory(
      deps.cwd ?? process.cwd(),
      deps.getInput('working-directory').trim() || undefined,
    );
    const configPath = deps.getInput('config-path').trim() || undefined;
    if (configPath && !existsSync(resolve(cwd, configPath))) {
      throw new Error(`config-path "${configPath}" was not found (relative to ${cwd}).`);
    }

    const config = loadConfig(cwd, configPath);
    const references = await scanRepository({ cwd, config });

    const { snapshot, result } = await publishReferences({
      apiUrl: resolveApiUrl({ flag: apiUrlInput, env: deps.env }),
      apiToken,
      project,
      references,
      maxReferences,
      env: deps.env,
      cwd,
      fetchImpl: deps.fetchImpl,
    });

    deps.info(
      `Scanned ${references.length} reference(s) in ${snapshot.repository}@${snapshot.branch}.`,
    );
    deps.info(
      `accepted=${result.accepted} matched=${result.matched} unknown=${result.unknown_keys.length}`,
    );
    if (result.unknown_keys.length > 0) {
      deps.warning(
        `Keys not found in project "${project}": ${result.unknown_keys.join(', ')}`,
      );
    }

    deps.setOutput('accepted', result.accepted);
    deps.setOutput('matched', result.matched);
    deps.setOutput('unknown-keys', result.unknown_keys.join(','));

    if (failOnUnknown && result.unknown_keys.length > 0) {
      deps.setFailed(
        `${result.unknown_keys.length} key(s) not found in project "${project}": ${result.unknown_keys.join(', ')}`,
      );
    }
  } catch (error) {
    deps.setFailed(error instanceof Error ? error.message : String(error));
  }
}
