# Save-file analysis replaces live sync

- **Status:** Accepted
- **Date:** 2026-08-24
- **Supersedes:** ADR-0002 (BizHawk hosts the Sync producer) for the
  raw-analysis layer; the v0.1 live pipeline is removed entirely

Simplicity review of the shipped v0.2 context layer showed two parallel data
paths where one suffices: every acceptance-battery question is answerable from
the save FILE, and the wired BizHawk SaveRAM copy refreshes on every in-game
save — so "freshness" never required a second transport. We removed the live
pipeline outright: Bridge script, `POST /sync`, `GET /state`, the
GameStateStore, and the five live MCP tools. The server is now a pure save-file
analyzer configured by a single variable, `PKHEX_SAVE_PATH`, pointing at any
Platinum `.sav` copy (BizHawk's flush target, a melonDS `.sav`, DeSmuME's export
— any of them).

## Considered Options

- **Keep dual-mode** (live party sync alongside file analysis) — rejected: two
  freshness models, two test families, and an emulator prerequisite for half the
  feature set, all to answer questions the file already answers.
- **Live-RAM command channel for raw reads** — rejected earlier in ADR-0003;
  this decision removes the remaining motivation.

## Consequences

- BizHawk is no longer a dependency of this project at all. The Bridge script
  and its setup docs are deleted; players who still want sub-second party
  visibility can run the archived v0.1 release.
- Answers reflect the **last in-game save**, not wall-clock — docs say so.
- The Inspector polls `GET /save/summary` (decoded trainer card, badges, dex,
  party audit, bag) instead of `/state`.
- `decodePartySlot` no longer accepts a `decryptedInPlace` input: save-file
  bytes are always encrypted at rest.
