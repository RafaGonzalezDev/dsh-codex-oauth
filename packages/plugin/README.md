# dsh-chatgpt-plan

Connect a ChatGPT account to DeepSeek Harness through OpenAI's **Sign in with ChatGPT** plan-sharing preview. Inference uses the official Responses API directly at `api.openai.com` and the granted ChatGPT plan usage permission. This provider has no API-key configuration or alternative API-billing fallback.

**Experimental version: `0.1.5-pi-catalog.2`.** Pi supplies model metadata only; it does not handle OAuth, credentials, inference or billing. See [models and restrictions](<docs/models.md>).

Declared Harness compatibility: **`>=0.2.0-rc.2 <0.3.0-0`**. Historical tested baseline: **0.2.0-rc.2**, Node **24**, macOS Desktop and a local Web host with plugin **0.1.2**. This does not validate the experimental catalog release. The package is independent of DeepSeek, OpenAI and Pi. License: MIT.

All DSH runtime peer dependencies and the informational `engines.dsh` field use this bounded range. DSH includes prereleases when checking peers, so the `-0` upper bound deliberately excludes every `0.3.0` prerelease as well as the stable release. Development dependencies remain pinned to `0.2.0-rc.2` for reproducible builds. This range permits loading later `0.2` releases; it does not certify untested API or UI compatibility. Validate each new Harness release before relying on it, especially release candidates. No version exemptions are required or installed.

## Usage limits and preview status

ChatGPT plan usage is governed by OpenAI, not by this plugin. Even when the permitted usage for this application is configured at 100% in ChatGPT settings, OpenAI can apply limits that are specific to third-party applications or to a short rolling window, so a request can fail with a quota error while ChatGPT still reports remaining weekly capacity. The plugin reports those failures without switching billing paths, substituting models or inferring a reset time. The plan-sharing preview and this experimental plugin can change, degrade or stop working without notice.

**Known issue, external and open.** An app-specific limit can remain at its original value after the weekly usage resets: the connection keeps failing with `subscription_sharing_usage_limit_exceeded` (429) while ChatGPT reports that capacity has reset. It was reported to OpenAI and acknowledged as specific to the Sign in with ChatGPT route, and it does not affect Codex usage. This plugin surfaces the failure as `QUOTA` and never changes the billing path, so the limit cannot be cleared from inside the plugin; see [diagnostics](<docs/troubleshooting.md>).

## Installation

Build and test the experimental package first, and install the **same tarball** on the target platform. Keep the previous working tarball for rollback. Source edits alone do not change an installed profile.

### Windows Desktop

Use the global CLI bundled with the installed Windows application, not a checkout launcher:

```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "C:\path\to\dsh-chatgpt-plan-0.1.5-pi-catalog.2.tgz"
```

The experimental rollout starts from `0.1.4` in the real `~/.dsh/profiles/desktop` profile. After installation, use the application's **restartHost** action and refresh the existing UI at `http://127.0.0.1:19387`. Do not start a replacement server. The generated Remote registry is discovered at startup; package changes are not guaranteed to hot-reload. This procedure does not modify ASAR/core files or a Pi/WSL installation.

**Validated platform coverage for `0.1.5-pi-catalog.2` is Windows Desktop only.** Installation through the bundled CLI, native loading, the remote and cache catalog path, the selection order and a live `gpt-6.1-sol` request are recorded in the [validation evidence](<docs/validation.md>) and the deployment receipt.

**macOS Desktop and Linux/Web have not been executed for this release.** The `0.1.2` baseline was validated on macOS, and the package is platform-neutral — prebuilt JavaScript, pure-JavaScript dependencies, no `os`/`cpu` restriction, no native module and no platform-specific branch — but that is a static property, not a runtime result. Validate installation, sign-in, the catalog and inference on the target platform before relying on them. Rollback is the retained `0.1.4` tarball.

### macOS Desktop and local Web

