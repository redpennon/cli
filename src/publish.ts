import { ApiClient } from './api.js';
import type { CodeReference, IngestResult, IngestSnapshot } from './types.js';
import { resolveGitContext, type GitContext } from './git.js';

/**
 * Client-side guard: the API contract in this repo documents no per-request
 * limit, so this only stops runaway scans (e.g. a minified bundle that slipped
 * past the excludes) from producing an enormous request body.
 */
export const DEFAULT_MAX_REFERENCES = 2_000;

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
  /** Error instead of posting more references than this. Defaults to 2,000, the API's per-snapshot limit. */
  maxReferences?: number;
}

/**
 * Resolve git context, build the snapshot, and POST it. Used by the GitHub
 * Action (the side-effecting half); `rp usages` itself never calls this.
 */
export async function publishReferences(
  inputs: PublishInputs,
): Promise<{ snapshot: IngestSnapshot; result: IngestResult }> {
  const max = inputs.maxReferences ?? DEFAULT_MAX_REFERENCES;
  if (inputs.references.length > max) {
    throw new Error(
      `Found ${inputs.references.length} references, but the limit is ${max}. ` +
        'Narrow the scan with include/exclude globs, or raise the limit (--max-references / max-references).',
    );
  }
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
