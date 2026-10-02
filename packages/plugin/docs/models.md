# Models and restrictions

## Catalog source and account access

The experimental `0.1.5-pi-catalog.2` provider uses [Pi's openai-codex chat catalog](<https://pi.dev/api/models/providers/openai-codex?types=chat>) as its **only model metadata source**. It never calls OAuth `GET /v1/models` for discovery. `openai-codex` identifies the Pi catalog namespace; it does not select Codex inference transport, credentials or OAuth behavior.

The exact Pi `name` is the display label, including its original capitalization: **GPT-6.1 Sol**. The exact `id`, **`gpt-6.1-sol`**, is the technical identifier sent in requests. There are no aliases that rewrite a request, merged supplemental lists or automatic substitutions.

The Models panel and the native composer selector list the catalog **newest first**, so the most recent generation such as **GPT-6.1 Sol** appears at the top. This is a presentation projection over Pi's exact source order: the catalog, the profile cache and the bundled snapshot keep Pi's order, and the projection never renames, adds, removes, aliases or substitutes a model. Changing the remote order therefore changes the displayed order, and no model is pinned to a fixed position.

A model marked `available` and `preferredModelAvailable` in public status is **selectable in the local catalog**, not verified for the current account. Pi publishes shared metadata, not entitlement. OpenAI checks account access on a real inference request. Independent confirmation of Pi access does not establish a successful live request through this updated DSH plugin.

## Updates, cache and empty lists

- Every plugin activation loads a valid profile cache or the bundled snapshot, then checks Pi in the background. Startup and account actions do not wait for the network update.
- **Update models now** calls the catalog refresh RPC. It performs metadata network I/O only, never an inference/access probe.
- Each remote check has a **4-second** deadline, **2 MiB** JSON bound and **1,000-record** maximum. The JSON is untrusted input and must pass schema/identifier/capability validation before publication.
- The per-profile `.cache/dsh-chatgpt-plan/pi-catalog-v1.json` stores the valid JSON and ETag independently of OAuth grants. Conditional requests avoid replacing unchanged metadata unnecessarily.
- A valid response **replaces the entire list**, including a valid empty list. Removed models do not survive by merging with a previous list or snapshot.
- A failed fetch or invalid response leaves the last valid list active, falling back to the bundled snapshot when no valid cache exists. A catalog warning explains the failure without asking for unnecessary OAuth reconnection.
- The source badge, revision, loaded-from state and last check/update times describe the **active catalog**, not a fabricated successful update. The bundled snapshot is generated from the same Pi service, not a hand-maintained model list.

An empty result means there are no selectable models in that current catalog; the panel explains this and offers the existing update action. Do not add IDs manually. Runtime refreshes can discover new models without updating the whole plugin package.

## Capabilities and context

Pi metadata takes precedence over older reviewed model limits. For example, when the Pi entry for `gpt-6.1-sol` reports **272,000** context tokens, the plugin uses **272,000**, not the **1,050,000** value reviewed in the previous implementation. That older documentation review is not an override of the active source. This example is a precedence rule, not a frozen model list; Pi may change its metadata.

Only capabilities supported by the native integration are advertised. Text/image metadata is projected into the native model view; an entry without usable text input is not selectable. Unsupported input modalities are explained rather than advertised as implemented transport features. Unknown capabilities do not grant account access.

The parser does not import provider base URLs, SDK/API selections, headers, credentials or pricing into the adapter. Direct Responses transport and native request restrictions remain fixed locally. No estimated prices, alternative billing or API-key fallback are introduced by importing metadata.

## Native parity

- Local function tools preserve schema, arguments, native name and call/result IDs. Parallel calls remain distinct. The Harness executes tools and checks permissions.
- PNG, JPEG, WebP and GIF use the native attachment store's normalized request version. Images from tools use the Responses tool-result content array. Offloaded images retain native placeholder/readonly-path text.
- General files, including audio and video, use native file-reference projection and configured local tools. The plugin does not upload them to OpenAI Files or invent direct audio/video model inputs.
- Reasoning summaries are exposed when returned. Encrypted reasoning is retained for provider replay, without claiming access to hidden chain of thought.
- Complete retained conversation history is sent on each request. A stream that fails or ends before `response.completed` is an error, including after complete-looking tool arguments.

## Preview restrictions

The current plan-sharing route requires `store: false` and `stream: true`. It supports the documented function/custom tools within a namespace. The plugin declares the Harness's local function tools in its `harness` namespace.

Unsupported preview parameters such as `max_output_tokens`, `temperature`, stop sequences, server-side previous response IDs, service-tier overrides and hosted tool search are not sent. Native auxiliary callers can supply output/temperature hints; this route cannot enforce them. The advertised context comes from valid catalog metadata, not an advertised configurable output cap.

OpenAI-hosted web search, file search, code interpreter, image generation, hosted MCP and native Live/computer execution are outside this preview route. Equivalent configured Harness tools can still run locally under normal permissions. No unsupported hosted capability is advertised or silently replaced.

Only the documented signed ChatGPT grant is used. API-key billing is never selected automatically. Account/app usage limits and eligibility restrictions are surfaced explicitly, with a link to ChatGPT usage settings. No reset time is inferred.

One external issue affecting app-specific limits is recorded in [diagnostics](<troubleshooting.md>): the limit can remain at its original value after the weekly usage resets, so requests keep failing with `subscription_sharing_usage_limit_exceeded` even though ChatGPT reports reset capacity.

Sources: [Pi catalog](<https://pi.dev/api/models/providers/openai-codex?types=chat>), [OpenAI inference contract](<https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference>), [preview limitations](<https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations>), [errors and recovery](<https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery>). The OpenAI discovery description is not the source used by this experimental catalog implementation.
