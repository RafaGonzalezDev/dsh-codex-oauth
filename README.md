# dsh-codex-oauth

Standalone source repository for **dsh-chatgpt-plan**, a native DeepSeek Harness plugin that connects ChatGPT plan usage through Sign in with ChatGPT. The installable package is `dsh-chatgpt-plan`; its version is declared in [the package manifest](<packages/plugin/package.json>).

The Host owns OAuth and native credentials. **Pi is the single model metadata source**, independently of the account grant. The Responses adapter still sends inference directly to `https://api.openai.com/v1/responses`; Harness owns tool execution and permissions. The Client provides token-free Models settings and catalog status through native RPC. See the [architecture](<packages/plugin/docs/architecture.md>).

## Experimental Pi catalog branch

This change is developed as **`0.1.5-pi-catalog.2`** on `feature/pi-model-catalog` in the `dsh-codex-oauth` checkout. `main` remains unchanged, and only that branch is pushed. It does not patch the installed DSH ASAR, core or a Pi/WSL installation.

The catalog comes from [Pi's openai-codex chat catalog](<https://pi.dev/api/models/providers/openai-codex?types=chat>). A background check runs on each plugin activation, with a 4-second deadline, a 2 MiB response limit and at most 1,000 records. A profile-local ETag/JSON cache and a bundled snapshot generated from the same service keep the last valid metadata available offline. A valid update replaces the whole list, including an empty list. Discovery never calls OpenAI `/v1/models` with OAuth.

Catalog presence means local selectability, **not verified account entitlement**. Names such as **GPT-6.1 Sol** are displayed as supplied by Pi, while requests retain the exact ID `gpt-6.1-sol`. There is no model substitution, Pi inference transport, API-key fallback or imported price configuration. Read the [catalog decision](<docs/adr/ADR-0001-use-pi-model-catalog.md>) and [model restrictions](<packages/plugin/docs/models.md>).

## Development

Requires Node 24 and npm. Declared Harness runtime compatibility is `>=0.2.0-rc.2 <0.3.0-0`; the tested development baseline remains pinned to `0.2.0-rc.2`. Future releases within that range still require API and UI validation.

```sh
nvm use
npm ci
npm run check
npm run pack:plugin
```

The installable tarball is emitted in the repository root. Build, test and install **the same tarball** through the target profile's plugin manager. Read the [development guide](<docs/development.md>) and [plugin installation guide](<packages/plugin/README.md>).

## Validation status

The recorded macOS Desktop/local Web results for **0.1.2 / 38 tests are historical**, not certification of the Pi catalog branch. On **Windows Desktop** the experimental release is validated end to end: installation by the bundled CLI, native loading, the remote/cache catalog, the panel and native selector, and a real `gpt-6.1-sol` request that returned HTTP 200 with a terminal `response.completed`. **macOS Desktop and Linux/Web have not been executed for this release**; the package is platform-neutral, but that is a static property, not a runtime result. Automated fixtures, catalog HTTP checks, installation and live inference are recorded separately in [validation evidence](<packages/plugin/docs/validation.md>) and the [deployment receipt](<docs/development.md>).

The Windows `desktop` profile currently runs the experimental `0.1.5-pi-catalog.2` package, installed by the bundled CLI. Install the experimental artifact only after the complete checks; retain the previous tarball for rollback. A new package requires `restartHost` and a refresh of the **existing** UI at `http://127.0.0.1:19387`, not another server or a promise of HMR. See [diagnostics](<packages/plugin/docs/troubleshooting.md>).

Dependencies, generated code, build caches, distributable tarballs and credentials are excluded from Git. This repository originated from the clean `0.1.2` source delivery; subsequent changes are tracked in its commit history.

License: MIT.
