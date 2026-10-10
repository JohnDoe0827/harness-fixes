/**
 * Translate OpenCode Go SSE payloads into the harness `StreamChunk` protocol.
 * One stateful block is kept per open content, reasoning, or tool-call index;
 * an empty initial delta does not open a block. Finish reason and the latest
 * usage are deferred until the `[DONE]` sentinel.
 * @module dsh-llm-opencode-go/translate
 */

/* jscpd:ignore-start -- The OpenAI-compatible chunk vocabulary (delta, finish,
 * usage) is the same protocol dsh-llm-deepseek translates; the mapping is a
 * protocol constant rather than owned logic (see the package Agent Note). */

import { CallId, EMPTY_RESPONSE_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type {
  AnthropicEvent,
  ResponsesEvent,
  ResponsesUsage,
  WireChunk,
  WireDelta,
  WireUsage,
} from './types.ts'

/** The terminal payload OpenCode Go (and OpenAI) send after the last chunk. */
export const DONE = '[DONE]'

/** One open block under assembly. */
interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  /** tool-call only */
  callId?: string
  name?: string
  /**
   * Whether a `block-start` has been emitted. The chat-completions translator
   * opens a block only when its first delta arrives, so it always starts
   * started; Anthropic and Responses announce some blocks (tool calls) before
   * they carry content and defer others until the first delta.
   */
  started?: boolean
  /** Whether the matching `block-end` has been emitted. */
  closed?: boolean
}

/**
 * Map the wire finish_reason vocabulary to the harness FinishReason.
 * @param reason - the wire `finish_reason` string.
 * @returns the mapped reason; unrecognized values become `{kind: 'error'}` with the uppercased value as `code`.
 */
export function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    default:
      // content_filter, insufficient_system_resource, future additions.
      return {
        kind: 'error',
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() },
      }
  }
}

/**
 * Map wire usage fields. OpenAI's `prompt_tokens` INCLUDES cache hits, while
 * the harness TokenUsage convention is DISJOINT counts, so cache reads are
 * subtracted out of `inputTokens`.
 * @param usage - wire usage from the finish chunk or the trailing usage-only chunk.
 * @returns disjoint harness counts; cache/reasoning fields present only when the wire reported them.
 */
export function mapUsage(usage: WireUsage): TokenUsage {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens,
    ...cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== undefined ? { reasoningTokens: reasoning } : {},
  }
}

/** Assemble the final ContentBlock for one open block. */
function closeBlock(block: OpenBlock): ContentBlock {
  switch (block.kind) {
    case 'text': return { type: 'text', text: block.text }
    case 'reasoning': return { type: 'reasoning', text: block.text }
    case 'tool-call': return {
      type: 'tool-call',
      id: CallId(block.callId ?? ''),
      name: block.name ?? '',
      arguments: block.text,
    }
  }
}

