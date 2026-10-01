# ADR-0001: Use the Pi model catalog as the single metadata source

**Date**: 2026-10-01  
**Status**: Accepted

## Context

The ChatGPT Plan plugin used an OAuth account `/v1/models` list with a small reviewed capability baseline. That list can omit a model even when the user has independently confirmed real access through Pi with a Pro 5x account. The absence of a shared catalog entry and authorization to run inference are different facts. Neither a catalog lookup nor the user's Pi result is a live test of this DSH adapter.

We need current human-readable names and exact request identifiers without a hand-maintained model list, a Pi runtime dependency or an update of the whole plugin for each new model. The plugin must retain direct OAuth Responses requests to `api.openai.com`, existing scopes/native credentials, native Harness model/tool interfaces and explicit provider errors. It must not adopt Codex transport, imported pricing, API keys or automatic model substitution.

The experimental implementation is isolated as `0.1.5-pi-catalog.2` on `feature/pi-model-catalog`. The `main` branch, DSH ASAR/core and Pi/WSL installation are outside the change.

## Alternatives considered

### Keep OAuth account discovery

This preserves the previous source, but couples metadata discovery to the grant and keeps omitting models absent from that response. Merging a manually curated supplement would create competing sources and stale account-access claims. Rejected for this experiment; OAuth `/v1/models` is not a fallback discovery route.

### Bundle a snapshot only

A generated snapshot is reproducible and works offline, but becomes stale until another package is installed. Keep a snapshot as the bootstrap/failure fallback, not as the only runtime source.

### Reuse the Pi catalog bundled with the installed DSH host

This avoids an external runtime catalog request, but the host's Pi version can be old and is outside the plugin's release cadence. It can also create an implicit dependency on host internals or a different local Pi/WSL installation. Rejected as the authoritative metadata source.

### Update the whole plugin whenever a model changes

This is operationally straightforward but requires repeated packaging, profile installation and Host restarts for metadata-only changes. It is unnecessary coupling; reserve package updates for code/schema changes and refresh the bundled snapshot during release maintenance.

### Use Pi for catalog and inference

This could reuse a broader provider implementation, but would change transport, credential and billing boundaries. Rejected: Pi supplies metadata only; the existing direct Responses adapter remains responsible for inference.

## Decision

Use [Pi's openai-codex chat catalog](<https://pi.dev/api/models/providers/openai-codex?types=chat>) as the **single model metadata source**. Preserve each validated original `name` and exact `id`; for example, display **GPT-6.1 Sol** and send **`gpt-6.1-sol`** without an alias.

On every plugin activation, load the last valid profile cache or generated bundled snapshot and start a non-blocking remote check. Bound each check to **4 seconds**, **2 MiB** and **1,000 records**. **Update models now** triggers the same metadata path with no inference probe. Valid updates replace the entire list, including an empty list. A failed request or invalid JSON retains the last valid catalog; do not merge old entries into a new valid response.

Persist the validated JSON and ETag in the profile-local `.cache/dsh-chatgpt-plan/pi-catalog-v1.json`, outside OAuth grants. Ignore legacy stored model lists while retaining valid OAuth registration/tokens. Generate the bundled snapshot from the same service with `node --import tsx scripts/update-pi-catalog.ts` (`npm run catalog:snapshot`); maintainers do not edit a model list by hand, and the script is not required for every new model.

Publish token-free source, revision, loaded-from state, check/update timestamps and any fallback warning through optional `CatalogInfo`. `available` and `preferredModelAvailable` mean local selectability, not verified entitlement. Reuse existing adapter-update events and status reads; do not add client polling or block account actions for metadata I/O.

### Security and trust boundaries

- Treat remote and cached JSON as untrusted data. Validate structure, exact/unique identifiers and bounded capability values before publication; reject an invalid response as a whole.
- Send **no OAuth tokens, cookies, account identity, credentials or prompts to Pi**. Pi receives a catalog request and cache validator, not an inference request.
- Do not import base URLs, request headers, SDK/API selections, secrets or prices from catalog records. Pi's `openai-codex` namespace is not permission to select a Codex backend.
- Pi metadata controls native display/capability metadata only. For example, its 272,000-token context takes precedence over an older reviewed 1,050,000-token limit; the adapter does not silently enlarge the catalog value.
- Keep native credential locking/rotation and direct OpenAI authorization unchanged. Report catalog fallback separately from authentication failures; account eligibility is enforced by the real inference response.
- Attribute bundled Pi metadata using the upstream [MIT license](<https://raw.githubusercontent.com/earendil-works/pi/main/LICENSE>), Copyright (c) 2025 Mario Zechner, without removing existing third-party notices.

## Consequences

**Positive**: Current metadata can arrive without a plugin release or account reauthorization. Original human names and exact model IDs are retained. A generated snapshot supports offline startup. Grants, transport and catalog data have separate ownership.

**Negative**: Runtime freshness depends on a third-party service and its schema. A valid empty response removes previously selectable models. Catalog availability cannot promise actual account access, and fallback data may be stale.

**Risks**: A service outage, oversized/malformed response or schema change may prevent updates. Bounded requests, atomic validated replacement, ETag/cache reuse, a bundled snapshot and visible warnings limit the effect. A valid but incorrect capability value can still affect selection/context budgeting; monitor the active revision and verify changes with fixtures and actual provider behavior. Do not report successful live inference based only on metadata or mocks.

Release validation must separately record automated tests, catalog HTTP checks, the exact packaged artifact, installation/Host/UI loading and live inference. Install the same tested tarball through the global Windows bundled CLI, retain the previous `0.1.4` artifact for rollback, use **restartHost** and refresh the same `http://127.0.0.1:19387` UI. No core patch, new server or HMR assumption is part of this decision.

## Related documentation

- [Development and release procedure](<../development.md>)
- [Model semantics and restrictions](<../../packages/plugin/docs/models.md>)
- [Architecture](<../../packages/plugin/docs/architecture.md>)
- [Version-scoped validation](<../../packages/plugin/docs/validation.md>)
- [Third-party notices](<../../packages/plugin/THIRD_PARTY_NOTICES.md>)
