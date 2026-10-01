# Validation

## Experimental Pi catalog release: 0.1.5-pi-catalog.1

Scope: `feature/pi-model-catalog`, isolated `dsh-codex-oauth-pi-catalog` worktree, Windows Node 24.21.0. Recorded on 2026-10-01. The stable checkout and installed DSH core are not changed by source implementation. Historical results below are not evidence that the new catalog release has passed live validation.

This is the **build-time record**. Post-build artifact hashes and Desktop/live results belong in the repository's deployment receipt, so the validated tarball does not need to be rebuilt to record its own deployment.

| Check | Recorded result |
| --- | --- |
| Compiled Client, pure React Models panel and existing sidebar | **Passed:** 31 focused tests (10 compiled Client races, 15 panel and 6 sidebar), also included in the full run. Covers independent catalog/auth state, stale refresh/status results, exact names/IDs, optional metadata, source/revision/dates, empty/fallback feedback, native update events and unchanged quota/sidebar semantics. No DOM or live UI claim. |
| Full Host/Client build and complete automated suite | **Passed:** `npm run check`; **136 tests, 136 passed, 0 failed, 0 cancelled, 0 skipped**. Host, generated RPC and Client rebuilt before the run. |
| Static types | **Passed:** `npm run typecheck`; additional strict standalone checks cover catalog, session and the new session regressions. |
| Pi service fetch and generated snapshot | **Passed:** `npm run catalog:snapshot -- --check`; the real public Pi endpoint matches the bundled **9 models**, including exact `gpt-6.1-sol` / `GPT-6.1 Sol`. This is metadata evidence, not inference. |
| Catalog/cache and session behavior | **Passed in the complete suite:** 200/304, ETag, timeout/size bounds, corrupt/malformed input, atomic-write failure, replacement and valid empty lists, single-flight, cancellation/dispose, cache isolation, legacy model payloads without grant writes, stale credential reads and delayed commit races. |
| Native credential privacy and concurrency | **Passed with fictional credentials:** concurrent stores rotate once and reload after logout. POSIX retains the `0600` assertion; Windows verifies the file DACL inherited from a private synthetic fixture directory. No real profile ACL, credential file or machine TEMP ACL is changed or audited by this test. |
| Model-specific provider rejection | **Passed:** HTTP 400/401/403/404 with `model_not_found` remains `MODEL_UNAVAILABLE`, retains the grant and exact selection, and never substitutes another model. |
| Package artifact | **Post-build check:** pack `0.1.5-pi-catalog.1`, retain the exact tarball/digest and prior `0.1.4` rollback artifact in the deployment receipt. |
| Windows desktop profile installation | **Pending at build time:** use the global Windows bundled CLI and real `~/.dsh/profiles/desktop` profile, initially at `0.1.4`. No ASAR/core or Pi/WSL patch. |
| Host and visible UI | **Pending at build time:** restartHost, then refresh the existing `http://127.0.0.1:19387` UI. Verify actual loaded metadata, exact human names/IDs and native selector. Do not replace the server or infer HMR. |
| Real account access through Pi | **User-confirmed externally:** Pro 5x account. This confirms the user's Pi result, not this plugin's direct Responses request. |
| Live inference through this plugin | **Pending at build time:** require a real terminal `response.completed` for exact model `gpt-6.1-sol`; mocks, discovery and installation cannot establish this. |

Record each deployment result only when its own evidence is available. Keep public diagnostics token-free; do not store grants, account identifiers or raw authenticated headers in the repository. Installation and rollback steps are in the [plugin guide](<../README.md>).

## Historical baseline: 0.1.2 / 38 tests

The following evidence is retained as historical validation of the pre-Pi-catalog implementation. Its `/v1/models` discovery behavior and model availability statements do not describe the experimental release above.

Target: installed macOS DeepSeek Harness 0.2.0-rc.2 and its published npm contracts, Node 24. Source inspection used the public `dsh-v0.2.0-rc.2` tag; the installed app reports a different build commit, so installed-runtime checks accompany source compatibility.

The 38 automated tests cover real RSA/JWKS signatures, OIDC issuer/audience/expiry/nonce, callbacks, PKCE, cancellation, issued-client reuse, missing consent, rotating refresh, concurrent managers, disconnect races, profile isolation, model order/visibility/capabilities, tools, multimodal projection, persisted reasoning, account/model replay isolation, and incomplete/contradictory streams.

Native integration tests exercise actual Cordis, file credentials, authorization cancellation, compiled Host unload, generated Remote schemas and the browser module factory. Simulated SDK transport verifies effective request bodies, no SDK retries, no API-key fallback, and safe errors.

### Recorded checks (2026-10-01)

| Check | Result |
| --- | --- |
| Version 0.1.2 build and automated suite | 38 tests passed; no failures, cancellations or skipped tests. |
| Clean local Web profile | A fresh profile initialized from the shipped Web template installed the package and published its generated RPC with no account or models. The existing Web profile also loaded Host/Client and the Models footer. |
| Existing Desktop profile | Bundled CLI installation and native application loading worked. |
| Live OAuth in both environments | The user completed browser sign-in and consent independently for Web and Desktop; validated dynamic registrations activated without an API key. |
| Official model catalog | Seven entries, five visible; identifiers/order/visibility retained. GPT-6.1 Sol was absent and is not added to this provider. |
| Native tools and images, both environments | GPT-5.6 Luna read two files and PNG/JPEG/WebP/GIF through six native tools, then correctly reported COBALT, 42 and red for all images. Each conversation used two inference steps. |
| Direct Web user attachments | A general text file and blue PNG were attached through the native picker. The model read the native file reference and image and correctly reported ORBITAL, 31 and blue. |
| History after full Host restarts | Desktop and Web recovered earlier values and image colors without reopening files or executing tools. |
| Real concurrent renewal | Two managers obtained the same replacement after one actual rotation. Access and refresh tokens changed together, registration remained, and subsequent Web inference succeeded. |
| Web disconnect and Desktop isolation | Web removed tokens and retained registration metadata with file mode 0600. Desktop remained connected and answered READY after Web disconnect. |
| Native attachment decoding | Installed attachment services normalized and decoded PNG/JPEG/WebP/GIF; general file bytes persisted and read correctly. |
| Windows | The package has no macOS-only runtime dependency. Windows installation, callback, native permission behavior and inference remain untested. |

The initial development OAuth request exposed a missing `urn:uuid:` prefix. The implementation now persists the documented UUIDv4 URN and preserves existing UUID identity. Live consent and inference passed after this correction.

Live streaming exposed a thin final aggregate: completed function calls were followed by `response.completed` with `output: []`. The translator validates the closed item ledger in this case and rejects open, contradictory or reused items. Only the terminal completion authorizes successful tool-call generation.

An unchanged tarball version at the same local path can be reused from pnpm's cache. Package checks use incremented versions and digest-specific staging. The Web test store is passed through the launcher's native pnpm argument forwarding; no global package-manager configuration is changed.

Protocol tests simulate normalized bytes and do not establish decoding quality. Installed-runtime attachment and live UI checks provide separate evidence. Test profiles, synthetic fixtures and diagnostic evidence stay outside the delivered package; credentials, account identifiers and authorization callbacks are never bundled.

Run from the source workspace root:

```sh
npm ci
npm run check
npm run pack:plugin
```

Callback tests bind localhost and require a normal terminal or sandbox permission. Automated tests use fictional credentials. Live checks used independently authorized ChatGPT plan grants and synthetic files. They establish observed access on the tested account, not universal model eligibility.