/** Apply one delta to the open blocks, yielding the deltas it produces. */
function* applyDelta(
  delta: WireDelta,
  blocks: { byKind: Map<string, OpenBlock>; byWireIndex: Map<number, OpenBlock>; order: OpenBlock[]; nextIndex: () => number },
): Generator<StreamChunk> {
  const open = (kind: OpenBlock['kind']): OpenBlock => {
    const block: OpenBlock = { index: blocks.nextIndex(), kind, text: '' }
    blocks.order.push(block)
    return block
  }

  const reasoning = delta.reasoning_content
  if (typeof reasoning === 'string' && reasoning.length > 0) {
    let block = blocks.byKind.get('reasoning')
    if (!block) {
      block = open('reasoning')
      blocks.byKind.set('reasoning', block)
      yield { type: 'block-start', index: block.index, blockType: 'reasoning' }
    }
    block.text += reasoning
    yield { type: 'reasoning-delta', index: block.index, text: reasoning }
  }

  const content = delta.content
  if (typeof content === 'string' && content.length > 0) {
    let block = blocks.byKind.get('text')
    if (!block) {
      block = open('text')
      blocks.byKind.set('text', block)
      yield { type: 'block-start', index: block.index, blockType: 'text' }
    }
    block.text += content
    yield { type: 'text-delta', index: block.index, text: content }
  }

  for (const call of delta.tool_calls ?? []) {
    const wireIndex = call.index ?? 0
    let block = blocks.byWireIndex.get(wireIndex)
    if (!block) {
      block = open('tool-call')
      blocks.byWireIndex.set(wireIndex, block)
      yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
    }
    // Only a non-empty id/name advances the block: compliant streams put
    // id/name on the first tool-call frame and leave them off argument
    // fragments, but some gateways explicitly emit null/empty placeholders on
    // later fragments. Overwriting the captured first-frame values there
    // produces a nameless call that the harness rejects with `unknown tool ""`
    // and the model retries forever.
    if (typeof call.id === 'string' && call.id.length > 0) block.callId = call.id
    if (typeof call.function?.name === 'string' && call.function.name.length > 0) block.name = call.function.name
    const fragment = call.function?.arguments ?? ''
    block.text += fragment
    yield {
      type: 'tool-call-delta',
      index: block.index,
      id: CallId(block.callId ?? ''),
      ...block.name !== undefined ? { name: block.name } : {},
      argumentsDelta: fragment,
    }
  }
}

/**
 * Consume SSE data payloads (ending with `[DONE]`) and yield StreamChunks.
 * Malformed JSON payloads abort the stream with `MALFORMED_RESPONSE`.
 * @param payloads - SSE data payloads, `[DONE]`-terminated.
 * @returns deltas as they arrive; `block-end`s, `usage`, and `finish` are all deferred to the `[DONE]` sentinel.
 */
export async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  const order: OpenBlock[] = []
  const byKind = new Map<string, OpenBlock>()
  const byWireIndex = new Map<number, OpenBlock>()
  let nextIndex = 0
  const state = {
    byKind,
    byWireIndex,
    order,
    nextIndex: () => nextIndex++,
  }
  let pendingFinish: FinishReason | undefined
  let pendingUsage: TokenUsage | undefined

  for await (const payload of payloads) {
    if (payload === DONE) {
      for (const block of order) {
        yield { type: 'block-end', index: block.index, block: closeBlock(block) }
      }
      if (pendingUsage !== undefined) yield { type: 'usage', usage: pendingUsage }
      const reason = pendingFinish ?? { kind: 'stop' as const }
      yield {
        type: 'finish',
        reason: reason.kind === 'stop' && order.length === 0
          ? {
            kind: 'error',
            failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
          }
          : reason,
      }
      return
    }

    let chunk: WireChunk
    try {
      chunk = JSON.parse(payload) as WireChunk
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }

    for (const choice of chunk.choices ?? []) {
      yield* applyDelta(choice.delta, state)
      if (typeof choice.finish_reason === 'string') {
        pendingFinish = mapFinishReason(choice.finish_reason)
      }
    }
    // Usage may arrive attached to the finish chunk or as a trailing
    // usage-only chunk — keep the latest. A wire `usage: null` (a completion
    // the endpoint reports without token accounting) is absent, not a count.
    if (chunk.usage != null) pendingUsage = mapUsage(chunk.usage)
  }

  // The caller's SSE framing guarantees the [DONE] sentinel (or throws);
  // reaching here means the payload source violated that contract.
  throw new LlmError('SSE payload stream ended without [DONE]', 'STREAM_CLOSED')
}

/* jscpd:ignore-end */

/**
 * Map the Anthropic `stop_reason` vocabulary to the harness finish reason.
 * A null reason (some gateways omit it) is treated as a normal stop.
 * @param reason - the wire `stop_reason`, when reported.
 * @returns the mapped reason; unrecognized values become `{kind: 'error'}`.
 */
