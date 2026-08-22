# pkhex-mcp v0.1 ingestion-path research: NDS emulator scripting for live Pokémon Platinum state

Researched August 2026. All quoted signatures were verified against shallow clones in `C:\Users\ethan\AppData\Local\Temp\opencode\clones\`.

## Emulator scripting landscape

### melonDS upstream (`melonDS-emu/melonDS`)
- **No stable release ships any scripting.** Latest release is **1.1 (2025-11-18)**; 25 releases total; none mention Lua/scripting. Upstream is active (last push Jun 2026; Arisotura status update Apr 2026 discusses 1.2 plans).
- **PR #1671 "Basic Lua Scripting Support" (NPO-197) is still OPEN** — last updated **2026-04-02**, diff ~+2781/−13 across 30 files (Mar 2026 rebase onto master grew it to +4003/−2638 in 37 files). RSDuck (maintainer) explicitly said *"We will unfortunately not merge this before the coming 1.0 release"*; 1.0 **and** 1.1 shipped without it. Implementation is plain Lua C API + **Lua 5.4** (author tried 5.5, reverted). Author states goal is BizHawk-API compatibility for trackers/accessibility, not TAS features.
- Author maintains runnable **test releases**: [`NPO-197/melonDS-lua`](https://github.com/NPO-197/melonDS-lua), latest **Test_11-4 (2024-11-05)** — pre-release zips for **Windows x64** (17.9 MB), macOS-universal, Ubuntu x86_64/aarch64. Menu entry: *System → Lua Script*.

### Community melonDS forks with embedded Lua
| Fork | Status (Aug 2026) | Notes |
|---|---|---|
| [NPO-197/melonDS-lua](https://github.com/NPO-197/melonDS-lua) | Active; feeds PR #1671; binary test releases (last Nov 2024) | BizHawk-compatible `memory` lib; `_Update()` per frame |
| [Veddy1674/melonDS-lua](https://github.com/Veddy1674/melonDS-lua) | Pushed **2026-05-28**; experimental; **no binary releases** | Independent **sol2 + Lua 5.4** implementation; `native.*` API; scripting button |
| [DarthMDev/melonDS-lua](https://github.com/DarthMDev/melonDS-lua) | Passive fork (created 2025-11-19, pushed 2026-07-16), 0 stars | Mirror of NPO-197's tree |

Other fork candidates surfaced but are inactive or non-Lua. No other maintained melonDS-with-Lua distribution exists.

### Proven Gen IV RAM-reading paths
1. **BizHawk melonDS core ("NDSHawk")** — in stable since **BizHawk 2.7 (Nov 2021)**; current stable **2.11.1 (released 2026-05-01)** includes melonDS updated to **upstream 1.1**, plus merged **PR #4555** giving 16/32-bit System-Bus access (fixes #3121), and melonDS **JIT** (since 2.11).
2. **DeSmuME (Windows)** — embeds Lua 5.1 (*Tools → Lua Scripting → New Lua Script Window*); historically THE Gen IV RNG/tooling platform; latest GitHub tag on TASEmulators org is `release_0_9_13`.
3. **[DevreeseJorik/universal-ds-lua-script](https://github.com/DevreeseJorik/universal-ds-lua-script)** (by RETIRE) — dual-target library proving **live Platinum/DP/HGSS/BW/B2W2 RAM reading on both DeSmuME and BizHawk's melonDS core**. ROM detection reads game title at `0x023FFE00`; `"POKEMON PL  CPU"` → `Scripts/.../PL/Platinum.lua`; reads player/NPC/camera/chunk structs via an emulator-abstraction layer (`client` global present ⇒ BizHawk, else DeSmuME).

---

## RAM-read API reference per path

### Path A — BizHawk 2.11.1, melonDS core
Verified in clone `bizhawk`:

```csharp
// src/BizHawk.Client.Common/lua/CommonLibs/MemoryLuaLibrary.cs
[LuaMethod("read_u32_le", "read unsigned 4 byte value, little endian")]
public uint ReadU32Little(long addr, [LuaASCIIStringParam] string domain = null)
```
- Family: `memory.read_u8 / s8 / u16_le / u16_be / s16_* / u24_* / u32_le / u32_be / s32_*` `(addr [, domain])`; bulk: `memory.read_bytes_as_array(addr, len [, domain])`, `memory.read_bytes(addr, len)` (string; new in 2.11). `mainmemory.*` aliases the primary domain.
- **Memory domains** (from `waterbox/melon/BizDebugging.cpp`, `GetMemoryAreas()`):
  - `"Main RAM"` — **primary**, direct pointer to `CurrentNDS->MainRAM`, size `MainRAMMaxSize/4` (**4 MB** on DS; full 16 MB on DSi). Pokémon Platinum's save/state structures live here (e.g. party/human structs around `0x02xxxxxx` map into this region via the ARM9 bus).
  - `"Shared WRAM"`, `"ARM7 WRAM"`, `"SRAM"` (save), `"ROM"`, `"Instruction TCM"`, `"Data TCM"`, `"ARM9 BIOS"`, `"ARM7 BIOS"`, `"Firmware"`; DSi adds `"NWRAM A/B/C"`, `"ARM9i/ARM7i BIOS"`.
  - `"ARM9 System Bus"` / `"ARM7 System Bus"` — full 4 GB function-hook domains; since **PR #4555 (in stable 2.11.1)** they carry `MEMORYAREA_FLAGS_SIZEDFUNCTIONHOOKS` so `read_u16_le`/`read_u32_le` perform real 16/32-bit bus reads (previously every width degraded to byte-reads — relevant for pointer chasing).
- **Frame hooks** (`EventsLuaLibrary.cs`): `event.onframeend(func)` ("default behavior of lua scripts"), `event.onframestart(func)`, or classic `while true do … emu.frameadvance() end`. Memory callbacks `event.onmemoryexecute/read/write` work on melonDS since 2.8 (issue #1909); `event.on_bus_exec` exists but has an ARM/THUMB bit caveat (issue #4649).
- Core registration: `[PortedCore(CoreNames.MelonDS, "Arisotura", "1.0+", ...)]` (`MelonDS.cs`).

### Path B — NPO-197/melonDS-lua (PR #1671 build)
Verified in clone `NPO-197-melonds-lua`, `src/frontend/qt_sdl/lua/libs/LuaMemory.cpp`:

```
AddMemoryReadFunction(s16 BE, read_s16_be); ... AddMemoryReadFunction(u32 LE, read_u32_le);
AddMemoryReadFunction(u8    , readbyte);
```
→ **`memory.read_u32_le(addr [, "domain"])`, `memory.readbyte(addr)`, etc.** — deliberately BizHawk-shaped (same names, same optional-domain convention, same default domain `"Main RAM"` pointing directly at `CurrentNDS->MainRAM`, size 4 MB on DS).
- Also: `memory.read_bytes_as_array(address, length[, domain])`, `write_bytes_as_array`, `usememorydomain(name)`, `getcurrentmemorydomain()`, `getmemorydomainlist()`, `getmemorydomainsize([domain])`.
- Domain list mirrors BizHawk incl. `"ARM9 System Bus"`/`"ARM7 System Bus"`; peek-safety guards (`SafeToPeek`) are copied verbatim from BizHawk's `BizDebugging.cpp`.
- **Frame hook:** define a global `function _Update()` — called **once per frame** by `LuaBundle::luaUpdate()` (`LuaMain.cpp`). No `frameadvance` loop needed; BizHawk scripts need only minor adaptation (author documents this trade-off in PR discussion).
- Script loading: one-shot `luaL_dofile` when you pick a file in the *Lua Script* dialog; instruction-count hook allows force-stop.
- Gaps per `tools/LuaScripts/checklist.txt`: `comm` **NOT_PLANNED_FOR_SUPPORT** ("may add support for sockets"); `event` not planned; `emu.framecount`/`getsystemid` done.

### Path C — DeSmuME (Windows, Lua 5.1)
Verified in clone `desmume`, `desmume/src/lua-engine.cpp`:

```cpp
DEFINE_LUA_FUNCTION(memory_readbyte,  "address")        // -> _MMU_read08<ARMCPU_ARM9>(address)   (L1818)
DEFINE_LUA_FUNCTION(memory_readword,  "address")        // -> _MMU_read16<ARMCPU_ARM9>(address)   (L1842)
DEFINE_LUA_FUNCTION(memory_readdword, "address")        // -> _MMU_read32<ARMCPU_ARM9>(address)   (L1858)
DEFINE_LUA_FUNCTION(memory_readbyterange, "address,length")
DEFINE_LUA_FUNCTION(memory_isvalid, "address")
```
- Real-width ARM9-bus reads through the normal MMU path (so main-RAM pointers resolve exactly like in-game); `vram.readword`/`vram.writeword` hit `MMU.ARM9_LCD`. Signed variants exist (`readbytesigned/readwordsigned/readdwordsigned`).
- **Hooks:** `gui.register(func)` = once-per-frame callback (this is what `universal-ds-lua-script` uses on DeSmuME); `emu.frameadvance()` loop style also supported; hardware callbacks `memory.registerwrite/registerread/registerexec("address,[size=1,][cpuname=\"main\",]func")` (L355–369).
- No domain concept — single unified address space; `memory.isvalid(addr)` guards bad addresses.

### Path D — Veddy1674/melonDS-lua (sol2 build)
Verified in clone `Veddy1674-melonds-lua`, `ScriptManager.cpp`:

```cpp
static int read_s32_le(u32 address) { if (address == -1) return -1; return nds->ARM9Read32(address); }
native.set_function("read_s32", &read_s32_le);          // also read_s8/read_s16/write_*
native.set_function("on_frame", [this](sol::protected_function callback){...});
```
- `native.read_s8/s16/s32(addr)` — true ARM9 bus reads; wrapped by `lua/core/memory.lua` as `memory.read_s32(addr)`. `lua/core/emu.lua` adds `emu.onFrame(func)`, `emu.getScreen`, savestate load/save, input injection.
- Libraries opened: base, math, string, table, package, **io**, debug — **os intentionally excluded** ("avoid os for security"). No socket lib.

---

## HTTP/export mechanisms per path

| Path | Built-in HTTP? | Mechanism | Evidence |
|---|---|---|---|
| **A. BizHawk** | **Yes — `comm` lib** | `comm.httpPost(url, payload)` (posts payload as **form-encoded** via `ExecPostAsForm`), `comm.httpGet(url)`, `comm.httpSetTimeout(ms)`, `comm.httpSetPostUrl/getUrl`. Also TCP-client `comm.socketServer*` and shared-memory `comm.mmf*` families. | `CommonLibs/CommLuaLibrary.cs` L170–250; 2.11 fixed `Expect: 100-Continue` failures (#4187) |
| A-alt. BizHawk + LuaSocket DLLs | Yes (raw sockets) | Ship `socket/core.dll` + `mime/core.dll` next to scripts, prepend `package.cpath`, then `require("socket")` gives full `socket.tcp()` — proven pattern runs an entire non-blocking **HTTP server inside BizHawk** (`bind/listen/settimeout(0)`) serving JSON REST for Pokémon party data (dkjson) | cloned `pokemon-memory-reader`: `network/server.lua` L6 (`package.cpath = package.cpath .. ";./modules/LuaSocket/socket/?.dll;…"`), `network/http_server.lua` L29–60, `modules/LuaSocket/socket/core.dll` checked into repo |
| **B. melonDS-lua (NPO-197)** | No | `luaL_openlibs` is called ⇒ standard **`io` + `os`** available: `io.open(...,"w")` file-drop + watcher, or `os.execute("curl -X POST -d @snapshot.json http://127.0.0.1:P/sync")` | `LuaMain.cpp` L135; `checklist.txt`: `comm NOT_PLANNED_FOR_SUPPORT – may add support for sockets` |
| **C. DeSmuME** | No | Lua 5.1 std libs incl. **`io` and `os`** compiled in (`src/lua/linit.c`) ⇒ `os.execute(curl)` or file-write both viable; no luasocket | `linit.c` L18–25 registers base/package/table/**io**/**os**/string/math/debug |
| **D. Veddy1674** | No | `io` opened but **`os` deliberately omitted** ⇒ only file-write + external watcher | `ScriptManager.cpp` L226 comment "avoid os for security" |

What existing Pokémon bots actually do: BizHawk-based projects either use `comm.http*` or bundle LuaSocket DLLs and run/serve HTTP themselves (`atendev/pokemon-memory-reader` serves a REST API from inside the emulator; `DevreeseJorik/universal-ds-lua-script` is display-only). DeSmuME-era RNG tools overwhelmingly used file-write or manual reading; none ship luasocket.

---

## Install/run UX per path

### A. BizHawk 2.11.1 (recommended target audience fit: good)
1. Download `bizhawk-2.11.1.zip` + run the bundled **prereq installer** (.NET runtime) — two downloads, one wizard.
2. Load ROM, set **melonDS** as preferred NDS core (Config → Cores… or per-ROM prompt).
3. Tools → **Lua Console** → Open Script (recent-scripts list persists; multiple scripts loadable; CLI `--lua=` loading since 2.10).
Friction points for non-technical users: prereq installer step, choosing the right core, and the fact that scripts must be re-opened per session unless launched via CLI shortcut. Mitigation: we ship a `.bat` that starts `EmuHawk.exe rom.nds --lua=pkhex_bridge.lua` alongside pkhex-mcp. Huge documentation surface + largest existing Pokémon-scripting user base.

### B. NPO-197/melonDS-lua (fit: moderate)
1. Download `melonDS-windows-x86_64.zip` from the Test_11-4 pre-release page.
2. Run `melonDS.exe` → **System → Lua Script** → pick script.
Simplest GUI story of all paths, **but**: binaries are from Nov 2024 while the branch moved through Apr 2026 (API drift risk between documented and shipped behavior), pre-release quality, single maintainer, and no auto-update channel.

### C. DeSmuME 0.9.x (fit: easiest install, oldest stack)
1. Download official Windows build (single exe/folder).
2. Tools → **Lua Scripting** → New Lua Script Window → Browse.
Lowest technical bar and the longest-proven Gen IV tooling lineage, but the project's release cadence is stale and emulation fidelity (and future maintenance) trails melonDS 1.1 significantly.

### D. Veddy1674 build (fit: poor today)
No releases; requires Qt6/CMake/vcpkg toolchain. Only realistic as a developer/self-build option.

---

## Recommendation

**Primary — BizHawk 2.11.1 stable + built-in melonDS core, driven by a `pkhex_bridge.lua`:**

```lua
-- sketch (verified against API above)
local last = 0
event.onframeend(function()
    local t = os.clock()
    if t - last < 0.5 then return end          -- wall-clock gate ≈500 ms
    last = t
    local json = string.format(
      '{"party_ptr":"0x%X","trainer_ptr":"0x%X"}',
      memory.read_u32_le(0x02249EA4, "Main RAM"),
      memory.read_u32_le(0x02249E30, "Main RAM"))
    local ok, err = pcall(comm.httpPost, "http://127.0.0.1:8756/sync", json)
    if not ok then console.log(err) end         -- never let transport kill the script
end)
while true do emu.frameadvance() end
```
Why: only path where **fidelity** (upstream-current melonDS 1.1 core, JIT), **reliable push** (`comm.httpPost` is synchronous, error-catchable, localhost-cheap; sized bus reads fixed in this exact stable), **distribution** (single well-known installer pair; CLI autostart recipe), and **our ability to document/bundle** (ship one .lua + one .bat + screenshots) all intersect. Precedent for the whole pipeline (Lua → HTTP → external tool) already exists in the wild.

**Fallback — NPO-197/melonDS-lua (PR #1671 builds):** the bridge ports nearly 1:1 because its `memory` API is intentionally BizHawk-shaped (swap `event.onframeend` → define `_Update()`; swap `comm.httpPost` → `os.execute("curl …")` or `io.open` snapshot-file + a tiny file-watcher inside pkhex-mcp). Keep this port warm from day one; revisit if upstream merges #1671 (then it becomes the zero-extra-emulator ideal).

**Last resort — DeSmuME:** only if a user cohort is locked to it; `gui.register` + `memory.readdword` + `os.execute` curl works but drags in the oldest emulator core.

Avoid for v0.1: Veddy1674 fork (no distributable), raw process-memory reading (fragile, anti-cheat/AV noise, breaks on melonDS updates).

---

## Citations

Upstream / PRs / issues
- https://github.com/melonDS-emu/melonDS — repo metadata: latest release 1.1 (2025-11-18); pushes through 2026-06
- https://github.com/melonDS-emu/melonDS/pull/1671 — open, updated 2026-04-02; maintainer "not merge before 1.0" comment; Lua 5.4 decision; `_Update()` design note
- https://melonds.kuribo64.net/ — Arisotura status update Apr 26 2026 (post-1.1 planning)
- https://github.com/TASEmulators/BizHawk/issues/3121 — melonDS system-bus width regression
- https://github.com/TASEmulators/BizHawk/pull/4555 — sized function-hook System Bus domains (merged)
- https://github.com/TASVideos/BizHawk/issues/1909 — melonDS memory callbacks implemented in 2.8
- https://github.com/TASEmulators/BizHawk/issues/4649 — `on_bus_exec` ARM/THUMB bit caveat

Releases / release notes
- http://tasvideos.org/Bizhawk/ReleaseHistory — 2.11.1 (May 1 2026): melonDS→1.1 + #4555; 2.11 (Sep 20 2025): JIT, `#4187` httpPost Expect-fix, `memory.read_bytes`
- https://github.com/TASVideos/BizHawk/releases/tag/2.7 — "New Core - melonDS"
- https://api.github.com/repos/NPO-197/melonDS-lua/releases — Test_11-4 assets (Windows x64/macOS/Ubuntu), 2024-11-05
- https://api.github.com/repos/TASEmulators/BizHawk/releases/latest → 2.11.1; https://api.github.com/repos/TASEmulators/desmume/releases/latest → `release_0_9_13`

