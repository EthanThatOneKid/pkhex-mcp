# Research: Gen IV slot-recency counter offset

**Researched:** 2026-08-23 · **Ticket:** [#23](https://github.com/EthanThatOneKid/pkhex-mcp/issues/23) · **Confidence: HIGH** (authoritative PKHeX implementation + independent Bulbapedia documentation + verified byte-for-byte against `local/platinum.mln.sav`)

## The rule (stated precisely)

A Platinum (US) `.sav` is two `0x40000` partitions. Each block inside a partition ends with a **20-byte footer**, and the footer carries two monotonically incrementing counters. **The active copy of a block is whichever partition's footer has the larger counter** — playtime, TID/SID, and headers are irrelevant to selection.

Footer location and layout (Platinum sizes: General `0xCF2C`, Storage starts at `0xCF2C`, length `0x121E4`; per-partition stride `0x40000`):

| Field | Footer rel. | Type | Notes |
|---|---|---|---|
| Major counter | `+0x00` | u32 LE | Primary recency counter; also pairs a small block to its big-block partner |
| Minor counter | `+0x04` | u32 LE | Secondary counter ("number of the save"); tiebreaker only |
| Block size | `+0x08` | u32 LE | e.g. `0xCF2C` / `0x121E4` |
| Magic | `+0x0C` | u32 LE | `0x20060623` international/Japanese, `0x20070903` Korean |
| Block type | `+0x10` | u16 LE | `0`=general, `1`=storage |
| Checksum | `+0x12` | u16 LE | CRC-16-CCITT (`poly 0x1021`, init `0xFFFF`) over block minus its footer |

Absolute footer offsets (Platinum):

| Block | Partition 0 | Partition 1 |
|---|---|---|
| General | `0x0CF18` (= `0xCF2C − 0x14`) | `0x4CF18` |
| Storage | `0x1F0FC` (= `0xCF2C + 0x121E4 − 0x14`) | `0x5F0FC` |

Selection algorithm — this is a faithful port of PKHeX `SAV4BlockDetection.CompareFooters` (see citations):

1. Read major counters `M0` @ partition-0 footer `+0x00`, `M1` @ partition-1 footer `+0x00`.
2. **Sentinel/wraparound handling:** if exactly one counter equals `0xFFFFFFFF` and the other is not `0xFFFFFFFE`, the `0xFFFFFFFF` side loses (treated as uninitialized flash fill). Otherwise plain unsigned comparison.
3. Higher major wins. If `M0 == M1`, repeat steps 2–3 with the **minor** counters at `+0x04`.
4. If both tie, **partition 0 wins** (lower half). PKHeX returns `First` on a full tie and notes this "shouldn't happen for valid saves."

Wraparound semantics: there is **no modular subtraction / half-range arithmetic**. The only rollover accommodation is the `0xFFFFFFFF` sentinel rule above; a genuine `0xFFFFFFFE → wrap` race is deemed humanly impossible (~4 billion saves).

Nuance that matters for readers: **General and Storage blocks are selected independently** (box saves rewrite only Storage; story progress rewrites mostly General). They usually agree but needn't. Trainer-card fields live in General, so slot selection for our purposes means comparing the two *General* footers.

## Evidence — `local/platinum.mln.sav` (read-only Deno verification, 2026-08-23)

| What | Partition 0 (`0x00000`) | Partition 1 (`0x40000`) | Verdict |
|---|---|---|---|
| General footer @ | `0x0CF18` | `0x4CF18` | — |
| Major counter | `0x0000000C` | **`0x0000000D`** | P1 newer |
| Minor counter | `0x0000000E` | **`0x0000000F`** | consistent |
| Size field | `0xCF2C` | `0xCF2C` | matches Pt |
| Magic | `0x20060623` | `0x20060623` | international Pt |
| Type | `0` | `0` | general |
| CRC-16 saved vs calc | `0x9B31` = `0x9B31` ✔ | `0xCAD0` = `0xCAD0` ✔ | both valid |
| Storage major/minor | `0x0C`/`0x0E` | **`0x0D`/`0x0F`** | P1 newer |
| Storage CRC | ✔ | ✔ | both valid |
| TID/SID | 1256 / 32863 | 1256 / 32863 | identical, useless for selection |
| Playtime | 61 h 21 m 24 s | **61 h 40 m 14 s** | ground truth: P1 active |

`CompareFooters` verdict: **Second** (partition 1, base `0x40000`), decided on the **major counter alone** — matching the known truth from the context-layer spike (active half shows the newer playtime, 61h40m). Both partitions' CRCs validate, so checksum cannot disambiguate on its own; only the counters can.

The first 8 bytes of each partition (RTC-offset i64) were `00×8` in this sample and are identical across halves — confirming the ticket's observation that half-start "headers" cannot select the slot.

## Citations

- PKHeX `SAV4BlockDetection.cs` — `CompareFooters`/`CompareCounters`: https://github.com/kwsch/PKHeX/blob/master/PKHeX.Core/Saves/Substructures/Gen4/SAV4BlockDetection.cs
- PKHeX `SAV4.cs` — `PartitionSize=0x40000`, `GetActiveBlock(data, begin, len)` → footer at `begin+len−0x14`, magic/CRC fields, independent General/Storage selection: https://github.com/kwsch/PKHeX/blob/master/PKHeX.Core/Saves/SAV4.cs
- PKHeX `SAV4Pt.cs` — `GeneralSize=0xCF2C`, `StorageSize=0x121E4`: https://github.com/kwsch/PKHeX/blob/master/PKHeX.Core/Saves/SAV4Pt.cs
- Bulbapedia, *Save data structure (Generation IV)* — footer field table + worked example ("higher count = current"): https://bulbapedia.bulbagarden.net/wiki/Save_data_structure_(Generation_IV)

## Recommended default for the reader implementation

Default strategy: port `CompareFooters` verbatim — read u32 LE at `0xCF18` and `0x4CF18`, pick the larger under PKHeX's sentinel semantics (`0xFFFFFFFF` loses unless the counterpart is `0xFFFFFFFE`), break a major-counter tie on the minors at `+0x04`, and on a full tie fall back to partition 0 while surfacing an "ambiguous slot" warning rather than silently guessing. Before trusting the winner, verify its CRC-16-CCITT (footer `+0x12` over the block minus footer); if neither half's General CRC validates, reject the file as corrupt instead of picking either half, and if only the loser validates (save interrupted mid-write), prefer the checksum-valid half and log the anomaly. Do not use playtime, TID/SID, or half-start headers for selection — reserve the spike's playtime comparison purely as a diagnostic sanity signal (warn if it disagrees with the counter verdict).
