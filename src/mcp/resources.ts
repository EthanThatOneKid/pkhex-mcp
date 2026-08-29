/**
 * Reference resources (ADR-0003): pinnable lookup tables and guidance the
 * LLM keeps in context while navigating the save file. URIs follow the
 * pkhex://reference/<name> scheme; content is compact markdown so a client
 * can pin the whole set without blowing the context budget.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ABILITIES } from "../gen4/data/abilities.ts";
import { ITEMS } from "../gen4/data/items.ts";
import { MOVES } from "../gen4/data/moves.ts";
import { NATURES } from "../gen4/data/natures.ts";
import { SPECIES } from "../gen4/data/species.ts";

const MIME = "text/markdown";

type ReadResult = {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
};

function contents(uri: string, text: string): ReadResult {
  return { contents: [{ uri, mimeType: MIME, text }] };
}

function renderSpecies(): string {
  const lines = ["# Species reference", "", "natDexId\tname\ttypes", ""];
  for (const [id, s] of Object.entries(SPECIES)) {
    lines.push(`${id}\t${s.name}\t${s.types.join("/")}`);
  }
  return lines.join("\n");
}

function renderMoves(): string {
  const lines = ["# Moves reference", "", "moveId\tname\tbasePP", ""];
  for (const [id, m] of Object.entries(MOVES)) {
    lines.push(`${id}\t${m.name}\t${m.basePP}`);
  }
  return lines.join("\n");
}

function renderItems(): string {
  const lines = [
    "# Items reference (Gen IV game_index)",
    "",
    "itemId\tname",
    "",
  ];
  for (const [id, name] of Object.entries(ITEMS)) {
    lines.push(`${id}\t${name}`);
  }
  return lines.join("\n");
}

function renderAbilities(): string {
  const lines = ["# Abilities reference", "", "abilityId\tname", ""];
  for (const [id, name] of Object.entries(ABILITIES)) {
    lines.push(`${id}\t${name}`);
  }
  return lines.join("\n");
}

function renderNatures(): string {
  const lines = [
    "# Natures reference",
    "",
    "nature = PID % 25 -> name. Stat effects are presentation-only here.",
    "",
    "natureIndex\tname",
    "",
  ];
  for (const [id, name] of Object.entries(NATURES)) {
    lines.push(`${id}\t${name}`);
  }
  return lines.join("\n");
}

function renderFieldGuide(): string {
  return `# pkhex-mcp field guide

How to answer open-ended questions about the player's Platinum save efficiently.

## Strategy

1. **Scanner first.** Prefer the scanner tools (\`get_badges\`, \`get_bag\`,
   \`get_dex_summary\`, \`decode_pc_box\`, \`get_trainer_card\`, \`get_story_progress\`,
   \`get_party_detail\`, \`get_pc_inventory\`, \`find_item\`) — they cost hundreds
   of tokens instead of thousands.
2. **Raw reads second.** For anything no scanner covers, use
   \`read_raw_region(offset, length)\`: slot-relative offset, base64 result,
   hard cap **1024 bytes** per call. Larger requests are REJECTED — paginate
   with consecutive windows. Use the optional \`region\` param (\"party\",
   \"trainer\", \"bag\", \"pc-box-1\"..\"pc-box-18\") to resolve named regions
   server-side instead of doing offset math.
3. **Reference third.** Resolve ids to names via these resources rather than
   guessing: species/moves/items/abilities/natures.

## Coordinate system

All offsets passed to \`read_raw_region\` are **partition-relative within the
active slot**: partition 1 starts at file offset 0x40000 in a 512 KB .sav;
the reader auto-selects the active half by General-block footer counters
(\`get_section_map.slot\` reports the choice).

## Landmarks (slot-relative)

| Region | Offset | Note |
| --- | --- | --- |
| Trainer card block | 0x68 | OT name (G4 u16[7]), TID/SID @0x78, money @0x7C |
| Badge bitmask byte | 0x82 | one bit per gym, Coal = bit 0 |
| Party count | 0x9C | live party size 0..6 |
| Party slots x6 | 0xA0 | stride 236 (0xEC) |
| Event work array | 0xDAC | u16 per index |
| Event flags | 0xFEC | flag n at + (n>>3), bit n&7 |
| Dex block | 0x1328 | caught @+0x04, seen @+0x44; bit = natId-1 |
| Bag | 0x630 | [u16 id][u16 count] per pouch |
| Mail storage x9 | general 0x4E80 | 9 x 0x38-byte Mail4 records |
| Daycare slots x2 | general 0x1654 | 2 x 236-byte stored records |
| Pokérus | party record byte 0x82 (post-decode) | high nibble = strain, low = days remaining |

## Gotchas

- The last dex-region byte often reads 0xFF (flash fill): popcounts must
  ignore species ids > 493 or every count inflates.
- Slots beyond the live party count contain STALE data from former members;
  gate on party count (byte @0x9C) before interpreting party slots.
- Add16 checksums and PID-shuffled blocks mean raw party/box bytes are
  meaningless without decoding — feed them to \`decode_pokemon_record\`
  (accepts an array; use it batch-wise for whole boxes) instead of trying to
  interpret ciphertext.
- Box numbers are 1-based in-game; the storage byte is 0-indexed.
- Add16 checksums and PID-shuffled blocks mean raw party/box bytes are
  meaningless without decoding — trust the scanner outputs.
`;
}

export function registerReferenceResources(server: McpServer): void {
  const entries: Array<
    {
      name: string;
      uri: string;
      description: string;
      load: () => Promise<string> | string;
    }
  > = [
    {
      name: "species",
      uri: "pkhex://reference/species",
      description: "National dex id -> name + types for all Gen IV species.",
      load: renderSpecies,
    },
    {
      name: "moves",
      uri: "pkhex://reference/moves",
      description: "Move id -> name + base PP.",
      load: renderMoves,
    },
    {
      name: "items",
      uri: "pkhex://reference/items",
      description: "Gen IV game_index -> item name.",
      load: renderItems,
    },
    {
      name: "abilities",
      uri: "pkhex://reference/abilities",
      description: "Ability id -> name.",
      load: renderAbilities,
    },
    {
      name: "natures",
      uri: "pkhex://reference/natures",
      description: "Nature index (PID % 25) -> name.",
      load: renderNatures,
    },
    {
      name: "field-guide",
      uri: "pkhex://reference/field-guide",
      description:
        "How to navigate the save efficiently: strategy, landmarks, gotchas.",
      load: renderFieldGuide,
    },
    {
      name: "offset-map",
      uri: "pkhex://reference/offset-map",
      description:
        "Rendered Gen IV offset map with citations and confidence tags.",
      load: async () => {
        try {
          return await Deno.readTextFile("docs/research/gen4-offsets.md");
        } catch (e) {
          return `offset-map document unavailable: ${String(e)}`;
        }
      },
    },
    {
      name: "story-flags",
      uri: "pkhex://reference/story-flags",
      description:
        "Platinum US story/event flag names (flag number -> meaning), curated from PKHeX's flags_pt_en.txt.",
      load: async () => {
        try {
          const tsv = await Deno.readTextFile(
            "docs/reference/story-flags-pt.tsv",
          );
          return `# Platinum US event/story flags\n\nflag\tkind\tname\n\n${tsv}`;
        } catch (e) {
          return `story-flags table unavailable: ${String(e)}`;
        }
      },
    },
  ];

  for (const entry of entries) {
    server.registerResource(
      entry.name,
      entry.uri,
      { description: entry.description, mimeType: MIME },
      async () => contents(entry.uri, await entry.load()),
    );
  }
}
