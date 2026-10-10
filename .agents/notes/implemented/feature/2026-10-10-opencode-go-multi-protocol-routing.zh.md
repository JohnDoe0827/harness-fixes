# Agent Note: OpenCode Go 多协议模型路由

Status: implemented

[English](2026-10-10-opencode-go-multi-protocol-routing.md) | 中文

## Problem

`opencode-go` 适配器此前只把 OpenCode Go 路由注册为 OpenAI 兼容的 chat completions。其咨询模型目录抄自 OpenCode Zen 的清单，而不是 Go 订阅，因此公布了 73 个 Go 网关并不提供的 id——Claude Sonnet 与 Opus、Gemini、GPT-5 系列、Jev、Ling、Nemotron——同时缺少网关确实提供的模型（`grok-4.7`、`longcat-2.0`、`mimo-v2.5`、`qwen3.8-max`、`hy3` 等）。实测表明网关在三种协议上服务 38 个 id：OpenAI 兼容的 `POST /chat/completions`、OpenAI `POST /responses` 与 Anthropic `POST /messages`。协议不匹配的模型会返回 `400 ModelProtocolUnsupported`，因此即使模型可达，向 `grok-4.7` 或 `claude-haiku-5-5` 发送 chat-completions 请求也会失败：选择列表中的模型，可能因为目录自身造成的原因而失败。

## Decision

**目录即网关公布的全部 38 个模型，每个模型都携带服务它的协议，适配器按模型路由。** `src/catalog.ts` 中的 `DEFAULT_MODELS` 为每个 id 标注 `chat-completions`（26 个）、`anthropic-messages`（`claude-haiku-5-5`、`minimax-m2.7`、`minimax-m3`、`qwen3.7-plus`、`qwen3.8-flash`、`qwen3.8-max`）或 `responses`（`grok-4.6`、`grok-4.7`、`gpt-5.6-luna`、`gpt-6-luna`、`muse-spark-1.2/1.3-contributor`）。`OpenCodeGoCatalogModel` 新增可选的 `protocol`；`protocolOf` 按请求解析它，未收录的 id 默认走 chat completions，因此咨询目录依旧不参与路由门控。

**在既有 chat 实现旁新增两套 wire 实现。** `serializeResponsesRequest` 构建 Responses 的 `input` 条目（以 call id 关联的 `function_call` / `function_call_output`），`serializeAnthropicRequest` 构建 Messages 内容块（`tool_use` / `tool_result`）；由于该协议强制要求 `max_tokens`，未指定时使用配置的 `maxTokens` 或文档化的默认值 8,192。`translateResponses` 与 `translateAnthropic` 把各自流的事件词汇（`response.output_text.delta` / `response.function_call_arguments.delta` / `response.completed`；`content_block_start` / `content_block_delta` / `message_stop`）转换为同一套 StreamChunk 协议。认证方式不同：Messages 发送 `x-api-key` 与 `anthropic-version`，OpenAI 形态的协议发送 bearer token，而必需的 `x-opencode-session` 与归因头在三种协议上都携带。缓存计量随协议而异：Responses 把缓存命中并入 `input_tokens`，适配器将其减去；Messages 则分别报告缓存读与缓存写。

## Alternatives considered

**保留仅 chat-completions 的表面，并把目录裁剪到 chat 模型。** 已否决：`grok-4.6`、`grok-4.7`、`claude-haiku-5-5`、`minimax-m2.7` 都可达且有文档，丢弃它们会让该路由无法服务订阅中三分之一的模型。

**按公开表格标注的协议列出全部模型，而不做实测。** 已否决：该表格落后于网关（它缺少 `deepseek-flash`、`glm-5.1`、`minimax-m2.5`、`qwen3.6-plus`、`qwen3.7-max` 与 `omen-alpha`），且只有真实请求才能证明某个模型确实从本来源被服务。

**复用 `llm-pi-ai` 的 `@earendil-works/pi-ai` 协议实现，而不是手写两套。** 已否决：原生适配器为该路由的区域门控刻意自持直连 HTTP/2 传输，且 pi-ai 目录正是为了让本适配器拥有 `opencode-go` 才将其扣留，见 [provider 说明](2026-08-14-opencode-go-provider.md) 与 [直连说明](2026-08-21-opencode-go-direct-connection.md)。

## Consequences

如今每个可达的 Go 模型都按各自的服务协议经由适配器流式调用：对全部 38 个目录条目的实测通过 34 个，仅 4 个区域受限 id（`gpt-5.6-luna`、`gpt-6-luna`、`muse-spark-1.2/1.3-contributor`）失败，它们从不支持的国家返回 403，与客户端无关；两种新协议上的工具调用都可往返。该路由现在承载三个序列化器与三个翻译器，网关协议变化时需要同步更新对应的一对。目录数量成为活的事实：它已按 `GET /v1/models` 核对，且会漂移，因此应从端点刷新，而不是照抄公开表格。
