# Development

This repository was initialized from the clean dsh-chatgpt-plan 0.1.2 source archive. The stable repository directory is `dsh-codex-oauth`; the npm package remains `dsh-chatgpt-plan` so installation and generated RPC identifiers remain compatible. No plugin behavior was changed during the original repository preparation.

## Experimental worktree

Develop **`0.1.5-pi-catalog.1`** on `feature/pi-model-catalog` in `C:\Users\rafat\Desktop\Code\dsh-codex-oauth-pi-catalog`. Keep the stable `dsh-codex-oauth` checkout and `main` unchanged. No installed DSH ASAR/core or Pi/WSL files are part of this change. Do not create commits unless requested.

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

The initial target is the real `~/.dsh/profiles/desktop` profile with plugin `0.1.4`. After complete checks and packaging, install the **same experimental tarball** through the Windows global bundled CLI:

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "C:\Users\rafat\Desktop\Code\dsh-codex-oauth-pi-catalog\dsh-chatgpt-plan-0.1.5-pi-catalog.1.tgz"
```

Use **restartHost**, then refresh the existing `http://127.0.0.1:19387` UI. Do not launch a replacement server, promise HMR or patch the installed application. Check the source badge, exact human names/IDs, empty/fallback feedback and native selector; then obtain distinct live-inference evidence if a real request is authorized.

For rollback, reinstall the retained `0.1.4` tarball through the same CLI and profile, then restartHost and refresh the same URL. Preserve OAuth credentials and both artifacts/digests. A catalog rollback is not a reason to delete the native credential store. The upgrade ignores legacy model lists stored alongside an existing grant while preserving the grant itself.

Keep the [build-time validation record](<../packages/plugin/docs/validation.md>) separate from the post-build receipt below. User-confirmed Pi access on a Pro 5x account is external evidence, not a successful request from this plugin.

### Deployment receipt: 0.1.5-pi-catalog.1

Build/install recorded on 2026-10-01; restart, corrected native-account verification and live inference recorded on 2026-10-02 (Europe/Madrid). No commits, pushes or core changes were made.

