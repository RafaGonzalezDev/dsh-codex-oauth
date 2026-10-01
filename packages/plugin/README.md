# dsh-chatgpt-plan

Connect a ChatGPT account to DeepSeek Harness through OpenAI's **Sign in with ChatGPT** plan-sharing preview. Inference uses the official Responses API and the granted ChatGPT plan usage permission. This provider has no API-key configuration or alternative API-billing fallback.

Supported target: DeepSeek Harness **0.2.0-rc.2**, Node **24**, macOS Desktop and a local Web host. The package is independent of DeepSeek and OpenAI. License: MIT.

Windows portability is expected: the plugin has no macOS-only runtime dependency, uses native Harness credential/attachment services and binds OAuth callbacks to `127.0.0.1`. The same npm tarball is intended for Windows, but Windows installation, browser callback and Desktop smoke tests have not been performed. Initial acceptance remains macOS Desktop and local Web.

## Installation

Use the CLI bundled with the installed application when managing Desktop:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add /absolute/path/dsh-chatgpt-plan-0.1.3.tgz
```

For a local Web profile, select that profile explicitly:

```sh
dsh plugin --profile web add /absolute/path/dsh-chatgpt-plan-0.1.3.tgz
```

For a new custom Web profile, initialize it from the shipped Web template before adding the plugin:

```sh
dsh --profile my-web --from-default-profile web --dump-config
dsh plugin --profile my-web add /absolute/path/dsh-chatgpt-plan-0.1.3.tgz
dsh --profile my-web --no-open --port 41873
```

Adding a package to a previously unknown custom profile creates a base profile without the Web application bundle. Such a profile does not start a Web server. `--from-default-profile` initializes a new profile; it does not repair an existing profile's bundle list.

Restart the relevant Harness host and reload its UI after installation. The generated Remote registry is discovered at startup. Installation does not modify the application's executable or shipped packages.

Open **Settings → Models → ChatGPT Plan**, choose **Continue with ChatGPT**, complete browser sign-in and authorize ChatGPT plan usage. The panel loads the official account catalog. Choose the model under the native **ChatGPT Plan** provider in the conversation model selector. The plugin never substitutes a different model automatically.

Only the visible entries returned by the official `/v1/models` account catalog are offered. An omitted GPT-6.1 Sol is explained in the panel and is not added through an access probe or an external catalog. Refreshing models performs no inference request.

Use **Cancel** to withdraw browser authorization, **Refresh models** to reload the catalog, and **Disconnect** to revoke the remote grant and erase local tokens. To change accounts, disconnect and choose **Change account**, which starts a new dynamic registration. A failed remote revocation is shown explicitly; local sign-out still removes all tokens.

The Web browser and Harness host must run on the same machine because the OAuth callback listens on `127.0.0.1`. A remotely hosted Web deployment is outside the initial supported scope.

## Sidebar connection notice

A connected account adds **ChatGPT plan connected** and **View usage** above the existing DeepSeek account launcher. The link opens [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage) in a new tab. The collapsed sidebar uses a compact **GPT** link with an accessible label.

The notice shares the Models panel's connection state. It is hidden while disconnected or loading; a session requiring renewed authorization instead shows **ChatGPT reconnection required** and **Reconnect in Models**. It does not indicate that the currently selected model uses ChatGPT, display estimated remaining quota, or query internal usage endpoints. The detailed usage notice remains in Models.

## Scope and validation

The adapter preserves native text, exposed reasoning summaries, local tool declarations/results, tool call identities, normalized images, general file references, and persisted reasoning replay. The Harness owns tool execution and permissions.

The plan-sharing preview restricts request parameters and OpenAI-hosted tools. Read [restrictions and model capabilities](docs/models.md) before relying on auxiliary generation hints or hosted API tools.

See [architecture](docs/architecture.md), [diagnostics](docs/troubleshooting.md), and [validation evidence](docs/validation.md). Automated protocol tests and successful package loading are separate from live account authorization and inference.
