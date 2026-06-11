import { execFileSync } from 'node:child_process';

export interface GitContext {
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
 * Resolve the Git context, preferring explicit overrides, then CI env vars
 * (`GITHUB_REPOSITORY` / `GITHUB_REF_NAME` / `GITHUB_SHA`), then local git.
 * This provider-agnostic fallback is what lets non-GitHub CI reuse the CLI.
 */
export function resolveGitContext(inputs: GitContextInputs = {}): GitContext {
  const { env = process.env, runner = defaultRunner, overrides = {} } = inputs;

  const repository =
    overrides.repository?.trim() ||
    env.GITHUB_REPOSITORY?.trim() ||
    parseRepository(safe(runner, ['remote', 'get-url', 'origin']));

  const branch =
    overrides.branch?.trim() ||
    env.GITHUB_REF_NAME?.trim() ||
    safe(runner, ['rev-parse', '--abbrev-ref', 'HEAD']);

  const commit_sha =
    overrides.commit_sha?.trim() ||
    env.GITHUB_SHA?.trim() ||
    safe(runner, ['rev-parse', 'HEAD']);

  return { repository, branch, commit_sha };
}
