# RedPennon CLI

RedPennon command-line tool, published as `@redpennon/cli` with the binaries
`redpennon` and `rp`. It scans a checked-out repository for feature-flag
variable usages and pushes the references to the RedPennon API.

This is the *push* half of the code references + staleness feature: scanning
runs where the full source already lives (your CI or your machine), so there is
no GitHub API rate limit and no server-side code pull. See
[AGENTS.md](../../AGENTS.md) for the full repository guide.

## What it does

- `**rp usages*`* — walk the working tree (default SDK call patterns plus any
`.redpennon/config.yml` `codeInsights` match patterns) and list every
variable usage. **Side-effect-free — it never posts** (the GitHub Action does the
upload). `--format json` emits machine output, `-o/--output` writes to a file,
`--show-regex` prints the effective patterns, and `--only-unused` lists keys
absent from the project.
- `**rp keys**` — fetch the project's variable keys from
`GET /v1/code-references/keys` (used as the search terms for scanning).
- `**rp repo init**` — scaffold a `.redpennon/config.yml` for the repo.
- `**rp status**`, `**rp autocomplete**`, `**rp help**` — diagnostics and shell
completion.

Roadmap (blocked on a future management API): `rp diff`, `rp cleanup`,
`rp generate`, and management topics (`features`, `variables`, `targeting`, …).

## Stack

- Node 20+ and TypeScript
- [oclif](https://oclif.io) for the topic/command structure, config directory,
and autocomplete
- Published to npm as `@redpennon/cli`; optional Homebrew tap

## Authentication

The CLI authenticates with an organisation-scoped `ApiToken` (`rpa_*` bearer
token, created under Settings → API Tokens in the app). Provide it via, in
order of precedence:

1. `--api-token` flag
2. `RP_API_TOKEN` environment variable
3. the auth file in the oclif config directory (`clientCredentials`)

Select the project with `--project` / `RP_PROJECT_KEY`, and override the API
base URL for self-hosted or local instances with `--api-url`
(default: the hosted RedPennon API). Never commit the token; in CI store it as a
secret.

## Repository configuration

`rp usages` and `rp repo init` read `.redpennon/config.yml` at the repo root.
The `codeInsights` block mirrors the matcher knobs:

```yaml
codeInsights:
  clientNames:
    - rpClient
  variableAliases:
    "FLAGS.DARK_MODE": dark-mode
  matchPatterns:
    ts:
      - "getFlag\\(\\s*[\"']([^\"']*)[\"']"
  includeFiles:
    - "*.[jt]s"
  excludeFiles:
    - "dist/*"
```

Each pattern must contain exactly one capture group for the variable key.

## GitHub Action

A bundled Node action (`action.yml` + `action/index.cjs`) scans the checkout and
posts the snapshot itself. Run it on push to `main` with a full checkout:

```yaml
on:
  push:
    branches: [main]
jobs:
  code-usages:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: redpennon/cli@v1
        with:
          api-token: ${{ secrets.REDPENNON_API_TOKEN }}
          project: my-project
```

A ready-to-copy workflow lives in [`examples/redpennon-usages.yml`](examples/redpennon-usages.yml).

## Local development

```bash
npm install            # install dependencies
npm test               # run the vitest suite
npm run build          # compile TypeScript to dist/
npm run action:build   # bundle the GitHub Action to action/index.cjs
node ./bin/run.js usages --show-regex   # try the CLI against the current repo
```

From the monorepo root, `./dev.sh cli build` runs the TypeScript + action
build, and `./dev.sh cli publish [--dry-run]` publishes `@redpennon/cli` to npm
(NPM_TOKEN-gated). The bundled `action/index.cjs` is committed and consumed via
the moving `redpennon/cli@v1` tag.