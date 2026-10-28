import { afterEach, describe, expect, it, vi } from 'vitest';

import Publish from '../../src/commands/publish.js';
import { runCommand } from '../helpers/command.js';
import { jsonResponse, tempRepo } from '../helpers/fs.js';

afterEach(() => vi.unstubAllGlobals());

const GIT_ENV = {
  RP_API_TOKEN: 'rpa_x',
  RP_PROJECT_KEY: 'web',
  GITHUB_REPOSITORY: 'acme/web',
  GITHUB_REF_NAME: 'main',
  GITHUB_SHA: 'sha1',
};

const repo = () =>
  tempRepo({ 'a.ts': "client.variable('dark-mode');\nclient.variable('ghost');" });

function stubFetch(result: object, status = 200) {
  const fetchMock = vi.fn(async () => jsonResponse(status, result));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('rp publish', () => {
  it('scans and posts a snapshot', async () => {
    const fetchMock = stubFetch({ accepted: 2, matched: 2, unknown_keys: [] });
    const { stdout, error } = await runCommand(Publish, [], { cwd: repo(), env: GIT_ENV });
    expect(error).toBeUndefined();
    expect(stdout[0]).toBe('Published 2 reference(s) for github:acme/web@main');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.redpennon.dev/v1/code-references');
    expect(JSON.parse(init.body as string)).toMatchObject({
      project: 'web',
      repository: 'acme/web',
      branch: 'main',
      commit_sha: 'sha1',
    });
  });

  it('reports unknown keys but succeeds by default', async () => {
    stubFetch({ accepted: 2, matched: 1, unknown_keys: ['ghost'] });
    const { stdout, error } = await runCommand(Publish, [], { cwd: repo(), env: GIT_ENV });
    expect(error).toBeUndefined();
    expect(stdout.join('\n')).toContain('Unknown keys (not in project): ghost');
  });

  it('--fail-on-unknown exits non-zero when the API returns unknown keys', async () => {
    stubFetch({ accepted: 2, matched: 1, unknown_keys: ['ghost'] });
    const { stdout, error } = await runCommand(Publish, ['--fail-on-unknown'], {
      cwd: repo(),
      env: GIT_ENV,
    });
    expect(stdout.join('\n')).toContain('Published 2 reference(s)');
    expect(error?.message).toMatch(/1 unknown key.*ghost/s);
    expect(error?.oclif?.exit).toBe(1);
  });

  it('--fail-on-unknown passes when every key is known', async () => {
    stubFetch({ accepted: 2, matched: 2, unknown_keys: [] });
    const { error } = await runCommand(Publish, ['--fail-on-unknown'], {
      cwd: repo(),
      env: GIT_ENV,
    });
    expect(error).toBeUndefined();
  });

  it('--dry-run prints a summary and does not post', async () => {
    const fetchMock = stubFetch({ accepted: 0, matched: 0, unknown_keys: [] });
    const { stdout, error } = await runCommand(Publish, ['--dry-run'], {
      cwd: repo(),
      env: GIT_ENV,
    });
    expect(error).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    const text = stdout.join('\n');
    expect(text).toContain('Dry run');
    expect(text).toContain('github:acme/web@main');
    expect(text).toContain('2 reference(s)');
    expect(text).toContain('2 distinct key(s)');
  });

  it('--dry-run works without a token', async () => {
    const fetchMock = stubFetch({});
    const { error } = await runCommand(Publish, ['--dry-run', '-p', 'web'], {
      cwd: repo(),
      env: { ...GIT_ENV, RP_API_TOKEN: undefined },
    });
    expect(error).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('errors above --max-references without posting', async () => {
    const fetchMock = stubFetch({});
    const { error } = await runCommand(Publish, ['--max-references', '1'], {
      cwd: repo(),
      env: GIT_ENV,
    });
    expect(error?.message).toMatch(/Found 2 references.*limit is 1/s);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires an API token', async () => {
    const { error } = await runCommand(Publish, [], {
      cwd: repo(),
      env: { ...GIT_ENV, RP_API_TOKEN: undefined },
    });
    expect(error?.message).toMatch(/rp auth login/);
  });

  it('requires a project', async () => {
    const { error } = await runCommand(Publish, [], {
      cwd: repo(),
      env: { ...GIT_ENV, RP_PROJECT_KEY: undefined },
    });
    expect(error?.message).toMatch(/project key is required/);
  });

  it('honours --provider and git overrides', async () => {
    const fetchMock = stubFetch({ accepted: 2, matched: 2, unknown_keys: [] });
    await runCommand(
      Publish,
      ['--provider', 'gitlab', '--branch', 'dev', '--commit-sha', 'zzz', '--repository', 'o/r'],
      { cwd: repo(), env: GIT_ENV },
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ provider: 'gitlab', branch: 'dev', commit_sha: 'zzz', repository: 'o/r' });
  });

  it('surfaces API errors', async () => {
    stubFetch({ error: 'plan required' }, 402);
    const { error } = await runCommand(Publish, [], { cwd: repo(), env: GIT_ENV });
    expect(error?.message).toBe('plan required');
  });
});
