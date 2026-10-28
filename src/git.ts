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

/** Providers the API accepts today. Anything else must map onto one of these. */
const KNOWN_PROVIDERS = ['github', 'gitlab', 'bitbucket'] as const;

/** Infer the provider from a remote URL's host; unknown hosts default to github. */
function providerFromUrl(url: string | undefined): string {
  const host = (url ?? '').toLowerCase();
  return KNOWN_PROVIDERS.find((p) => host.includes(p)) ?? 'github';
}

function stripRefPrefix(ref: string | undefined): string {
  return (ref ?? '').trim().replace(/^refs\/heads\//, '');
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
 *     (on pull_request events GITHUB_HEAD_REF is preferred over GITHUB_REF_NAME, which is `<n>/merge`)
 *  4. CircleCI (`CIRCLECI=true`), Azure Pipelines (`TF_BUILD`), Jenkins (`JENKINS_URL`):
 *     repository/branch/sha come from their env vars; the provider is inferred from the
 *     remote URL / repository provider and limited to github, gitlab or bitbucket
 *  5. Local git fallback → provider defaults to "github"
 */
export function resolveGitContext(inputs: GitContextInputs = {}): GitContext {
  const { env = process.env, runner = defaultRunner, overrides = {} } = inputs;

  const isGitLab = env.GITLAB_CI === 'true';
  const isBitbucket = Boolean(env.BITBUCKET_WORKSPACE || env.BITBUCKET_REPO_FULL_NAME);
  const isGitHubActions = env.GITHUB_ACTIONS === 'true';
  const isCircle = !isGitHubActions && env.CIRCLECI === 'true';
  const isAzure = !isGitHubActions && Boolean(env.TF_BUILD);
  const isJenkins = !isGitHubActions && Boolean(env.JENKINS_URL);

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
  } else if (isCircle) {
    provider = providerFromUrl(env.CIRCLE_REPOSITORY_URL);
    const slug =
      env.CIRCLE_PROJECT_USERNAME && env.CIRCLE_PROJECT_REPONAME
        ? `${env.CIRCLE_PROJECT_USERNAME}/${env.CIRCLE_PROJECT_REPONAME}`
        : undefined;
    repository =
      overrides.repository?.trim() ||
      slug ||
      parseRepository(env.CIRCLE_REPOSITORY_URL ?? safe(runner, ['remote', 'get-url', 'origin']));
    branch =
      overrides.branch?.trim() ||
      env.CIRCLE_BRANCH?.trim() ||
      safe(runner, ['rev-parse', '--abbrev-ref', 'HEAD']);
    commit_sha =
      overrides.commit_sha?.trim() ||
      env.CIRCLE_SHA1?.trim() ||
      safe(runner, ['rev-parse', 'HEAD']);
  } else if (isAzure) {
    const azureProvider = env.BUILD_REPOSITORY_PROVIDER?.trim().toLowerCase() ?? '';
    provider = KNOWN_PROVIDERS.find((p) => p === azureProvider) ?? 'github';
    repository =
      overrides.repository?.trim() ||
      env.BUILD_REPOSITORY_NAME?.trim() ||
      parseRepository(safe(runner, ['remote', 'get-url', 'origin']));
    branch =
      overrides.branch?.trim() ||
      stripRefPrefix(env.SYSTEM_PULLREQUEST_SOURCEBRANCH) ||
      stripRefPrefix(env.BUILD_SOURCEBRANCH) ||
      safe(runner, ['rev-parse', '--abbrev-ref', 'HEAD']);
    commit_sha =
      overrides.commit_sha?.trim() ||
      env.BUILD_SOURCEVERSION?.trim() ||
      safe(runner, ['rev-parse', 'HEAD']);
  } else if (isJenkins) {
    provider = providerFromUrl(env.GIT_URL);
    repository =
      overrides.repository?.trim() ||
      (env.GIT_URL ? parseRepository(env.GIT_URL) : '') ||
      parseRepository(safe(runner, ['remote', 'get-url', 'origin']));
    branch =
      overrides.branch?.trim() ||
      env.BRANCH_NAME?.trim() ||
      env.GIT_BRANCH?.trim().replace(/^origin\//, '') ||
      safe(runner, ['rev-parse', '--abbrev-ref', 'HEAD']);
    commit_sha =
      overrides.commit_sha?.trim() ||
      env.GIT_COMMIT?.trim() ||
      safe(runner, ['rev-parse', 'HEAD']);
  } else {
    provider = 'github';
    repository =
      overrides.repository?.trim() ||
      env.GITHUB_REPOSITORY?.trim() ||
      parseRepository(safe(runner, ['remote', 'get-url', 'origin']));
    branch =
      overrides.branch?.trim() ||
      env.GITHUB_HEAD_REF?.trim() ||
      env.GITHUB_REF_NAME?.trim() ||
      safe(runner, ['rev-parse', '--abbrev-ref', 'HEAD']);
    commit_sha =
      overrides.commit_sha?.trim() ||
      env.GITHUB_SHA?.trim() ||
      safe(runner, ['rev-parse', 'HEAD']);
  }

  return { provider, repository, branch, commit_sha };
}
