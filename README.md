# pkhex-mcp

Read-only analysis of a Pokémon Platinum save file — served over MCP so any AI
chat client can answer open-ended questions about your game: badges, bag,
Pokédex, PC boxes, IVs/EVs, story progress and more.

Decodes the save in TypeScript (single authoritative decoder), enriches it with
generated lookup tables, and serves it three ways: an MCP server (Streamable
HTTP + stdio), an OpenAPI-documented REST surface, and a local Inspector UI.

- **Architecture**: [docs/adr/](docs/adr/) (ADR-0001 runtime, ADR-0002 BizHawk
  producer [superseded by ADR-0004], ADR-0003 context layer, ADR-0004
  save-file-only)
- **Implementation spec**: [docs/spec/v0.1.md](docs/spec/v0.1.md)
- **Vocabulary**: [CONTEXT.md](CONTEXT.md)

## Install

**Prerequisites**

- [Deno](https://docs.deno.com/runtime/getting_started/installation/) ≥ 2.9
  (`deno desktop` is experimental):

  ```sh
  # Windows (PowerShell)
  irm https://deno.land/install.ps1 | iex

  # macOS / Linux
  curl -fsSL https://deno.land/install.sh | sh
  ```

  Other package managers (winget, scoop, Homebrew) are listed on that docs page.

- **Your Pokémon Platinum (US) save file** — any `.sav` copy works: BizHawk's
  `NDS/SaveRAM/*.SaveRAM`, melonDS's `.sav`, DeSmuME's export. Answers reflect
  the last in-game save.

**From source** (prebuilt releases aren't published yet)

```sh
git clone https://github.com/EthanThatOneKid/pkhex-mcp.git
cd pkhex-mcp
```

## Quickstart

```powershell
# Windows (PowerShell) — point the server at your save file
$env:PKHEX_SAVE_PATH = "C:\path\to\Pokemon - Platinum Version (USA) (Rev 1).SaveRAM"
deno task start      # first run fetches dependencies automatically
```

```sh
# macOS / Linux
PKHEX_SAVE_PATH="/path/to/platinum.sav" deno task start
```

| Surface               | URL / mode                   |
| --------------------- | ---------------------------- |
| Inspector UI          | <http://127.0.0.1:8941/>     |
| MCP (Streamable HTTP) | <http://127.0.0.1:8941/mcp>  |
| MCP (stdio)           | `deno task start -- --stdio` |
| OpenAPI / Swagger     | `/doc` · `/swagger`          |

The server binds loopback only; use literal `127.0.0.1` URLs.

## Point an MCP client at it

| Client             | Transport       | Setup                                                                                                                           |
| ------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| OpenWebUI ≥ 0.6.31 | Streamable HTTP | Admin settings → Tools: URL `http://127.0.0.1:8941/mcp`, auth None                                                              |
| OpenCode           | Streamable HTTP | `opencode.json` → `"mcp": { "pkhex": { "type": "remote", "url": "http://127.0.0.1:8941/mcp" } }`                                |
| Claude Code        | Streamable HTTP | `claude mcp add --transport http pkhex http://127.0.0.1:8941/mcp`                                                               |
| Cursor             | Streamable HTTP | `mcp.json` → `"pkhex": { "url": "http://127.0.0.1:8941/mcp" }`                                                                  |
| VS Code (Copilot)  | Streamable HTTP | `.vscode/mcp.json` → `{ "servers": { "pkhex": { "type": "http", "url": "http://127.0.0.1:8941/mcp" } } }`                       |
| Gemini CLI         | Streamable HTTP | settings → `"mcpServers": { "pkhex": { "httpUrl": "http://127.0.0.1:8941/mcp" } }`                                              |
| Claude Desktop     | stdio           | `mcpServers` → command launching this binary with `--stdio`, or bridge via [`mcp-remote`](https://github.com/geelen/mcp-remote) |

## Try asking your client

Paste-ready prompts — the model picks the tools:

- _"What badges do I have?"_
- _"What's in my bag?"_
- _"What are my Pokedex seen and caught counts? Have I caught Rotom?"_
- _"What's in my current PC box — which box number is it?"_
- _"Where is my Ponyta stored — which box and slot?"_
- _"Summarize my trainer card, including money."_
- _"Which notable story flags are set?"_
- _"What are Crobat's IVs, EVs and nature?"_
- _"Compare my party members' speeds."_

Anything not covered by a scanner can be explored via `read_raw_region`
(hard-capped at 1024 bytes per call) plus the pinned reference tables.

## What your client gets

**Scanner tools** — decoded answers straight from the save file:

| Tool                | Answers                                             |
| ------------------- | --------------------------------------------------- |
| `get_trainer_card`  | Name, TID/SID, money, badge count, playtime         |
| `get_badges`        | Badge case by gym order                             |
| `get_bag`           | Every pouch with item names and quantities          |
| `get_dex_summary`   | Seen/caught counts                                  |
| `is_species_caught` | Caught verdict for a dex id or species name         |
| `get_pc_box`        | One PC box decoded slot-by-slot (1-based numbering) |
| `find_in_pc_box`    | Where a species is stored across all 18 boxes       |
| `get_story_flags`   | Notable story-progress event flags                  |
| `get_party_audit`   | Raw per-member IVs/EVs/nature/moves                 |
| `read_raw_region`   | Raw bytes as base64 — hard cap 1024 B/call          |
| `get_section_map`   | The machine-readable offset map itself              |

**Reference resources** (`pkhex://reference/<name>`) — pinnable lookup tables
(species, moves, items, abilities, natures), the rendered offset map, and a
field guide teaching efficient save navigation.

Per Pokémon: species (+types), PID, level, current/max HP, status condition
(slp/psn/brn/frz/par with counters), nature, held item, ability, four moves with
PP-Up-aware current/max PP, battle stats (atk·def·spe·spa·spd). Trainer card:
name, TID/SID, money, playtime, badges.

Answers refresh every tool call — re-save in-game to update the underlying file.
Read-only and Platinum-US scoped: no save editing, no games beyond CPUE.
Authoritative contracts: [docs/spec/v0.1.md](docs/spec/v0.1.md) ·
[ADR-0003](docs/adr/0003-context-layer.md) ·
[ADR-0004](docs/adr/0004-save-file-only.md).

## Desktop packaging (Windows tested-first)

```sh
deno task build:win      # dist output per deno.json desktop block (.msi)
deno task build:macos    # needs macOS host for .dmg
deno task build:linux    # .AppImage
```

Artifacts follow `pkhex-mcp-v<version>-<platform>.<ext>`; version lives in
`deno.json`. Windows ships the CEF backend until upstream webview launch bugs
(denoland/deno#35645, #36515) close — see ticket #18 for live status.
macOS/Linux builds are emitted but untested tiers.

## Development

```sh
deno task check   # typecheck
deno task lint    # lint
deno task test    # full suite
deno task desktop # run inside a desktop window with HMR
```

No copyrighted game data ever lives in this repository — all test fixtures are
synthetic, built field-by-field.
