import { ApiClient } from './api.js';
import type { CodeReference, IngestResult, IngestSnapshot } from './types.js';
import { resolveGitContext, type GitContext } from './git.js';

export interface BuildSnapshotInputs {
  project: string;
  provider?: string;
  git: GitContext;
  references: CodeReference[];
}

export function buildSnapshot(inputs: BuildSnapshotInputs): IngestSnapshot {
  return {
    project: inputs.project,
    provider: inputs.provider ?? inputs.git.provider ?? 'github',
    repository: inputs.git.repository,
    branch: inputs.git.branch,
    commit_sha: inputs.git.commit_sha,
    references: inputs.references,
  };
}

export interface PublishInputs {
  apiUrl: string;
  apiToken: string;
  project: string;
  provider?: string;
  references: CodeReference[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  fetchImpl?: typeof fetch;
  overrides?: Partial<GitContext>;
}

/**
 * Resolve git context, build the snapshot, and POST it. Used by the GitHub
 * Action (the side-effecting half); `rp usages` itself never calls this.
 */
export async function publishReferences(
  inputs: PublishInputs,
): Promise<{ snapshot: IngestSnapshot; result: IngestResult }> {
  const git = resolveGitContext({ env: inputs.env, cwd: inputs.cwd, overrides: inputs.overrides });
  const snapshot = buildSnapshot({
    project: inputs.project,
    provider: inputs.provider,
    git,
    references: inputs.references,
  });
  const client = new ApiClient({
    apiUrl: inputs.apiUrl,
    apiToken: inputs.apiToken,
    fetchImpl: inputs.fetchImpl,
  });
  const result = await client.ingest(snapshot);
  return { snapshot, result };
}
