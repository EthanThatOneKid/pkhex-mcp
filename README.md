# pkhex-mcp

Read-only analysis of a Pokémon Platinum save file — served over [MCP](https://modelcontextprotocol.io/) so any AI chat client can answer open-ended questions about the player's game.

## What it does

Give pkhex-mcp a path to your `Platinum.sav` and it exposes 13 scanner tools plus 8 reference resources over the Model Context Protocol. An LLM can ask "how many Rare Candies do I have?" or "what's in box 7?" and get deterministic, decoded answers without hallucinating offsets.

It also ships a **desktop app** (CEF) with a built-in Inspector UI and optional embedded chat (BYO OpenAI-compatible API key).

## Quick start

### Prerequisites

- [Deno](https://deno.land/) v2.x
- A Pokémon Platinum `.sav` file

### Run

```bash
# Set your save file path
export PKHEX_SAVE_PATH=/path/to/Platinum.sav

# Start the MCP server (HTTP on localhost:8941)
deno task start
```

Or with the CLI flag:

```bash
deno task start --port 3000
```

### Desktop app

```bash
# Dev mode with HMR (opens CEF window)
PKHEX_SAVE_PATH=/path/to/Platinum.sav deno task desktop

# Build for your platform
deno task build:win     # Windows → dist/pkhex-mcp-v0.3.0-windows.msi
deno task build:macos   # macOS → dist/pkhex-mcp-v0.3.0-macos.dmg
deno task build:linux   # Linux → dist/pkhex-mcp-v0.3.0-linux.AppImage
```

## MCP tools

| Tool | Description |
|------|-------------|
| `read_raw_region` | Read raw bytes from any save region (with named-region shortcuts) |
| `decode_pokemon_record` | Decode an encrypted party or stored Pokémon record |
| `get_trainer_card` | Player name, TID/SID, money, badges, playtime |
| `get_badges` | List of earned gym badges |
| `get_party_detail` | Species, level, nature, IVs/EVs, moves for each party member |
| `get_bag` | Items across all bag pouches with resolved names |
| `get_dex_summary` | Seen/caught counts |
| `get_pc_inventory` | Occupied slots across all 18 boxes + live party |
| `decode_pc_box` | Full decoded data for a PC box (nature, moves, held item) |
| `find_in_pc_box` | Find a Pokémon by species in a specific box |
| `find_item` | Substring search across all bag pouches |
| `get_story_progress` | Read story flags (gym states, key events) |
| `get_save_info` | List available save-file resources |

## MCP reference resources

Pinnable lookup tables the LLM can resolve IDs against:

- `pkhex://reference/species` — Gen IV species table
- `pkhex://reference/moves` — Move names and properties
- `pkhex://reference/items` — Item names and indices
- `pkhex://reference/abilities` — Ability names
- `pkhex://reference/natures` — Nature names and stat modifiers
- `pkhex://reference/field-guide` — Usage guide for tools and resources
- `pkhex://reference/offset-map` — Save-file region offsets
- `pkhex://reference/story-flags` — Story flag bit positions

## Connecting clients

### Claude Desktop / OpenCode / any MCP client

Add to your MCP config:

```json
{
  "mcp": {
    "pkhex": {
      "type": "remote",
      "url": "http://127.0.0.1:8941/mcp"
    }
  }
}
```

### stdio mode

For clients that prefer stdio transport:

```bash
deno task start --stdio
```

## Embedded chat

The desktop app includes an optional chat panel. Set your OpenAI-compatible API key via the settings gear (⚙) or environment variables:

```bash
export PKHEX_LLM_API_KEY=sk-...
export PKHEX_LLM_BASE_URL=https://api.openai.com/v1  # optional
export PKHEX_LLM_MODEL=gpt-4o-mini                     # optional
```

The chat streams responses via SSE (`POST /chat/stream`) with progressive text rendering and tool-call metadata.

## Inspector UI

The built-in Inspector renders a live-updating overview of your save file:

- Trainer strip (name, TID/SID, money, badges, playtime)
- Party audit cards (species, level, nature, IVs/EVs, moves)
- Dex chip (seen/caught)

Polls `GET /save/summary` every 2 seconds with flash animations on value changes.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Inspector UI |
| GET | `/save/summary` | Decoded save overview (JSON) |
| GET | `/chat/config` | Chat enabled status (never leaks API key) |
| POST | `/chat` | One-shot chat completion |
| POST | `/chat/stream` | SSE streaming chat |
| GET | `/mcp` | MCP endpoint (Streamable HTTP) |
| GET | `/doc` | OpenAPI stub |
| GET | `/swagger` | Interactive API explorer |

## Development

```bash
# Typecheck
deno task check

# Tests (92 tests)
deno task test

# Lint + format
deno task lint && deno task fmt

# Dev server with watch
deno task dev
```

## Project structure

```
src/
├── main.ts              # Entry point (CLI args, server startup)
├── app.ts               # Hono app (routes, middleware, security)
├── serve-target.ts      # Port/address resolution
├── chat/                # Embedded chat (AI SDK, streaming)
│   ├── agent.ts         # Text generation + SSE streaming
│   ├── config.ts        # Chat configuration (env + client)
│   └── tools.ts         # Chat tool definitions
├── gen4/                # Gen IV save-file engine
│   ├── crypto.ts        # Encryption/decryption (LCG, shuffle)
│   ├── deserialize.ts   # Record decoding (party + stored)
│   ├── schemas.ts       # Type definitions
│   ├── data/            # Lookup tables (species, moves, items, etc.)
│   └── save/            # Save-file reader + scanners
│       ├── reader.ts    # Dual-partition reader with CRC validation
│       ├── section-map.ts  # Save region offsets
│       ├── offsets.ts   # Binary offset definitions
│       └── scanners.ts  # 13 scanner tools
├── mcp/                 # MCP server + reference resources
│   ├── server.ts        # Tool registration
│   ├── resources.ts     # Reference resource serving
│   └── stdio.ts         # Stdio transport
├── routes/mcp.ts        # HTTP transport mounting
└── ui/                  # Inspector UI
    ├── index.html
    ├── styles.css       # Gen IV design system
    └── ui.js            # Client-side rendering + SSE consumer

tests/                   # 92 tests across 10 test files
.github/workflows/
├── ci.yml               # PR checks (deno check + deno test)
└── release.yml          # Tag-triggered desktop builds (Win/Mac/Linux)
```

## How it works

1. **Reads** your Platinum `.sav` using a dual-partition reader that picks the active save slot via counter comparison and CRC validation
2. **Decodes** Gen IV encrypted Pokémon records using block unshuffling, LCG-XOR decryption, and Add16 checksum verification
3. **Exposes** deterministic scanners that return decoded data (trainer info, bag contents, PC box contents) without requiring the LLM to compute offsets
4. **Serves** over MCP (Streamable HTTP or stdio) so any compatible client can use the tools

## License

MIT
