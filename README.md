# dsh-codex-oauth

Standalone source repository for **dsh-chatgpt-plan**, a native DeepSeek Harness plugin that connects ChatGPT plan usage through Sign in with ChatGPT. The installable package retains its existing name and version (`dsh-chatgpt-plan`, `0.1.2`).

The Host owns OAuth, credentials and the official account model catalog. The Responses adapter maps the native LLM contract; Harness owns tool execution and permissions. The Client provides the Models settings panel through generated, token-free RPC. See the [architecture](packages/plugin/docs/architecture.md).

## Development

Requires Node 24 and npm. Harness compatibility is pinned to `0.2.0-rc.2`.

```sh
nvm use
npm ci
npm run check
npm run pack:plugin
```

The installable tarball is emitted in the repository root. Read the [development guide](docs/development.md) and [plugin installation guide](packages/plugin/README.md).

## Current scope

The provider uses only visible entries returned by the official account `/v1/models` catalog. It does not import the Pi catalog or append supplemental models. macOS Desktop and local Web were validated; Windows remains untested.

See [model restrictions](packages/plugin/docs/models.md), [diagnostics](packages/plugin/docs/troubleshooting.md), and [validation evidence](packages/plugin/docs/validation.md).

Dependencies, generated code, build caches, distributable tarballs and credentials are excluded from Git. This repository was prepared from the clean `0.1.2` source delivery; it has no initial commit or configured remote.

License: MIT.
