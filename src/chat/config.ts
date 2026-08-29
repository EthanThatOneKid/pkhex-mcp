/**
 * Embedded-chat inference configuration (ADR-0007). The desktop app hosts no
 * model itself; inference comes from an OpenAI-compatible endpoint the user
 * points it at (OpenAI, LM Studio, a local foundry, OpenRouter, etc.) via the
 * AI SDK's OpenAI-compatible provider.
 *
 * Secrets live in the environment / central vault only — never in the repo.
 *
 * Env vars:
 *   PKHEX_LLM_API_KEY    API key for the endpoint (Bearer).
 *   PKHEX_LLM_BASE_URL   Base URL, e.g. https://api.openai.com/v1 (default).
 *   PKHEX_LLM_MODEL      Model id, e.g. gpt-4o-mini (default gpt-4o-mini).
 */

export interface ChatConfig {
  /** Resolved API key, or undefined when the chat is disabled. */
  apiKey?: string;
  baseUrl: string;
  model: string;
}

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-4o-mini";

export function readChatConfig(env: Record<string, string | undefined> = Deno.env.toObject()): ChatConfig {
  return {
    apiKey: env.PKHEX_LLM_API_KEY || undefined,
    baseUrl: env.PKHEX_LLM_BASE_URL || DEFAULT_BASE_URL,
    model: env.PKHEX_LLM_MODEL || DEFAULT_MODEL,
  };
}

/** True when the user has wired an endpoint key so the chat can run. */
export function chatEnabled(config: ChatConfig): boolean {
  return Boolean(config.apiKey);
}
