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

describe('ApiClient resilience', () => {
  const okBody = { accepted: 1, matched: 1, unknown_keys: [] };

  function client(fetchImpl: unknown, extra: Record<string, unknown> = {}) {
    return new ApiClient({
      apiUrl: 'http://api.test',
      apiToken: 'rpa_x',
      fetchImpl: fetchImpl as typeof fetch,
      sleep: async () => {},
      ...extra,
    });
  }

  it('passes an abort signal so requests time out', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody));
    await client(fetchImpl, { timeoutMs: 5000 }).ingest(snapshot);
    expect((fetchImpl.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('retries ingest on 5xx and then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: 'busy' }))
      .mockResolvedValueOnce(jsonResponse(502, {}))
      .mockResolvedValueOnce(jsonResponse(200, okBody));
    expect(await client(fetchImpl).ingest(snapshot)).toEqual(okBody);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries keys on network errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(200, { keys: ['a'] }));
    expect(await client(fetchImpl).keys('web')).toEqual(['a']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the maximum attempts with the last 5xx error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { error: 'boom' }));
    await expect(client(fetchImpl).ingest(snapshot)).rejects.toMatchObject({
      status: 500,
      message: 'boom',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up on persistent network errors with a clear message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(client(fetchImpl).ingest(snapshot)).rejects.toThrow(/Could not reach.*fetch failed/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry 4xx responses', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'bad token' }));
    await expect(client(fetchImpl).ingest(snapshot)).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially between attempts', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => jsonResponse(503, {}));
    await expect(
      client(fetchImpl, { sleep, retryBaseMs: 100 }).ingest(snapshot),
    ).rejects.toBeInstanceOf(ApiError);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });
});
