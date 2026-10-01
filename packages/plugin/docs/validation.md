# Validation

Target: installed macOS DeepSeek Harness 0.2.0-rc.2 and its published npm contracts, Node 24. Source inspection used the public `dsh-v0.2.0-rc.2` tag; the installed app reports a different build commit, so installed-runtime checks accompany source compatibility.

The 38 automated tests cover real RSA/JWKS signatures, OIDC issuer/audience/expiry/nonce, callbacks, PKCE, cancellation, issued-client reuse, missing consent, rotating refresh, concurrent managers, disconnect races, profile isolation, model order/visibility/capabilities, tools, multimodal projection, persisted reasoning, account/model replay isolation, and incomplete/contradictory streams.

Native integration tests exercise actual Cordis, file credentials, authorization cancellation, compiled Host unload, generated Remote schemas and the browser module factory. Simulated SDK transport verifies effective request bodies, no SDK retries, no API-key fallback, and safe errors.

## Recorded checks (2026-10-01)

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
