# Diagnostics

Start with the profile name, installed Harness/plugin versions, public status/error code and request ID. Never include the native credentials file, access/refresh/ID tokens, authorization codes or unredacted HTTP headers in a report.

| Symptom/code | Action |
| --- | --- |
| Panel absent | Confirm the bundle is enabled in this profile. Restart the Host and reload the UI so the generated Remote contribution is discovered. |
| Custom profile stays idle without a Web URL | Initialize a new profile with `dsh --profile my-web --from-default-profile web --dump-config` before installing the plugin. A profile first created by `plugin add` contains the base bundle but lacks `@deepseek-ai/dsh-web-app`. The template option applies only to new profiles. |
| Rebuilt development tarball still loads old code | The profile package manager may cache an unchanged version at the same local path. Install a uniquely named/staged path, or increment the development version; then restart the Host and reload the UI. |
| Managed profile reports missing native peer dependencies | The bundled launcher supplies protected Harness, Cordis and React peers from its managed runtime. Confirm actual Host/Client loading; do not add duplicate native frameworks to the profile solely to suppress static package-manager warnings. |
| Browser did not open | Use **Open sign-in page** in the panel. Popup blockers may prevent automatic opening. |
| Callback fails | Keep browser and Host on the same machine. The callback is an ephemeral `127.0.0.1` port with `/auth/callback`; remote Web hosts are unsupported. Cancel and restart an expired flow. |
| `INSUFFICIENT_SCOPE` | Reconnect and grant ChatGPT plan usage. The issued registration is retained; the next flow requests consent again. |
| `AUTH` / terminal refresh rejection | Reconnect the selected account. Unusable tokens are removed; the issued client registration is retained. |
| `ACCOUNT_MISMATCH` | Disconnect and select **Change account**, which starts a fresh registration. |
| `ACCOUNT_CHANGED` | Start a new request after switching accounts. A prepared request never adopts another account's credentials. |
| Missing GPT-6.1 Sol | Refresh the official catalog. This version offers only its visible entries. If Sol remains omitted, it remains unavailable in this provider; no alternative model is selected automatically. |
| Unknown input capabilities | The account entry lacks metadata and has no reviewed exact-model baseline. Update the plugin after verifying official capability documentation. |
| `INELIGIBLE` | Check selected account/workspace, eligibility, policy and serving region. Repeated OAuth does not fix a policy restriction. |
| `QUOTA` | Review [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage), including this app's limit and enabled credits. The plugin does not infer a reset time or switch billing. |
| `RATE_LIMIT`, `SERVER`, `TIMEOUT`, `TRANSPORT` | Native Harness retry policy may retry transient failures with bounded backoff. Credentials remain intact. SDK retries are disabled. |
| `UNSUPPORTED_REQUEST` | Inspect the safe OpenAI code and request ID; check documented preview restrictions. Repeating the same unsupported request is not recovery. |
| `INCOMPLETE_RESPONSE` / `INVALID_STREAM` | Retry the request. Only `response.completed` succeeds; partial tool calls are not a successful generation. |
| Remote revocation unconfirmed | Tokens were removed locally. Also disconnect the application in ChatGPT settings if necessary. |
| `INVALID_CREDENTIAL` | Restore a valid native credential store through Harness's normal recovery process. The plugin refuses malformed records. |

For authentication/session behavior, see [official sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) and [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).
