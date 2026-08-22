import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GameState, SyncHealth } from "../gen4/schemas.ts";
import type { GameStateStore } from "../state/game-state.ts";

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
  if (gs === null) return { state: "disconnected", ageMs: null, receivedAt: null };
  return { state: gs.sync.state, ageMs: gs.sync.ageMs, receivedAt: gs.receivedAt };
}

/**
 * The pkhex-mcp MCP surface: tools speak the frozen contract verbatim.
 * Data tools hard-error only before the first-ever Sync (spec section 8);
 * get_sync_status always answers.
 */
export function createMcpServer(store: GameStateStore): McpServer {
  const server = new McpServer({ name: "pkhex-mcp", version: "0.1.0" });

  server.tool(
    "get_party",
    "The player's Party: six slots of decoded Party Members (null when empty).",
    {},
    async () => {
      const gs = store.getGameState();
      if (gs === null) return text("no Sync received yet", true);
      return text(JSON.stringify(gs.slots));
    },
  );

  server.tool(
    "get_game_state",
    "Full Live State: trainer meta, sync health, and the whole Party.",
    {},
    async () => {
      const gs = store.getGameState();
      if (gs === null) return text("no Sync received yet", true);
      return text(JSON.stringify(gs));
    },
  );

  server.tool(
    "get_sync_status",
    "Sync health verdict: live/stale/disconnected plus Snapshot age.",
    {},
    async () => text(JSON.stringify(syncStatus(store.getGameState()))),
  );

  server.tool(
    "get_pokemon_by_slot",
    "One Party Member by slot number (1..6); null when the slot is empty.",
    { slot: z.number().int().min(1).max(6) },
    async ({ slot }: { slot: number }) => {
      const gs = store.getGameState();
      if (gs === null) return text("no Sync received yet", true);
      return text(JSON.stringify(gs.slots[slot - 1] ?? null));
    },
  );

  server.tool(
    "find_party_member_by_species",
    "First Party Member matching a species id or display name; null when absent.",
    { nameOrId: z.union([z.string(), z.number()]) },
    async ({ nameOrId }: { nameOrId: string | number }) => {
      const gs = store.getGameState();
      if (gs === null) return text("no Sync received yet", true);
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
