# Development

This repository was initialized from the clean dsh-chatgpt-plan 0.1.2 source archive. The stable repository directory is `dsh-codex-oauth`; the npm package remains `dsh-chatgpt-plan` so installation and generated RPC identifiers remain compatible. No plugin behavior was changed during the original repository preparation.

## Release lines and branches

The Pi catalog work described in [ADR-0001](<adr/ADR-0001-use-pi-model-catalog.md>) was developed on `feature/pi-model-catalog`, merged into `main` as `3e55d72` (PR #1) and released as `0.1.5-pi-catalog.2`. Only `main` exists now, and the later releases — including the current `0.1.9-sidebar-height.1` — are prepared and version-bumped on `main`.

Isolate a change on a branch only when it must stay out of the released line, and state the target branch and version range before starting. No installed DSH ASAR/core or Pi/WSL files are part of these changes.

Pi is the single model metadata source. OAuth, native credentials, direct OpenAI Responses inference and native Harness interfaces remain separate. See [ADR-0001](<adr/ADR-0001-use-pi-model-catalog.md>) for the decision and rejected alternatives.

## Layout and ownership

- [Plugin source](<../packages/plugin/src/>): Host account management, Pi catalog/cache, Responses adapter, RPC and Client UI.
- [Plugin docs](<../packages/plugin/docs/>): architecture, provider restrictions, diagnostics and version-scoped validation evidence.
- [Tests](<../test/>): protocol, native-service integration and pure React tree tests using fictional credentials.
- [Typert preparation](<../scripts/prepare-typert.mjs>): analysis-only declarations needed by the pinned native generator.
- [Dependency lockfile](<../package-lock.json>): locked development and runtime dependencies.
- [Node version](<../.nvmrc>): Node 24 development version.

## Commands

```sh
nvm use
npm ci
npm run check
npm run pack:plugin
```

`check` builds the Host and generated RPC before the Client, then runs the automated tests. OAuth callback tests bind localhost and need a terminal that permits local listeners. These tests do not authenticate a real account or perform live model inference.

`pack:plugin` rebuilds and emits `dsh-chatgpt-plan-<version>.tgz` in the repository root. Use the resulting versioned artifact, not a separately rebuilt copy, for the deployment being validated. Record its digest and retain the previous known-good tarball. See the [installation guide](<../packages/plugin/README.md>).

The source repository is independent of an installed Harness profile. Editing source does not replace the installed plugin. Dependencies, compiled output, analysis-only declarations, caches and tarballs remain ignored. Keep real credentials and account data outside the repository; OAuth credentials stay in Harness's native managed credential service.

## Maintaining the bundled catalog snapshot

The release/bootstrap snapshot is generated from the **same** [Pi service](<https://pi.dev/api/models/providers/openai-codex?types=chat>) used by runtime updates:

```sh
node --import tsx scripts/update-pi-catalog.ts
# Equivalent maintainer shortcut:
npm run catalog:snapshot
```

Review the generated metadata diff and rerun the checks before packaging. This command is for maintainers preparing a bundled offline starting point; it is **not required for every new model**. Users get new valid lists through the activation check or **Update models now**, without a package release, manual model edits or a Pi runtime dependency.

The Host bounds each catalog fetch to 4 seconds, 2 MiB and 1,000 records. Runtime JSON and its ETag are cached per profile under `.cache/dsh-chatgpt-plan/pi-catalog-v1.json`, separate from grants. Successful lists replace rather than merge, including an empty list. Network, size or validation failures retain the last valid cache or bundled snapshot and expose a catalog warning. Never use an OAuth `/v1/models` request or inference probe for discovery.

## Windows deployment and rollback

The target is the real `~/.dsh/profiles/desktop` profile. After complete checks and packaging, install the **same versioned tarball** emitted in the repository root through the Windows global bundled CLI:

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "C:\path\to\dsh-chatgpt-plan-<version>.tgz"
```

Use **restartHost**, then refresh the existing `http://127.0.0.1:19387` UI. Do not launch a replacement server, promise HMR or patch the installed application. Check the surface the release actually changes — for the catalog work that means the source badge, the exact human names/IDs, empty and fallback feedback and the native selector — and obtain distinct live-inference evidence only if a real request is authorized.

For rollback, reinstall the retained previous tarball through the same CLI and profile, then restartHost and refresh the same URL. Preserve OAuth credentials and both artifacts/digests. A rollback is not a reason to delete the native credential store. Legacy model lists stored alongside an existing grant are ignored on read while the grant itself is preserved.

## Release validation records

Keep the [build-time validation record](<../packages/plugin/docs/validation.md>) separate from per-deployment evidence. Record artifact digests, installation results and live-inference evidence in a local receipt file that is excluded from Git, never in the published documentation: deployment receipts carry machine-specific paths, process identifiers, local backup directories and account state that do not belong in the package.

Independent confirmation of access through Pi is external evidence, not a successful request from this plugin.

Do not repack a released version merely to update its deployment results; keep the installed artifact and its recorded digest paired.

## Harness compatibility policy

Runtime DSH peer dependencies and `engines.dsh` declare `>=0.2.0-rc.2 <0.3.0-0`. The installed Harness admission check evaluates DSH peers with `semver.satisfies(..., { includePrerelease: true })`; `engines.dsh` is informational. The `-0` upper bound excludes even prereleases of the next minor line. Tests exercise both boundaries and ensure all DSH peers agree.

Keep development dependencies pinned to the tested `0.2.0-rc.2` baseline and retain the lockfile. Semver is a development-only dependency for admission-policy tests, not part of the plugin runtime.

A permissive admission result is not an API compatibility guarantee. For each new Harness release:

1. Review changes to the native LLM, credentials, authorization, attachment, Typert and Slot contracts.
2. Build and run the complete suite against the candidate SDK in a separate test checkout/profile.
3. Smoke-test plugin loading, Models, sidebar expanded/collapsed placement, and token-free RPC. Keep account and inference validation separate from fixture tests.
4. Record the tested runtime. Adapt and release the plugin if contracts changed; do not silently widen the range or install version exemptions.

Install a newly packed version in the target profile through the plugin manager, then restart when requested. Updating this repository alone never changes a global profile.

## Git conventions

When commits are explicitly requested, use English Conventional Commit subjects, matching the existing history (`feat(client):`, `feat(plugin):`, `fix(plugin):`, `test:`, `docs:`). Keep independently meaningful changes in separate commits. Author identity inherits the existing Git configuration.
