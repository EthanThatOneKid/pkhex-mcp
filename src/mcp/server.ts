/**
 * The pkhex-mcp MCP surface — raw-first (ADR-0006): read_raw_region is the
 * exploration primitive, decode_pokemon_record handles the encrypted
 * records, get_save_info orients. Reference resources carry the lookup
 * tables and the field guide that teaches this workflow.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SaveFileReader } from "../gen4/save/reader.ts";
import {
  decodePokemonRecord,
  getPcBox,
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

  // Raw-first surface (ADR-0006): three tools. The v0.2 scanners were
  // removed without deprecation — interpretation now happens in the model,
  // guided by the reference resources and the field guide.

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
    "Save-file identity and reader diagnostics: active partition choice (with reason/warnings), file size, and capability limits.",
    {},
    withSave((r) => ({
      source: "save file",
      fileSizeBytes: r.fileSize,
      activePartition: r.slot,
      capabilities: { maxRawRegionBytes: 1024 },
    })),
  );

  server.tool(
    "decode_pc_box",
    "One PC storage box decoded slot-by-slot (species per 136-byte record). Box numbers are 1-based like the game UI; defaults to the currently-viewed box.",
    { box: z.number().int().min(1).max(18).optional() },
    withSave((r, args: { box?: number }) => getPcBox(r, args.box)),
  );

  return server;
}
