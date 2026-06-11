import { describe, expect, it, vi } from 'vitest';

import { ApiClient, ApiError } from '../src/api.js';
import type { IngestSnapshot } from '../src/types.js';

const snapshot: IngestSnapshot = {
  project: 'web',
  provider: 'github',
  repository: 'acme/web',
  branch: 'main',
  commit_sha: 'abc',
  references: [{ key: 'dark-mode', file: 'a.ts', line_number: 1, snippet: 'x' }],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiClient.ingest', () => {
  it('posts a bearer-authenticated snapshot and returns the result', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { accepted: 1, matched: 1, unknown_keys: [] }),
    );
    const client = new ApiClient({
      apiUrl: 'http://api.test',
      apiToken: 'rpa_x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.ingest(snapshot);

    expect(result).toEqual({ accepted: 1, matched: 1, unknown_keys: [] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api.test/v1/code-references');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as any).headers.Authorization).toBe('Bearer rpa_x');
  });

  it('throws ApiError with the server message on 402', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(402, { error: 'Code references require the Business or Enterprise plan.' }),
    );
    const client = new ApiClient({
      apiUrl: 'http://api.test',
      apiToken: 'rpa_x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.ingest(snapshot)).rejects.toMatchObject({
      status: 402,
      message: 'Code references require the Business or Enterprise plan.',
    });
    await expect(client.ingest(snapshot)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('ApiClient.keys', () => {
  it('fetches and returns the project keys', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { keys: ['a', 'b'] }),
    );
    const client = new ApiClient({
      apiUrl: 'http://api.test',
      apiToken: 'rpa_x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(await client.keys('web')).toEqual(['a', 'b']);
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api.test/v1/code-references/keys?project=web');
  });
});