export function mapAnthropicStopReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case undefined:
    case null:
    case 'end_turn':
    case 'stop_sequence': return { kind: 'stop' }
    case 'tool_use': return { kind: 'tool-calls' }
    case 'max_tokens': return { kind: 'max-tokens' }
    default:
      return { kind: 'error', failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() } }
  }
}

/**
 * Map Responses usage to disjoint harness counts. Responses' `input_tokens`
 * INCLUDES cache hits, so cached tokens are subtracted out of `inputTokens`.
 * @param usage - wire usage from `response.completed`.
 * @returns disjoint harness counts.
 */
export function mapResponsesUsage(usage: ResponsesUsage): TokenUsage {
  const cacheRead = usage.input_tokens_details?.cached_tokens
  const reasoning = usage.output_tokens_details?.reasoning_tokens
  return {
    inputTokens: usage.input_tokens - (cacheRead ?? 0),
    outputTokens: usage.output_tokens,
    ...cacheRead === undefined ? {} : { cacheReadTokens: cacheRead },
    ...reasoning === undefined ? {} : { reasoningTokens: reasoning },
  }
}

/**
 * Consume an Anthropic Messages SSE stream and yield StreamChunks. Blocks are
 * announced by `content_block_start`, filled by `content_block_delta`
 * (text, thinking, and tool-argument fragments), and closed by
 * `content_block_stop`; the stream ends at `message_stop`, which is where
 * usage and finish are deferred.
 * @param payloads - SSE data payloads of the Messages stream.
 * @returns deltas as they arrive; usage and finish are deferred to `message_stop`.
 */
