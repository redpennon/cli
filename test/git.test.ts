import { describe, expect, it } from 'vitest';

import { parseRepository, resolveGitContext, type GitRunner } from '../src/git.js';

describe('parseRepository', () => {
  it('parses an SSH remote', () => {
    expect(parseRepository('git@github.com:acme/web.git')).toBe('acme/web');
  });

  it('parses an HTTPS remote', () => {
    expect(parseRepository('https://github.com/acme/web.git')).toBe('acme/web');
  });

  it('keeps the final two segments for subgroups', () => {
    expect(parseRepository('https://gitlab.com/group/sub/web.git')).toBe(
      'sub/web',
    );
  });
});

describe('resolveGitContext', () => {
  it('prefers GitHub env vars over git', () => {
    const runner: GitRunner = () => {
      throw new Error('git should not be called');
    };
    const ctx = resolveGitContext({
      env: {
        GITHUB_REPOSITORY: 'acme/web',
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: 'abc123',
      },
      runner,
    });
    expect(ctx).toEqual({
      provider: 'github',
      repository: 'acme/web',
      branch: 'main',
      commit_sha: 'abc123',
    });
  });

  it('falls back to git when env vars are absent', () => {
    const runner: GitRunner = (args) => {
      if (args[0] === 'remote') return 'git@github.com:acme/api.git';
      if (args.includes('--abbrev-ref')) return 'feature/x';
      return 'deadbeef';
    };
    expect(resolveGitContext({ env: {}, runner })).toEqual({
      provider: 'github',
      repository: 'acme/api',
      branch: 'feature/x',
      commit_sha: 'deadbeef',
    });
  });

  it('applies explicit overrides above all else', () => {
    const ctx = resolveGitContext({
      env: { GITHUB_REPOSITORY: 'env/repo' },
      runner: () => '',
      overrides: { repository: 'override/repo' },
    });
    expect(ctx.repository).toBe('override/repo');
  });

  it('detects github provider from GITHUB_ACTIONS env', () => {
    const ctx = resolveGitContext({
      env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'a/b', GITHUB_REF_NAME: 'main', GITHUB_SHA: 'x' },
      runner: () => { throw new Error('no git'); },
    });
    expect(ctx.provider).toBe('github');
  });

  it('detects gitlab provider and context from GitLab CI env vars', () => {
    const ctx = resolveGitContext({
      env: {
        GITLAB_CI: 'true',
        CI_PROJECT_PATH: 'acme/api',
        CI_COMMIT_REF_NAME: 'feat/x',
        CI_COMMIT_SHA: 'abc999',
      },
      runner: () => { throw new Error('no git'); },
    });
    expect(ctx.provider).toBe('gitlab');
    expect(ctx.repository).toBe('acme/api');
    expect(ctx.branch).toBe('feat/x');
    expect(ctx.commit_sha).toBe('abc999');
  });

  it('detects bitbucket provider and context from Bitbucket Pipelines env vars', () => {
    const ctx = resolveGitContext({
      env: {
        BITBUCKET_WORKSPACE: 'acme',
        BITBUCKET_REPO_FULL_NAME: 'acme/web',
        BITBUCKET_BRANCH: 'main',
        BITBUCKET_COMMIT: 'def456',
      },
      runner: () => { throw new Error('no git'); },
    });
    expect(ctx.provider).toBe('bitbucket');
    expect(ctx.repository).toBe('acme/web');
    expect(ctx.branch).toBe('main');
    expect(ctx.commit_sha).toBe('def456');
  });

  it('falls back to github provider when no CI env detected', () => {
    const ctx = resolveGitContext({
      env: {},
      runner: (args) => {
        if (args[0] === 'remote') return 'git@github.com:acme/web.git';
        if (args.includes('--abbrev-ref')) return 'main';
        return 'sha';
      },
    });
    expect(ctx.provider).toBe('github');
  });
});
