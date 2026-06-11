import { Flags } from '@oclif/core';

/** Flags common to commands that talk to the RedPennon API. */
export const connectionFlags = {
  'api-token': Flags.string({
    description: 'Organisation API token (rpa_...). Defaults to RP_API_TOKEN or the auth file.',
  }),
  project: Flags.string({
    char: 'p',
    description: 'Project key. Defaults to RP_PROJECT_KEY.',
  }),
  'api-url': Flags.string({
    description: 'API base URL. Defaults to RP_API_URL or the hosted API.',
  }),
};
