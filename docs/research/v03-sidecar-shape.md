# v0.3 sidecar shape — running PKHeX.Core beside the Deno server

**Researched:** 2026-08-24 · Ticket
[#34](https://github.com/EthanThatOneKid/pkhex-mcp/issues/34) (part of #33) ·
Resolves against [ADR-0004](../adr/0004-save-file-only.md) (pure save-file
analyzer) and [ADR-0003](../adr/0003-context-layer.md) (deterministic code owns
crypto/arithmetic; the model interprets, it never computes).

Tags: **verified** = figure/fact read from the cited source during this
research · **inferred** = derived from verified anchors, awaiting local
measurement · **estimated** = order-of-magnitude judgment call.

Primary sources, cited per row below:

- **[ADR3]** / **[ADR4]** — repo `docs/adr/0003-context-layer.md`,
  `docs/adr/0004-save-file-only.md`
- **[PKHeX]** — kwsch/PKHeX (pushed 2026-08-23, 5,066 stars, GPL-3.0-or-later
  per `PKHeX.Core.csproj`)
  <https://github.com/kwsch/PKHeX/tree/master/PKHeX.Core>
- **[wasm]** — EthanThatOneKid/pkhex-wasm ("Web bindings for PKHeX.Core",
  created 2026-08-22, pushed 2026-08-24) + its locked v1 spec
  <https://github.com/EthanThatOneKid/pkhex-wasm> ·
  <https://raw.githubusercontent.com/EthanThatOneKid/pkhex-wasm/main/docs/spec/v1-api.md>
- **[pokality]** — the unrelated npm package `pkhex@26.1.22`
  (publisher monokrome, homepage `pokality/pkhex`, whose GitHub repo now
  returns 404 — orphaned); its `api-wrapper.d.ts` survives on jsDelivr
  <https://cdn.jsdelivr.net/npm/pkhex@26.1.22/api-wrapper.d.ts>
- **[Deno]** — Deno subprocess API (`Deno.Command` / `Deno.spawn*`, piped
  stdio, `--allow-run`; Deno ≥ 2.7 shorthands)
  <https://docs.deno.com/api/deno/subprocess/> ·
  <https://docs.deno.com/examples/subprocess_tutorial/>
- **[AOT-ms]** — Thinktecture NativeAOT startup measurements (.NET 8):
  ~14 ms Linux / ~17 ms Windows 11 vs ~70–80 ms regular CLR
  <https://www.thinktecture.com/en/net/native-aot-with-asp-net-core-overview/>
- **[ForceOps]** — domsleee/ForceOps PR #54 benchmark table: Native AOT
  9.8 ms vs framework-dependent 107.9 ms CLI startup (PR was folded into
  #49, but the hyperfine figures stand as stated in its description)
  <https://github.com/domsleee/ForceOps/pull/54>
- **[TTFR]** — Start Debugging, .NET 11 RC2, median of 50 cold launches,
  minimal API time-to-first-request: AOT 37 ms / R2R 84 ms / JIT 118 ms;
  publish size AOT 13 MB / self-contained R2R 91 MB / fw-dep 4.3 MB + shared
  runtime <https://startdebugging.net/2026/05/native-aot-vs-readytorun-vs-jit-in-dotnet-11/>
- **[MS-AOT]** — Microsoft, Native AOT deployment overview (self-contained,
  RID-specific, no runtime install)
  <https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/>
- **[dotnet-install]** — Microsoft .NET download/install pages (runtime
  channels; console apps need only the base .NET Runtime)
  <https://dotnet.microsoft.com/en-us/download/dotnet/10.0> ·
  <https://learn.microsoft.com/en-us/dotnet/core/install/windows>

## TL;DR

Ship PKHeX.Core decode behind a **standalone C# NativeAOT self-contained
executable** that the Deno server **spawns per MCP tool call** over
**piped stdio with newline-delimited JSON** — one request line in, one
response line out. Read-only enforcement is layered: policy (path resolution,
caps, op allowlist) stays in the Deno boundary; the sidecar opens the save
read-only and simply has no write-shaped ops. Loopback HTTP is a documented
debug alternative, not the default.

## Recommendation matrix

| Criterion | 1. AOT self-contained exe | 2. Framework-dependent exe | 3. pkhex-wasm (managed binding) | 4. Native embed (`UnmanagedCallersOnly` + `Deno.dlopen`) |
| --- | --- | --- | --- | --- |
| Lifecycle under Deno | Spawn-per-call or resident; both trivial via [Deno] `Deno.Command` | Same mechanics, slower each launch | In-process wasm module; hosting verdict is `wasmbrowser` (browser); Node loading explicitly avoided in its E2E [wasm] | Loaded into the Deno process itself; crash = server crash |
| Cold-start cost | ~10–17 ms verified hello-world [AOT-ms][ForceOps]; ≤ ~200 ms realistic per-call incl. SAV4 parse (inferred) | ~80–110 ms verified [AOT-ms][ForceOps]; plus first-run runtime check | Browser-measured only: ~6 MB gz fetch + wasm instantiate before first answer [wasm] (inferred for Deno) | Zero process spawn, but every call pays FFI marshal tax (unmeasured) |
| Footprint per channel | One `.exe` per RID, ~15–30 MB (estimated; 13 MB verified floor for minimal-API AOT [TTFR]) | ~2–6 MB app + user-installed .NET Runtime (≈35 MB installer, ~150 MB disk — estimated [dotnet-install]) | npm tarball, ~6 MB gz transfer, 8 MB hard gate [wasm] | Similar bytes to AOT, split across host + exported DLL (estimated) |
| Cross-repo coupling | Own repo, own release cadence; depends only on NuGet `PKHeX.Core` [PKHeX] | Same | Second repo owned by same person but **pre-v1**: spec locked 2026-08-22, implementation underway, **not yet on npm** [wasm]; sequencing risk for v0.3 | Tooling churn (DllExport projects) or hand-maintained export shims |
| Surface covers bag/dex/badges/story flags? | Yes — we define ops directly over Core's `PlayerBag4Pt`/`Zukan4`/flag regions | Same | **No.** Locked v1 = trainer, boxes, party, lookups only; pouch contents, dex, badges, event flags are absent from v1 [wasm]. (The old pokality npm wrapper had them [pokality], but its repo is gone and it is a different project.) | Whatever we hand-marshall; every field costs bespoke unsafe code |
| Risk profile | Trim/AOT warnings around `EntityConverter`/`EvolutionTree` already catalogued by the sibling project's risk register [wasm]; trackable per upstream bump | Runtime presence/version drift on player machines; slowest launches | Off-spec host (Deno ≠ browser), blocked on another repo's v1, missing scanner regions | Highest: manual UTF-8/struct marshalling, GC pinning, per-RID native builds, hardest debugging |
| Read-only story | Sidecar opens file read-only; no write ops compiled in; Deno still owns policy [ADR4] | Same | Edit-tier mutators are the product — wrong direction for a read-only server [ADR4] | Same as AOT but enforced by convention over FFI |

## Startup-cost table (measured anchors, then our projection)

| Scenario | Figure | Status | Source |
| --- | --- | --- | --- |
| NativeAOT hello/console, Windows 11, avg of 10+ runs | ~17 ms | verified | [AOT-ms] |
| NativeAOT CLI tool, end-to-end startup | 9.8 ms | verified | [ForceOps] |
| Framework-dependent CLI tool, end-to-end startup | 107.9 ms | verified | [ForceOps] |
| Regular CLR console, Windows, avg | ~80 ms | verified | [AOT-ms] |
| Minimal API, median cold launch ×50: AOT / R2R / JIT | 37 / 84 / 118 ms | verified | [TTFR] |
| AWS Lambda AOT custom-runtime cold start, avg of 100 | 129.8 ms (includes cloud infra overhead) | verified | <https://nodogmablog.bryanhogan.net/2022/11/lambda-cold-starts-net-7-native-aot-vs-net-6-managed-runtime/> |
| **Projected pkhex-sidecar call**: process create + AOT init + open/decrypt/parse 512 KB SAV4 + emit JSON | ~50–200 ms on the dev desktop | inferred (anchors above; parse cost unmeasured) | this doc |
| pkhex-wasm bootstrap: ~6 MB gz assets fetched + wasm runtime instantiated | hundreds of ms minimum, browser-conditioned | inferred | [wasm] |

Context that makes the projection cheap: MCP tool calls are paced by LLM
turns (seconds), so even the pessimistic 200 ms is invisible to users, and
per-call spawn buys crash isolation for free.

## Process & transport contract

### Lifecycle: spawn-per-call is the default; resident is an upgrade, not a starting point

- **Deno keeps nothing alive — deliberately.** Each tool call runs
  `new Deno.Command(sidecarPath, { args: [...], stdin: "piped", stdout:
  "piped" })` and awaits `output()` ([Deno]). The OS reaps the child; there is
  no supervisor loop, no orphan/zombie handling, no restart logic to write.
- Freshness falls out for free: every call re-reads `PKHEX_SAVE_PATH`, which
  is exactly the ADR-0004 freshness model ("answers reflect the last in-game
  save") [ADR4]. A resident process holding a parsed save would either add
  staleness (cache) or save only the ~10–20 ms AOT init while still re-reading
  the file (pointless).
- Crash isolation: a hung or crashed decode poisons one tool call, not the
  server. Kill-by-timeout is a one-line race around `output()`.
- **If profiling ever demands residency**, the same binary grows a `serve`
  subcommand speaking identical NDJSON frames over the same pipes; Deno holds
  the `ChildProcess` handle and restarts on `status` exit. Nothing about the
  message format changes — that is why the framing below matters more than the
  lifecycle choice.

### Why stdio pipes beat loopback HTTP here

No port to pick, collide with, or leak; no listener socket for security tools
to flag; child lifetime mechanically tied to pipe EOF (parent death closes
stdin → sidecar exits); `Deno.Command.output()` collects the whole exchange in
one await. HTTP-on-127.0.0.1 remains useful when debugging the sidecar by hand
(curl-able) — support it as a hidden dev flag if needed, ship pipes as the
contract.

### Wire format: plain JSON, one object per line (NDJSON)

```
→ {"v":1,"id":"t1","op":"get_party","params":{"save":"C:\\…\\platinum.sav"}}
← {"v":1,"id":"t1","ok":true,"data":{ …decoded party… }}
← {"v":1,"id":"t9","ok":false,"error":{"code":"parse_failed","message":"footer CRC mismatch at 0x1F10E"}}
```

- One request line → exactly one response line, ordered; `id` echoes for
  safety; `v` gates future evolution. Human diagnostics go to stderr only.
- Exit codes for the one-shot mode: `0` ok · `1` usage/unknown op · `2` IO
  (missing/unreadable save) · `3` parse failure (torn/corrupt region maps
  here, mirroring the torn-read vocabulary in CONTEXT.md) · `4` protocol
  violation. A structured error body always accompanies non-zero exits where a
  line was consumable.
- `--version` emits `{name, protocolVersion, pkhexCoreVersion}` JSON so the
  server can assert compatibility with a throwaway spawn at startup.
- Errors carry a machine-readable `code` enum so scanners can classify
  (retryable vs fatal) without string-matching — the same determinism stance
  as ADR-0003's "no silent truncation" rule.

### Where read-only + loopback enforcement lives

Two layers, on purpose:

1. **Deno boundary (policy owner)** — resolves/validates `PKHEX_SAVE_PATH`,
   allowlists ops per MCP tool, applies caps (e.g. `read_raw_region`'s 1 KB
   compact-base64 ceiling [ADR3]), and is the only component that knows MCP
   exists.
2. **Sidecar (capability limit)** — opens the save with a read-only
   `FileStream` (`FileShare.Read`), exposes only read-shaped ops, never
   writes anywhere. Even a compromised or misconfigured invocation chain
   cannot mutate the save through it.

Loopback enforcement is moot under stdio (there is no socket); if the dev-only
HTTP mode exists, it binds `127.0.0.1` exclusively inside the sidecar.

## Distribution footprint per channel

| Channel | What ships | Size | Status |
| --- | --- | --- | --- |
| AOT self-contained (recommended) | Single `pkhex-sidecar.exe` per RID (win-x64 first), zero prerequisites [MS-AOT] | ~15–30 MB (13 MB verified as minimal-API AOT floor [TTFR]; PKHeX.Core's tables add mass — measure at first publish) | estimated |
| Self-contained JIT/R2R | App + bundled runtime | 91 MB R2R verified [TTFR]; plain self-contained ~65–70 MB | verified/estimated |
| Framework-dependent | Tiny app + user installs .NET Runtime (console apps need only base runtime [dotnet-install]); ≈35 MB installer, ~150 MB disk | app ~2–6 MB | estimated |
| pkhex-wasm npm | ESM tarball + `_framework` runtime assets, brotli siblings, GPL kit | ~6 MB gz transfer, 8 MB hard build gate | verified [wasm] |
| Native embed | Exported DLL + host glue per RID | comparable to AOT, split | estimated |

GPL note: PKHeX.Core is GPL-3.0-or-later [PKHeX], so any channel that
distributes binaries linking it owes corresponding source — the
compliance-kit pattern (complete source + notices + modification log inside
the artifact) already designed for pkhex-wasm [wasm] ports directly to a
sidecar release channel.

## Rejected alternatives, specifically

- **Framework-dependent (shape 2)** — loses on every axis that matters for a
  player-facing desktop tool: users must install a runtime (~35 MB installer,
  version-matching pain), and every launch pays ~3–10× the startup cost
  ([AOT-ms], [ForceOps]). Only wins if AOT trimming fights PKHeX.Core harder
  than expected — keep as fallback, not default.
- **pkhex-wasm (shape 3)** — right idea, wrong shape *for this server*, and
  the analysis changed once I found the exact repo: it is
  EthanThatOneKid/pkhex-wasm, created 2026-08-22, spec locked, implementation
  underway [wasm]. Three disqualifiers for v0.3: (a) its locked v1 surface has
  trainer/boxes/party only — no bag, dex, badges, or story flags, i.e. the
  core-matrix regions v0.3 exists to serve (its `items` member is a name
  lookup table, not bag contents); (b) its locked hosting verdict is the
  browser `wasmbrowser` workload with non-browser loading explicitly kept out
  of its E2E — a repo-shipped `examples/deno-cli.ts` shows Deno use is
  *contemplated*, but it is untested territory per its own testing spec, so a
  Deno host would be off-spec improvisation; (c) it is unpublished, so
  adopting it blocks v0.3 on another repo's release train.
  It remains the correct vehicle for any future *browser* Inspector work, and
  its facade design (Handles over Core structures, managed crypto registration
  before first parse, trim-warning register) is directly reusable knowledge
  for the sidecar's C# seam.
- **Native embed (shape 4)** — `Deno.dlopen` + `[UnmanagedCallersOnly]`
  exports (or legacy DllExport rewriting) saves the ~10–20 ms spawn but costs
  hand-written UTF-8/struct marshalling for every field of every scanner,
  GC-pinning discipline, per-RID native artifacts, and in-process crashes take
  the whole MCP server down. Worst maintainability per feature delivered;
  reject outright.
- *(Historical footnote: the npm package `pkhex` — a different, richer JS
  binding by pokality with bag/dex/badges/event-flag coverage — is orphaned;
  its GitHub repo 404s while the tarball lingers on npm/jsDelivr [pokality].
  Building on it is untenable; it is cited only as evidence that the fuller
  wrapper surface is achievable over Core.)*

## Recommended default

**Shape 1 — NativeAOT self-contained `pkhex-sidecar.exe`, spawned per MCP tool
call by the Deno server over piped stdio, speaking one-JSON-object-per-line.**
Reasoning: it is the only option that simultaneously satisfies ADR-0004's
read-only freshness model (fresh file read per call, no cache to go stale),
keeps all arithmetic in deterministic C# per ADR-0003, adds ≤ ~200 ms to
calls that are LLM-paced anyway, requires zero runtime prerequisites for
players (single ~15–30 MB exe), keeps crash blast-radius to one tool call,
and leaves the resident-mode upgrade path open without changing the wire
format. Sequencing note: nothing in v0.3 waits on pkhex-wasm.

Open follow-ups for the implementation tickets:

1. Measure the projected 50–200 ms locally (hyperfine-style loop over the
   real Platinum save) and record actual AOT publish size — replaces the two
   inferred cells above.
2. Probe `dotnet publish -r win-x64 -c Release` AOT warnings against current
   PKHeX.Core (net10.0); triage the `EntityConverter`/`EvolutionTree` trim
   class early [wasm].
3. Decide the op list (likely mirrors the acceptance battery + core-matrix
   regions: party, box, bag, dex, badges, flags, trainer card, section map).
