# pkhex-mcp

Read-only analysis of a Pokémon Platinum save file — served over MCP so any AI
chat client can answer open-ended questions about the player's game.

## Language

### Save-file analysis

**Save file**: The player's Platinum `.sav` copy wired via `PKHEX_SAVE_PATH`;
the single source this tool reads. _Avoid_: save state, memory dump

**Scanner tool**: A server-side tool that reads known save regions and returns a
decoded answer directly. _Avoid_: decoder endpoint, feature tool

**Region read**: A raw, capped base64 slice of the save file returned by
`read_raw_region` for exploration beyond declared scanners. _Avoid_: hexdump,
dump

**Section map**: The machine-readable table of save offsets that scanners and
Region reads navigate by, served via `get_section_map`. _Avoid_: offset list,
cheat sheet

**Reference resource**: A pinnable MCP resource (`pkhex://reference/<name>`)
carrying a lookup table or guidance document. _Avoid_: doc, manual

**Acceptance battery**: The eight open-ended questions whose correct answering
against the player's real save defines v0.2 done. _Avoid_: checklist, test suite

**Torn read**: A slot captured mid-write whose Add16 checksum fails; reported as
a torn row instead of decoded garbage. _Avoid_: bad read, corrupt slot

### Game data

**Party**: The up-to-six Pokémon actively traveling with the player. _Avoid_:
team, roster

**Gen IV**: The game family this tool targets; **Platinum** is the supported
title. _Avoid_: Sinnoh-era, DPPt

### Surfaces

**Inspector**: The local UI page rendering the decoded save overview. _Avoid_:
dashboard, viewer

**Chat**: The optional embedded chat panel that lets the player ask open-ended
questions about their save via a BYO OpenAI-compatible inference endpoint
(ADR-0007). When no key is configured, the panel degrades to the MCP snippet
harness for external clients. _Avoid_: chatbot, assistant, embedded chat (old
anti-goal; superseded by ADR-0007)
