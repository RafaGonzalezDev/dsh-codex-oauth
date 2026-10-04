# Architecture

The **Adapter** pattern connects the Harness's provider-neutral LLM contract to OpenAI Responses. Inference goes directly to `https://api.openai.com/v1/responses`; no Chat Completions request, Codex backend, Codex OAuth client identifier or intermediary inference server is involved. Pi supplies **model metadata only**, as recorded in [ADR-0001](<../../../docs/adr/ADR-0001-use-pi-model-catalog.md>) in the source repository.

## Request boundaries

- **Client to Host:** token-free `chatgptPlan` RPC for account controls, public status and explicit catalog updates.
- **Host to OpenAI OAuth/OIDC:** issued-client registration, PKCE, consent, token exchange/rotation and revocation using native Harness credential services.
- **Host to Pi:** an unauthenticated metadata request to [the fixed openai-codex chat catalog](<https://pi.dev/api/models/providers/openai-codex?types=chat>), optionally carrying `If-None-Match`. No OAuth token, cookie, account identity or prompt is sent.
- **Native LLM loop to Responses adapter:** exact model ID, native history, tools and attachments. Only OpenAI receives the signed ChatGPT inference grant. Harness executes tools and checks permissions.

The Pi provider namespace does not configure a backend. The parser never imports transport URLs, headers, SDK/API selections, credentials or prices into the Responses adapter. OAuth `/v1/models` is not used for discovery or as a fallback.

## Ownership

- [OAuth](<../src/oauth.ts>) owns dynamic registration, fresh PKCE/state/nonce, loopback callback, JOSE OIDC verification, token exchange/rotation and revocation. Discovery and key endpoints stay on the trusted OpenAI issuer origin.
- [Session management](<../src/session.ts>) owns the credential schema, stable installation UUIDv4 URN (`urn:uuid:...`), canonical profile identity, one active token set, refresh serialization, account generation guards and connection-scoped model publication. Account registration metadata survives sign-out. An early development bare UUID is normalized without changing the UUID.
- [Pi catalog service](<../src/pi-catalog.ts>) owns bounded fetches, ETag revalidation, the profile-local cache, source/revision/timestamps, shared refresh state, fallback warnings and disposal. It has no dependency on an OAuth grant.
- [Model projection](<../src/models.ts>) validates the metadata allowlist and publishes only supported native capabilities. It preserves unique exact IDs, original human names and source order in the catalog, its profile cache and the bundled snapshot. The selection view exposed to the Models panel and the native composer selector is that same list reversed, so the newest generation is offered first; the projection renames, adds, removes, aliases and substitutes nothing. Unsupported modalities are not advertised; an entry needs text input to be selectable. Pi context metadata wins over the retired reviewed baseline.
- [Generated snapshot](<../src/pi-catalog.generated.ts>) is a release/bootstrap fallback obtained from the same Pi service, not a manual model list. The source repository's [maintainer script](<../../../scripts/update-pi-catalog.ts>) regenerates it without a Pi runtime dependency.
- [Request projection](<../src/request.ts>) projects full native history and the current tool declarations into Responses. Tool names use a deterministic collision-resistant mapping. The native filesystem/attachment helpers retain file handles, readonly image paths and offload markers.
- [Stream translation](<../src/response-stream.ts>) turns Responses SSE events into native blocks, deltas, usage and one terminal finish. Only `response.completed` is success. It never executes a tool.
- [Responses adapter](<../src/adapter.ts>) owns the official OpenAI SDK request, with `maxRetries: 0`, `store: false`, streaming, native attribution headers and safe provider failure routing. Harness decides retries.
- [RPC service](<../src/service.ts>) publishes five `chatgptPlan` methods: `getStatus`, cancelable streaming `authorize`, `cancel`, `disconnect`, and `refreshModels`. Public results contain no OAuth token values. `refreshModels` performs catalog network I/O without inference and reports catalog failures separately from authentication.
- [Client](<../src/client/>) owns the Models footer, sidebar connection notice, first-sign-in confirmation and account/catalog controls. All surfaces share one token-free observable. No quota polling, second authentication flow or new catalog polling loop is introduced.

The packaged distribution does not include the source tree or repository ADR/script; source links above describe repository ownership. Runtime consumers use the compiled package and bundled snapshot.

## Catalog lifecycle and persistence

On each plugin activation, the Host loads a valid cache or the bundled snapshot, registers the native adapter and starts a background Pi check. A check has a **4-second** deadline, **2 MiB** body bound and **1,000-record** maximum. Startup does not wait for the remote result. Concurrent requests share one refresh; unloading the plugin cancels its catalog lifecycle.

The canonical profile directory owns `.cache/dsh-chatgpt-plan/pi-catalog-v1.json`. It contains versioned validated model JSON, source identity, a revision, ETag and check/update timestamps. Cache reads are validated; writes use temporary-file/atomic replacement. Catalog data is not part of the native grant record.

A successful complete response replaces the entire current list, including `[]`. A valid `304` reuses the previously validated body. A transport, HTTP, size, parsing or cache-persistence error retains the last valid list and exposes a safe warning; if no valid cache exists, the generated snapshot remains active. A new valid list is never merged with stale models.

The public optional `CatalogInfo` describes source `pi`, its URL, `bundled`/`cache`/`remote` provenance, revision, last check/update times, refreshing state and warning. `available` and `preferredModelAvailable` indicate local selectability, not account entitlement. Inference is the point at which OpenAI enforces actual account access. Metadata and fixture tests are not proof of a successful live request.

Legacy credentials may contain a `models` field from account discovery. Reading a valid legacy record ignores that field, even when its obsolete model payload is malformed, while preserving OAuth registration/tokens and normal credential validation. Those old entries cannot overwrite the new catalog. Catalog errors do not turn a connected grant into a reconnect-required session.

## Client state and accessibility

The Client entry mounts its Remote contribution first, then starts an injected child context that declares `remote.chatgptPlan` alongside `remote` and `slots`. The pinned Gateway requires callers to declare their concrete namespace. Declaring that namespace before mounting it would create a startup dependency cycle.

The panel repulls status when opened, on native connection resets and on existing `llm/adapters-updated` events. The catalog service's publication reaches the selector and the same observable through this path. **Update models now** keeps its progress/error state separate from OAuth `busy` state; it does not disable Disconnect or sign-in while only metadata is refreshing. After its RPC completes, the Client reads current status rather than restoring a potentially stale connected response. Account transitions invalidate older status reads.

The catalog region uses text for source/provenance, a shortened revision with a complete title, semantic timestamps, a polite live region for progress/warnings and a native button with visible focus. Catalog fallback is distinct from authentication alerts. Optional missing metadata has a compatibility placeholder. Empty/non-selectable lists explain the state and retain the explicit update action.

The sidebar notice registers an additive `sidebar.footer.action` entry. On the pinned rc.2 shell this area precedes `sidebar.settings`, preserving the DeepSeek account launcher. It shows only a connected plan or reconnect-required state, never inferred quota or a claim that the selected model uses ChatGPT. Its usage link opens the official ChatGPT dashboard without credentials in the URL. Scoped wrapping gives it its own footer row: the rule targets the slot's `display: contents` parent, never shell class names, so it holds with or without other footer actions installed. The collapsed rail uses the same glyph in a 36×36 control with an accessible label. Reconnection remains in Models. The official sidebar package is a development-only type dependency. Quota wording and sidebar behavior are unchanged by the catalog work.

The first-sign-in confirmation registers an additive `shell.overlay` entry, the frame-wide floating layer the shell already uses for its own quota host, so the confirmation outlives the Models panel that started the sign-in. This Client ships without `react-dom`, so the surface renders inside that layer instead of a body portal; `aria-modal` plus Tab containment stands in for the root-inert ownership the portal-based onboarding modal relies on. Acknowledgement is a versioned client-local value keyed by profile, so an effective connection shows the confirmation once and a reconnection never does. The acknowledgement is not part of the native grant record and never crosses RPC.

## Credentials and races

Credentials remain in the native managed store, normally `$DSH_HOME/.credentials.yaml`, whose file implementation writes with owner-only permissions. It is a native managed file, not an OS-keychain claim. The plugin derives its record key from the canonical profile directory's SHA-256 digest; installation identity has its own record.

OAuth refresh uses the native `modifyRecord` cross-process lock around read, refresh and complete replacement. Once rotation starts it is persisted even if that request's consumer cancels. Disconnect cancels active inference requests, waits for OAuth refresh, revokes the latest token set and removes tokens atomically. A changed account generation rejects stale prepared inference calls. Native credential events republish the provider and cancel calls when another process changes the account. Shared, account-independent catalog metadata cannot replace a grant.

Cancellation waits for callback/token cleanup. An exchanged grant that was not activated is revoked; issued registration metadata remains available for reconnection. Once a validated session is atomically activated, catalog loading does not determine its authorization outcome; use Disconnect to revoke it.

Reasoning replay contains opaque provider reasoning data, not authentication credentials. Its account client ID, exact model and per-block fingerprints prevent replay across accounts/models or rewritten history. It is persisted through the native assistant replay envelope and is resent with full history because Responses storage is disabled.

Explicit native `options.system` keeps precedence for `instructions`; otherwise a leading system-history message supplies it. Every other system-history message is preserved at its original position as a Responses developer message, as required by the preview. No historical system message overwrites or drops another.

The adapter uses the native aspect-preserving `requestImageDimensions` helper and the pinned native adapter defaults: a 2048 × 2048 total-pixel budget, 1 MiB encoded target per request version and 20 MiB aggregate base64 bound. These are local policies, not asserted OpenAI API limits. `requiredImageOffload` counts exact request-byte occurrences and returns the native `IMAGE_OFFLOAD_REQUIRED` failure so Harness applies its durable offload/retry flow. Repeated images are normalized once but counted per occurrence.

Output items must keep consistent identities and complete successfully. The live plan-sharing route can send `response.completed` with `output: []` after closing every item with `response.output_item.done`; the adapter uses that validated item ledger. An open item, reused output index or contradictory nonempty final aggregate is rejected. The terminal completion event remains mandatory before any tool-call turn succeeds. HTTP status and Retry-After are retained only when observed; network and SSE failures do not invent HTTP status codes. Redirects are rejected for authenticated provider requests.

## Build and distribution

The workspace contains one distributable plugin package. Host TypeScript builds before the Client, then tsdown emits the Host and native lazy-CJS Client. The official Typert generator produces `./typert` and `./remote`; `./types` exposes token-free DTOs.

The rc.2 analyzer recognizes protocol symbols only in registered source projects. The source repository's [Typert preparation script](<../../../scripts/prepare-typert.mjs>) creates an analysis-only project from the exact installed public protocol declarations. This does not patch a dependency or ship another protocol runtime. The generated view is excluded from distribution; native generator workspace mode emits only explicit contract exporters.

Bundling the browser codec keeps the Client compatible with the existing lazy module loader. Harness and Cordis packages remain peer dependencies; the official SDK, JOSE and Zod are runtime dependencies. Pi is not a runtime package dependency. Bundled Pi metadata attribution is retained in [third-party notices](<../THIRD_PARTY_NOTICES.md>).

The experimental release is developed in a separate worktree without changing stable `main`. Build/test, retain and install the same versioned tarball through the native global CLI; restartHost and refresh the existing UI. No registry publication, ASAR/core patch or replacement Web server is required. Preserve the previous tarball for rollback. See the [installation guide](<../README.md>) and [validation evidence](<validation.md>).
