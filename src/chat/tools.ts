/**
 * Chat-facing tool definitions (ADR-0007). Each tool mirrors a scanner from
 * the MCP surface but is executable directly in-process by the embedded chat
 * agent — no MCP wire round-trip. Tool logic delegates to the same
 * deterministic scanners used over MCP, so answers stay byte-identical.
 *
 * Design: every tool is a thin `savePath -> structured answer` wrapper. The
 * save file is re-read per call (ADR-0006 freshness model), matching how the
 * MCP server behaves. Input schemas are Zod v4 schemas handed straight to the
 * AI SDK's `tool()`, which serializes them for the provider.
 */

import { z } from "zod";
import { SaveFileReader } from "@/src/gen4/save/reader.ts";
import {
  decodePokemonRecord,
  findInPcBox,
  getBadges,
  getBag,
  getDexSummary,
  getPartyDetail,
  getPcBox,
  getStoryProgress,
  getTrainerCard,
  readRawRegion,
} from "@/src/gen4/save/scanners.ts";

export interface ChatToolContext {
  savePath?: string;
}

const NO_SAVE =
  "save file not configured: set PKHEX_SAVE_PATH to your Platinum .sav copy and restart";

type Executor<A> = (ctx: ChatToolContext, args: A) => Promise<unknown> | unknown;

/** Read the configured save fresh, then run `fn` against its reader. */
function withSave<A, R>(
  fn: (reader: SaveFileReader, args: A) => R,
): Executor<A> {
  return async (ctx, args): Promise<unknown> => {
    if (!ctx.savePath) {
      return { error: NO_SAVE };
    }
    try {
      const reader = SaveFileReader.fromBytes(
        await Deno.readFile(ctx.savePath),
      );
      return fn(reader, args);
    } catch (e) {
      return { error: String(e) };
    }
  };
}

export interface ChatTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute: Executor<any>;
}

const EMPTY = z.object({});

export const chatTools: ChatTool[] = [
  {
    name: "get_save_info",
    description:
      "Save-file identity and reader diagnostics: active partition, file size, and capability limits. Call this first to orient.",
    inputSchema: EMPTY,
    execute: withSave((r) => ({
      source: "save file",
      fileSizeBytes: r.fileSize,
      activePartition: r.slot,
      capabilities: { maxRawRegionBytes: 1024 },
    })),
  },
  {
    name: "read_raw_region",
    description:
      "Raw save-file bytes as base64 + spaced hex for exploration beyond the scanners. Slot-relative offset; HARD CAP 1024 bytes per call.",
    inputSchema: z.object({
      offset: z.number().int().min(0),
      length: z.number().int().min(1).max(1024),
    }),
    execute: withSave((r, args: { offset: number; length: number }) =>
      readRawRegion(r, args.offset, args.length)
    ),
  },
  {
    name: "decode_pokemon_record",
    description:
      "Decrypt + decode encrypted Pokemon records. Pass base64 strings of 236-byte party records or 136-byte PC box records. Returns species/moves/IVs/EVs/nature; torn records are flagged, never guessed.",
    inputSchema: z.object({
      recordsBase64: z.array(z.string()).min(1).max(60),
    }),
    execute: withSave((_r, args: { recordsBase64: string[] }) => ({
      decoded: args.recordsBase64.map((b64) => decodePokemonRecord(b64)),
    })),
  },
  {
    name: "decode_pc_box",
    description:
      "One PC storage box decoded slot-by-slot (1-based numbering, 1-18).",
    inputSchema: z.object({
      box: z.number().int().min(1).max(18).optional(),
    }),
    execute: withSave((r, args: { box?: number }) => getPcBox(r, args.box)),
  },
  {
    name: "get_bag",
    description:
      "All bag pouches with resolved item names and counts. Use for any item-count question.",
    inputSchema: EMPTY,
    execute: withSave((r) => getBag(r)),
  },
  {
    name: "get_trainer_card",
    description:
      "Trainer identity: player name, TID, SID, money, badge count, playtime. Answers 'who am I?' and 'how rich am I?'.",
    inputSchema: EMPTY,
    execute: withSave((r) => getTrainerCard(r)),
  },
  {
    name: "get_badges",
    description:
      "Badge case: count and list of earned gym badges with resolved names.",
    inputSchema: EMPTY,
    execute: withSave((r) => getBadges(r)),
  },
  {
    name: "get_dex_summary",
    description:
      "Pokédex seen/caught counts (species capped at 493). Answers 'how many species have I seen/caught?'",
    inputSchema: EMPTY,
    execute: withSave((r) => getDexSummary(r)),
  },
  {
    name: "get_party_detail",
    description:
      "Party audit: species, level, nature, IVs, EVs, and moves for each live party member. Torn records flagged, never guessed.",
    inputSchema: EMPTY,
    execute: withSave((r) => getPartyDetail(r)),
  },
  {
    name: "find_in_pc_box",
    description:
      "Search all 18 PC boxes for a species by national dex id or exact name.",
    inputSchema: z.object({
      query: z.union([z.string(), z.number()]),
    }),
    execute: withSave((r, args: { query: string | number }) =>
      findInPcBox(r, args.query)
    ),
  },
  {
    name: "get_story_progress",
    description:
      "Notable story/event flag states (Dialga captured, National Dex obtained, etc.).",
    inputSchema: z.object({
      indices: z.array(z.number().int()).optional(),
    }),
    execute: withSave((r, args: { indices?: number[] }) =>
      getStoryProgress(r, args.indices)
    ),
  },
];

/** Resolve a tool by name for execution in the agent loop. */
export function getChatTool(name: string): ChatTool | undefined {
  return chatTools.find((t) => t.name === name);
}
