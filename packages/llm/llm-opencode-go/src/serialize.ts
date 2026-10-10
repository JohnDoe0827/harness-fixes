/**
 * Serialize harness messages into OpenCode Go chat completions. User text is
 * joined, assistant tool calls are replayed as `tool_calls`, and tool results
 * become separate tool messages. Core image blocks are rejected explicitly
 * because this wire route is text-only.
 * @module dsh-llm-opencode-go/serialize
 */

/* jscpd:ignore-start -- The OpenAI-compatible chat-completions wire format is
 * the same protocol dsh-llm-deepseek serializes; the mapping helpers are
 * protocol constants rather than owned logic (see the package Agent Note). */

import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicRequest,
  AnthropicTool,
  ResponsesInputItem,
  ResponsesRequest,
  ResponsesTool,
  WireMessage,
  WireRequest,
  WireTool,
} from './types.ts'

/** Reject core image content before any text-flattening path can silently erase it. */
function assertTextOnly(blocks: readonly ContentBlock[]): void {
  if (contentHasImage(blocks)) {
    throw new LlmError('The OpenCode Go chat-completions adapter does not support image content.', 'UNSUPPORTED_CONTENT')
  }
}

/** Join the text blocks of a message (used for user/tool-result content). */
function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Serialize one assistant message: text plus replayed tool calls. */
function serializeAssistant(message: Message): WireMessage {
  const text = flattenText(message.content)
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))
  return {
    role: 'assistant',
    // Text-less turns send "" — NEVER null: some OpenAI-compatible gateways
    // reject null content on tool-call turns, and a null here would sit
    // durably in the session log.
    content: text,
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; a mixed user message contributes its text first
 * and its tool results as separate wire messages after.
 * @param messages - the harness conversation, in order.
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
export function serializeMessages(messages: readonly Message[]): WireMessage[] {
  const wire: WireMessage[] = []
  for (const message of messages) {
    assertTextOnly(message.content)
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    // user role: tool results ride in user messages in the harness
    // vocabulary, but OpenCode Go wants them as role:'tool' messages.
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const text = flattenText(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted rather than sent as null, so
 * provider defaults apply.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @returns the chat-completions request body.
 */
export function serializeRequest(options: GenerateOptions): WireRequest {
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...serializeMessages(options.messages))

  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== undefined ? { stop: options.stop } : {},
  }
}

/* jscpd:ignore-end */

/**
 * Parse replayed tool arguments into the object an Anthropic `tool_use.input`
 * requires. A model that emitted malformed JSON still gets a replayed call —
 * with an empty object — rather than failing the whole request: the provider
 * produced the bytes, and the harness owns only the re-encoding.
 * @param raw - the raw JSON string from a tool-call block.
 * @returns the parsed object, or an empty object for non-object or malformed JSON.
 */
function parseToolInput(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch (_malformedModelJson) {
    return {}
  }
}

/**
 * Build an OpenAI Responses request. Conversation turns and tool correlation
 * map to the `input` item vocabulary: a replayed assistant tool call is a
 * `function_call` item and its result a `function_call_output` item, both
 * keyed by the call id the model issued.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @returns the Responses request body; `input` order is the conversation order.
 */
export function serializeResponsesRequest(options: GenerateOptions): ResponsesRequest {
  const input: ResponsesInputItem[] = []
  for (const message of options.messages) {
    assertTextOnly(message.content)
    if (message.role === 'system') {
      input.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      const text = flattenText(message.content)
      if (text.length > 0) input.push({ role: 'assistant', content: text })
      for (const block of message.content) {
        if (block.type === 'tool-call') {
          input.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: block.arguments })
        }
      }
      continue
    }
    // user role: text first, then each tool result as its own function_call_output.
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const text = flattenText(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      input.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      input.push({
        type: 'function_call_output',
        call_id: result.toolCallId,
        // Responses rejects an empty output string the same way chat rejects
        // empty tool content, so empty output still needs a placeholder.
        output: flattenText(result.content) || '(no output)',
      })
    }
  }

  const tools: ResponsesTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))

  return {
    model: options.model,
    input,
    stream: true,
    ...options.system === undefined ? {} : { instructions: options.system },
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature === undefined ? {} : { temperature: options.temperature },
    ...options.maxTokens === undefined ? {} : { max_output_tokens: options.maxTokens },
  }
}

/**
 * Build an Anthropic Messages request. The system slot is top-level, not a
 * message: a system-role harness message folds into it ahead of
 * `options.system`. Tool calls replay as `tool_use` blocks with parsed input,
 * and tool results as `tool_result` blocks correlated by the call id.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param fallbackMaxTokens - output cap used when the request names none; the protocol requires `max_tokens`.
 * @returns the Messages request body.
 */
export function serializeAnthropicRequest(options: GenerateOptions, fallbackMaxTokens: number): AnthropicRequest {
  const systemParts: string[] = []
  if (options.system !== undefined) systemParts.push(options.system)
  const messages: AnthropicMessage[] = []
  for (const message of options.messages) {
    assertTextOnly(message.content)
    if (message.role === 'system') {
      const text = flattenText(message.content)
      if (text.length > 0) systemParts.push(text)
      continue
    }
    const content: AnthropicContentBlock[] = []
    const text = flattenText(message.content)
    if (text.length > 0) content.push({ type: 'text', text })
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type === 'tool-call') {
          content.push({ type: 'tool_use', id: block.id, name: block.name, input: parseToolInput(block.arguments) })
        }
      }
    } else {
      for (const result of message.content) {
        if (result.type === 'tool-result') {
          content.push({
            type: 'tool_result',
            tool_use_id: result.toolCallId,
            content: flattenText(result.content) || '(no output)',
          })
        }
      }
    }
    // Anthropic rejects an empty content array; an empty turn still needs one block.
    messages.push({ role: message.role, content: content.length > 0 ? content : [{ type: 'text', text: '' }] })
  }

  const tools: AnthropicTool[] | undefined = options.tools?.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }))

  return {
    model: options.model,
    max_tokens: options.maxTokens ?? fallbackMaxTokens,
    messages,
    stream: true,
    ...systemParts.length === 0 ? {} : { system: systemParts.join('\n\n') },
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature === undefined ? {} : { temperature: options.temperature },
    ...options.stop === undefined ? {} : { stop_sequences: options.stop },
  }
}
