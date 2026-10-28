import { Command, Flags } from '@oclif/core';

import { resolveApiToken, resolveApiUrl, resolveProject } from '../auth.js';
import { loadConfig } from '../config.js';
import { applyFlagOverrides } from '../flag-config.js';
import { resolveGitContext } from '../git.js';
import { buildSnapshot, DEFAULT_MAX_REFERENCES, publishReferences } from '../publish.js';
import { connectionFlags } from '../shared-flags.js';
import { distinctKeys } from '../scanner.js';
import { runUsages } from '../usages-run.js';

export default class Publish extends Command {
  static override description =
    'Scan the working tree for feature-flag variable references and publish them to the RedPennon API. ' +
    'Combines `rp usages` (scan) with an automatic POST so GitLab/Bitbucket pipelines and local pushes ' +
    'share one uploader rather than using the GitHub Action.';

  static override examples = [
    '<%= config.bin %> publish --project web --api-token rpa_xxx',
    '<%= config.bin %> publish -p web --provider gitlab',
    '<%= config.bin %> publish --dry-run',
    '<%= config.bin %> publish --fail-on-unknown',
    'RP_API_TOKEN=rpa_xxx RP_PROJECT_KEY=web <%= config.bin %> publish',
  ];

  static override flags = {
    ...connectionFlags,
    provider: Flags.string({
      options: ['github', 'gitlab', 'bitbucket'],
      description:
        'Source-control provider. Auto-detected from CI env vars when absent ' +
        '(GITLAB_CI → gitlab; BITBUCKET_WORKSPACE → bitbucket; CircleCI/Azure/Jenkins → inferred from the remote; else github).',
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
    'dry-run': Flags.boolean({
      description: 'Scan and print a summary of what would be published, without contacting the API.',
    }),
    'fail-on-unknown': Flags.boolean({
      description: 'Exit non-zero if the API reports keys that are not in the project.',
    }),
    'max-references': Flags.integer({
      min: 1,
      default: DEFAULT_MAX_REFERENCES,
      description: 'Error instead of publishing more than this many references.',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Publish);
    const cwd = process.cwd();

    const apiToken = resolveApiToken({
      flag: flags['api-token'],
      configDir: this.config.configDir,
      warn: (message) => this.warn(message),
    });
    if (!apiToken && !flags['dry-run']) {
      this.error(
        'An API token is required. Pass --api-token, set RP_API_TOKEN, or run `rp auth login`.',
      );
    }

    const project = resolveProject({ flag: flags.project });
    if (!project && !flags['dry-run']) {
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
    const overrides = {
      repository: flags.repository,
      branch: flags.branch,
      commit_sha: flags['commit-sha'],
    };

    if (flags['dry-run']) {
      const snapshot = buildSnapshot({
        project: project ?? '(not set)',
        provider: flags.provider,
        git: resolveGitContext({ cwd, overrides }),
        references,
      });
      this.log('Dry run: nothing was sent to the API.');
      this.log(`Target:     ${snapshot.provider}:${snapshot.repository}@${snapshot.branch}`);
      this.log(`Commit:     ${snapshot.commit_sha}`);
      this.log(`Project:    ${snapshot.project}`);
      this.log(
        `References: ${references.length} reference(s), ${distinctKeys(references).length} distinct key(s)`,
      );
      return;
    }

    const { snapshot, result } = await publishReferences({
      apiUrl: resolveApiUrl({ flag: flags['api-url'] }),
      apiToken: apiToken as string,
      project: project as string,
      provider: flags.provider,
      references,
      cwd,
      overrides,
      maxReferences: flags['max-references'],
    });

    this.log(
      `Published ${result.accepted} reference(s) for ${snapshot.provider}:${snapshot.repository}@${snapshot.branch}`,
    );
    if (result.unknown_keys.length > 0) {
      this.log(`Unknown keys (not in project): ${result.unknown_keys.join(', ')}`);
      if (flags['fail-on-unknown']) {
        this.error(
          `${result.unknown_keys.length} unknown key(s) not in project "${project}": ${result.unknown_keys.join(', ')}`,
          { exit: 1 },
        );
      }
    }
  }
}
