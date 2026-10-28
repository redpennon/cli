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

describe('resolveGitContext: GitHub pull requests', () => {
  it('prefers GITHUB_HEAD_REF over the synthetic merge ref name', () => {
    const ctx = resolveGitContext({
      env: {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_REPOSITORY: 'acme/web',
        GITHUB_REF_NAME: '123/merge',
        GITHUB_HEAD_REF: 'feature/login',
        GITHUB_SHA: 'abc',
      },
      runner: () => '',
    });
    expect(ctx.branch).toBe('feature/login');
  });

  it('still lets an explicit branch override win', () => {
    const ctx = resolveGitContext({
      env: { GITHUB_HEAD_REF: 'feature/login', GITHUB_REF_NAME: '1/merge' },
      runner: () => '',
      overrides: { branch: 'forced' },
    });
    expect(ctx.branch).toBe('forced');
  });

  it('uses GITHUB_REF_NAME on push events (no head ref)', () => {
    const ctx = resolveGitContext({
      env: { GITHUB_ACTIONS: 'true', GITHUB_REF_NAME: 'main', GITHUB_HEAD_REF: '' },
      runner: () => '',
    });
    expect(ctx.branch).toBe('main');
  });
});

describe('resolveGitContext: other CI systems', () => {
  const noGit = () => {
    throw new Error('no git');
  };

  it('detects CircleCI', () => {
    const ctx = resolveGitContext({
      env: {
        CIRCLECI: 'true',
        CIRCLE_PROJECT_USERNAME: 'acme',
        CIRCLE_PROJECT_REPONAME: 'web',
        CIRCLE_BRANCH: 'feat/x',
        CIRCLE_SHA1: 'c1c1',
      },
      runner: noGit,
    });
    expect(ctx).toEqual({
      provider: 'github',
      repository: 'acme/web',
      branch: 'feat/x',
      commit_sha: 'c1c1',
    });
  });

  it('infers a known provider from the CircleCI repository URL', () => {
    const ctx = resolveGitContext({
      env: {
        CIRCLECI: 'true',
        CIRCLE_REPOSITORY_URL: 'git@bitbucket.org:acme/web.git',
        CIRCLE_BRANCH: 'main',
        CIRCLE_SHA1: 'c1',
      },
      runner: noGit,
    });
    expect(ctx.provider).toBe('bitbucket');
    expect(ctx.repository).toBe('acme/web');
  });

  it('detects Azure Pipelines and strips refs/heads/', () => {
    const ctx = resolveGitContext({
      env: {
        TF_BUILD: 'True',
        BUILD_REPOSITORY_NAME: 'acme/web',
        BUILD_REPOSITORY_PROVIDER: 'GitHub',
        BUILD_SOURCEBRANCH: 'refs/heads/release/1.0',
        BUILD_SOURCEVERSION: 'a2a2',
      },
      runner: noGit,
    });
    expect(ctx).toEqual({
      provider: 'github',
      repository: 'acme/web',
      branch: 'release/1.0',
      commit_sha: 'a2a2',
    });
  });

  it('prefers the Azure pull request source branch', () => {
    const ctx = resolveGitContext({
      env: {
        TF_BUILD: 'True',
        BUILD_REPOSITORY_NAME: 'acme/web',
        BUILD_SOURCEBRANCH: 'refs/pull/7/merge',
        SYSTEM_PULLREQUEST_SOURCEBRANCH: 'refs/heads/feature/pr',
        BUILD_SOURCEVERSION: 'a2',
      },
      runner: noGit,
    });
    expect(ctx.branch).toBe('feature/pr');
  });

  it('maps an unsupported Azure repository provider to the github default', () => {
    const ctx = resolveGitContext({
      env: { TF_BUILD: 'True', BUILD_REPOSITORY_PROVIDER: 'TfsGit', BUILD_REPOSITORY_NAME: 'web' },
      runner: noGit,
    });
    expect(ctx.provider).toBe('github');
  });

  it('detects Jenkins and strips the remote prefix from GIT_BRANCH', () => {
    const ctx = resolveGitContext({
      env: {
        JENKINS_URL: 'https://ci.example.com/',
        GIT_URL: 'https://gitlab.com/acme/web.git',
        GIT_BRANCH: 'origin/main',
        GIT_COMMIT: 'j3j3',
      },
      runner: noGit,
    });
    expect(ctx).toEqual({
      provider: 'gitlab',
      repository: 'acme/web',
      branch: 'main',
      commit_sha: 'j3j3',
    });
  });

  it('prefers Jenkins BRANCH_NAME (multibranch)', () => {
    const ctx = resolveGitContext({
      env: {
        JENKINS_URL: 'https://ci.example.com/',
        GIT_URL: 'https://github.com/acme/web.git',
        BRANCH_NAME: 'feature/y',
        GIT_BRANCH: 'origin/feature/y',
        GIT_COMMIT: 'j',
      },
      runner: noGit,
    });
    expect(ctx.branch).toBe('feature/y');
  });

  it('does not treat GitHub Actions runs as another CI', () => {
    const ctx = resolveGitContext({
      env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'a/b', GITHUB_REF_NAME: 'm', GITHUB_SHA: 's', JENKINS_URL: 'x' },
      runner: noGit,
    });
    expect(ctx.repository).toBe('a/b');
  });
});

