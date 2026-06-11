import { resolveApiUrl } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { publishReferences } from '../src/publish.js';
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
    const cwd = deps.cwd ?? process.cwd();

    const config = loadConfig(cwd);
    const references = await scanRepository({ cwd, config });

    const { snapshot, result } = await publishReferences({
      apiUrl: resolveApiUrl({ flag: apiUrlInput, env: deps.env }),
      apiToken,
      project,
      references,
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
  } catch (error) {
    deps.setFailed(error instanceof Error ? error.message : String(error));
  }
}
