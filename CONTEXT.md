# pkhex-mcp

Real-time, read-only visibility into a Pokémon Generation IV play session, served over MCP so any AI chat client can reason about the player's game as it happens.

## Language

### Live state pipeline

**Live State**:
The current condition of the player's game as read from emulator RAM — party contents plus trainer meta.
_Avoid_: save state, memory dump

**Snapshot**:
One complete observation of Live State delivered by an ingest event; replaces the previous one wholesale.
_Avoid_: update, delta, patch

**Sync**:
The act of pushing a Snapshot from the polling script into the server (`POST /sync`).
_Avoid_: upload, ingest event, publish

**Staleness**:
The age of the newest Snapshot relative to the expected 500ms polling cadence; past ~2s the Live State is considered stale.

**Sync health**:
The three-state freshness verdict applied identically everywhere — `live` (newest Snapshot age ≤ 2s), `stale` (2s–30s), `disconnected` (older than 30s, or none yet).
_Avoid_: connection status, heartbeat

**Bridge script**:
The Sync producer — a Lua script (`bridge/platinum-sync.lua`) hosted by BizHawk's NDS core, reading Live State from emulated RAM and pushing Snapshots.
_Avoid_: polling script, Lua hook, bot

**Trainer Meta**:
Identity and progress facts about the player — ID numbers, name, playtime, current location — carried alongside the Party in every Snapshot.
_Avoid_: trainer info, profile

### Game data

**Party**:
The up-to-six Pokémon actively traveling with the player.
_Avoid_: team, roster

**Party Member**:
A single Pokémon occupying a Party slot, decoded from live RAM into structured form.

**Torn read**:
A Snapshot captured while the game was mid-write to a Party Member; caught by checksum validation and healed from last-known-good values.
_Avoid_: bad read, corrupt slot

**Gen IV**:
The game family this tool targets; **Platinum** is the supported title for v0.1.
_Avoid_: Sinnoh-era, DPPt

### Surfaces

**Inspector**:
The desktop UI pane that renders Live State as it updates.
_Avoid_: dashboard, viewer

**Chat Harness**:
The embedded panel that tells users how to point an external MCP client at this server; it hosts no chat itself.
_Avoid_: chatbot, assistant, embedded chat