export async function* translateAnthropic(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  const byWireIndex = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  let nextIndex = 0
  const open = (kind: OpenBlock['kind']): OpenBlock => {
    const block: OpenBlock = { index: nextIndex++, kind, text: '', started: false }
    order.push(block)
    return block
  }
  let inputTokens = 0
  let outputTokens = 0
  let cacheRead: number | undefined
  let cacheWrite: number | undefined
  let reasoningTokens: number | undefined
  let stopReason: string | null | undefined

  for await (const payload of payloads) {
    let event: AnthropicEvent
    try {
      event = JSON.parse(payload) as AnthropicEvent
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }
    switch (event.type) {
      case 'message_start': {
        const usage = event.message?.usage
        if (usage !== undefined) {
          inputTokens = usage.input_tokens ?? 0
          outputTokens = usage.output_tokens ?? 0
          cacheRead = usage.cache_read_input_tokens
          cacheWrite = usage.cache_creation_input_tokens
          reasoningTokens = usage.output_tokens_details?.thinking_tokens
        }
        break
      }
      case 'content_block_start': {
        const contentBlock = event.content_block ?? {}
        const kind: OpenBlock['kind'] = contentBlock.type === 'tool_use'
          ? 'tool-call'
          : contentBlock.type === 'thinking' || contentBlock.type === 'redacted_thinking' ? 'reasoning' : 'text'
        const block = open(kind)
        if (kind === 'tool-call') {
          if (contentBlock.id !== undefined) block.callId = contentBlock.id
          if (contentBlock.name !== undefined) block.name = contentBlock.name
          // A tool call is announced before its arguments, so its block-start
          // is emitted here; text and thinking wait for their first delta.
          block.started = true
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        byWireIndex.set(event.index ?? 0, block)
        break
      }
      case 'content_block_delta': {
        const block = byWireIndex.get(event.index ?? 0)
        const delta = event.delta ?? {}
        if (block === undefined) break
        if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
          if (!block.started) {
            block.started = true
            yield { type: 'block-start', index: block.index, blockType: 'text' }
          }
          block.text += delta.text
          yield { type: 'text-delta', index: block.index, text: delta.text }
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking.length > 0) {
          if (!block.started) {
            block.started = true
            yield { type: 'block-start', index: block.index, blockType: 'reasoning' }
          }
          block.text += delta.thinking
          yield { type: 'reasoning-delta', index: block.index, text: delta.thinking }
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          block.text += delta.partial_json
          yield {
            type: 'tool-call-delta',
            index: block.index,
            id: CallId(block.callId ?? ''),
            ...block.name === undefined ? {} : { name: block.name },
            argumentsDelta: delta.partial_json,
          }
        }
        // signature_delta carries Anthropic's opaque thinking signature; it has
        // no harness block.
        break
      }
      case 'content_block_stop': {
        const wireIndex = event.index ?? 0
        const block = byWireIndex.get(wireIndex)
        if (block !== undefined && block.started && block.closed !== true) {
          block.closed = true
          yield { type: 'block-end', index: block.index, block: closeBlock(block) }
        }
        byWireIndex.delete(wireIndex)
        break
      }
      case 'message_delta': {
        if (event.delta?.stop_reason !== undefined) stopReason = event.delta.stop_reason
        const usage = event.usage
        if (usage !== undefined) {
          if (usage.input_tokens !== undefined) inputTokens = usage.input_tokens
          if (usage.output_tokens !== undefined) outputTokens = usage.output_tokens
          if (usage.cache_read_input_tokens !== undefined) cacheRead = usage.cache_read_input_tokens
          if (usage.cache_creation_input_tokens !== undefined) cacheWrite = usage.cache_creation_input_tokens
          if (usage.output_tokens_details?.thinking_tokens !== undefined) {
            reasoningTokens = usage.output_tokens_details.thinking_tokens
          }
        }
        break
      }
      case 'error':
        throw new LlmError(event.error?.message ?? 'OpenCode Go Anthropic stream error', 'PROVIDER_ERROR')
      case 'message_stop': {
        for (const block of order) {
          if (block.started !== true || block.closed === true) continue
          block.closed = true
          yield { type: 'block-end', index: block.index, block: closeBlock(block) }
        }
        yield {
          type: 'usage',
          usage: {
            inputTokens,
            outputTokens,
            ...cacheRead === undefined ? {} : { cacheReadTokens: cacheRead },
            ...cacheWrite === undefined ? {} : { cacheWriteTokens: cacheWrite },
            ...reasoningTokens === undefined ? {} : { reasoningTokens },
          },
        }
        const reason = mapAnthropicStopReason(stopReason)
        yield {
          type: 'finish',
          reason: reason.kind === 'stop' && !order.some(block => block.text.length > 0)
            ? {
              kind: 'error',
              failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
            }
            : reason,
        }
        return
      }
      default:
        // ping, and any future event this adapter does not consume.
        break
    }
  }
  // The caller's SSE framing guarantees message_stop (or throws); reaching
  // here means the payload source violated that contract.
  throw new LlmError('SSE payload stream ended without message_stop', 'STREAM_CLOSED')
}

/**
 * Consume an OpenAI Responses SSE stream and yield StreamChunks. Output items
 * are keyed by `output_index`: reasoning-summary and output-text deltas fill
 * text and reasoning blocks, `function_call` items fill tool-call blocks, and
 * `response.completed` / `response.incomplete` / `response.failed` terminate
 * with usage and finish.
 * @param payloads - SSE data payloads of the Responses stream.
 * @returns deltas as they arrive; usage and finish are deferred to the terminal event.
 */
