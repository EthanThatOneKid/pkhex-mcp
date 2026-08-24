# pkhex-mcp

Real-time, read-only visibility into a Pokémon Platinum play session — served
over MCP so any AI chat client can reason about the game as it happens.

Reads live emulator RAM via a BizHawk Lua bridge, decodes it in TypeScript
(single authoritative decoder), and serves it three ways: an MCP server
(Streamable HTTP + stdio), an OpenAPI-documented REST surface, and an embedded
desktop Inspector UI.

- **Architecture**: [docs/adr/](docs/adr/) (ADR-0001 runtime/packaging, ADR-0002
  BizHawk producer)
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

- [BizHawk](https://tasvideos.org/BizHawk/Releases) ≥ 2.11.1 — needed only to
  connect your game; setup is covered in [bridge/README.md](bridge/README.md).

**From source** (prebuilt releases aren't published yet)

```sh
git clone https://github.com/EthanThatOneKid/pkhex-mcp.git
cd pkhex-mcp
deno task start     # first run fetches dependencies automatically
```

Verify: open <http://127.0.0.1:8941/> — the Inspector loads. `GET /state`
answering `503` is expected until the Bridge connects (explained under
[Quickstart](#quickstart-development)).

Prebuilt `.msi` / `.dmg` / `.AppImage` artifacts can be built locally — see
[Desktop packaging](#desktop-packaging-windows-tested-first).

## Quickstart (development)

```sh
deno task start          # server on http://127.0.0.1:8941 (loopback only)
```

| Surface                     | URL / mode                   |
| --------------------------- | ---------------------------- |
| Inspector UI                | <http://127.0.0.1:8941/>     |
| MCP (Streamable HTTP)       | <http://127.0.0.1:8941/mcp>  |
| MCP (stdio)                 | `deno task start -- --stdio` |
| OpenAPI / Swagger           | `/doc` · `/swagger`          |
| Debug: degradation counters | `/debug/sync-integrity`      |

Until the Bridge script is connected, `GET /state` answers `503` and the MCP
data tools report "no Sync received yet" — that's the designed pre-Sync state.

## Connect your game (Platinum US)

Follow **[bridge/README.md](bridge/README.md)**: install BizHawk 2.11.1+, open
your Platinum ROM (BIOS/firmware dumps optional — Direct Boot works), and load
`bridge/platinum-sync.lua` in the Lua Console. Your party appears in the
Inspector within ~1 second.

## Point an MCP client at it

The server binds loopback only; use literal `127.0.0.1` URLs.

| Client             | Transport       | Setup                                                                                                                           |
| ------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| OpenWebUI ≥ 0.6.31 | Streamable HTTP | Admin settings → Tools: URL `http://127.0.0.1:8941/mcp`, auth None                                                              |
| OpenCode           | Streamable HTTP | `opencode.json` → `"mcp": { "pkhex": { "type": "remote", "url": "http://127.0.0.1:8941/mcp" } }`                                |
| Claude Code        | Streamable HTTP | `claude mcp add --transport http pkhex http://127.0.0.1:8941/mcp`                                                               |
| Cursor             | Streamable HTTP | `mcp.json` → `"pkhex": { "url": "http://127.0.0.1:8941/mcp" }`                                                                  |
| VS Code (Copilot)  | Streamable HTTP | `.vscode/mcp.json` → `{ "servers": { "pkhex": { "type": "http", "url": "http://127.0.0.1:8941/mcp" } } }`                       |
| Gemini CLI         | Streamable HTTP | settings → `"mcpServers": { "pkhex": { "httpUrl": "http://127.0.0.1:8941/mcp" } }`                                              |
| Claude Desktop     | stdio           | `mcpServers` → command launching this binary with `--stdio`, or bridge via [`mcp-remote`](https://github.com/geelen/mcp-remote) |

## What your client gets

Two families of tools over MCP (mirrored by REST under `/doc`):

**Live party** — refreshed from emulator RAM every ~500 ms while BizHawk runs:

| Tool                           | Answers                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `get_game_state`               | Full Live State: trainer meta, sync health, whole party   |
| `get_party`                    | All six party slots (`null` when empty)                   |
| `get_pokemon_by_slot`          | One member by slot 1–6                                    |
| `find_party_member_by_species` | First member matching name or species id                  |
| `get_sync_status`              | live (≤2 s) / stale (≤30 s) / disconnected + snapshot age |

**Save-file scanners** — open-ended answers from the wired BizHawk SaveRAM copy
(set `PKHEX_SAVE_PATH`; refreshes on every in-game save):

| Tool                | Answers                                              |
| ------------------- | ---------------------------------------------------- |
| `get_trainer_card`  | Name, TID/SID, money, badge count, playtime          |
| `get_badges`        | Badge case by gym order                              |
| `get_bag`           | Every pouch with item names and quantities           |
| `get_dex_summary`   | Seen/caught counts                                   |
| `is_species_caught` | Caught verdict for a dex id or species name          |
| `get_pc_box`        | One PC box decoded slot-by-slot                      |
| `find_in_pc_box`    | Where a species is stored across all 18 boxes        |
| `get_story_flags`   | Notable story-progress event flags                   |
| `get_party_audit`   | Raw per-member IVs/EVs/nature/moves beyond live sync |
| `get_section_map`   | The machine-readable offset map itself               |

Per Pokémon: species (+types), PID, level, current/max HP, status condition
(slp/psn/brn/frz/par with counters), nature, held item, ability, four moves with
PP-Up-aware current/max PP, battle stats (atk·def·spe·spa·spd). Trainer meta:
name, TID/SID, playtime, current map id.

Read-only and Platinum-US scoped: no save editing, no games beyond CPUE (v0.2
scope). Authoritative contracts: [docs/spec/v0.1.md](docs/spec/v0.1.md) ·
[ADR-0003](docs/adr/0003-context-layer.md) · machine-readable schema at `/doc`.

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
deno task test    # full suite (48 tests)
deno task desktop # run inside a desktop window with HMR
```

Optional local smoke against a running server + BizHawk:
`PKHEX_LOCAL_SMOKE=1 deno test tests/local-smoke.test.ts` (inert otherwise).

Wire debugging: start the server with `PKHEX_SYNC_TRACE=1` to log every `/sync`
request (and any schema-rejection detail) to `logs/sync-incoming.log`;
`recordSync` failures always land in `logs/sync-errors.log`.

No copyrighted game data ever lives in this repository — all test fixtures are
synthetic, built field-by-field.
