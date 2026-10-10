/**
 * OpenCode Go wire formats. OpenCode Go serves OpenCode Zen's Go subscription
 * at `https://opencode.ai/zen/go/v1` over three protocols: OpenAI-compatible
 * `POST /chat/completions` (the standard streaming request with the standard
 * delta vocabulary), OpenAI `POST /responses` (item and output-text events),
 * and Anthropic `POST /messages` (content-block events). The advisory catalog
 * names which protocol serves each model. Types only.
 *
 * @module dsh-llm-opencode-go/types
 */

/** Request body for `POST {baseURL}/chat/completions`. */
export interface WireRequest {
  model: string
  messages: WireMessage[]
  stream: true
  stream_options: { include_usage: true }
  tools?: WireTool[]
  temperature?: number
  max_tokens?: number
  stop?: string[]
}

/** System-role message: a single string of instructions. */
export interface WireSystemMessage {
  role: 'system'
  content: string
}

/** User-role message: a single string of user input. */
export interface WireUserMessage {
  role: 'user'
  content: string
}

/** Tool-role message: the result of one tool call, keyed by its call id. */
export interface WireToolMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}

/** One replayed assistant tool call. */
export interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/**
 * Assistant-role history message. Text-less turns send `content: ""` — never
 * null — because some OpenAI-compatible gateways reject null content on
 * tool-call turns; `tool_calls` rides alongside when the turn called tools.
 */
export interface WireAssistantMessage {
  role: 'assistant'
  content: string
  tool_calls?: WireToolCall[]
}

/** One entry of the request `messages` array, discriminated on `role`. */
export type WireMessage =
  | WireSystemMessage
  | WireUserMessage
  | WireAssistantMessage
  | WireToolMessage

/** One entry of the request `tools` array. */
export interface WireTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** One delta of one streamed choice. */
export interface WireDelta {
  role?: 'assistant'
  content?: string | null
  /** Reasoning text some routed models expose on the OpenAI surface. */
  reasoning_content?: string | null
  tool_calls?: {
    index?: number
    id?: string
    function?: { name?: string; arguments?: string }
  }[]
}

/** One streamed choice. */
export interface WireChoice {
  delta: WireDelta
  finish_reason?: string | null
}

/** Token accounting from the streamed `usage` payload. */
export interface WireUsage {
  prompt_tokens: number
  completion_tokens: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

/** One SSE data payload of the chat-completions stream. */
export interface WireChunk {
  choices?: WireChoice[]
  usage?: WireUsage
}

/** Error envelope of a non-2xx response body. */
export interface WireError {
  error?: { message?: string; type?: string; code?: string }
}

/** One OpenCode Go wire protocol. An uncatalogued model id defaults to `chat-completions`. */
export type OpenCodeGoProtocol = 'chat-completions' | 'responses' | 'anthropic-messages'

/** One function tool of an OpenAI Responses request. */
export interface ResponsesTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

/**
 * One entry of an OpenAI Responses request `input` array. Conversation turns
 * are role-tagged messages; a replayed tool call and its output are the
 * `function_call` / `function_call_output` items correlated by `call_id`.
 */
export type ResponsesInputItem =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }

/** Request body for `POST {baseURL}/responses`. */
export interface ResponsesRequest {
  model: string
  input: ResponsesInputItem[]
  instructions?: string
  stream: true
  tools?: ResponsesTool[]
  temperature?: number
  max_output_tokens?: number
}

/** Token accounting from a Responses `response.completed`, where `input_tokens` includes cache hits. */
export interface ResponsesUsage {
  input_tokens: number
  output_tokens: number
  input_tokens_details?: { cached_tokens?: number }
  output_tokens_details?: { reasoning_tokens?: number }
}

/** One output item a Responses stream event references. */
export interface ResponsesOutputItem {
  type?: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
  status?: string
}

/** One SSE data payload of the Responses stream; only the fields this adapter reads. */
export interface ResponsesEvent {
  type: string
  output_index?: number
  summary_index?: number
  item_id?: string
  item?: ResponsesOutputItem
  delta?: string
  arguments?: string
  name?: string
  response?: {
    status?: string
    error?: { message?: string; code?: string } | null
    incomplete_details?: { reason?: string } | null
    usage?: ResponsesUsage | null
  }
}

/** One content block of an Anthropic Messages request. */
export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

/** One entry of an Anthropic `messages` array. */
export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

/** One tool of an Anthropic Messages request; the schema field is `input_schema`. */
export interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** Request body for `POST {baseURL}/messages`. `max_tokens` is required by the protocol. */
export interface AnthropicRequest {
  model: string
  max_tokens: number
  system?: string
  messages: AnthropicMessage[]
  tools?: AnthropicTool[]
  temperature?: number
  stop_sequences?: string[]
  stream: true
}

/** Token accounting from Anthropic `message_start` / `message_delta`; input counts exclude cache reads and writes. */
export interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens_details?: { thinking_tokens?: number }
}

/** One SSE data payload of the Anthropic Messages stream; only the fields this adapter reads. */
export interface AnthropicEvent {
  type: string
  index?: number
  content_block?: { type?: string; id?: string; name?: string }
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string | null }
  message?: { usage?: AnthropicUsage }
  usage?: AnthropicUsage
  error?: { type?: string; message?: string }
}
