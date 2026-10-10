# @deepseek-ai/dsh-llm-opencode-go

English | [中文](README.zh.md)

OpenCode Go (the OpenCode Zen Go subscription) provider adapter for the DeepSeek Harness LLM seam: registers the `opencode-go` provider route on `ctx.llm` against the subscription at `https://opencode.ai/zen/go/v1` and streams each model over the wire protocol its catalog entry names — OpenAI-compatible chat completions, OpenAI Responses, or Anthropic Messages. Sessions can switch their default model to an `opencode-go/*` model in the same picker that lists DeepSeek and any other registered provider.

## Composition

The plugin registers one provider route (`opencode-go`, display name "OpenCode Go") plus a configurable-provider entry, so the web Models page can write an API key and per-provider settings. Connection facts resolve per request: the `llm-opencode-go:` user-settings section (`$DSH_HOME/settings.yaml`) layers over the `cordis.yml` entry config, and the API key resolves through the credential seam from the `OPENCODE_GO_API_KEY` reference (default; `apiKeyEnv` renames it). An edited base URL, catalog, or key reaches the very next request without a restart; the endpoint also falls back to `$OPENCODE_GO_BASE_URL` from a trusted environment layer.

The adapter's requests always connect directly over an HTTP/2-first transport: got negotiates HTTP/2 and falls back to HTTP/1.1 automatically (the same transport shape as the OpenCode client), and never reads environment proxies, so OpenCode Go traffic always leaves from the machine's real origin. The endpoint's regional gating — the China-hosted deepseek opt-in — keys off the request origin, and a proxied exit from an overseas IP silently flips that state, so this route is deliberately exempt from any proxy the host configures. Other providers and the harness's own web tools keep their ambient transport.

The adapter is text-only (`UNSUPPORTED_CONTENT` for image blocks) and does not declare a reasoning-effort ladder: none of the three wire protocols carries a stable effort vocabulary the subscription documents, so an explicit `reasoningEffort` fails with `UNSUPPORTED_REASONING_EFFORT` instead of being silently dropped. The advisory model catalog defaults to the 38 models the Go gateway advertises, each paired with its serving protocol (see the `Catalog` section in this README), and is overridable through `models`.

## Model Experience

### Request route

#### What the model sees

Nothing beyond the ordinary request: the adapter serializes the harness conversation into the protocol its catalog entry names — chat-completions messages, Responses `input` items, or Anthropic content blocks — and streams the response back as text, reasoning, and tool-call blocks. The `opencode-go` provider and model come from the session's logged route.

#### Token effect

Zero direct tokens; the request is the conversation itself. Usage reported by the endpoint is mapped to harness token counts: chat completions and Responses fold cache hits into the input count, so the adapter subtracts them out, while Messages reports cache reads and writes separately.

#### KV Cache effect

Provider-keyed per conversation: OpenCode Go requires the `x-opencode-session` header on every request and reuses prompt-cache state under the stable id it carries, so the adapter sends the conversation's session id (a fresh UUID when a hand-built request has none) and repeated requests of one conversation benefit from the provider's cache. A `llm-opencode-go:` settings edit changes the request prefix only when it changes the endpoint or model.

## Catalog

The default advisory catalog is the 38 models the Go gateway currently advertises, each paired with the protocol the subscription serves it on: 26 on chat completions, six on Anthropic Messages (`claude-haiku-5-5`, `minimax-m2.7`, `minimax-m3`, `qwen3.7-plus`, `qwen3.8-flash`, `qwen3.8-max`), and six on OpenAI Responses (`grok-4.6`, `grok-4.7`, `gpt-5.6-luna`, `gpt-6-luna`, `muse-spark-1.2-contributor`, `muse-spark-1.3-contributor`). Every entry uses the same 1,000,000-token `defaultContextWindow`; the gateway publishes no per-model capacity or output cap. Requests remain unrestricted: an id absent from the catalog still streams, over chat completions. Anthropic Messages requires `max_tokens`, so a request that names none uses the profile's `maxTokens` or the adapter default (8,192). Reference pricing (USD per million tokens) is carried by the subscription's published price table, not by this catalog — the harness meters tokens, not currency.

## Known Limitations and Deferred Work

- **Region-gated models** — the gateway answers `gpt-5.6-luna`, `gpt-6-luna`, and `muse-spark-1.2/1.3-contributor` with a 403 from unsupported countries; the API key cannot change that, and the adapter reports the provider's message as an `AUTH` failure instead of hiding the model.
- **Always direct** — requests bypass any proxy the host configures; a deployment that can only reach opencode.ai through a proxy cannot use this adapter as-is.
- **No reasoning ladder** — `reasoningEffort` requests fail loudly rather than mapping to an undocumented wire vocabulary.
- **Text-only** — image content is rejected; multimodal models on the surface are not served.
- **Shared adapter pipeline** — the fetch/SSE transport and provider-registration shapes mirror `dsh-llm-deepseek`; extracting a shared OpenAI-compatible adapter layer is deferred.
