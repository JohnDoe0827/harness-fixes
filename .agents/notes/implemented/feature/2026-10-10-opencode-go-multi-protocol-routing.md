# Agent Note: OpenCode Go multi-protocol model routing

Status: implemented

English | [中文](2026-10-10-opencode-go-multi-protocol-routing.zh.md)

## Problem

The `opencode-go` adapter registered the OpenCode Go route as OpenAI-compatible chat completions only. Its advisory catalog was transcribed from an OpenCode Zen listing rather than the Go subscription, so it advertised 73 ids — Claude Sonnet and Opus, Gemini, the GPT-5 line, Jev, Ling, Nemotron — that the Go gateway does not serve, and it was missing models the gateway does serve (`grok-4.7`, `longcat-2.0`, `mimo-v2.5`, `qwen3.8-max`, `hy3`, and others). Live probing showed the gateway serves 38 ids across three protocols: OpenAI-compatible `POST /chat/completions`, OpenAI `POST /responses`, and Anthropic `POST /messages`. A model on the wrong protocol answers `400 ModelProtocolUnsupported`, so a chat-completions request to `grok-4.7` or `claude-haiku-5-5` failed even though the model was reachable: selecting a listed model could fail for a reason the catalog itself created.

## Decision

**The catalog is the gateway's 38 advertised models, each carrying the protocol that serves it, and the adapter routes per model.** `DEFAULT_MODELS` in `src/catalog.ts` pairs every id with `chat-completions` (26), `anthropic-messages` (`claude-haiku-5-5`, `minimax-m2.7`, `minimax-m3`, `qwen3.7-plus`, `qwen3.8-flash`, `qwen3.8-max`), or `responses` (`grok-4.6`, `grok-4.7`, `gpt-5.6-luna`, `gpt-6-luna`, `muse-spark-1.2/1.3-contributor`). `OpenCodeGoCatalogModel` gains an optional `protocol`; `protocolOf` resolves it per request and defaults an uncatalogued id to chat completions, so the advisory list still never gates routing.

**Two new wire implementations land beside the existing chat one.** `serializeResponsesRequest` builds Responses `input` items (`function_call` / `function_call_output` correlated by call id), and `serializeAnthropicRequest` builds Messages content blocks (`tool_use` / `tool_result`), using the profile's `maxTokens` or a documented 8,192 default because that protocol requires `max_tokens`. `translateResponses` and `translateAnthropic` consume each stream's event vocabulary (`response.output_text.delta` / `response.function_call_arguments.delta` / `response.completed`; `content_block_start` / `content_block_delta` / `message_stop`) into the same StreamChunk protocol. Authentication differs: Messages sends `x-api-key` and `anthropic-version`, the OpenAI-shaped protocols send the bearer token, and the required `x-opencode-session` plus attribution headers ride all three. Cache accounting follows each protocol: Responses folds cache hits into `input_tokens` and the adapter subtracts them, while Messages reports cache reads and writes separately.

## Alternatives considered

**Keep the chat-completions-only surface and prune the catalog to chat models.** Rejected: `grok-4.6`, `grok-4.7`, `claude-haiku-5-5`, and `minimax-m2.7` are reachable and documented, and dropping them would leave the route unable to serve a third of the subscription.

**List every model against the protocol the published table names, without probing.** Rejected: the table lags the gateway (it omits `deepseek-flash`, `glm-5.1`, `minimax-m2.5`, `qwen3.6-plus`, `qwen3.7-max`, and `omen-alpha`), and only a live request proves a model is served from this origin.

**Reuse `llm-pi-ai`'s `@earendil-works/pi-ai` protocol implementations instead of hand-writing two.** Rejected: the native adapter deliberately owns its direct HTTP/2 transport for the route's regional gating, and the pi-ai catalog withholds `opencode-go` precisely so this adapter owns it, per [the provider note](2026-08-14-opencode-go-provider.md) and [the direct-connection note](2026-08-21-opencode-go-direct-connection.md).

## Consequences

Every reachable Go model now streams through the adapter on its serving protocol: a live sweep of all 38 catalog entries passed 34 and failed only the four region-gated ids (`gpt-5.6-luna`, `gpt-6-luna`, `muse-spark-1.2/1.3-contributor`), which answer 403 from unsupported countries regardless of the client, and tool calls round-trip on both new protocols. The route now carries three serializers and three translators, so a gateway protocol change needs the matching pair updated. The catalog count became a live fact: it was verified against `GET /v1/models` and will drift, so refresh it from the endpoint rather than from the published table.
