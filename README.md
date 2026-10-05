# dsh-chatgpt-plan

A native **DeepSeek Harness** plugin that connects a ChatGPT plan account through OpenAI's *Sign in with ChatGPT* plan-sharing preview. Inference uses the official Responses API directly; Harness keeps ownership of tools and permissions.

| | |
| --- | --- |
| Package | `dsh-chatgpt-plan` (this source repository is `dsh-codex-oauth`) |
| Version | `0.1.9-sidebar-height.1` — experimental |
| Harness compatibility | `>=0.2.0-rc.2 <0.3.0-0` |
| License | MIT |

![The Models panel and the native composer selector listing the Pi catalog under ChatGPT Plan, newest first, with the sidebar connection notice](<docs/assets/native-model-selector.png>)

## Disclaimer

- **Usage limits are enforced by OpenAI, not by this plugin.** ChatGPT plan usage through third-party applications is governed by the *Sign in with ChatGPT* preview and by limits that OpenAI sets and can change.
- **The permitted usage you configure in ChatGPT does not remove app-specific limits.** Even with usage set to 100% for this application, OpenAI can apply limits that are specific to third-party applications or to a short rolling window. A turn can therefore fail with a quota error while ChatGPT still reports remaining weekly capacity.
- **The plugin never changes the billing path.** Quota and rate-limit failures are surfaced as they arrive: no API-key fallback, no model substitution and no inferred reset time. See [known issues](#known-issues) for a reported instance of this behavior.
- **This is experimental software built on a preview feature.** Model metadata, limits and availability can change, degrade or stop working without notice, and no compatibility or availability guarantee is provided.

## Known issues

- **An app-specific limit can remain at its original value after the weekly usage resets (external, open).** A connection created through the *Sign in with ChatGPT* preview can keep failing with `subscription_sharing_usage_limit_exceeded` (429, "ChatGPT usage limit for this app") while ChatGPT reports that weekly capacity has reset. It was reported to OpenAI and acknowledged as specific to the *Sign in with ChatGPT* route, and it does not affect Codex usage. This plugin classifies the code as `QUOTA` and never infers a reset time; it never changes the billing path either, so the limit cannot be cleared from inside the plugin. See [diagnostics](<packages/plugin/docs/troubleshooting.md>) for the entry.

## How it works

- **Sign-in.** OAuth 2.0 with PKCE through the browser, using the ChatGPT plan-sharing preview and a loopback callback on `127.0.0.1`.
- **Credentials.** Tokens live in Harness's native managed credential store, which also handles refresh, rotation and revocation. The Client surfaces are token-free.
- **Inference.** Requests go directly to `https://api.openai.com/v1/responses` with the granted plan permission. There is no API-key configuration, no Codex transport and no intermediary server.
- **Model catalog.** Pi's `openai-codex` chat catalog is the only model metadata source. A profile-local cache and a bundled snapshot keep the last valid list available offline.
- **Model identity.** Exact Pi names and IDs are preserved and listed newest first. The plugin renames, aliases and substitutes nothing; the selected ID is what is sent to OpenAI.
- **Tools and attachments.** Native history, local tool declarations and results, images and file references are projected into the request. Harness executes tools and checks permissions.

## Requirements

- Node.js 24 (`nvm use`).
- DeepSeek Harness `0.2.0-rc.2` or a later `0.2` release; development is pinned to the tested `0.2.0-rc.2` baseline.
- A ChatGPT account eligible for the plan-sharing preview.
- Browser and Harness host on the same machine, because the OAuth callback listens on `127.0.0.1`.

## Install

Build the package and install **the same tarball** in the target profile through Harness's native plugin manager. Keep the previous working tarball for rollback.

```sh
nvm use
npm ci
npm run check
npm run pack:plugin
```

The commands above emit `dsh-chatgpt-plan-<version>.tgz` in the repository root.

**Windows Desktop**

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "C:\path\to\dsh-chatgpt-plan-0.1.9-sidebar-height.1.tgz"
```

**macOS Desktop and local Web**

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add /absolute/path/dsh-chatgpt-plan-0.1.9-sidebar-height.1.tgz
dsh plugin --profile web add /absolute/path/dsh-chatgpt-plan-0.1.9-sidebar-height.1.tgz
```

After installing, run the application's **restartHost** action and reload the existing UI. Source edits alone never change an installed profile. For a new custom Web profile, initialize it from the shipped Web template first; see the [plugin guide](<packages/plugin/README.md>). For an agent-driven or unattended install, follow the [agent installation runbook](<docs/agent-install.md>).

## Usage

1. Open **Settings → Models → ChatGPT Plan** and choose **Continue with ChatGPT**.
2. Complete the browser sign-in and authorize ChatGPT plan usage. The first connection shows a one-time confirmation that eligible requests use your plan.
3. Select a model under the native **ChatGPT Plan** provider in the conversation model selector.
4. Use **Update models now** to refresh metadata without an inference request, and **View usage** in the sidebar to open ChatGPT's usage settings.

While a session is connected, the sidebar and the Models header state **Using ChatGPT plan**; the sign-in invitation is shown only when the profile is not connected.

Disconnecting revokes the remote grant and erases local tokens. To switch accounts, disconnect and choose **Change account**.

## Model catalog

- Every plugin activation loads a valid profile cache or the bundled snapshot, then checks Pi in the background. Startup never waits for the network.
- Each check is bounded to **4 seconds**, **2 MiB** and **1,000 records**. Remote JSON is untrusted input and is validated before publication.
- A valid response replaces the entire list, including a valid empty list. Errors retain the last valid list or the bundled snapshot and raise a catalog warning that is separate from authentication state.
- The cache is stored per profile at `.cache/dsh-chatgpt-plan/pi-catalog-v1.json`, independently of OAuth grants.
- `available` and `preferredModelAvailable` mean **locally selectable**, not verified account entitlement. OpenAI enforces access on the actual inference request.
- Discovery never calls the OAuth `/v1/models` endpoint, and no model is added, aliased or substituted manually. See [models and restrictions](<packages/plugin/docs/models.md>).

## Project layout

| Path | Contents |
| --- | --- |
| [packages/plugin](<packages/plugin/>) | Plugin source, package documentation and third-party notices. |
| [packages/plugin/src](<packages/plugin/src/>) | Host account management, Pi catalog and cache, Responses adapter, RPC service and Client UI. |
| [packages/plugin/docs](<packages/plugin/docs/>) | Architecture, model restrictions, diagnostics and validation evidence. |
| [scripts](<scripts/>) | Maintainer catalog snapshot generator and Typert preparation. |
| [test](<test/>) | Protocol, native-service integration and React tree tests using fictional credentials. |
| [docs](<docs/>) | Development guide and architecture decision records. |

## Development

```sh
nvm use
npm ci
npm run check          # build Host, generated RPC and Client, then run the automated suite
npm run typecheck      # static types
npm run pack:plugin    # emit the installable tarball in the repository root
```

`npm run check` builds before testing. OAuth callback tests bind localhost and need a terminal that permits local listeners; they neither authenticate a real account nor perform live inference.

Maintainers regenerate the bundled catalog snapshot from the same Pi service with `npm run catalog:snapshot`. Review the metadata diff and rerun the checks before packaging. See the [development guide](<docs/development.md>).

## Compatibility and validation

Runtime peer dependencies and the informational `engines.dsh` field declare `>=0.2.0-rc.2 <0.3.0-0`. The `-0` upper bound deliberately excludes every `0.3.0` prerelease. A permissive admission result is not an API compatibility guarantee; validate each new Harness release before relying on it.

This release, `0.1.9-sidebar-height.1`, changes only the sidebar presentation: one visible status line, a fixed expanded height matching the native account launcher, ellipsis and the embedded ChatGPT mark. Host behavior, credentials, transport, catalog and inference are unchanged. The automated suite and static types pass on Node 24 (**154/154**, plus **11/11** in the focused sidebar suite). Installation into the real `desktop` profile through the bundled CLI succeeded, and the installed Client bundle matches the repository build.

**Windows Desktop is the only platform executed for this release; macOS Desktop and Linux/Web have not been executed.** The package is platform-neutral — prebuilt JavaScript, pure-JavaScript dependencies, no `os`/`cpu` restriction and no native module — but that is a static property, not a runtime result. Live browser rendering, theme contrast, pointer hit testing and keyboard focus in the installed GUI remain pending in the local deployment receipt.

The catalog, native-selector and live `gpt-6.1-sol` evidence belongs to the `0.1.5-pi-catalog` series and was not re-executed for this presentation release. Automated fixtures, catalog HTTP checks, installation and live inference are recorded separately in the [validation evidence](<packages/plugin/docs/validation.md>).

## Documentation

| Document | Contents |
| --- | --- |
| [Plugin guide](<packages/plugin/README.md>) | Installation per platform, rollback and connection behavior. |
| [Architecture](<packages/plugin/docs/architecture.md>) | Components, request boundaries, catalog lifecycle and credential races. |
| [Models and restrictions](<packages/plugin/docs/models.md>) | Catalog semantics, capabilities and preview restrictions. |
| [Diagnostics](<packages/plugin/docs/troubleshooting.md>) | Symptom-to-action tables for catalog, installation and authorization. |
| [Validation](<packages/plugin/docs/validation.md>) | Version-scoped build, test and platform evidence. |
| [Development guide](<docs/development.md>) | Repository layout, release procedure and compatibility policy. |
| [Agent installation](<docs/agent-install.md>) | Runbook for installing, configuring, verifying and rolling back the plugin from a terminal or desktop agent. |
| [ADR-0001](<docs/adr/ADR-0001-use-pi-model-catalog.md>) | Decision to use the Pi catalog as the single metadata source. |

## License

MIT. Bundled third-party notices, including the Pi model metadata attribution, are reproduced in [THIRD_PARTY_NOTICES.md](<packages/plugin/THIRD_PARTY_NOTICES.md>).
