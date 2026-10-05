# AGENTS.md

Guidance for coding agents working in this repository. It complements [README.md](README.md) and
[docs/development.md](docs/development.md); it does not replace them.

## Project identity

- The repository `dsh-codex-oauth` publishes the package **`dsh-chatgpt-plan`**. Keep the package
  name, the `cordis.patch.yml` row id and the generated RPC names unchanged.
- Version source of truth: [packages/plugin/package.json](packages/plugin/package.json). The
  workspace root `package.json` mirrors it. Do not trust prose versions in README files.
- The plugin signs in to a ChatGPT plan account through OpenAI's *Sign in with ChatGPT*
  plan-sharing preview and calls `https://api.openai.com/v1/responses` directly. The Harness keeps
  ownership of tools and permissions.

## Invariants

Do not change these without an explicit request and a recorded decision:

- **The billing path never changes.** No API-key fallback, no model substitution, no inferred quota
  reset time.
- **Pi is the only model metadata source.** No model is added, renamed, aliased or replaced by hand.
  Discovery never uses the OAuth `/v1/models` endpoint.
- **Catalog fetches stay bounded** to 4 seconds, 2 MiB and 1,000 records, and remote JSON is
  validated before publication.
- **OAuth tokens live only in the native managed credential store.** Client surfaces and RPC
  results stay token-free.
- **Only `response.completed` is a successful stream termination**, and stream translation never
  executes a tool.
- **A credential record is a grant, not a model list.** Catalog failures never turn a connected
  session into `reconnect-required`.

## Layout

| Path | Contents |
| --- | --- |
| [packages/plugin/src](packages/plugin/src/) | Host account management, Pi catalog and cache, Responses adapter, RPC service and Client UI. |
| [packages/plugin/docs](packages/plugin/docs/) | Architecture, model restrictions, diagnostics and version-scoped validation evidence. |
| [packages/plugin/package.json](packages/plugin/package.json) | Package manifest: `dsh` manifest, exports, peers, `files`. |
| [test](test/) | Protocol, native-service integration and React tree tests with fictional credentials. |
| [scripts/update-pi-catalog.ts](scripts/update-pi-catalog.ts) | Maintainer-only regeneration of the bundled catalog snapshot. |
| [scripts/prepare-typert.mjs](scripts/prepare-typert.mjs) | Analysis-only declarations required by the pinned Typert generator. |
| [docs](docs/) | Repository development guide, ADRs and the [agent installation runbook](docs/agent-install.md). |

## Commands

Run from the repository root, with Node 24 (`nvm use`, see [.nvmrc](.nvmrc)).

```sh
npm ci
npm run check          # build Host, generated RPC and Client, then run the test suite
npm run typecheck      # static types only
npm run pack:plugin    # emit dsh-chatgpt-plan-<version>.tgz in the repository root
npm run catalog:snapshot   # maintainers only: regenerate the bundled snapshot
```

- `check` = `build` + `test`. `test` runs `node --import tsx --test test/*.test.ts`; the OAuth
  callback tests bind localhost, so they need a terminal that permits local listeners.
- `build:host` runs `scripts/prepare-typert.mjs`, `tsc -b tsconfig.host.json` and `tsdown` for the
  Host; `build:client` compiles and bundles the Client. Host output is required before the Client.
- `lib/`, `packages/.build/` and `*.tsbuildinfo` are generated and ignored. Never edit them.

## Dependency policy

- DSH peers are pinned to the tested `0.2.0-rc.2` baseline. Runtime peers and the informational
  `engines.dsh` declare `>=0.2.0-rc.2 <0.3.0-0`. Do not widen that range silently; the `-0` upper
  bound deliberately excludes every `0.3.0` prerelease.
- Keep the lockfile and the exact pins. `semver` is a development-only dependency used by the
  admission-policy tests, not part of the plugin runtime.
- Protocol tests and fixture tests are not evidence of a live request. Say so when reporting.

## Documentation duties

- Behavior changes update the matching document: [packages/plugin/README.md](packages/plugin/README.md)
  for installation and connection behavior,
  [packages/plugin/docs/architecture.md](packages/plugin/docs/architecture.md) for component
  ownership, [packages/plugin/docs/models.md](packages/plugin/docs/models.md) for catalog semantics,
  [packages/plugin/docs/troubleshooting.md](packages/plugin/docs/troubleshooting.md) for diagnostics.
- Build-time evidence belongs in
  [packages/plugin/docs/validation.md](packages/plugin/docs/validation.md). Per-machine deployment
  receipts belong in a `*.local.md` file, which is ignored by Git.
- Never record tokens, account identifiers, raw authenticated headers or machine-specific paths in
  tracked documentation or test fixtures. Use fictional credentials.

## Git conventions

- When commits are explicitly requested, use English Conventional Commit subjects matching the
  history: `feat(plugin):`, `feat(client):`, `fix(plugin):`, `refactor(client):`, `test:`, `docs:`,
  `build(plugin):`, `chore(release):`.
- Keep independently meaningful changes in separate commits. Do not commit unless asked.

## Do not

- Do not edit an installed Harness profile, its `node_modules`, the application ASAR/core, or a
  Pi/WSL installation. Source edits never change an installed profile.
- Do not start a replacement Web server or claim hot-reload. Install through the bundled CLI and
  use the application's **restartHost** action.
- Do not hand-edit the profile files the plugin manager owns for you; see the
  [agent installation runbook](docs/agent-install.md).