| Check | Evidence |
| --- | --- |
| Source | `feature/pi-model-catalog`, based on `91d627f6141997eb99bf4dc70d15b413215acb74`; stable `main` checkout remains clean. |
| Build and regression tests | Windows Node **24.21.0**; `npm run check` **136/136 passed**, no failures, cancellations or skips; `npm run typecheck` passed. |
| Public Pi snapshot | `npm run catalog:snapshot -- --check` passed against the real service, **9 models**. Exact `gpt-6.1-sol` / `GPT-6.1 Sol` retained. |
| Candidate artifact | [dsh-chatgpt-plan-0.1.5-pi-catalog.1.tgz](<../dsh-chatgpt-plan-0.1.5-pi-catalog.1.tgz>), **238632 bytes**, **38 files**; no credentials, environment files, tests, `node_modules` or audit scratch files in the tarball. |
| Candidate SHA-256 | `4a4470402b3bc8b5b79f9c6bdbc44a9d8f67b026520467ddb106d41c25a1d35f` |
| Rollback | Existing `dsh-codex-oauth/dsh-chatgpt-plan-0.1.4.tgz` retained, SHA-256 `2485f414eae8d5ac565db6b23f1cc910572c168db1301d61fe8a1e02faee8131`. |
| Installation metadata backup | `~/.dsh/backups/chatgpt-plan-before-pi-catalog-20261001-2347`: only `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`. No credential backup/export. |
| Desktop installation | Global bundled CLI command above exited **0**. Real desktop manifest now names the exact candidate tarball. **38/38 installed files** compared byte-for-byte by SHA-256 with the archive. |
| Native dependency diagnostic | `pnpm peers check` reports missing local peers because profile `node_modules` does not contain the runtime's shared packages. All **9 Host peers** exist in the immutable Desktop runtime and satisfy their declared ranges. Electron uses Node **24.18.1**. React is provided separately by the Client shell, not asserted from Host `node_modules`. No duplicate core packages or version exemptions installed. |
| Installed package native load | **Verified** with the shared runtime and the real desktop profile: the exact installed `0.1.5-pi-catalog.1` loaded through the native credentials, authorization and LLM services and reported `catalog.source = "pi"` with no unhandled failure. This exercises the installed artifact, not the already-running GUI Host. |
| Public catalog refresh and cache | **Verified in the real profile:** the activation check moved `bundled` to `remote` at revision `63334bb2d0308eacbc238f7b5b5c88adec1e5a86f818ae76d001f70137917942` with `refreshing: false` and no warning; a later start loaded `cache` first and refreshed again. `~/.dsh/profiles/desktop/.cache/dsh-chatgpt-plan/pi-catalog-v1.json` holds only public model metadata, source identity, timestamps and ETag — no token, header or account field. |
| Deployed Host and Client artifacts | **Verified in the installed copies:** `lib/index.js` references the fixed Pi catalog URL and the catalog module; `lib/client.js` contains every user-visible catalog label (`Pi catalog`, `Revision`, `Last checked`, `Last updated`, `Not yet recorded`, `Update models now`, empty-catalog and failure messages) and the exact `GPT-6.1 Sol` name; `lib/typert.remote-client.js` exposes the token-free `getStatus`/`refreshModels` surface. The source URL stays Host-side, so the Client bundle does not carry it. |
| Manual catalog refresh | **Verified against the real endpoint with the installed package:** `refreshModels` issued **exactly one** GET to the fixed public URL, moved the catalog from `cache` to `remote`, reported `refreshing: false` with no warning and advanced `lastCheckedAt`. This initial public-only check used the temporary probe's profile-local store (not Desktop's actual shared account store), which stayed `disconnected`, with **zero** inference and **zero** OAuth requests. The catalog/cache path and installed service were correct; the account-location correction is recorded below. |
| Existing account state | **Connected, verified with the correct native store:** Desktop's base configuration mounts `LocalCredentialProvider` with its default `$DSH_HOME/.credentials.yaml`, not a profile-local file. The original temporary probe incorrectly specified a profile-local store; its empty enumeration and `disconnected` result did **not** describe Desktop's account. That earlier conclusion is withdrawn. After removing the probe's path override, the installed plugin reports `connected`, **9 models** and exact `GPT-6.1 Sol`; cache-to-remote refresh completes without warning. No raw credential document was inspected or exported. |
| Running Desktop Host / GUI | **Restart confirmed:** the old supervisor has been replaced by PID 27940, created on 2026-10-02 at **00:32:08**, with a new child Host PID 10056 at **00:32:44**, after installation. The user confirmed the restart. **Visual verification passed with two user-provided screenshots and explicit user approval:** the actual Models panel shows `Update models now`, the metadata/access disclaimer, all **9 exact human names and IDs**, modalities and the existing usage link. The sidebar shows `ChatGPT plan connected`. The second screenshot shows all **9 official model names** under `ChatGPT Plan` in the native composer selector, with **GPT-6.1 Sol selected**. The source/revision/date section is above the visible scroll region and is not claimed as directly observed in these screenshots; its data was independently verified through native status. `dsh --profile desktop --dump-config` refuses with `profile "desktop" is managed exclusively by the Electron application`; unauthenticated access to the existing URL returns 401. No replacement server, authentication bypass or HMR assumption was used. |
| Live direct Responses request | **Passed:** the exact installed `0.1.5-pi-catalog.1` ran through official native credential/authorization/LLM services using the default shared store and the desktop profile. Exactly **one POST** to `https://api.openai.com/v1/responses`, exact model **`gpt-6.1-sol`**, only prompt **`Responde solo OK.`**, no tools/private history/substitution/retry/API-key fallback. Result: **HTTP 200**, text **`OK`**, terminal **`response.completed`** independently observed, successful native finish, no safe failure code; the session remains **connected**. This is an installed-artifact native probe, not a browser-driven chat test. |

The receipt is repository-only: do not repack the same version merely to update these post-build results. This keeps the installed artifact and its recorded digest unchanged.

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
