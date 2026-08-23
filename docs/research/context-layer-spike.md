# Spike findings — raw-save context layer (v0.2 prototype)

Date: 2026-08-23 · Save under test: `local/platinum.mln.sav` (512 KB, two 256 KB
slots) Method: known-plaintext reverse engineering with throwaway Deno scripts;
reference tables from `src/gen4/data/*`; zero production code changed.

## Ground truth supplied by the player (in-game, active slot)

| Question          | Player-stated truth       |
| ----------------- | ------------------------- |
| Badges            | 3                         |
| Certain bag items | Repel ×2, Yellow Shard ×2 |
| Pokédex           | 102 seen / 41 obtained    |

## Results

### ✅ Active-slot identification (trivial, works)

Both halves decode through the existing anchor offsets (`TID/SID @slot+0x78`,
playtime @`+0x8A..8D`, partyCount @`+0x9C`, party @`+0xA0`). Slot 1 (`0x40000`)
shows playtime **61 h 40 m 14 s** matching today's live sync; slot 0 holds an
older 61 h 21 m state. Slot headers are identical (`00 09 BF 11 22 33 01 01`) so
recency needs either playtime comparison or a real counter offset (research
follow-up).

### ✅ Open question: "What's in my bag?" — fully answered

Exact pair hits `[itemId u16][count u16]`: **Repel ×2 @0x40630**, **Yellow Shard
×2 @0x40634** (active-slot absolute offsets) — matches ground truth precisely.
Pocket structure emerged from density runs of valid pairs:

| Region (abs) | Pocket                   | Sample contents                                                                                         |
| ------------ | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| 0x40630      | Items (misc)             | Repel ×2, Yellow Shard ×2, Escape Rope, Big Pearl ×2, Honey ×8, Stardust ×2, Green Shard, Silver Powder |
| 0x4067C      | Items (hold/key-ish)     | Soothe Bell, Fire/Water/Thunder Stone, Nugget, Mind Plate, Odd Incense, Cleanse Tag                     |
| 0x40B4C      | Medicine/etc. (31 pairs) | Antidote ×7, Paralyze Heal ×2, Super Potion, Awakening, Revive ×4, Burn Heal, Rare Candy ×3, Ether ×3   |
| 0x40CEC      | Balls (11 pairs)         | Poké Ball ×30, Premier Ball ×6, Net Ball ×2, Heal Ball, Great Ball ×5, Ultra Ball                       |
| 0x40D28      | Battle items (15 pairs)  | X Attack/Accuracy/Defense/Sp.Atk/Sp.Def, Dire Hit, Guard Spec., X Speed                                 |

All ids resolve cleanly against `ITEMS` (Gen IV game_index keyed). No false
positives among ≥6-pair runs.

### 🟡 Open question: Pokédex seen/caught — candidate region, not yet pinned

Popcount scans near the bag found windows reading ≈105 seen / ≈42 caught against
truth 102/41 — consistent with window edges swallowing adjacent bag bytes. True
bitfields are likely within `0x405xx–0x407xx` but need alignment/order research
(Gen IV dex flag ordering is not plain national order). Follow-up:
exact-popcount scan (102 & 41) over byte- and bit-offset variants, plus
cross-checking a species the player knows they've caught.

### 🟡 Open question: Badge case — ambiguous without a second sample

Byte `0x07` census: 85 positions identical across both slots, 19 changed. A
single snapshot cannot discriminate the real badge byte from other flag-bytes
that happen to equal 7. Resolution path: diff consecutive BizHawk SaveRAM
flushes around a badge event, or consult PKHeX's `Gen4SaveFile` badge offset and
verify against it.

### ✅ Baseline questions re-proven through the raw path

Trainer card essentials (name, TID 1256 / SID 32863, playtime, map 120, party 6)
reproduce from slot-relative anchors — these become the seed rows of the
machine-readable offset map.

### ✅ Addendum: live map anchor cross-check (same day, later session)

Player-stated location **Pastoria City** while standing there matched a fresh
live frame reading **mapId 120** (77 ms age; playtime advanced 61 h 40 m → 61 h
54 m, proving freshness). Two consequences:

1. The implicit "120 = Veilstone" attribution from earlier sessions was never
   player-verified and is hereby superseded — treat 120 as Pastoria City pending
   further samples.
2. A **Gen IV map-id → name reference table** must join the v0.2 reference
   resources; without it, every location answer inherits guesswork exactly like
   this.

## Token economics observed

| Access pattern                         | Bytes into context | Approx tokens       |
| -------------------------------------- | ------------------ | ------------------- |
| Decoded answer only (server-side scan) | ~300–600 chars     | ~150–300            |
| Raw b64 of one pocket (~120 B)         | ~160 chars         | ~50                 |
| Naive whole-file dump                  | 512 KB             | ~700 K — impossible |

**Lesson**: the winning shape is _server-side scanners that return decoded
answers_, with raw-region reads (`read_raw_region`, b64, ≤1 KB cap) reserved for
genuinely novel exploration. Scanning costs CPU locally and ~zero tokens; that
asymmetry is the core economic argument for the hybrid architecture.

## Boundary rule validated

No checksum/LCG arithmetic was needed for any answered question — but dex
bit-ordering and slot-recency counters show the same risk class. Keep
crypto/arithmetic deterministic in tools; give the model semantics + navigation.

## Seeds for the offset-map artifact (`get_section_map`)

Trainer/party anchors below restate the verified table from the
[`research/platinum-memory-map`](https://github.com/EthanThatOneKid/pkhex-mcp/tree/research/platinum-memory-map)
branch — treat that document as authoritative for them; bag rows are new.

| Field               | Offset (slot-relative)         | Note                           |
| ------------------- | ------------------------------ | ------------------------------ |
| TID/SID             | 0x78 u32                       | verified                       |
| Playtime h/m/s      | 0x8A u16, 0x8C u8, 0x8D u8     | verified                       |
| Party count         | 0x9C u8                        | verified                       |
| Party slots ×6      | 0xA0, stride 0xEC              | verified                       |
| Map id              | 0x1280 u16                     | verified ×2 (live cross-check) |
| Bag misc pocket     | 0x0630 (slot-rel; abs 0x40630) | spike                          |
| Bag hold/key pocket | 0x067C (abs 0x4067C)           | spike                          |
| Bag medicine pocket | 0x0B4C (abs 0x40B4C)           | spike                          |
| Bag balls pocket    | 0x0CEC (abs 0x40CEC)           | spike                          |
| Bag battle pocket   | 0x0D28 (abs 0x40D28)           | spike                          |
| Dex seen/caught     | ~0x25xx–0x27xx window          | partial                        |

(Note: offsets above are slot-relative for the active second half; pocket
capacities/ordering tables are ticket work.)

## Implications for the build tickets

1. Confirmed demand for `find_item_pairs(id?, count?)`-style scanner tools —
   they turned an open question into a 300-token answer.
2. `read_raw_region(source, off, len)` still wanted for exploration beyond known
   scanners; cap ≤1 KB.
3. Slot-recency + dex/bit-order belong in deterministic helpers/research, not
   model reasoning.
4. Badge/dex pinning needs a live-flush diff session — cheap to schedule while
   the user plays.
