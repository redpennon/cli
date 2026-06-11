import { Command, Flags } from '@oclif/core';

import { CONFIG_RELATIVE_PATH } from '../../config.js';
import { writeScaffold } from '../../scaffold.js';

export default class RepoInit extends Command {
  static override description =
    'Scaffold a .redpennon/config.yml in the current repository.';

  static override examples = ['<%= config.bin %> repo init'];

  static override flags = {
    force: Flags.boolean({ description: 'Overwrite an existing config file.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(RepoInit);
    const { created } = writeScaffold(process.cwd(), flags.force);
    if (!created) {
      this.error(`${CONFIG_RELATIVE_PATH} already exists (use --force to overwrite).`);
    }
    this.log(`Created ${CONFIG_RELATIVE_PATH}`);
  }
}
