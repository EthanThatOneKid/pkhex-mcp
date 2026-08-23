# Bridge script setup — BizHawk → pkhex-mcp

The Bridge script is the Sync producer: it reads live Platinum state inside
BizHawk's NDS core and pushes snapshots to the local server every ~500 ms.

## Prerequisites

1. **BizHawk 2.11.1 or newer** — <https://tasvideos.org/BizHawk/Releases>
2. **Pokémon Platinum (US)** ROM dump — gamecode `CPUE`.
3. The pkhex-mcp desktop app running (`GET /state` reachable).

BIOS/firmware dumps are **optional**: the NDS core's Direct Boot (FreeBIOS) runs
Platinum fine without them (verified 2026-08-23). If boot misbehaves on your
machine, drop your own dumps into BizHawk's `Firmware` folder — `biosnds7.bin`
(ARM7, 16 KB), `biosnds9.bin` (ARM9, 4 KB), `firmware.dfc` — then
`Config ▸ Paths…` → point `Firmware` there and restart BizHawk.

## Steps

1. Start the pkhex-mcp server first (`deno task start` or the packaged app).
2. Open BizHawk → `File ▸ Open ROM` → your Platinum `.nds` file.
   - First time only: if BizHawk complains about missing firmware, open
     `Config ▸ Paths…`, point the `Firmware` entry at the folder from step 2,
     then restart BizHawk.
3. `Tools ▸ Lua Console` → `Add New Script…` → select `bridge/platinum-sync.lua`
   from this repo.
4. Watch the Lua Console: you should see
   `pkhex-mcp: syncing Live State to http://127.0.0.1:8941/sync`
5. Open the Inspector (`http://127.0.0.1:8941/`) — your party appears within a
   second and tracks the game live.

## Troubleshooting

| Symptom                                     | Fix                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------- |
| Console says "waiting for Pokemon Platinum" | Wrong ROM/region — only Platinum US (`CPUE`) is supported in v0.1    |
| Server unreachable warnings                 | Is the app running? Same machine? Firewall blocking loopback? (rare) |
| Inspector shows STALE/DISCONNECTED          | Bridge script not loaded, or BizHawk paused/closed                   |

The script posts one form-encoded field per Sync; failures retry on the next
tick automatically — no action needed after brief server restarts.
