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
}

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

  async ingest(snapshot: IngestSnapshot): Promise<IngestResult> {
    const res = await this.fetchImpl(`${this.opts.apiUrl}/v1/code-references`, {
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
    const res = await this.fetchImpl(url, { headers: this.authHeader });
    const body = await this.parse(res);
    if (!res.ok) {
      throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
    }
    return Array.isArray(body?.keys) ? (body.keys as string[]) : [];
  }
}
