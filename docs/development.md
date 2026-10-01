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

`pack:plugin` rebuilds and emits `dsh-chatgpt-plan-0.1.2.tgz` in the repository root. Installation instructions are in `packages/plugin/README.md`. The source repository is independent of an installed Harness profile; editing source does not replace the installed plugin until a new tarball is installed.

`node_modules/`, compiled `lib/`, analysis-only `packages/.build/`, build caches and tarballs are ignored. Keep real credentials and account data outside the repository. The native plugin continues to store credentials through Harness's managed credential service.

## Initial Git state

Git is initialized locally without a commit, staging changes or configuring a remote. Author identity inherits the existing Git configuration. No global or local identity override was added.