export async function* translateResponses(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  const byOutputIndex = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  let nextIndex = 0
  const openAt = (outputIndex: number, kind: OpenBlock['kind']): OpenBlock => {
    let block = byOutputIndex.get(outputIndex)
    if (block === undefined) {
      block = { index: nextIndex++, kind, text: '', started: false }
      order.push(block)
      byOutputIndex.set(outputIndex, block)
    }
    return block
  }
  let usage: TokenUsage | undefined
  let sawToolCall = false

  for await (const payload of payloads) {
    let event: ResponsesEvent
    try {
      event = JSON.parse(payload) as ResponsesEvent
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }
    switch (event.type) {
      case 'response.output_item.added': {
        const item = event.item
        if (item?.type === 'function_call') {
          const block = openAt(event.output_index ?? 0, 'tool-call')
          const callId = item.call_id ?? item.id
          if (callId !== undefined) block.callId = callId
          if (item.name !== undefined) block.name = item.name
          if (block.started !== true) {
            block.started = true
            yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
          }
          sawToolCall = true
        }
        break
      }
      case 'response.reasoning_summary_text.delta': {
        if (typeof event.delta !== 'string' || event.delta.length === 0) break
        const block = openAt(event.output_index ?? 0, 'reasoning')
        if (block.started !== true) {
          block.started = true
          yield { type: 'block-start', index: block.index, blockType: 'reasoning' }
        }
        block.text += event.delta
        yield { type: 'reasoning-delta', index: block.index, text: event.delta }
        break
      }
      case 'response.output_text.delta': {
        if (typeof event.delta !== 'string' || event.delta.length === 0) break
        const block = openAt(event.output_index ?? 0, 'text')
        if (block.started !== true) {
          block.started = true
          yield { type: 'block-start', index: block.index, blockType: 'text' }
        }
        block.text += event.delta
        yield { type: 'text-delta', index: block.index, text: event.delta }
        break
      }
      case 'response.function_call_arguments.delta': {
        const block = openAt(event.output_index ?? 0, 'tool-call')
        if (block.callId === undefined && event.item_id !== undefined) block.callId = event.item_id
        if (block.started !== true) {
          block.started = true
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        sawToolCall = true
        if (typeof event.delta === 'string' && event.delta.length > 0) {
          block.text += event.delta
          yield {
            type: 'tool-call-delta',
            index: block.index,
            id: CallId(block.callId ?? ''),
            ...block.name === undefined ? {} : { name: block.name },
            argumentsDelta: event.delta,
          }
        }
        break
      }
      case 'response.function_call_arguments.done': {
        const block = byOutputIndex.get(event.output_index ?? 0)
        if (block !== undefined) {
          if (typeof event.arguments === 'string') block.text = event.arguments
          if (event.name !== undefined) block.name = event.name
        }
        break
      }
      case 'response.output_item.done': {
        const block = byOutputIndex.get(event.output_index ?? 0)
        if (block !== undefined) {
          if (event.item?.type === 'function_call') {
            if (event.item.name !== undefined) block.name = event.item.name
            if (typeof event.item.arguments === 'string') block.text = event.item.arguments
          }
          if (block.started === true && block.closed !== true) {
            block.closed = true
            yield { type: 'block-end', index: block.index, block: closeBlock(block) }
          }
        }
        break
      }
      case 'response.completed':
      case 'response.incomplete':
      case 'response.failed': {
        const response = event.response
        if (response?.usage != null) usage = mapResponsesUsage(response.usage)
        for (const block of order) {
          if (block.started !== true || block.closed === true) continue
          block.closed = true
          yield { type: 'block-end', index: block.index, block: closeBlock(block) }
        }
        if (event.type === 'response.failed' || response?.error != null) {
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: {
                message: response?.error?.message ?? 'model response failed',
                code: 'PROVIDER_ERROR',
              },
            },
          }
          return
        }
        if (usage !== undefined) yield { type: 'usage', usage }
        const incomplete = response?.incomplete_details?.reason
        let reason: FinishReason
        if (incomplete === 'max_output_tokens') reason = { kind: 'max-tokens' }
        else if (incomplete === 'content_filter') {
          reason = { kind: 'error', failure: { message: 'model stopped: content_filter', code: 'CONTENT_FILTER' } }
        } else if (sawToolCall) reason = { kind: 'tool-calls' }
        else if (!order.some(block => block.text.length > 0)) {
          reason = {
            kind: 'error',
            failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
          }
        } else reason = { kind: 'stop' }
        yield { type: 'finish', reason }
        return
      }
      default:
        // response.created / in_progress / content_part.* / *.done carry no
        // additional block state this adapter consumes.
        break
    }
  }
  throw new LlmError('SSE payload stream ended without response.completed', 'STREAM_CLOSED')
}
