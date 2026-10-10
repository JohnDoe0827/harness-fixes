# @deepseek-ai/dsh-llm-opencode-go

[English](README.md) | 中文

DeepSeek Harness LLM 接缝的 OpenCode Go（OpenCode Zen Go 订阅）provider 适配器：在 `ctx.llm` 上注册 `opencode-go` provider 路由，指向 `https://opencode.ai/zen/go/v1` 的订阅端点，并按目录条目声明的 wire 协议（OpenAI 兼容 chat completions、OpenAI Responses 或 Anthropic Messages）流式调用每个模型。会话可以在与 DeepSeek 及其他已注册 provider 相同的选择器里把默认模型切换到 `opencode-go/*` 模型。

## 组合方式

插件注册一个 provider 路由（`opencode-go`，显示名 "OpenCode Go"）和一个可配置 provider 条目，因此 Web 的 Models 页面可以写入 API key 和每 provider 设置。连接事实按请求解析：`llm-opencode-go:` 用户设置段（`$DSH_HOME/settings.yaml`）覆盖在 `cordis.yml` 条目配置之上，API key 通过凭据接缝从 `OPENCODE_GO_API_KEY` 引用解析（默认；`apiKeyEnv` 可改名）。编辑 base URL、目录或 key 后无需重启即到达下一次请求；端点还会从可信环境层回退到 `$OPENCODE_GO_BASE_URL`。

适配器的请求始终直连，且走 HTTP/2 优先的传输：got 自动协商 HTTP/2 并在不可用时回退 HTTP/1.1（与 OpenCode 客户端相同的传输形态），且从不读取环境代理，因此 OpenCode Go 流量始终从机器的真实来源离开。端点的区域门控——中国托管的 deepseek opt-in——以请求来源判定，代理出口的境外 IP 会静默翻转该状态，所以本路由刻意豁免宿主配置的任何代理。其他 provider 与 harness 自身的 web 工具保持各自的环境传输。

适配器仅文本（图片块返回 `UNSUPPORTED_CONTENT`），且不声明推理档阶梯：三种 wire 协议都没有订阅方文档化的稳定 effort 词汇，因此显式 `reasoningEffort` 会以 `UNSUPPORTED_REASONING_EFFORT` 响亮失败，而不是被静默丢弃。咨询模型目录默认是 Go 网关公布的全部 38 个模型，每个模型都标注其 serving 协议（见本 README 的"目录"一节），可通过 `models` 覆盖。

## 模型体验

### 请求路由

#### 模型看到什么

除普通请求外别无其他：适配器把 harness 会话序列化为其目录条目声明的协议——chat-completions 消息、Responses `input` 条目或 Anthropic 内容块——并把响应以文本、推理和工具调用块流式返回。`opencode-go` provider 与模型来自会话记录的路径。

#### Token 影响

零直接 token；请求即会话本身。端点报告的用量映射为 harness token 计数：chat completions 与 Responses 把缓存命中并入输入计数，因此适配器会将其减去；Messages 则分别报告缓存读与缓存写。

#### KV Cache 影响

按会话由 provider 键控：OpenCode Go 要求每个请求都携带 `x-opencode-session` 头，并在其携带的稳定 id 下复用提示缓存状态，因此适配器发送会话的 session id（手工构建的请求没有时会发送一个新 UUID），同一会话的重复请求可受益于 provider 的缓存。`llm-opencode-go:` 设置编辑只在改变端点或模型时改变请求前缀。

## 目录

默认咨询目录是 Go 网关当前公布的 38 个模型，每个模型都标注订阅方为其分配的协议：26 个走 chat completions，6 个走 Anthropic Messages（`claude-haiku-5-5`、`minimax-m2.7`、`minimax-m3`、`qwen3.7-plus`、`qwen3.8-flash`、`qwen3.8-max`），6 个走 OpenAI Responses（`grok-4.6`、`grok-4.7`、`gpt-5.6-luna`、`gpt-6-luna`、`muse-spark-1.2-contributor`、`muse-spark-1.3-contributor`）。每一项都使用相同的 1,000,000 token `defaultContextWindow`；网关不公布逐模型容量或输出上限。请求不受限制：不在目录中的 id 仍可流式调用，走 chat completions。Anthropic Messages 要求 `max_tokens`，因此未指定时使用配置的 `maxTokens` 或适配器默认值（8,192）。各模型的参考价格（每百万 token，美元）由订阅方公开的价格表承载，不在此目录中——harness 计 token，不计货币。

## 已知限制与待办

- **区域受限模型** — 网关对 `gpt-5.6-luna`、`gpt-6-luna`、`muse-spark-1.2/1.3-contributor` 从不支持的国家返回 403；API key 无法改变这一点，适配器把 provider 的消息作为 `AUTH` 失败上报，而不是隐藏该模型。
- **始终直连** — 请求绕过宿主配置的任何代理；只能通过代理到达 opencode.ai 的部署无法按现状使用本适配器。
- **无推理阶梯** — `reasoningEffort` 请求响亮失败，而不是映射到未文档化的 wire 词汇。
- **仅文本** — 拒绝图片内容；表面上的多模态模型不提供服务。
- **共享适配器管线** — fetch/SSE 传输与 provider 注册形态与 `dsh-llm-deepseek` 同构；抽取共享的 OpenAI 兼容适配器层留待后续。
