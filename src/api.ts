import type { IngestResult, IngestSnapshot } from './types.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  apiUrl: string;
  apiToken: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. Defaults to 30s. */
  timeoutMs?: number;
  /** Total attempts (first try included) for network errors and 5xx. Defaults to 3. */
  maxAttempts?: number;
  /** Base backoff; doubles after each failed attempt. Defaults to 500ms. */
  retryBaseMs?: number;
  /** Injectable delay for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_MS = 500;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  private get fetchImpl(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  private get authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.opts.apiToken}` };
  }

  private async parse(res: Response): Promise<any> {
    try {
      return await res.json();
    } catch {
      return {};
    }
  }

  /**
   * fetch with a timeout and bounded retry. Network errors and 5xx responses
   * are retried with exponential backoff; 4xx responses are returned as-is.
   * Both endpoints are safe to retry (ingest posts a full snapshot).
   */
  private async request(url: string, init: RequestInit): Promise<Response> {
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const attempts = this.opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const base = this.opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    const sleep = this.opts.sleep ?? defaultSleep;

    for (let attempt = 1; ; attempt++) {
      let res: Response | undefined;
      let failure: unknown;
      try {
        res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        failure = error;
      }
      const last = attempt >= attempts;
      if (res && (res.status < 500 || last)) return res;
      if (!res && last) {
        const reason = failure instanceof Error ? failure.message : String(failure);
        throw new Error(`Could not reach the RedPennon API at ${this.opts.apiUrl}: ${reason}`);
      }
      await sleep(base * 2 ** (attempt - 1));
    }
  }

  async ingest(snapshot: IngestSnapshot): Promise<IngestResult> {
    const res = await this.request(`${this.opts.apiUrl}/v1/code-references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader },
      body: JSON.stringify(snapshot),
    });
    const body = await this.parse(res);
    if (!res.ok) {
      throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
    }
    return body as IngestResult;
  }

  async keys(project: string): Promise<string[]> {
    const url = `${this.opts.apiUrl}/v1/code-references/keys?project=${encodeURIComponent(project)}`;
    const res = await this.request(url, { headers: this.authHeader });
    const body = await this.parse(res);
    if (!res.ok) {
      throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
    }
    return Array.isArray(body?.keys) ? (body.keys as string[]) : [];
  }
}