Use the CLI bundled with the installed application when managing macOS Desktop:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add /absolute/path/dsh-chatgpt-plan-0.1.5-pi-catalog.2.tgz
```

For a local Web profile on Linux/macOS, select that profile explicitly:

```sh
dsh plugin --profile web add /absolute/path/dsh-chatgpt-plan-0.1.5-pi-catalog.2.tgz
```

For a **new, separate** custom Web profile, initialize it from the shipped Web template before adding the plugin:

```sh
dsh --profile my-web --from-default-profile web --dump-config
dsh plugin --profile my-web add /absolute/path/dsh-chatgpt-plan-0.1.5-pi-catalog.2.tgz
dsh --profile my-web --no-open --port 41873
```

These new-profile examples do not replace an existing Desktop host. Adding a package to a previously unknown custom profile creates a base profile without the Web application bundle. Such a profile does not start a Web server. `--from-default-profile` initializes a new profile; it does not repair an existing profile's bundle list.

Restart the relevant Harness host and reload its UI after installation. Installation uses the native plugin manager and does not modify the application's executable or shipped packages.

### Rollback

Reinstall the retained `0.1.4` tarball through the same bundled CLI and `desktop` profile, then use **restartHost** and refresh the same UI. Keep both tested artifacts and their digests. Do not delete the native credential store, patch core packages or copy dependencies between profiles as a rollback method. The Pi cache is separate from OAuth credentials.

## Models and connection

Open **Settings → Models → ChatGPT Plan**, choose **Continue with ChatGPT**, complete browser sign-in and authorize ChatGPT plan usage. Choose the model under the native **ChatGPT Plan** provider in the conversation model selector. The plugin never substitutes a different model automatically.

The model list comes only from [Pi's openai-codex chat catalog](<https://pi.dev/api/models/providers/openai-codex?types=chat>). A check starts in the background on every activation; the last valid profile cache or a bundled snapshot is immediately available. **Update models now** checks the same source without making an inference request. The panel shows the Pi source, current revision, loaded-from state, last check/update times and any fallback warning separately from account authorization. It remains usable during the bounded update.

A valid response replaces the entire catalog, even when it is empty. Errors retain the last valid list or bundled snapshot. Missing models are not added manually. The exact Pi `name` is the human label, for example **GPT-6.1 Sol**; the exact `id`, such as `gpt-6.1-sol`, is sent to OpenAI. Listed/selectable does not prove account access; OpenAI enforces access on inference. Discovery never uses OAuth `/v1/models`.

Use **Cancel sign-in** to withdraw browser authorization and **Disconnect** to revoke the remote grant and erase local tokens. To change accounts, disconnect and choose **Change account**, which starts a new dynamic registration. A failed remote revocation is shown explicitly; local sign-out still removes all tokens.

The Web browser and Harness host must run on the same machine because the OAuth callback listens on `127.0.0.1`. A remotely hosted Web deployment is outside the initial supported scope. OAuth scopes, native credential services and native model/tool interfaces are unchanged by the catalog update.

## Sidebar connection notice

A connected account adds **Using ChatGPT plan** and **View usage** above the existing DeepSeek account launcher. The link opens [ChatGPT Settings → Usage](<https://chatgpt.com/settings/usage>) in a new tab. It stretches across the whole notice, so the entire footer row is a single pointer, hover and focus target, matching the model-usage entry. It matches the native launcher geometry: a 44px row, 24px glyph, 14px label and the shared hover and radius tokens. Its own footer row comes from scoping `flex-wrap` to the slot's `display: contents` parent rather than to shell class names, so the notice wraps correctly whether or not any other footer action is installed. The collapsed sidebar replaces the copy with the same glyph in a 36×36 control that keeps an accessible label.

The notice shares the Models panel's connection state. It is hidden while disconnected or loading; a session requiring renewed authorization instead shows **ChatGPT reconnection required** and **Reconnect in Models**. It does not indicate that the currently selected model uses ChatGPT, display estimated remaining quota, or query internal usage endpoints. The detailed usage notice remains in Models. The Models header states **Using ChatGPT plan** while the session is connected and keeps the sign-in invitation otherwise.

## First sign-in confirmation

The first time a profile connects, the frame-wide overlay layer shows a blocking confirmation: eligible requests use the ChatGPT plan, with **Manage usage** and **Got it**. It appears only for an effective connection, never for a session that merely needs reconnection. Acknowledging it records the copy version in the browser, so later sign-ins and reloads do not show it again; bumping that version shows the current copy once more. When the browser storage is unavailable or blocked, the acknowledgement stays process-local and the confirmation is not lost.

This Client ships without `react-dom`, so the confirmation renders inside the overlay layer instead of a body portal, and `aria-modal` with Tab containment stands in for root-inert ownership. Escape dismisses it and focus returns to the element that opened the session.

## Scope and validation

The adapter preserves native text, exposed reasoning summaries, local tool declarations/results, tool call identities, normalized images, general file references, and persisted reasoning replay. The Harness owns tool execution and permissions.

The plan-sharing preview restricts request parameters and OpenAI-hosted tools. Read [restrictions and model capabilities](<docs/models.md>) before relying on auxiliary generation hints or hosted API tools.

See [architecture](<docs/architecture.md>), [diagnostics](<docs/troubleshooting.md>), and [validation evidence](<docs/validation.md>). Automated protocol tests and successful package loading are separate from live account authorization and inference. Independent confirmation of access through Pi is not a completed live test of this DSH plugin.
