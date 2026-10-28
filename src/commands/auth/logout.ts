import { Command } from '@oclif/core';

import { removeAuthFile } from '../../auth.js';

export default class AuthLogout extends Command {
  static override description = 'Remove the API token stored by `auth login`.';

  static override examples = ['<%= config.bin %> auth logout'];

  async run(): Promise<void> {
    const removed = removeAuthFile(this.config.configDir);
    this.log(
      removed
        ? 'Removed stored credentials.'
        : 'Not logged in (no stored credentials found).',
    );
    if (process.env.RP_API_TOKEN) {
      this.warn('RP_API_TOKEN is still set in the environment and will continue to be used.');
    }
  }
}
