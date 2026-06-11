export interface CodeReference {
  key: string;
  file: string;
  line_number: number;
  snippet: string;
}

export interface RepoConfig {
  /** SDK client variable names whose `.variable(...)` calls are scanned. */
  clientNames: string[];
  /** Rewrite a captured key to a canonical key before reporting. */
  variableAliases: Record<string, string>;
  /** Extra per-extension regex strings (exactly one capture group = the key). */
  matchPatterns: Record<string, string[]>;
  /** Globs the scan is limited to. */
  includeFiles: string[];
  /** Globs excluded from the scan. */
  excludeFiles: string[];
}

export interface IngestSnapshot {
  project: string;
  provider: string;
  repository: string;
  branch: string;
  commit_sha: string;
  references: CodeReference[];
}

export interface IngestResult {
  accepted: number;
  matched: number;
  unknown_keys: string[];
}
