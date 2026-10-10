# Agent Note: OpenCode Go provider adapter

Status: implemented

English | [中文](2026-08-14-opencode-go-provider.zh.md)

## Problem

OpenCode Go (the OpenCode Zen Go subscription) serves its coding lineup at `https://opencode.ai/zen/go/v1`, authenticated with an `OPENCODE_GO_API_KEY`-style bearer token. Harness users wanting to switch APIs to that subscription had no native provider: the custom-provider path (llm-pi-ai) needs hand-built profiles, and the built-in DeepSeek adapter could not point at a different vendor's endpoint with a different credential contract.

## Decision

**A dedicated `llm-opencode-go` adapter package, symmetric with `llm-deepseek`.** `dsh-llm-opencode-go` registers the `opencode-go` provider route plus a configurable-provider entry (display name "OpenCode Go") on `ctx.llm`, resolves connection facts per request (the `llm-opencode-go:` settings section layers over entry config; the key resolves from the `OPENCODE_GO_API_KEY` credential reference), and is mounted as a base-bundle row like the DeepSeek adapter, so the web Models page lists it and switching the session default model to an `opencode-go/*` model routes requests through it.

**The adapter serves the gateway's three wire protocols, as text.** Each catalog entry names its protocol — OpenAI-compatible chat completions, OpenAI Responses, or Anthropic Messages — and the adapter serializes, authenticates, and translates accordingly; [the multi-protocol routing note](2026-10-10-opencode-go-multi-protocol-routing.md) owns that decision. The adapter declares no reasoning-effort ladder and rejects image blocks, so explicit `reasoningEffort` fails with `UNSUPPORTED_REASONING_EFFORT` and image content with `UNSUPPORTED_CONTENT` instead of being silently dropped.

**The advisory catalog is the gateway's 38 advertised models**, each carrying its serving protocol, overridable through `models`; requests remain unrestricted. [The multi-protocol routing note](2026-10-10-opencode-go-multi-protocol-routing.md) owns the protocol pairing and its live verification.

## Alternatives considered

**A llm-pi-ai provider profile preset.** Rejected: pi-ai's provider-profile machinery is a multi-provider community path; a first-class adapter keeps the provider in the installed catalog with the same settings/credentials layering every built-in provider has. pi-ai's SDK in fact already ships an `opencode-go` builtin, so the native adapter collides with its configurable-provider directory entry: pi-ai's catalog now withholds the route (`catalogProviderIds()` filters it, documented in both READMEs), while a hand-written pi-ai profile for the route still resolves and a directory collision keeps the native entry serving.

**Reuse the DeepSeek adapter with a different base URL.** Rejected: the credential contract (env reference), catalog, and error vocabulary differ, and the DeepSeek adapter sends DeepSeek-specific headers and thinking fields no other endpoint should receive.

**Extract a shared OpenAI-compatible adapter layer first.** Deferred: the fetch/SSE transport and provider-registration shapes mirror `dsh-llm-deepseek` (clones are marked `jscpd:ignore` with that rationale), and extracting the shared layer would touch the core llm packages plus migrate the DeepSeek adapter in the same change.

## Consequences

A harness user can add an OpenCode Go API key on the Models page: the page's provider editor carries a curated `opencode-go` layout (key input, base URL, and the advisory model catalog — the same direct-fetch family shape as DeepSeek), so the card renders editable fields instead of only the "other fields live in settings.yaml" hint and its submit is enabled. Users keep or switch to `opencode-go` models per session and rotate keys or endpoints through `$DSH_HOME/settings.yaml` with the change reaching the next request. The adapter is mounted in the base bundle alongside the DeepSeek adapter, so every profile lists both providers. Wire-shape and error-mapping tests cover the transport; the loader-composition test proves the settings-edit endpoint switch end to end through the real Loader; UI tests cover the curated `opencode-go` layout. No core llm contract changed. The adapter's transport behavior (always-direct connections, proxy bypass) is refined by the [OpenCode Go direct-connection](2026-08-21-opencode-go-direct-connection.md) note.
