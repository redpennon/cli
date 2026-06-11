import { mkdtempSync, writeFileSync } from 'node:fs';
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
      'api-url': 'http://api.test',
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
    expect(url).toBe('http://api.test/v1/code-references');
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
});
