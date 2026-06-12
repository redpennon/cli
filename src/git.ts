import { execFileSync } from 'node:child_process';

export interface GitContext {
  provider: string;
  repository: string;
  branch: string;
  commit_sha: string;
}

export type GitRunner = (args: string[]) => string;

const defaultRunner: GitRunner = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * Normalise a Git remote URL to `owner/repo`. Handles SSH
 * (`git@github.com:owner/repo.git`), HTTPS (`https://host/owner/repo.git`),
 * and self-hosted subgroups (keeps the final two path segments).
 */
export function parseRepository(remoteUrl: string): string {
  let path = remoteUrl.trim();
  const sshMatch = path.match(/^[^@]+@[^:]+:(.+)$/);
  if (sshMatch) {
    path = sshMatch[1];
  } else {
    path = path.replace(/^[a-z]+:\/\/[^/]+\//i, '');
  }
  path = path.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const segments = path.split('/').filter(Boolean);
  if (segments.length < 2) return path;
  return segments.slice(-2).join('/');
}

function safe(runner: GitRunner, args: string[]): string {
  try {
    return runner(args);
  } catch {
    return '';
  }
}

export interface GitContextInputs {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  runner?: GitRunner;
  overrides?: Partial<GitContext>;
}

/**
 * Resolve the Git context, preferring explicit overrides, then provider-specific
 * CI env vars (GitHub Actions, GitLab CI, Bitbucket Pipelines), then local git.
 *
 * Provider detection order:
 *  1. `GITLAB_CI=true`   → gitlab  (CI_PROJECT_PATH / CI_COMMIT_REF_NAME / CI_COMMIT_SHA)
 *  2. `BITBUCKET_WORKSPACE` present → bitbucket (BITBUCKET_REPO_FULL_NAME / BITBUCKET_BRANCH / BITBUCKET_COMMIT)
 *  3. `GITHUB_ACTIONS=true` or GITHUB_REPOSITORY present → github
 *  4. Local git fallback → provider defaults to "github"
 */
export function resolveGitContext(inputs: GitContextInputs = {}): GitContext {
  const { env = process.env, runner = defaultRunner, overrides = {} } = inputs;

  const isGitLab = env.GITLAB_CI === 'true';
  const isBitbucket = Boolean(env.BITBUCKET_WORKSPACE || env.BITBUCKET_REPO_FULL_NAME);
  const isGitHub = Boolean(env.GITHUB_ACTIONS || env.GITHUB_REPOSITORY);

  let provider: string;
  let repository: string;
  let branch: string;
  let commit_sha: string;

  if (isGitLab) {
    provider = 'gitlab';
    repository =
      overrides.repository?.trim() ||
      env.CI_PROJECT_PATH?.trim() ||
      parseRepository(safe(runner, ['remote', 'get-url', 'origin']));
    branch =
      overrides.branch?.trim() ||
      env.CI_COMMIT_REF_NAME?.trim() ||
      safe(runner, ['rev-parse', '--abbrev-ref', 'HEAD']);
    commit_sha =
      overrides.commit_sha?.trim() ||
      env.CI_COMMIT_SHA?.trim() ||
      safe(runner, ['rev-parse', 'HEAD']);
  } else if (isBitbucket) {
    provider = 'bitbucket';
    repository =
      overrides.repository?.trim() ||
      env.BITBUCKET_REPO_FULL_NAME?.trim() ||
      parseRepository(safe(runner, ['remote', 'get-url', 'origin']));
    branch =
      overrides.branch?.trim() ||
      env.BITBUCKET_BRANCH?.trim() ||
      safe(runner, ['rev-parse', '--abbrev-ref', 'HEAD']);
    commit_sha =
      overrides.commit_sha?.trim() ||
      env.BITBUCKET_COMMIT?.trim() ||
      safe(runner, ['rev-parse', 'HEAD']);
  } else {
    provider = isGitHub ? 'github' : 'github';
    repository =
      overrides.repository?.trim() ||
      env.GITHUB_REPOSITORY?.trim() ||
      parseRepository(safe(runner, ['remote', 'get-url', 'origin']));
    branch =
      overrides.branch?.trim() ||
      env.GITHUB_REF_NAME?.trim() ||
      safe(runner, ['rev-parse', '--abbrev-ref', 'HEAD']);
    commit_sha =
      overrides.commit_sha?.trim() ||
      env.GITHUB_SHA?.trim() ||
      safe(runner, ['rev-parse', 'HEAD']);
  }

  return { provider, repository, branch, commit_sha };
}
