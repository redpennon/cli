import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_MAX_REFERENCES, publishReferences } from '../src/publish.js';
import type { CodeReference } from '../src/types.js';

const refs: CodeReference[] = [
  { key: 'dark-mode', file: 'a.ts', line_number: 1, snippet: 'x' },
];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('publishReferences', () => {
  it('resolves git context from env and posts the snapshot', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { accepted: 1, matched: 1, unknown_keys: [] }),
    );

    const { snapshot, result } = await publishReferences({
      apiUrl: 'http://api.test',
      apiToken: 'rpa_x',
      project: 'web',
      references: refs,
      env: {
        GITHUB_REPOSITORY: 'acme/web',
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: 'sha123',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(snapshot).toMatchObject({
      project: 'web',
      provider: 'github',
      repository: 'acme/web',
      branch: 'main',
      commit_sha: 'sha123',
    });
    expect(result.accepted).toBe(1);

    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).references).toEqual(refs);
  });

  it('refuses to publish more references than the configured maximum', async () => {
    const fetchImpl = vi.fn();
    const many: CodeReference[] = Array.from({ length: 3 }, (_, i) => ({
      key: `k${i}`,
      file: 'a.ts',
      line_number: i + 1,
      snippet: 'x',
    }));
    await expect(
      publishReferences({
        apiUrl: 'http://api.test',
        apiToken: 'rpa_x',
        project: 'web',
        references: many,
        maxReferences: 2,
        env: { GITHUB_REPOSITORY: 'a/b', GITHUB_REF_NAME: 'm', GITHUB_SHA: 's' },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Found 3 references.*limit is 2/s);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('has a sensible default maximum', () => {
    expect(DEFAULT_MAX_REFERENCES).toBe(10_000);
  });
});

