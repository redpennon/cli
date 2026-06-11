import { Command, Flags } from '@oclif/core';

import { ApiClient } from '../api.js';
import { resolveApiToken, resolveApiUrl, resolveProject } from '../auth.js';
import { connectionFlags } from '../shared-flags.js';

export default class Keys extends Command {
  static override description =
    "Fetch the project's variable keys from the API. Backs `usages --only-unused`.";

  static override examples = ['<%= config.bin %> keys --project web'];

  static override flags = {
    ...connectionFlags,
    format: Flags.string({
      options: ['console', 'json'],
      default: 'console',
      description: 'Output format.',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Keys);
    const apiToken = resolveApiToken({
      flag: flags['api-token'],
      configDir: this.config.configDir,
    });
    const project = resolveProject({ flag: flags.project });
    if (!apiToken) {
      this.error('An API token is required (--api-token or RP_API_TOKEN).');
    }
    if (!project) {
      this.error('A project is required (--project or RP_PROJECT_KEY).');
    }

    const client = new ApiClient({
      apiUrl: resolveApiUrl({ flag: flags['api-url'] }),
      apiToken,
    });
    const keys = await client.keys(project);
    this.log(
      flags.format === 'json' ? JSON.stringify({ keys }, null, 2) : keys.join('\n'),
    );
  }
}
