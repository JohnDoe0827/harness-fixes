/**
 * Default advisory catalog for the OpenCode Go route. Every id is one the
 * subscription's `GET /v1/models` currently advertises, verified live against
 * the gateway, and each entry names the wire protocol the gateway serves that
 * model on (the subscription documents `/chat/completions`, `/responses`, and
 * `/messages`; see https://opencode.ai/v2/docs/console/go). The catalog is
 * advisory for discovery only: an uncatalogued id still streams, over the
 * default `chat-completions` protocol, so the harness never turns absence from
 * the list into a request rejection.
 *
 * Context capacities are deliberately absent: the gateway publishes no
 * per-model window, so every entry resolves through the profile's
 * `defaultContextWindow` unless a deployment overrides the catalog.
 *
 * @module dsh-llm-opencode-go/catalog
 */

import type { OpenCodeGoCatalogModel } from './adapter.ts'

/**
 * Every protocol the gateway serves, most-reached first. Exposed for the
 * config schema's `protocol` union and for surfaces that enumerate the set.
 */
export const OPENCODE_GO_PROTOCOLS = ['chat-completions', 'responses', 'anthropic-messages'] as const

/**
 * The default advisory catalog: the 38 models the Go gateway advertises, each
 * paired with its serving protocol.
 */
export const DEFAULT_MODELS: OpenCodeGoCatalogModel[] = [
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', protocol: 'anthropic-messages' },
  { id: 'deepseek-flash', name: 'DeepSeek Flash' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision Exp' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
  { id: 'glm-5.1', name: 'GLM-5.1' },
  { id: 'glm-5.2', name: 'GLM-5.2' },
  { id: 'glm-5.3', name: 'GLM-5.3' },
  { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', protocol: 'responses' },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', protocol: 'responses' },
  { id: 'grok-4.6', name: 'Grok 4.6', protocol: 'responses' },
  { id: 'grok-4.7', name: 'Grok 4.7', protocol: 'responses' },
  { id: 'hy3', name: 'Hy3' },
  { id: 'hy4-preview', name: 'Hy4 Preview' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6' },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code' },
  { id: 'kimi-k3', name: 'Kimi K3' },
  { id: 'longcat-2.0', name: 'LongCat-2.0' },
  { id: 'longcat-2.5-preview-free', name: 'LongCat 2.5 Preview Free' },
  { id: 'mimo-v2.5', name: 'MiMo-V2.5' },
  { id: 'mimo-v2.5-pro', name: 'MiMo-V2.5-Pro' },
  { id: 'mimo-v2.6-flash', name: 'MiMo-V2.6-Flash' },
  { id: 'mimo-v2.6-pro', name: 'MiMo-V2.6-Pro' },
  { id: 'minimax-m2.5', name: 'MiniMax M2.5' },
  { id: 'minimax-m2.7', name: 'MiniMax M2.7', protocol: 'anthropic-messages' },
  { id: 'minimax-m3', name: 'MiniMax M3', protocol: 'anthropic-messages' },
  { id: 'muse-spark-1.2-contributor', name: 'Muse Spark 1.2 Contributor', protocol: 'responses' },
  { id: 'muse-spark-1.3-contributor', name: 'Muse Spark 1.3 Contributor', protocol: 'responses' },
  { id: 'omen-alpha', name: 'Omen Alpha' },
  { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus' },
  { id: 'qwen3.7-max', name: 'Qwen3.7 Max' },
  { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', protocol: 'anthropic-messages' },
  { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', protocol: 'anthropic-messages' },
  { id: 'qwen3.8-max', name: 'Qwen3.8 Max', protocol: 'anthropic-messages' },
  { id: 'space-bunny', name: 'Space Bunny' },
  { id: 'step-5-preview-free', name: 'Step 5 Preview Free' },
]
