import { Command, Flags } from '@oclif/core';

import { resolveApiToken, resolveApiUrl, resolveProject } from '../auth.js';
import { loadConfig } from '../config.js';
import { applyFlagOverrides } from '../flag-config.js';
import { publishReferences } from '../publish.js';
import { connectionFlags } from '../shared-flags.js';
import { runUsages } from '../usages-run.js';

export default class Publish extends Command {
  static override description =
    'Scan the working tree for feature-flag variable references and publish them to the RedPennon API. ' +
    'Combines `rp usages` (scan) with an automatic POST so GitLab/Bitbucket pipelines and local pushes ' +
    'share one uploader rather than using the GitHub Action.';

  static override examples = [
    '<%= config.bin %> publish --project web --api-token rpa_xxx',
    '<%= config.bin %> publish -p web --provider gitlab',
    'RP_API_TOKEN=rpa_xxx RP_PROJECT_KEY=web <%= config.bin %> publish',
  ];

  static override flags = {
    ...connectionFlags,
    provider: Flags.string({
      options: ['github', 'gitlab', 'bitbucket'],
      description:
        'Source-control provider. Auto-detected from CI env vars when absent ' +
        '(GITLAB_CI → gitlab; BITBUCKET_WORKSPACE → bitbucket; else github).',
    }),
    branch: Flags.string({ description: 'Branch override.' }),
    'commit-sha': Flags.string({ description: 'Commit SHA override.' }),
    repository: Flags.string({
      description: 'Repository override in "owner/repo" format.',
    }),
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
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Publish);
    const cwd = process.cwd();

    const apiToken = resolveApiToken({
      flag: flags['api-token'],
      configDir: this.config.configDir,
    });
    if (!apiToken) {
      this.error(
        'An API token is required. Pass --api-token, set RP_API_TOKEN, or run `rp auth login`.',
      );
    }

    const project = resolveProject({ flag: flags.project });
    if (!project) {
      this.error('A project key is required. Pass --project or set RP_PROJECT_KEY.');
    }

    const config = applyFlagOverrides(loadConfig(cwd), {
      clientName: flags['client-name'],
      matchPattern: flags['match-pattern'],
      varAlias: flags['var-alias'],
      include: flags.include,
      exclude: flags.exclude,
    });

    const { references } = await runUsages({ cwd, config, format: 'json' });

    const { snapshot, result } = await publishReferences({
      apiUrl: resolveApiUrl({ flag: flags['api-url'] }),
      apiToken,
      project,
      provider: flags.provider,
      references,
      cwd,
      overrides: {
        repository: flags.repository,
        branch: flags.branch,
        commit_sha: flags['commit-sha'],
      },
    });

    this.log(
      `Published ${result.accepted} reference(s) for ${snapshot.provider}:${snapshot.repository}@${snapshot.branch}`,
    );
    if (result.unknown_keys.length > 0) {
      this.log(`Unknown keys (not in project): ${result.unknown_keys.join(', ')}`);
    }
  }
}
