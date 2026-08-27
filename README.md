# pkhex-mcp

Read-only analysis of a Pokémon Platinum save file — served over MCP so any AI
chat client can answer open-ended questions about your game: badges, bag,
Pokédex, PC boxes, IVs/EVs, story progress and more.

Decodes the save in TypeScript (single authoritative decoder), enriches it with
generated lookup tables, and serves it three ways: an MCP server (Streamable
HTTP + stdio), an OpenAPI-documented REST surface, and a local Inspector UI.

- **Architecture**: [docs/adr/](docs/adr/) (ADR-0001 runtime, ADR-0002 BizHawk
  producer [superseded by ADR-0004], ADR-0003 context layer, ADR-0004
  save-file-only, ADR-0005 no external decode engine, ADR-0006 raw-first
  surface)
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
- _"How far am I in the story?"_
- _"What are Crobat's IVs, EVs and nature?"_
- _"Compare my party members' speeds."_
- _"Show me everything about my party."_

Anything not covered by a scanner can be explored via `read_raw_region`
(hard-capped at 1024 bytes per call) plus the pinned reference tables.

### What an answer looks like

Real output from a live session against a Platinum US save:

> _"What badges do I have?"_
>
> You have **3 badges**: Coal, Forest, and Relic.

> _"Where is my Ponyta stored — which box and slot?"_
>
> Ponyta is in **Box 2**, slot **6**.

> _"What are Crobat's IVs, EVs and nature?"_
>
> Crobat (Lv 32) — Nature: **Mild** IVs: HP 0 / Atk 5 / Def 2 / Spe 11 / SpA 1 /
> SpD 14 EVs: HP 52 / Atk 24 / Def 40 / Spe 82 / SpA 89 / SpD 13

📄
[Full session transcript](https://gist.github.com/EthanThatOneKid/633e584d3555ef5bd119accf70d33c4b)
— tool-call chain + complete model output.

## What your client gets

**Ten tools** over MCP plus pinnable **reference resources**:

| Tool                    | Purpose                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `read_raw_region`       | Raw save bytes as base64 + spaced hex — the exploration primitive (1 KB/call cap)    |
| `decode_pokemon_record` | Decrypt + decode encrypted Pokémon records (party 236 B / box 136 B), accepts arrays |
| `decode_pc_box`         | One PC storage box decoded slot-by-slot (1-based numbering)                          |
| `get_save_info`         | Active partition, file size, capability limits + resource discovery                  |

**Scanner tools** (deterministic answers, no raw-region navigation needed):

| Tool                    | Purpose                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `get_bag`               | All bag pouches with resolved item names and counts                                  |
| `get_trainer_card`      | Player name, TID, SID, money, badge count, playtime                                 |
| `get_badges`            | Earned gym badges with resolved names                                                |
| `get_dex_summary`       | Pokédex seen/caught counts (species capped at 493)                                   |
| `get_party_detail`      | Species, level, nature, IVs, EVs, moves for each live party member                   |
| `find_in_pc_box`        | Search all 18 PC boxes by species name or national dex id                            |
| `get_story_progress`    | Notable story/event flag states (Dialga captured, National Dex obtained, etc.)       |

**Reference resources** (`pkhex://reference/<name>`): the offset map, a field
guide teaching raw-first navigation (landmarks, worked gotchas), and lookup
tables for species/moves/items/abilities/natures.

Scanner tools give deterministic answers in one call. For anything beyond what
scanners cover, explore with `read_raw_region`, consult guides and tables as
needed, and feed anything encrypted through `decode_pokemon_record`. Answers
refresh every call — re-save in-game to update the underlying file.

### Battery results

Measured against a real Platinum US save with `opencode/mimo-v2.5-free`:

| Q | Question | Raw-first (before) | With scanners (after) | Improvement |
| --- | --- | --- | --- | --- |
| Q1 | Which badges? | 11 calls ✓ | 2 calls ✓ | **5.5× fewer** |
| Q2 | Bag items? | ~17 calls ✓ | 2 calls ✓ | **8.5× fewer** |
| Q3 | Dex seen/caught? | 3 calls ✗ (wrong answer) | 2 calls ✓ | **correct answer** |
| Q4 | PC box contents? | 2 calls ✓ | 2 calls ✓ | already optimal |
| Q5 | Money, playtime? | timeout | 2 calls ✓ | **from timeout to 2** |
| Q6 | Non-battery probes | raw-first fallback | raw-first fallback | offsets added to field guide |
| Q7 | Party species/nature? | timeout | 2 calls ✓ | **from timeout to 2** |
| Q8 | Find species in PC? | 19 calls timeout | 2 calls ✓ | **9.5× fewer** |

Each scanner question answers in `get_save_info` + 1 scanner call = **2 tool
calls**. The ADR-0006 acceptance bar is 3 tool interactions per question — all
scanner questions now beat it.

Read-only and Platinum-US scoped: no save editing, no games beyond CPUE.
Authoritative contracts: [docs/spec/v0.1.md](docs/spec/v0.1.md) ·
[ADR-0003](docs/adr/0003-context-layer.md) ·
[ADR-0005](docs/adr/0005-no-external-decode-engine.md) ·
[ADR-0006](docs/adr/0006-raw-first-surface.md).

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
