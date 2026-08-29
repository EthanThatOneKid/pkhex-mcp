/**
 * Embedded-chat agent (ADR-0007). Wraps the AI SDK's OpenAI-compatible
 * provider and drives the shared chat tools (src/chat/tools.ts) so the model
 * can answer open-ended questions about the save by calling the same
 * deterministic scanners the MCP server uses.
 *
 * The AI SDK's `generateText` runs the tool-calling loop for us: it presents
 * the tools, executes requested tool calls in-process, feeds results back,
 * and stops when the model produces a final text answer.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, stepCountIs, streamText, tool } from "ai";
import type { ChatConfig } from "./config.ts";
import { chatTools, type ChatToolContext } from "./tools.ts";

export interface AgentOptions {
  config: ChatConfig;
  context: ChatToolContext;
}

export interface ChatResult {
  text: string;
  /** Number of tool calls the model made (diagnostics). */
  toolCalls: number;
  steps: number;
}

const SYSTEM_PROMPT = `You are a Pokémon Platinum (Gen IV) save-file assistant. \
You help the player by reading their save file through the provided tools.

Strategy:
1. Prefer the scanner tools (get_badges, get_bag, get_dex_summary,
   decode_pc_box, get_trainer_card, get_story_progress, get_party_detail,
   find_in_pc_box) — they cost hundreds of tokens instead of thousands.
2. For anything no scanner covers, use read_raw_region and, if it is an
   encrypted Pokémon record, feed it to decode_pokemon_record.
3. Box numbers are 1-based like the game UI.

Use tools when the question needs save data. Answer concisely and directly.`;

/**
 * Run one user message through the agent, returning the final text answer.
 * Throws only on hard transport/configuration failures; tool errors are
 * surfaced back to the model so it can recover.
 */
export async function runAgent(
  { config, context }: AgentOptions,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<ChatResult> {
  if (!config.apiKey) {
    throw new Error(
      "Embedded chat is not configured: set PKHEX_LLM_API_KEY (and optionally PKHEX_LLM_BASE_URL / PKHEX_LLM_MODEL) and restart.",
    );
  }

  const provider = createOpenAICompatible({
    name: "pkhex",
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });

  const toolSet = Object.fromEntries(
    chatTools.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: t.inputSchema,
        execute: async (args: unknown) => t.execute(context, args),
      }),
    ]),
  );

  const result = await generateText({
    model: provider(config.model),
    system: SYSTEM_PROMPT,
    messages,
    tools: toolSet,
    stopWhen: [stepCountIs(12)],
  });

  const toolCalls = result.steps.reduce(
    (acc, step) => acc + (step.toolCalls?.length ?? 0),
    0,
  );

  return {
    text: result.text,
    toolCalls,
    steps: result.steps.length,
  };
}

// ---- SSE streaming variant (POST /chat/stream) --------------------------

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function buildProvider(config: ChatConfig) {
  return createOpenAICompatible({
    name: "pkhex",
    apiKey: config.apiKey!,
    baseURL: config.baseUrl,
  });
}

function buildToolSet(context: ChatToolContext) {
  return Object.fromEntries(
    chatTools.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: t.inputSchema,
        execute: async (args: unknown) => t.execute(context, args),
      }),
    ]),
  );
}

/**
 * Stream one user message through the agent, returning an SSE
 * ReadableStream. Events emitted:
 *   text       — incremental text delta
 *   tool-call  — model requested a tool invocation (name + args JSON)
 *   tool-result — tool execution result summary
 *   done       — final event with toolCalls and steps counts
 *   error      — transport or config failure
 */
export function streamAgent(
  { config, context }: AgentOptions,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): ReadableStream<Uint8Array> {
  if (!config.apiKey) {
    const body = sse(
      "error",
      "Embedded chat is not configured. Set PKHEX_LLM_API_KEY.",
    );
    return new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode(body));
        ctrl.close();
      },
    });
  }

  const encoder = new TextEncoder();
  let toolCallCount = 0;

  return new ReadableStream({
    async start(ctrl) {
      try {
        const result = streamText({
          model: buildProvider(config)(config.model),
          system: SYSTEM_PROMPT,
          messages,
          tools: buildToolSet(context),
          stopWhen: [stepCountIs(12)],
        });

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "text-delta":
              ctrl.enqueue(encoder.encode(sse("text", part.text)));
              break;
            case "tool-call": {
              toolCallCount++;
              ctrl.enqueue(
                encoder.encode(
                  sse("tool-call", {
                    toolName: part.toolName,
                    args: part.input,
                  }),
                ),
              );
              break;
            }
            case "tool-result":
              ctrl.enqueue(
                encoder.encode(
                  sse("tool-result", {
                    toolName: part.toolName,
                    result: typeof part.output === "string"
                      ? part.output.slice(0, 200)
                      : "[object]",
                  }),
                ),
              );
              break;
            // step-finish, finish, etc. — ignored for SSE
          }
        }

        const steps = (await result.steps).length;
        ctrl.enqueue(
          encoder.encode(sse("done", { toolCalls: toolCallCount, steps })),
        );
        ctrl.close();
      } catch (e) {
        ctrl.enqueue(encoder.encode(sse("error", String(e))));
        ctrl.close();
      }
    },
  });
}
