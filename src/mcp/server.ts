/**
 * The pkhex-mcp MCP surface — raw-first (ADR-0006): read_raw_region is the
 * exploration primitive, decode_pokemon_record handles the encrypted
 * records, get_save_info orients. Scanner tools wrap the deterministic
 * helpers for common queries. Reference resources carry the lookup
 * tables and the field guide that teaches this workflow.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SaveFileReader } from "../gen4/save/reader.ts";
import {
  decodePokemonRecord,
  findInPcBox,
  getBadges,
  getBag,
  getDexSummary,
  getPartyAudit,
  getPcBox,
  getStoryFlags,
  getTrainerCard,
  readRawRegion,
} from "../gen4/save/scanners.ts";
import { registerReferenceResources } from "./resources.ts";

export interface McpServerOptions {
  /** Path to the player's Platinum .sav copy. */
  savePath?: string;
}

function text(payload: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: payload }],
    ...(isError ? { isError: true } : {}),
  };
}

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const server = new McpServer({ name: "pkhex-mcp", version: "0.1.0" });
  registerReferenceResources(server);

  // ---- save-file context layer (ADR-0003) ----
  const NO_SAVE =
    "save file not configured: set PKHEX_SAVE_PATH to your BizHawk SaveRAM copy (Tools\BizHawk\NDS\SaveRAM\*.SaveRAM) and restart";
  const withSave = <A>(
    fn: (reader: SaveFileReader, args: A) => unknown,
  ) =>
  async (args: A) => {
    if (!options.savePath) {
      return text(JSON.stringify({ error: NO_SAVE }), true);
    }
    try {
      const reader = SaveFileReader.fromBytes(
        await Deno.readFile(options.savePath),
      );
      return text(JSON.stringify(fn(reader, args)));
    } catch (e) {
      return text(JSON.stringify({ error: String(e) }), true);
    }
  };

  // ---- raw-first primitives (ADR-0006) ----

  server.tool(
    "read_raw_region",
    "Raw save-file bytes as base64 + spaced hex for exploration beyond the scanners. Slot-relative offset; HARD CAP 1024 bytes per call — larger requests are rejected, paginate instead.",
    {
      offset: z.number().int().min(0),
      length: z.number().int().min(1).max(1024),
    },
    withSave((r, args: { offset: number; length: number }) =>
      readRawRegion(r, args.offset, args.length)
    ),
  );

  server.tool(
    "decode_pokemon_record",
    "Decrypt + decode encrypted Pokemon records. Pass base64 strings of 236-byte party records or 136-byte PC box records (obtain via read_raw_region: party at 0xA0+slot*236; box slots are 136 B stride). Returns species/moves/IVs/EVs/nature per record; torn records are flagged, never guessed.",
    { recordsBase64: z.array(z.string()).min(1).max(60) },
    withSave((_r, args: { recordsBase64: string[] }) => ({
      decoded: args.recordsBase64.map((b64) => decodePokemonRecord(b64)),
    })),
  );

  server.tool(
    "get_save_info",
    "Save-file identity and reader diagnostics: active partition choice (with reason/warnings), file size, and capability limits. Read the field-guide resource next for navigation landmarks and recipes.",
    {},
    withSave((r) => ({
      source: "save file",
      fileSizeBytes: r.fileSize,
      activePartition: r.slot,
      capabilities: { maxRawRegionBytes: 1024 },
      resources: [
        {
          uri: "pkhex://reference/field-guide",
          purpose: "Navigation landmarks, recipes, gotchas",
        },
        { uri: "pkhex://reference/items", purpose: "Item id -> name lookup" },
        {
          uri: "pkhex://reference/species",
          purpose: "Species id -> name + types",
        },
        {
          uri: "pkhex://reference/moves",
          purpose: "Move id -> name + base PP",
        },
        { uri: "pkhex://reference/abilities", purpose: "Ability id -> name" },
        { uri: "pkhex://reference/natures", purpose: "Nature index -> name" },
        { uri: "pkhex://reference/story-flags", purpose: "Event flag names" },
        {
          uri: "pkhex://reference/offset-map",
          purpose: "Full offset map with citations",
        },
      ],
    })),
  );

  server.tool(
    "decode_pc_box",
    "One PC storage box decoded slot-by-slot (species per 136-byte record). Box numbers are 1-based like the game UI; defaults to the currently-viewed box.",
    { box: z.number().int().min(1).max(18).optional() },
    withSave((r, args: { box?: number }) => getPcBox(r, args.box)),
  );

  // ---- scanner tools ----

  server.tool(
    "get_bag",
    "All bag pouches with resolved item names. Returns every non-empty [u16 id][u16 count] slot per pouch (Items, Medicine, Poké Balls, TMs, Mail, Berries, Key Items, Battle Items). Use this for any item-count question instead of manually parsing raw bytes.",
    {},
    withSave((r) => getBag(r)),
  );

  server.tool(
    "get_trainer_card",
    "Trainer identity: player name, TID, SID, money, badge count, and playtime. Answers 'who am I?' and 'how rich am I?' in one call.",
    {},
    withSave((r) => getTrainerCard(r)),
  );

  server.tool(
    "get_badges",
    "Badge case: count and list of earned gym badges with resolved names. Answers 'which badges do I have?' in one call.",
    {},
    withSave((r) => getBadges(r)),
  );

  server.tool(
    "get_dex_summary",
    "Pokédex seen/caught counts (species capped at 493, flash-fill 0xFF masked). Answers 'how many species have I seen/caught?' in one call.",
    {},
    withSave((r) => getDexSummary(r)),
  );

  server.tool(
    "get_party_audit",
    "Party audit: species, level, nature, IVs, EVs, and moves for each live party member (gated on party count). Torn records (checksum failure) are flagged, never guessed.",
    {},
    withSave((r) => getPartyAudit(r)),
  );

  server.tool(
    "find_in_pc_box",
    "Search all 18 PC boxes for a species by national dex id or exact name. Returns box number, slot, and species for every match.",
    { query: z.union([z.string(), z.number()]) },
    withSave((r, args: { query: string | number }) =>
      findInPcBox(r, args.query)
    ),
  );

  server.tool(
    "get_story_flags",
    "Notable story/event flag states (Dialga captured, National Dex obtained, etc.). Pass specific flag indices to check, or omit for the curated notable-flags list.",
    { indices: z.array(z.number().int()).optional() },
    withSave((r, args: { indices?: number[] }) =>
      getStoryFlags(r, args.indices)
    ),
  );

  return server;
}
