# Custom DeepSeek Harness build

This repository is a **standalone snapshot** of a customized DeepSeek Harness
tree. It is not a fork of `deepseek-ai/deepseek-harness` and shares no commit
history with it: the tree is published as a single squashed commit.

## What is customized

| Area | Change |
|---|---|
| `packages/llm/llm-opencode-go` | Sends the `x-opencode-session` header (harness session id, or a fresh UUID for a sessionless request). OpenCode Go rejects requests without it since 06/09 with `HTTP 400 MissingSessionID`. |
| `packages/llm/llm-opencode-go` | Default catalog is the 38 models the Go gateway actually advertises, each routed over its serving protocol — OpenAI-compatible chat completions, OpenAI Responses, or Anthropic Messages. Replaces the previous 73-entry Zen-derived list, which named models the Go subscription does not serve and sent every request over chat completions. |
| `packages/llm/llm-opencode-go`, `packages/llm/llm-deepseek` | Streaming tool calls keep the identity from their first frame; gateways that echo `null`/`""` placeholders on later argument fragments no longer erase `id`/`name`. |
| `packages/llm/llm` | `BlockAssembler` guards the tool-call id/name against empty delta and block-end values. |
| `packages/guard/observer`, `packages/workflow/tool-evolve` | Type fixes so the repository typecheck passes (`context/handoff` matched in the documented default branch; the unreachable failure guard reads `error` only). |

The Agent Notes recording these decisions ship in the tree under
`.agents/notes/implemented/`:

- `bug-fix/2026-08-27-empty-tool-call-stream-identity.md`
- `bug-fix/2026-09-07-x-opencode-session-required-header.md`
- `feature/2026-08-14-opencode-go-provider.md` (updated catalog facts)
- `feature/2026-10-10-opencode-go-multi-protocol-routing.md`

## Scope note

The Go gateway's free models (`longcat-2.5-preview-free`, `step-5-preview-free`)
are included. The separate OpenCode Zen endpoint's free lanes were verified
unreachable from third-party clients — `403 FreeTierError: OpenCode's free tier
can only be used from within OpenCode` — and are deliberately not listed.

## Excluded from this snapshot

`node_modules/`, build outputs (`lib/`, `dist/`, `.dist/`, `*.tsbuildinfo`),
archives, local session dumps, and scratch directories. Restore a working tree
with:

```sh
pnpm install
pnpm run build
```

## Upstream and license

The tree derives from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness),
Copyright (c) 2026 DeepSeek, released under the MIT License (see `LICENSE`).
Upstream documentation, package READMEs, and vendored sources retain their own
notices (see `THIRD_PARTY_NOTICES.md` and `vendor/README.md`).
