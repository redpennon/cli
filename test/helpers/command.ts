import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Command, Config } from '@oclif/core';
import { vi } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');

export interface RunOptions {
  /** Env vars set for the duration of the run (undefined deletes). */
  env?: Record<string, string | undefined>;
  /** Working directory for the run. */
  cwd?: string;
  /** oclif config dir (where auth.json lives). A fresh temp dir by default. */
  configDir?: string;
}

export interface RunResult {
  stdout: string[];
  stderr: string[];
  /** Set when the command threw (including `this.error`). */
  error?: Error & { oclif?: { exit?: number } };
  configDir: string;
}

type CommandClass = new (argv: string[], config: Config) => Command;

/**
 * Run an oclif command class in-process, capturing `this.log` / `this.warn`
 * output and any thrown error. Env vars and cwd are restored afterwards.
 */
export async function runCommand(
  Cmd: CommandClass,
  argv: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const configDir = opts.configDir ?? mkdtempSync(join(tmpdir(), 'rp-cmd-config-'));
  const savedEnv: Record<string, string | undefined> = {};
  const env = {
    RP_CONFIG_DIR: configDir,
    RP_API_TOKEN: undefined,
    RP_PROJECT_KEY: undefined,
    RP_API_URL: undefined,
    GITHUB_ACTIONS: undefined,
    GITHUB_REPOSITORY: undefined,
    GITHUB_REF_NAME: undefined,
    GITHUB_HEAD_REF: undefined,
    GITHUB_SHA: undefined,
    GITLAB_CI: undefined,
    BITBUCKET_WORKSPACE: undefined,
    BITBUCKET_REPO_FULL_NAME: undefined,
    CIRCLECI: undefined,
    TF_BUILD: undefined,
    JENKINS_URL: undefined,
    ...opts.env,
  };
  for (const [key, value] of Object.entries(env)) {
    savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const savedCwd = process.cwd();
  if (opts.cwd) process.chdir(opts.cwd);

  const stdout: string[] = [];
  const stderr: string[] = [];
  const logSpy = vi
    .spyOn(Command.prototype, 'log')
    .mockImplementation((message?: string) => void stdout.push(message ?? ''));
  const warnSpy = vi
    .spyOn(Command.prototype, 'warn')
    .mockImplementation(((input: string | Error) => {
      stderr.push(typeof input === 'string' ? input : input.message);
      return input;
    }) as never);

  const result: RunResult = { stdout, stderr, configDir };
  try {
    const config = await Config.load({ root: ROOT });
    await new Cmd(argv, config).run();
  } catch (error) {
    result.error = error as RunResult['error'];
  } finally {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    process.chdir(savedCwd);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return result;
}
