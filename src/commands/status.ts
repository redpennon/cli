import { Command } from '@oclif/core';

import { maskToken, resolveApiToken, resolveApiUrl, resolveProject } from '../auth.js';
import { connectionFlags } from '../shared-flags.js';

export default class Status extends Command {
  static override description =
    'Show the resolved API URL, project, and whether an API token is configured.';

  static override flags = { ...connectionFlags };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    const apiToken = resolveApiToken({
      flag: flags['api-token'],
      configDir: this.config.configDir,
      warn: (message) => this.warn(message),
    });
    const project = resolveProject({ flag: flags.project });
    const apiUrl = resolveApiUrl({ flag: flags['api-url'] });

    this.log(`API URL:  ${apiUrl}`);
    this.log(`Project:  ${project ?? '(not set)'}`);
    this.log(
      `Token:    ${apiToken ? `configured (${maskToken(apiToken)})` : '(not set)'}`,
    );
    this.log(`Config:   ${this.config.configDir}`);
  }
}
