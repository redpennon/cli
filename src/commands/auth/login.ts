import { Command, Flags } from '@oclif/core';

import { writeAuthFile } from '../../auth.js';
import { promptSecret } from '../../prompt.js';

export default class AuthLogin extends Command {
  static override description =
    'Store an organisation API token in the CLI config directory so later commands need no --api-token. ' +
    'The token is read from a hidden prompt (or piped stdin) unless --api-token is given.';

  static override examples = [
    '<%= config.bin %> auth login',
    'echo "$REDPENNON_API_TOKEN" | <%= config.bin %> auth login',
    '<%= config.bin %> auth login --api-token rpa_xxx',
  ];

  static override flags = {
    'api-token': Flags.string({
      description: 'Organisation API token (rpa_...). Prefer the hidden prompt: flags land in shell history.',
    }),
  };

  protected async readToken(): Promise<string> {
    return promptSecret('RedPennon API token (rpa_...): ');
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(AuthLogin);
    const token = (flags['api-token'] ?? (await this.readToken())).trim();
    if (!token) {
      this.error('An API token is required.');
    }
    if (!token.startsWith('rpa_')) {
      this.error('That does not look like a RedPennon API token (expected the rpa_ prefix).');
    }
    const path = writeAuthFile(this.config.configDir, token);
    this.log(`Saved credentials to ${path}`);
  }
}
