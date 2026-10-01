# Development

This repository was initialized from the clean dsh-chatgpt-plan 0.1.2 source archive. The repository directory is `dsh-codex-oauth`; the npm package remains `dsh-chatgpt-plan` so installation and generated RPC identifiers remain compatible. No plugin behavior was changed during repository preparation.

## Layout and ownership

- `packages/plugin/src/`: Host account management, official catalog, Responses adapter, RPC and Client UI.
- `packages/plugin/docs/`: architecture, provider restrictions, diagnostics and existing validation evidence.
- `test/`: protocol and native-service integration tests using fictional credentials.
- `scripts/prepare-typert.mjs`: prepares the analysis-only declarations needed by the pinned native generator.
- `package-lock.json`: locked development and runtime dependencies.
- `.nvmrc`: Node 24 development version.

## Commands

```sh
nvm use
npm ci
npm run check
npm run pack:plugin
```

`check` builds the Host and generated RPC before the Client, then runs the existing automated tests. OAuth callback tests bind localhost and need a terminal that permits local listeners. These tests do not authenticate a real account or perform live model inference.

`pack:plugin` rebuilds and emits `dsh-chatgpt-plan-<version>.tgz` in the repository root. Installation instructions are in `packages/plugin/README.md`. The source repository is independent of an installed Harness profile; editing source does not replace the installed plugin until a new tarball is installed.

`node_modules/`, compiled `lib/`, analysis-only `packages/.build/`, build caches and tarballs are ignored. Keep real credentials and account data outside the repository. The native plugin continues to store credentials through Harness's managed credential service.

## Harness compatibility policy

Runtime DSH peer dependencies and `engines.dsh` declare `>=0.2.0-rc.2 <0.3.0-0`. The installed Harness admission check evaluates DSH peers with `semver.satisfies(..., { includePrerelease: true })`; `engines.dsh` is informational. The `-0` upper bound excludes even prereleases of the next minor line. Tests exercise both boundaries and ensure all DSH peers agree.

Keep development dependencies pinned to the tested `0.2.0-rc.2` baseline and commit the lockfile. Semver is a development-only dependency for admission-policy tests, not part of the plugin runtime.

A permissive admission result is not an API compatibility guarantee. For each new Harness release:

1. Review changes to the native LLM, credentials, authorization, attachment, Typert and Slot contracts.
2. Build and run the complete suite against the candidate SDK in a separate test checkout/profile.
3. Smoke-test plugin loading, Models, sidebar expanded/collapsed placement, and token-free RPC. Keep account and inference validation separate from fixture tests.
4. Record the tested runtime. Adapt and release the plugin if contracts changed; do not silently widen the range or install version exemptions.

Install a newly packed version in the target profile through the plugin manager, then restart when requested. Updating this repository alone never changes a global profile.

## Git conventions

Use English Conventional Commit subjects, matching the existing history (`feat(client):`, `feat(plugin):`, `fix(plugin):`, `test:`, `docs:`). Keep independently meaningful changes in separate commits. Author identity inherits the existing Git configuration.
