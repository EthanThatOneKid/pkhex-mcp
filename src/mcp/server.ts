/**
 * The pkhex-mcp MCP surface. Two families:
 * 1. Save-file context layer (v0.2, ADR-0003): scanner tools over the wired
 *    BizHawk SaveRAM copy + raw section map. Every call re-reads the file so
 *    answers track the player's latest in-game save.
 * 2. Live state pipeline (v0.1, unchanged): tools speak the frozen contract
 *    verbatim; data tools hard-error only before the first-ever Sync (spec
 *    section 8); get_sync_status always answers.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GameState, SyncHealth } from "../gen4/schemas.ts";
import type { GameStateStore } from "../state/game-state.ts";
import { SPECIES } from "../gen4/data/species.ts";
import { SaveFileReader } from "../gen4/save/reader.ts";
import {
  findInPcBox,
  getBadges,
  getBag,
  getDexSummary,
  getPartyAudit,
  getPcBox,
  getStoryFlags,
  getTrainerCard,
  isSpeciesCaught,
  resolveSpeciesId,
} from "../gen4/save/scanners.ts";
import { getSectionMap } from "../gen4/save/section-map.ts";

export interface McpServerOptions {
  /** Absolute or repo-relative path to the wired BizHawk SaveRAM copy. */
  savePath?: string;
}

function text(payload: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: payload }],
    ...(isError ? { isError: true } : {}),
  };
}

function syncStatus(gs: GameState | null): {
  state: SyncHealth["state"];
  ageMs: number | null;
  receivedAt: string | null;
} {
  if (gs === null) {
    return { state: "disconnected", ageMs: null, receivedAt: null };
  }
  return {
    state: gs.sync.state,
    ageMs: gs.sync.ageMs,
    receivedAt: gs.receivedAt,
  };
}

const NO_SYNC = "no Sync received yet";

function requireGame(gs: GameState | null): GameState {
  if (gs === null) throw new Error(NO_SYNC);
  return gs;
}

export function createMcpServer(
  store: GameStateStore,
  options: McpServerOptions = {},
): McpServer {
  const server = new McpServer({ name: "pkhex-mcp", version: "0.1.0" });

  // ---- save-file context layer (ADR-0003) ----
  const NO_SAVE =
    "save file not configured: set PKHEX_SAVE_PATH to your BizHawk SaveRAM copy (Tools\\BizHawk\\NDS\\SaveRAM\\*.SaveRAM) and restart";
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

  server.tool(
    "get_section_map",
    "Machine-readable map of save-file regions the scanners navigate by, with confidence tags.",
    {},
    withSave((r) => ({ slot: r.slot, sections: getSectionMap() })),
  );

  server.tool(
    "get_trainer_card",
    "Trainer identity from the save file: name, TID/SID, money, badge count, playtime.",
    {},
    withSave((r) => getTrainerCard(r)),
  );

  server.tool(
    "get_badges",
    "Gym badge case from the save file: earned badges by gym order.",
    {},
    withSave((r) => getBadges(r)),
  );

  server.tool(
    "get_bag",
    "Overworld bag from the save file, grouped by pouch with item names and quantities.",
    {},
    withSave((r) => getBag(r)),
  );

  server.tool(
    "get_dex_summary",
    "Pokedex seen/caught counts from the save file (terminator-masked).",
    {},
    withSave((r) => getDexSummary(r)),
  );

  server.tool(
    "is_species_caught",
    "Whether a species is marked CAUGHT in the Pokedex. Pass a national dex id or an exact species name.",
    { species: z.union([z.string(), z.number()]) },
    withSave((r, args: { species: string | number }) => {
      const id = resolveSpeciesId(args.species);
      if (id === null) return { error: `unknown species: ${args.species}` };
      return {
        species: SPECIES[id].name,
        nationalDexId: id,
        caught: isSpeciesCaught(r, id),
      };
    }),
  );

  server.tool(
    "get_pc_box",
    "One PC storage box from the save file: 30 slots decoded to species (null when empty). Defaults to the currently-viewed box.",
    { box: z.number().int().min(0).max(17).optional() },
    withSave((r, args: { box?: number }) => getPcBox(r, args.box)),
  );

  server.tool(
    "find_in_pc_box",
    "Search every PC box for a species. Pass a national dex id or an exact species name; returns box/slot hits.",
    { species: z.union([z.string(), z.number()]) },
    withSave((r, args: { species: string | number }) => {
      const id = resolveSpeciesId(args.species);
      if (id === null) return { error: `unknown species: ${args.species}` };
      return {
        species: SPECIES[id].name,
        nationalDexId: id,
        hits: findInPcBox(r, id),
      };
    }),
  );

  server.tool(
    "get_story_flags",
    "Notable story-progress event flags from the save file (legendaries captured, Hall of Fame, Bebe's PC...). Pass explicit flag indices to read arbitrary bits.",
    { flags: z.array(z.number().int().min(0)).optional() },
    withSave((r, args: { flags?: number[] }) => getStoryFlags(r, args.flags)),
  );

  server.tool(
    "get_party_audit",
    "Raw party audit from the save file: per member, IVs, EVs, nature, level, species and move ids — beyond what live sync exposes.",
    {},
    withSave((r) => getPartyAudit(r)),
  );

  // ---- live state pipeline (v0.1, unchanged) ----

  server.tool(
    "get_party",
    "The player's Party: six slots of decoded Party Members (null when empty).",
    {},
    () => {
      return text(JSON.stringify(requireGame(store.getGameState()).slots));
    },
  );

  server.tool(
    "get_game_state",
    "Full Live State: Trainer Meta, Sync health, and the whole Party.",
    {},
    () => {
      return text(JSON.stringify(requireGame(store.getGameState())));
    },
  );

  server.tool(
    "get_sync_status",
    "Sync health verdict: live/stale/disconnected plus Snapshot age.",
    {},
    () => text(JSON.stringify(syncStatus(store.getGameState()))),
  );

  server.tool(
    "get_pokemon_by_slot",
    "One Party Member by slot number (1..6); null when the slot is empty.",
    { slot: z.number().int().min(1).max(6) },
    ({ slot }: { slot: number }) => {
      const gs = requireGame(store.getGameState());
      return text(JSON.stringify(gs.slots[slot - 1] ?? null));
    },
  );

  server.tool(
    "find_party_member_by_species",
    "First Party Member matching a species id or display name; null when absent.",
    { nameOrId: z.union([z.string(), z.number()]) },
    ({ nameOrId }: { nameOrId: string | number }) => {
      const gs = requireGame(store.getGameState());
      const wanted = typeof nameOrId === "number"
        ? nameOrId
        : nameOrId.trim().toLowerCase();
      const member = gs.slots.find((m) =>
        m !== null &&
        (typeof wanted === "number"
          ? m.speciesId === wanted
          : m.speciesName.toLowerCase() === wanted)
      );
      return text(JSON.stringify(member ?? null));
    },
  );

  return server;
}