Cloned sources (shallow clones under `%TEMP%\opencode\clones\`)
- `NPO-197-melonds-lua`: `src/frontend/qt_sdl/lua/libs/LuaMemory.cpp` (memory API + domains + SafeToPeek), `src/frontend/qt_sdl/lua/LuaMain.cpp` (script load, `_Update()` dispatch, `luaL_openlibs`), `tools/LuaScripts/Lua_Docs.md`, `tools/LuaScripts/checklist.txt` (comm/event status)
- `Veddy1674-melonds-lua`: `src/frontend/qt_sdl/ScriptManager.cpp` (`native.*`, lib selection, "avoid os for security"), `lua/core/memory.lua`, `lua/core/emu.lua`
- `bizhawk`: `src/BizHawk.Client.Common/lua/CommonLibs/MemoryLuaLibrary.cs`, `CommonLibs/CommLuaLibrary.cs`, `LuaHelperLibs/EventsLuaLibrary.cs`, `waterbox/melon/BizDebugging.cpp` (`GetMemoryAreas`), `src/BizHawk.Emulation.Cores/Consoles/Nintendo/NDS/MelonDS.cs` (PortedCore attr)
- `desmume`: `desmume/src/lua-engine.cpp` (L1818–1936 memory fns; L355–369 register hooks), `desmume/src/lua/linit.c` (io+os registered)
- `universal-ds-lua-script`: `main.lua`, `GameLoader.lua` (`"POKEMON PL  CPU"` → Platinum), `DependencyLoader.lua` (emulator detect via `client` global), `EmulatorDependencies/BizHawk|DeSmuME/Utility/Memory.lua` (API mapping tables), `Scripts/Bizhawk/Templates/Gen4/*` (live Gen IV struct reads)
- `pokemon-memory-reader`: `network/server.lua` (package.cpath LuaSocket injection), `network/http_server.lua` (in-process socket.tcp HTTP server), `modules/LuaSocket/socket/core.dll`

Community projects referenced
- https://github.com/DevreeseJorik/universal-ds-lua-script
- https://github.com/atendev/pokemon-memory-reader
