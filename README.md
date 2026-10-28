# RedPennon CLI

RedPennon command-line tool, published as `@redpennon/cli` with the binaries
`redpennon` and `rp`. It scans a checked-out repository for feature-flag
variable usages and pushes the references to the RedPennon API.

This is the *push* half of the code references + staleness feature: scanning
runs where the full source already lives (your CI or your machine), so there is
no API rate limit and no server-side code pull. It works with **GitHub, GitLab,
and Bitbucket** — the scan reads the working tree, so it is host-agnostic. See
[AGENTS.md](../../AGENTS.md) for the full repository guide.

## What it does

- `**rp usages**` — walk the working tree (default SDK call patterns plus any
`.redpennon/config.yml` `codeInsights` match patterns) and list every
variable usage. **Side-effect-free — it never posts.** `--format json` emits
machine output, `-o/--output` writes to a file, `--show-regex` prints the
effective patterns, and `--only-unused` lists keys absent from the project.
- `**rp publish**` — scan, resolve the git context, and POST the full snapshot to
  `POST /v1/code-references`. Auto-detects the CI environment (GitHub Actions,
  GitLab CI, Bitbucket Pipelines, CircleCI, Azure Pipelines, Jenkins), so
  pipelines call it with no extra flags. Override with `--provider`,
  `--repository`, `--branch`, `--commit-sha`. This is the uploader for non-GitHub
  CI (the GitHub Action does the equivalent for GitHub).
  - `--dry-run` prints what would be published (target, commit, reference and
    key counts) without contacting the API; no token needed.
  - `--fail-on-unknown` exits non-zero if the API reports keys that are not in
    the project.
  - `--max-references <n>` (default 2000) errors instead of sending an
    oversized snapshot. This is a client-side guard; see [Limits](#limits-and-safety).
- `**rp auth login**` / `**rp auth logout**` — store or remove the API token in
  the CLI config directory (see [Authentication](#authentication)).
- `**rp keys**` — fetch the project's variable keys from
`GET /v1/code-references/keys` (used as the search terms for scanning).
- `**rp repo init**` — scaffold a `.redpennon/config.yml` for the repo.
- `**rp status**`, `**rp autocomplete**`, `**rp help**` — diagnostics and shell
completion.

Roadmap (blocked on a future management API): `rp diff`, `rp cleanup`,
`rp generate`, and management topics (`features`, `variables`, `targeting`, …).

## Stack

- Node 24+ and TypeScript
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
base URL for self-hosted or local instances with `--api-url` / `RP_API_URL`
(default: the hosted RedPennon API). The URL must be `https://`; plain
`http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]`. Never
commit the token; in CI store it as a secret.

### Storing a token locally

```bash
rp auth login                              # hidden prompt
echo "$REDPENNON_API_TOKEN" | rp auth login   # piped stdin
rp auth login --api-token rpa_xxx          # works, but lands in shell history
rp auth logout                             # remove the stored token
rp status                                  # shows the resolved URL, project and the token's rpa_ prefix
```

`auth login` writes `auth.json` (`{"clientCredentials":{"apiToken":"..."}}`) to
the config directory with mode `0600`. If the file is ever group- or
world-readable (non-Windows), commands print a warning with the `chmod 600` fix.

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

Each pattern must compile, contain exactly one capture group for the variable
key, and be at most 500 characters; at most 50 custom patterns are allowed. The
same checks apply to `--match-pattern`. Include globs must stay inside the
repository (no absolute paths or `..` segments).

The built-in patterns ignore matches on full-line comments (`//`, `/*`, `*` in
TypeScript/JavaScript/Go; `#` in Python) and also match calls whose key is on a
following line, e.g. `client.variable(\n  'dark-mode',\n)`. Custom
`matchPatterns` are applied as written.

### Limits and safety

- Files larger than 1 MB are skipped.
- Each reference's `snippet` is capped at 200 characters and common secret
  shapes (`rpa_` tokens, AWS access keys, `Bearer ...`, `password`/`secret`/`token`
  assignments) are replaced with `[REDACTED]` before anything is sent.
- API calls time out after 30s and are retried (up to 3 attempts, exponential
  backoff) on network errors and 5xx responses; 4xx responses fail immediately.
- `publish` refuses to send more than 2,000 references (the API rejects larger snapshots) (`--max-references`).
  The API contract in this repository documents no per-request limit, so this is
  only a guard against runaway scans; automatic chunking would need a server-side
  decision.

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

### Inputs

| Input | Required | Description |
| --- | --- | --- |
| `api-token` | yes | Organisation API token (`rpa_...`); store it as a secret. |
| `project` | yes | Project key the references belong to. |
| `api-url` | no | API base URL override (https, or http for localhost). |
| `working-directory` | no | Directory to scan, relative to the workspace (default: the workspace root). Must stay inside the workspace. |
| `config-path` | no | Config file path, relative to the working directory (default: `.redpennon/config.yml`). |
| `fail-on-unknown` | no | `true` to fail the step if the API reports keys that are not in the project (default: `false`, which only warns). |
| `max-references` | no | Fail instead of publishing more than this many references (default: `2000`). |

Outputs: `accepted`, `matched`, `unknown-keys` (comma-separated).

For a monorepo package:

```yaml
      - uses: redpennon/cli@v1
        with:
          api-token: ${{ secrets.REDPENNON_API_TOKEN }}
          project: my-project
          working-directory: packages/web
          config-path: .redpennon/web.yml
          fail-on-unknown: true
```

On `pull_request` events the branch is taken from `GITHUB_HEAD_REF` (the PR's
source branch) rather than `GITHUB_REF_NAME` (`<n>/merge`).

A ready-to-copy workflow lives in [`examples/redpennon-usages.yml`](examples/redpennon-usages.yml).

## GitLab / Bitbucket

Install the CLI and call `rp publish`; the provider is detected from the built-in
CI env vars (no extra flags).

```yaml
# .gitlab-ci.yml
redpennon-usages:
  stage: .post
  image: node:24-alpine
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - npm install -g @redpennon/cli
    - rp publish --project $REDPENNON_PROJECT_KEY --api-token $REDPENNON_API_TOKEN
```

```yaml
# bitbucket-pipelines.yml
pipelines:
  branches:
    main:
      - step:
          image: node:24-alpine
          script:
            - npm install -g @redpennon/cli
            - rp publish --project $REDPENNON_PROJECT_KEY --api-token $REDPENNON_API_TOKEN
```

## Other CI systems

`rp publish` also reads the built-in variables of CircleCI (`CIRCLE_*`), Azure
Pipelines (`BUILD_*`, `SYSTEM_PULLREQUEST_SOURCEBRANCH`) and Jenkins (`GIT_URL`,
`GIT_BRANCH`/`BRANCH_NAME`, `GIT_COMMIT`) for the repository, branch and commit.
The `provider` sent to the API is always one of `github`, `gitlab` or
`bitbucket` (inferred from the remote URL where possible, otherwise `github`);
use `--provider` to override it.

## Releasing

Pushing a `v*` tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml):
it runs the suite, builds, and `npm publish`es `@redpennon/cli` with provenance
(gated by the `NPM_TOKEN` repository secret), then cuts a GitHub Release. CI also
fails if `action/index.cjs` is out of date with `npm run action:build`. Bump `version` in
`package.json` before tagging.

## Local development

```bash
npm install            # install dependencies
npm test               # run the vitest suite
npm run test:coverage  # tests + coverage (fails below 80% lines; runs in CI)
npm run build          # compile TypeScript to dist/
npm run action:build   # bundle the GitHub Action to action/index.cjs
node ./bin/run.js usages --show-regex   # try the CLI against the current repo
```

From the monorepo root, `./dev.sh cli build` runs the TypeScript + action
build, and `./dev.sh cli publish` **validates** the package (dry-run pack only —
it never uploads). Real releases run in CI on a `v*` tag (see [Releasing](#releasing)).
The bundled `action/index.cjs` is committed and consumed via the moving
`redpennon/cli@v1` tag.