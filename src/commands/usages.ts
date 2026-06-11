import { writeFileSync } from 'node:fs';

import { Command, Flags } from '@oclif/core';

import { ApiClient } from '../api.js';
import { resolveApiToken, resolveApiUrl, resolveProject } from '../auth.js';
import { loadConfig } from '../config.js';
import { applyFlagOverrides } from '../flag-config.js';
import { connectionFlags } from '../shared-flags.js';
import { formatRegex, runUsages, type UsagesFormat } from '../usages-run.js';

export default class Usages extends Command {
  static override description =
    'Scan the working tree for feature-flag variable references and print them. Side-effect-free: it never posts (the GitHub Action does the upload).';

  static override examples = [
    '<%= config.bin %> usages',
    '<%= config.bin %> usages --format json -o usages.json',
    '<%= config.bin %> usages --client-name rpClient --include "src/**/*.ts"',
    '<%= config.bin %> usages --only-unused --project web',
  ];

  static override flags = {
    ...connectionFlags,
    format: Flags.string({
      options: ['console', 'json'],
      default: 'console',
      description: 'Output format.',
    }),
    output: Flags.string({ char: 'o', description: 'Write output to a file instead of stdout.' }),
    include: Flags.string({ multiple: true, description: 'Glob to include (repeatable).' }),
    exclude: Flags.string({ multiple: true, description: 'Glob to exclude (repeatable).' }),
    'client-name': Flags.string({
      multiple: true,
      description: 'Additional SDK client variable name to detect.',
    }),
    'match-pattern': Flags.string({
      multiple: true,
      description: 'ext=<regex> custom pattern (exactly one capture group).',
    }),
    'var-alias': Flags.string({
      multiple: true,
      description: '<from>=<to> rewrite for a captured key.',
    }),
    'show-regex': Flags.boolean({ description: 'Print the effective patterns and exit.' }),
    'only-unused': Flags.boolean({
      description: 'List only captured keys absent from the project (needs API access).',
    }),
    'no-api': Flags.boolean({ description: 'Scan without contacting the API.' }),
    headless: Flags.boolean({ description: 'Machine-parseable output (no header line).' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Usages);
    const cwd = process.cwd();
    const config = applyFlagOverrides(loadConfig(cwd), {
      clientName: flags['client-name'],
      matchPattern: flags['match-pattern'],
      varAlias: flags['var-alias'],
      include: flags.include,
      exclude: flags.exclude,
    });

    if (flags['show-regex']) {
      this.log(formatRegex(config));
      return;
    }

    let onlyUnusedAgainst: string[] | undefined;
    if (flags['only-unused'] && !flags['no-api']) {
      const apiToken = resolveApiToken({
        flag: flags['api-token'],
        configDir: this.config.configDir,
      });
      const project = resolveProject({ flag: flags.project });
      if (!apiToken) {
        this.error('--only-unused needs an API token (set --api-token / RP_API_TOKEN, or pass --no-api).');
      }
      if (!project) {
        this.error('--only-unused needs a project (--project or RP_PROJECT_KEY).');
      }
      const client = new ApiClient({
        apiUrl: resolveApiUrl({ flag: flags['api-url'] }),
        apiToken,
      });
      onlyUnusedAgainst = await client.keys(project);
    }

    const { output } = await runUsages({
      cwd,
      config,
      format: flags.format as UsagesFormat,
      onlyUnusedAgainst,
      headless: flags.headless,
    });

    if (flags.output) {
      writeFileSync(flags.output, `${output}\n`);
      this.log(`Wrote ${flags.output}`);
    } else {
      this.log(output);
    }
  }
}
