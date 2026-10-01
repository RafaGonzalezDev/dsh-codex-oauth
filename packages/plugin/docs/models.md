# Models and restrictions

`GET https://api.openai.com/v1/models` uses the account access token. Only entries with `visibility: "list"` are displayed, preserving returned order, IDs and names. Entries lacking verified text input capabilities remain visible with an explanation but are not advertised to the native conversation selector.

The catalog's capability metadata takes precedence. The following baseline was reviewed on **2026-10-01** and applies to exact identifiers returned by the account. Capability metadata alone does not grant access or add an omitted model:

| Identifier | Verified input | Context | Reasoning efforts | Default when documented |
| --- | --- | --- | --- | --- |
| `gpt-6.1-sol` | text, image | 1,050,000 | low, medium, high, xhigh, max | medium |
| `gpt-6-sol` | text, image | 1,050,000 | none, low, medium, high, xhigh, max | medium |
| `gpt-6-astra` | text, image | 1,050,000 | low, medium, high, xhigh, max | unspecified |
| `gpt-6-luna` | text, image | 1,050,000 | none, low, medium, high, xhigh, max | medium |

Sources: [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna). Availability and metadata can change. An unavailable GPT-6.1 Sol is explained without selecting another model.

## Catalog policy

This version uses only the official account catalog. Omitted identifiers are never appended, even if a separate diagnostic request has succeeded. No Pi catalog, imported credentials, access-check feature or API-key fallback is used. Refreshing the catalog performs no inference. Cached supplemental entries from earlier development builds are excluded on upgrade.

## Native parity

- Local function tools preserve schema, arguments, native name and call/result IDs. Parallel calls remain distinct. The Harness executes tools and checks permissions.
- PNG, JPEG, WebP and GIF use the native attachment store's normalized request version. Images from tools use the Responses tool-result content array. Offloaded images retain native placeholder/readonly-path text.
- General files, including audio and video, use native file-reference projection and configured local tools. The plugin does not upload them to OpenAI Files or invent direct audio/video model inputs.
- Reasoning summaries are exposed when returned. Encrypted reasoning is retained for provider replay, without claiming access to hidden chain of thought.
- Complete retained conversation history is sent on each request. A stream that fails or ends before `response.completed` is an error, including after complete-looking tool arguments.

## Preview restrictions

The current plan-sharing route requires `store: false` and `stream: true`. It supports the documented function/custom tools within a namespace. The plugin declares the Harness's local function tools in its `harness` namespace.

Unsupported preview parameters such as `max_output_tokens`, `temperature`, stop sequences, server-side previous response IDs, service-tier overrides and hosted tool search are not sent. Native auxiliary callers can supply output/temperature hints; this route cannot enforce them. The advertised model context is a verified context limit, not an advertised configurable output cap.

OpenAI-hosted web search, file search, code interpreter, image generation, hosted MCP and native Live/computer execution are outside this preview route. Equivalent configured Harness tools can still run locally under normal permissions. No unsupported hosted capability is advertised or silently replaced.

Only the documented signed ChatGPT grant is used. API-key billing is never selected automatically. Account/app usage limits and eligibility restrictions are surfaced explicitly, with a link to ChatGPT usage settings. No reset time is inferred.

Sources: [model discovery and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
