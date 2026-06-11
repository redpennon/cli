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
});
