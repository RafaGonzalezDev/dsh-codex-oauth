# Diagnostics

Start with the profile name, installed Harness/plugin versions, public status/error code and request ID. For catalog issues, also record the source, loaded-from state, revision, last check/update times and visible catalog warning. Never include the native credentials file, access/refresh/ID tokens, authorization codes or unredacted HTTP headers in a report.

## Catalog and model selection

| Symptom | Action |
| --- | --- |
| Bundled snapshot or cached catalog is shown | This is a valid startup/offline state, not an OAuth error. Each activation checks Pi in the background; use **Update models now** to retry immediately. |
| Catalog update warning, timeout or invalid response | Keep using the displayed last valid list. Check connectivity to [Pi's catalog service](<https://pi.dev/api/models/providers/openai-codex?types=chat>) and retry. Requests are bounded to 4 seconds, 2 MiB and 1,000 records; invalid responses are not partially applied. Reconnecting OAuth does not repair Pi connectivity. |
| Last checked changed but revision/last updated did not | The check may have confirmed unchanged metadata using the ETag. Inspect the warning and loaded-from label before concluding that fresh JSON was applied. |
| Catalog has no selectable models | A valid empty list replaces the previous catalog; unsupported entries may also be non-selectable. Use **Update models now** and review the current source. Do not manually append IDs or infer access from a previous list. |
| Missing GPT-6.1 Sol | Update the Pi catalog. If `gpt-6.1-sol` remains absent or non-selectable, it is not offered by this provider. No substitute is selected automatically and OAuth `/v1/models` is not a discovery fallback. |
| Human label differs from the request ID | This is intentional: **GPT-6.1 Sol** is the human `name`; **`gpt-6.1-sol`** is the exact request `id`. Labels do not rewrite IDs. |
| Model is listed but inference is rejected | Listing is local selectability, not entitlement. Inspect the actual provider error, selected account/workspace, eligibility and app limits. Do not switch to an API key or Codex transport as a fallback. |
| Context differs from an older reviewed limit | Pi metadata wins. For example, a Pi context of 272,000 is not enlarged to an older reviewed 1,050,000. Check the active revision rather than editing the list. |
| Catalog source details unavailable | Older Host status may omit optional catalog metadata. Restart the updated Host and refresh its UI; do not treat the missing badge as a new authorization failure. |
| Suspected cache corruption | The Host validates the profile-local `.cache/dsh-chatgpt-plan/pi-catalog-v1.json` and falls back to the bundled snapshot if needed. Retry an update and report the safe warning. Do not edit the JSON by hand or delete native OAuth credentials. |

## Host, installation and authorization

| Symptom/code | Action |
| --- | --- |
| Panel absent | Confirm the bundle is enabled in this profile. Restart the Host and reload the UI so the generated Remote contribution is discovered. |
| Windows experimental package still shows old UI | Install the tested `0.1.5-pi-catalog.1` tarball through the global Windows bundled CLI into `desktop`, use **restartHost**, then refresh the existing `http://127.0.0.1:19387` UI. Do not start another server or patch ASAR/core files. See the [installation guide](<../README.md>). |
| Custom profile stays idle without a Web URL | Initialize a new profile with `dsh --profile my-web --from-default-profile web --dump-config` before installing the plugin. A profile first created by `plugin add` contains the base bundle but lacks `@deepseek-ai/dsh-web-app`. The template option applies only to new profiles. |
| Rebuilt development tarball still loads old code | The profile package manager may cache an unchanged version at the same local path. Use a distinct experimental version and retain the exact tested artifact/digest; then restart the Host and reload the UI. |
| Rollback needed | Reinstall the retained known-good `0.1.4` tarball through the same CLI/profile, restartHost and refresh the same URL. Preserve OAuth credentials; do not copy or patch core packages. |
| Managed profile reports missing native peer dependencies | The bundled launcher supplies protected Harness, Cordis and React peers from its managed runtime. Confirm actual Host/Client loading; do not add duplicate native frameworks to the profile solely to suppress static package-manager warnings. |
| Browser did not open | Use **Open sign-in page** in the panel. Popup blockers may prevent automatic opening. |
| Callback fails | Keep browser and Host on the same machine. The callback is an ephemeral `127.0.0.1` port with `/auth/callback`; remote Web hosts are unsupported. Cancel and restart an expired flow. |
| `INSUFFICIENT_SCOPE` | Reconnect and grant ChatGPT plan usage. The issued registration is retained; the next flow requests consent again. |
| `AUTH` / terminal refresh rejection | Reconnect the selected account. Unusable tokens are removed; the issued client registration is retained. |
| `ACCOUNT_MISMATCH` | Disconnect and select **Change account**, which starts a fresh registration. |
| `ACCOUNT_CHANGED` | Start a new request after switching accounts. A prepared request never adopts another account's credentials. |
| Unknown input capabilities | The Pi entry lacks usable native capability metadata. Update the catalog and report the safe model ID/revision. Do not invent capabilities or change transport configuration. |
| `INELIGIBLE` | Check selected account/workspace, eligibility, policy and serving region. Repeated OAuth does not fix a policy restriction. |
| `QUOTA` | Review [ChatGPT Settings → Usage](<https://chatgpt.com/settings/usage>), including this app's limit and enabled credits. The plugin does not infer a reset time or switch billing. |
| `RATE_LIMIT`, `SERVER`, `TIMEOUT`, `TRANSPORT` | Native Harness retry policy may retry transient failures with bounded backoff. Credentials remain intact. SDK retries are disabled. |
| `UNSUPPORTED_REQUEST` | Inspect the safe OpenAI code and request ID; check documented preview restrictions. Repeating the same unsupported request is not recovery. |
| `INCOMPLETE_RESPONSE` / `INVALID_STREAM` | Retry the request. Only `response.completed` succeeds; partial tool calls are not a successful generation. |
| Remote revocation unconfirmed | Tokens were removed locally. Also disconnect the application in ChatGPT settings if necessary. |
| `INVALID_CREDENTIAL` | Restore a valid native credential store through Harness's normal recovery process. The plugin refuses malformed records. |

For authentication/session behavior, see [official sign-in](<https://developers.openai.com/siwc/token-sharing-open-source/sign-in>) and [accounts and sessions](<https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions>). Keep catalog HTTP checks, automated fixture results and live plugin inference separate in [validation evidence](<validation.md>).
