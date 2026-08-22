# BizHawk hosts the Sync producer

* **Status:** Accepted
* **Date:** 2026-08-22

ADR-0001 specified a "melonDS Lua 5.1 RAM polling script" as the Live Ingestion Layer, but upstream melonDS ships no scripting support — the Lua integration PR (#1671) has been blocked past 1.0, so no stable melonDS release can host a producer. We instead ship `bridge/platinum-sync.lua`, a Lua script running inside **BizHawk's NDS core** (which *is* melonDS, vendored at `waterbox/melon/melonDS`): it reads Pokémon Platinum state from emulated RAM via `memory.read_u32_le` inside `event.onframeend` hooks and pushes snapshots over built-in `comm.httpPost`. Compatibility was verified before deciding: live Platinum pointer-chasing reads against BizHawk's melonDS core are already proven in production by the community's `universal-ds-lua-script` project.

## Considered Options

* **Standalone melonDS + Lua fork (NPO-197/melonDS-lua)** — keeps the true melonDS UI but depends on unofficial pre-release binaries that lag the branch API; documented as the unsupported fallback.
* **DeSmuME embedded Lua** — viable reads, but no native HTTP (curl/file-drop bridges only) and weaker distribution story.

## Consequences

* Users run their game inside BizHawk rather than standalone melonDS. Local-wireless trading (melonAP) and DSi-mode extras are unavailable there — acceptable because this tool is a read-only live-state viewer.
* BIOS (×2) + firmware files must be supplied, as with standalone melonDS; the app's setup docs walk users through provisioning.
* `comm.httpPost` posts form-encoded (`ExecPostAsForm`), so `POST /sync` accepts `application/x-www-form-urlencoded` carrying the snapshot as one field value.
* Cadence is a wall-clock 500ms accumulator inside the frame-end hook — pause-safe and turbo-proof, since frames ≠ time when unthrottled.
