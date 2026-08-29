# BYO embedded chat via OpenAI-compatible inference

- **Status:** Accepted
- **Date:** 2026-08-28

The desktop app gains an **optional embedded chat panel** whose inference comes
from an **OpenAI-compatible endpoint** the user configures (OpenAI, LM Studio,
a local foundry, OpenRouter, etc.) via the AI SDK's OpenAI-compatible provider.
This supersedes the earlier anti-goal in CONTEXT.md:46-48 which explicitly
avoided embedded chat.

## Design principles

- **Server stays read-only.** Adding a chat convenience layer does not change
  the MCP tool/REST surface or relax the ADR-0006 raw-first contract.
- **In-process tool execution.** The chat agent calls the same deterministic
  scanner logic directly (no MCP wire round-trip) — byte-identical answers to
  the MCP tools, reusing unit-tested code.
- **Secrets stay out of the repo.** Configured via env: `PKHEX_LLM_API_KEY`,
  `PKHEX_LLM_BASE_URL` (default `https://api.openai.com/v1`),
  `PKHEX_LLM_MODEL` (default `gpt-4o-mini`).
- **Graceful degradation.** With no key set, the panel falls back to the
  current copy-MCP-snippet harness — the external-client path stays fully
  supported.

## Considered options

- **Local-model sidecar (LM Studio / Ollama)** — heavier; requires a capable
  machine. The OpenAI-compatible abstraction keeps both options open behind one
  code path, so a local endpoint works identically.
- **Raw fetch + manual tool loop** — rejected; the AI SDK gives
  tool-calling + streaming + provider variety for free and is the documented
  approach.

## Implementation shape

- `src/chat/config.ts` — env config + enabled flag.
- `src/chat/tools.ts` — shared chat tools mapping all scanners to AI-SDK
  `tool()`s, each a thin `savePath → answer` wrapper re-reading the save per
  call (ADR-0006 freshness).
- `src/chat/agent.ts` — `generateText`-driven agent loop over those tools.
- `src/app.ts` — `GET /chat/config` (never leaks the key) + `POST /chat`
  (loopback-gated by the existing host/origin middleware).
- `src/ui/` — collapsible chat panel; when disabled, shows the MCP snippet
  fallback.

## Consequences

- The `ai` and `@ai-sdk/openai-compatible` npm deps are added to `deno.json`.
  Consistent with the existing `nodeModulesDir: auto` setup.
- ADR-0006's raw-first surface is unchanged; the chat agent wraps it
  transparently.
- Users who don't want to hand the app a key can still use any external MCP
  client — nothing is removed.
