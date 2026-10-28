import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { runAction, type ActionDeps } from '../action/run.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function repoWith(file: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rp-action-'));
  writeFileSync(join(dir, file), content);
  return dir;
}

function deps(overrides: Partial<ActionDeps>): ActionDeps {
  return {
    getInput: () => '',
    info: vi.fn(),
    warning: vi.fn(),
    setOutput: vi.fn(),
    setFailed: vi.fn(),
    ...overrides,
  };
}

describe('runAction', () => {
  it('scans the repo and posts a snapshot with git context', async () => {
    const cwd = repoWith('a.ts', "client.variable('dark-mode')");
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { accepted: 1, matched: 1, unknown_keys: [] }),
    );
    const inputs: Record<string, string> = {
      'api-token': 'rpa_x',
      project: 'web',
      'api-url': 'https://api.test',
    };
    const setOutput = vi.fn();
    const setFailed = vi.fn();

    await runAction(
      deps({
        getInput: (name) => inputs[name] ?? '',
        setOutput,
        setFailed,
        cwd,
        env: {
          GITHUB_REPOSITORY: 'acme/web',
          GITHUB_REF_NAME: 'main',
          GITHUB_SHA: 'sha',
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );

    expect(setFailed).not.toHaveBeenCalled();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test/v1/code-references');
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload).toMatchObject({
      project: 'web',
      provider: 'github',
      repository: 'acme/web',
      branch: 'main',
      commit_sha: 'sha',
    });
    expect(payload.references[0].key).toBe('dark-mode');
    expect(setOutput).toHaveBeenCalledWith('accepted', 1);
  });

  it('warns on unknown keys', async () => {
    const cwd = repoWith('a.ts', "client.variable('ghost')");
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { accepted: 1, matched: 0, unknown_keys: ['ghost'] }),
    );
    const warning = vi.fn();

    await runAction(
      deps({
        getInput: (name) => ({ 'api-token': 'rpa_x', project: 'web' })[name] ?? '',
        warning,
        cwd,
        env: { GITHUB_REPOSITORY: 'acme/web', GITHUB_REF_NAME: 'main', GITHUB_SHA: 's' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('ghost'));
  });

  it('calls setFailed when the API rejects', async () => {
    const cwd = repoWith('a.ts', "client.variable('x')");
    const fetchImpl = vi.fn(async () =>
      jsonResponse(402, { error: 'Code references require the Business or Enterprise plan.' }),
    );
    const setFailed = vi.fn();

    await runAction(
      deps({
        getInput: (name) => ({ 'api-token': 'rpa_x', project: 'web' })[name] ?? '',
        setFailed,
        cwd,
        env: { GITHUB_REPOSITORY: 'acme/web', GITHUB_REF_NAME: 'main', GITHUB_SHA: 's' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );

    expect(setFailed).toHaveBeenCalledWith(
      'Code references require the Business or Enterprise plan.',
    );
  });

  const baseEnv = { GITHUB_REPOSITORY: 'acme/web', GITHUB_REF_NAME: 'main', GITHUB_SHA: 's' };
  const okFetch = () =>
    vi.fn(async () => jsonResponse(200, { accepted: 1, matched: 1, unknown_keys: [] }));

  it('fails on an insecure api-url', async () => {
    const cwd = repoWith('a.ts', "client.variable('x')");
    const setFailed = vi.fn();
    const fetchImpl = okFetch();
    await runAction(
      deps({
        getInput: (name) =>
          ({ 'api-token': 'rpa_x', project: 'web', 'api-url': 'http://evil.example.com' })[name] ?? '',
        setFailed,
        cwd,
        env: baseEnv,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );
    expect(setFailed).toHaveBeenCalledWith(expect.stringMatching(/https/));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  describe('fail-on-unknown', () => {
    const unknownFetch = () =>
      vi.fn(async () => jsonResponse(200, { accepted: 1, matched: 0, unknown_keys: ['ghost'] }));

    it('fails the step when set and the API reports unknown keys', async () => {
      const cwd = repoWith('a.ts', "client.variable('ghost')");
      const setFailed = vi.fn();
      const setOutput = vi.fn();
      await runAction(
        deps({
          getInput: (name) =>
            ({ 'api-token': 'rpa_x', project: 'web', 'fail-on-unknown': 'true' })[name] ?? '',
          setFailed,
          setOutput,
          cwd,
          env: baseEnv,
          fetchImpl: unknownFetch() as unknown as typeof fetch,
        }),
      );
      expect(setOutput).toHaveBeenCalledWith('unknown-keys', 'ghost');
      expect(setFailed).toHaveBeenCalledWith(expect.stringMatching(/ghost/));
    });

    it('does not fail when unset', async () => {
      const cwd = repoWith('a.ts', "client.variable('ghost')");
      const setFailed = vi.fn();
      await runAction(
        deps({
          getInput: (name) => ({ 'api-token': 'rpa_x', project: 'web' })[name] ?? '',
          setFailed,
          cwd,
          env: baseEnv,
          fetchImpl: unknownFetch() as unknown as typeof fetch,
        }),
      );
      expect(setFailed).not.toHaveBeenCalled();
    });
  });

  describe('max-references', () => {
    it('fails without posting when the scan exceeds the limit', async () => {
      const cwd = repoWith('a.ts', "client.variable('a')\nclient.variable('b')");
      const setFailed = vi.fn();
      const fetchImpl = okFetch();
      await runAction(
        deps({
          getInput: (name) =>
            ({ 'api-token': 'rpa_x', project: 'web', 'max-references': '1' })[name] ?? '',
          setFailed,
          cwd,
          env: baseEnv,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      );
      expect(setFailed).toHaveBeenCalledWith(expect.stringMatching(/limit is 1/));
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric value', async () => {
      const cwd = repoWith('a.ts', "client.variable('a')");
      const setFailed = vi.fn();
      await runAction(
        deps({
          getInput: (name) =>
            ({ 'api-token': 'rpa_x', project: 'web', 'max-references': 'lots' })[name] ?? '',
          setFailed,
          cwd,
          env: baseEnv,
          fetchImpl: okFetch() as unknown as typeof fetch,
        }),
      );
      expect(setFailed).toHaveBeenCalledWith(expect.stringMatching(/max-references/));
    });
  });

  describe('working-directory', () => {
    it('scans only the given subdirectory', async () => {
      const root = repoWith('top.ts', "client.variable('top-level')");
      mkdirSync(join(root, 'packages', 'web'), { recursive: true });
      writeFileSync(join(root, 'packages', 'web', 'a.ts'), "client.variable('in-package')");
      const fetchImpl = okFetch();
      await runAction(
        deps({
          getInput: (name) =>
            ({ 'api-token': 'rpa_x', project: 'web', 'working-directory': 'packages/web' })[name] ?? '',
          cwd: root,
          env: baseEnv,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      );
      const payload = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
      expect(payload.references.map((r: { key: string }) => r.key)).toEqual(['in-package']);
    });

    it('rejects a directory outside the workspace', async () => {
      const root = repoWith('a.ts', "client.variable('a')");
      const setFailed = vi.fn();
      await runAction(
        deps({
          getInput: (name) =>
            ({ 'api-token': 'rpa_x', project: 'web', 'working-directory': '../elsewhere' })[name] ?? '',
          setFailed,
          cwd: root,
          env: baseEnv,
          fetchImpl: okFetch() as unknown as typeof fetch,
        }),
      );
      expect(setFailed).toHaveBeenCalledWith(expect.stringMatching(/outside the workspace/));
    });

    it('fails when the directory does not exist', async () => {
      const root = repoWith('a.ts', "client.variable('a')");
      const setFailed = vi.fn();
      await runAction(
        deps({
          getInput: (name) =>
            ({ 'api-token': 'rpa_x', project: 'web', 'working-directory': 'nope' })[name] ?? '',
          setFailed,
          cwd: root,
          env: baseEnv,
          fetchImpl: okFetch() as unknown as typeof fetch,
        }),
      );
      expect(setFailed).toHaveBeenCalledWith(expect.stringMatching(/working-directory.*nope/));
    });
  });

  describe('config-path', () => {
    it('loads config from a custom path relative to the working directory', async () => {
      const cwd = repoWith('a.ts', "rp.variable('custom-client')");
      mkdirSync(join(cwd, 'ci'), { recursive: true });
      writeFileSync(join(cwd, 'ci', 'redpennon.yml'), 'clientNames:\n  - rp\n');
      const fetchImpl = okFetch();
      await runAction(
        deps({
          getInput: (name) =>
            ({ 'api-token': 'rpa_x', project: 'web', 'config-path': 'ci/redpennon.yml' })[name] ?? '',
          cwd,
          env: baseEnv,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      );
      const payload = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
      expect(payload.references.map((r: { key: string }) => r.key)).toEqual(['custom-client']);
    });

    it('fails when the config file is missing', async () => {
      const cwd = repoWith('a.ts', "client.variable('a')");
      const setFailed = vi.fn();
      await runAction(
        deps({
          getInput: (name) =>
            ({ 'api-token': 'rpa_x', project: 'web', 'config-path': 'missing.yml' })[name] ?? '',
          setFailed,
          cwd,
          env: baseEnv,
          fetchImpl: okFetch() as unknown as typeof fetch,
        }),
      );
      expect(setFailed).toHaveBeenCalledWith(expect.stringMatching(/config-path.*missing\.yml/));
    });
  });
});

