# Gen IV offset map — Pokémon Platinum US (`offsets.ts` companion)

**Researched:** 2026-08-23 · Ticket [#27](https://github.com/EthanThatOneKid/pkhex-mcp/issues/27) ·
Machine-readable twin: [`src/gen4/save/offsets.ts`](../../src/gen4/save/offsets.ts) ·
Save under test: `local/platinum.mln.sav` (512 KB = two 256 KB partitions).

Tags: **verified** = cross-checked against PKHeX source *and* probed against the reference save on
2026-08-23 · **inferred** = sourced from PKHeX/decomp but awaiting a second sample (flush-pair diff,
ticket #24).

Primary sources, cited per row below:

- **[SAV4]** — PKHeX `PKHeX.Core/Saves/SAV4.cs`
  <https://github.com/kwsch/PKHeX/blob/master/PKHeX.Core/Saves/SAV4.cs>
- **[Sinnoh]** — PKHeX `Saves/SAV4Sinnoh.cs`
- **[Pt]** — PKHeX `Saves/SAV4Pt.cs`
- **[Zukan]** — PKHeX `Saves/Substructures/PokeDex/Zukan4.cs`
- **[Bag4Pt]** — PKHeX `Items/Bags/PlayerBag4Pt.cs`; **[Store4]** — `Items/ItemStorage4.cs` / `ItemStorage4Pt.cs`
- **[Pouch]** — PKHeX `Saves/Substructures/Inventory/Pouch/InventoryPouch4.cs`
- **[CRC]** — PKHeX `Saves/Util/Checksums.cs` (`CRC16_CCITT`)
- **[Flags]** — PKHeX curated Pt flag list `Resources/text/script/gen4/flags_pt_en.txt`
- **[pp-maps]** — pret/pokeplatinum `generated/map_headers.txt`
- **[pp-badges]** — pret/pokeplatinum `generated/badges.txt`
- **[spike]** — repo `docs/research/context-layer-spike.md` (+ its live map addendum)

## File & block layout

| Region | Offset | Size | Notes | Tag |
| --- | --- | --- | --- | --- |
| Partition 0 / 1 | `0x00000` / `0x40000` | `0x40000` each | Two full save copies; game writes both. | verified [SAV4] |
| General ("small") block | partition+`0x00000` | `0xCF2C` | Trainer card, bag, dex, party, flags. Footer `0x14`. | verified [Pt] |
| Storage ("large") block | partition+`0x0CF2C` | `0x121E4` | PC boxes; ends at partition+`0x1F110`. **Gen IV stores PC storage outside the general block — this is where.** | verified [Pt] |
| Block footer | block end−`0x14` | `0x14` | u16 LE CRC16-CCITT at end−2; save magic `0x20060623` at end−8..−4. | verified [SAV4][CRC] |
| Extra blocks | `0x20000`,`0x23000`,`0x24000`,`0x26000`,`0x28000`,`0x2A000` | `0x2AC0`,`0xBB0`,`0x1D60`×4 | Hall of Fame, Battle Hall, 4 battle videos — own footers, partition-relative. | verified [Pt] |

Activity check on reference save: **all four footers validate simultaneously** (gen+storage × both
partitions), so recency needs playtime comparison or counter research → ticket #23.

## Trainer card (general-block relative)

| Field | Offset | Type | Value on reference save | Tag |
| --- | --- | --- | --- | --- |
| OT name | `0x68` | utf16×7 (16 B) | — | verified [SAV4] |
| TID16 | `0x78` | u16 | 1256 (= player truth) | verified [SAV4] |
| SID16 | `0x7A` | u16 | 32863 (= truth) | verified [SAV4] |
| ID32 | `0x78` | u32 | TID\|SID<<16 | verified [SAV4] |
| **Money** | `0x7C` | u32 | 91,124 ≤ cap 999,999 | verified [SAV4] |
| Gender | `0x80` | u8 | — | verified [SAV4] |
| Language | `0x81` | u8 | — | verified [SAV4] |
| **Badges bitmask** | `0x82` | bitfield[8] | `0b00010011` = 3 badges ✓ | verified [SAV4] |
| Sprite | `0x83` | u8 | — | inferred [SAV4] |
| Progress flags | `0x85` | bits | bit0 Game Clear, bit1 National Dex; reads 0 mid-run | verified [SAV4] |
| Coins | `0x88` | u16 | 66 ≤ cap 50,000 | verified [SAV4] |
| Playtime h/m/s | `0x8A`/`0x8C`/`0x8D` | u16/u8/u8 | 61:40:14 (= spike slot-1 anchor) | verified [SAV4] |
| Seconds-to-start | `0x34` | u32 | AdventureInfo base = 0 | verified [Pt] |
| Seconds-to-fame | `0x3C` | u32 | `0xFFFFFFFF` until champion | verified [Pt] |
| Rival name | `0x27E8` | utf16×7 | — | verified [Pt] |

## Party

| Field | Offset | Type | Notes | Tag |
| --- | --- | --- | --- | --- |
| Party count | `0x9C` | u8 | read 6 | verified [SAV4] |
| Slots ×6 | `0xA0` | record stride `0xEC` (236 B) | matches repo `deserialize.ts SLOT_SIZE` | verified [Pt][spike] |

## Badges → gym mapping

Bit *i* of byte `0x82` = badge enum *i* (**inferred**, from [pp-badges]; single-sample so far):

bit0 Coal (Roark/Oreburgh) · bit1 Forest (Gardenia/Eterna) · bit2 Cobble (Maylene/Veilstone) ·
bit3 Fen (Wake/Pastoria) · bit4 Relic (Fantina/Hearthome) · bit5 Mine (Byron/Canalave) ·
bit6 Icicle (Candice/Snowpoint) · bit7 Beacon (Volkner/Sunyshore).

Reference save reads `0b00010011` ⇒ {Coal, Forest, Relic} — consistent with a Platinum route where
Fantina preceded Maylene. Pin bit order via #24 flush-pair diff around badge 4.

## Bag (general-relative base `0x630`)

Every entry is `[u16 itemId][u16 count]`, LE. Empty slot = `0000 0000`; pockets occupy leading
slots. Offsets/capacities from [Bag4Pt]/[Store4]; spot contents matched [spike] exactly
(Repel ×2 @items head, Antidote ×7 @medicine, Poké Ball ×30 + Premier ×6 + Net ×2 @balls).

| Pouch | Bag-rel offset | Slot capacity¹ | Legal slots² | Max stack | Tag |
| --- | --- | --- | --- | --- | --- |
| Items | `0x000` | 165 | 162 | 999 | offsets verified [Bag4Pt] |
| Key Items | `0x294` | 50 | 40 | 1 | 〃 |
| TMs & HMs | `0x35C` | 100 | 100 | 99 (HM=1) | 〃 |
| Mail | `0x4EC` | 12 | 12 | 999 | 〃 |
| Medicine | `0x51C` | 40 | 38 | 999 | 〃 |
| Berries | `0x5BC` | 64 | 64 | 999 | 〃 |
| Poké Balls | `0x6BC` | 15 | 15 | 999 | 〃 |
| Battle Items | `0x6F8` | ≥13³ | 13 | 99³ | 〃 |

¹ distance to next pouch ÷ 4 (verified arithmetic).
² PKHeX legal-list length ([Store4]); trailing region bytes are padding.
³ Extent unpinned — EventWork begins `0xDAC`.

## Pokédex (general-relative base `0x1328`) — ordering resolved

Structure [Zukan]: `u32 magic` then four `0x40`-byte bit regions:

| Region | Base rel | Bits | Tag |
| --- | --- | --- | --- |
| Magic | `+0x000` | observed `0xBEEFCAFE` | verified |
| Caught | `+0x004` | species bit = natdex id − 1, **LSB-first within each byte** | verified |
| Seen | `+0x044` | same rule | verified |
| Seen-gender first/second | `+0x084` / `+0x0C4` | 2-bit gender-seen state per species | verified (layout) / inferred (semantics) |

The earlier open question "dex flag ordering is not plain national order" is now closed: it **is**
national-dex order with LSB-first packing — decoding the caught region yields a coherent Sinnoh
playthrough list (Turtwig line, Starly/Bidoof/Shinx, Unown, Rotom…), and popcounts match player
truth once masked (below).

**Popcount caveat (new empirical finding):** the final byte (`region+0x3F`) of caught and seen
regions reads `0xFF` on the reference save (gender regions read `0x00`). Masking indices ≥493 turns
raw popcounts 49→41 caught and 110→102 seen — exact match with player-stated truth. Scanners should
cap species ids at 493.

Form extras (all inferred [Zukan]): Spinda PID `+0x104` · Shellos/Gastrodon/Burmy/Wormadam +
28 Unown slots `+0x108..` · language flags `+0x128` (0x1F4 bytes, Pt layout) · Rotom u32
`+0x31C`, Shaymin `+0x320`, Giratina `+0x321`.

## PC storage (storage-block relative)

| Field | Offset | Type | Notes | Tag |
| --- | --- | --- | --- | --- |
| Current box | `+0x000` | u8 | read 1 | verified [Sinnoh] |
| Box data | `+0x004` | 18 × 30 × 136 B | Gen IV stored record = 136 B (0x88); box stride `0xFF0`, no padding | verified [Sinnoh] |
| Box names | `+0x11EE4` | utf16×8 ×18 | 40 B each | verified [Sinnoh] |
| Wallpapers | `+0x121B4` | u8 ×18 | Pt specials shifted +8 | verified [Sinnoh][Pt] |
| Box flags | `+0x121C6` | bitfield | also hosts Pt unlockable-wallpaper bits | inferred [Pt] |

## Story-progress machinery

| Mechanism | Offset | Encoding | Notes | Tag |
| --- | --- | --- | --- | --- |
| Event WORKs | `0xDAC` | u16 array | work *i* at `0xDAC+2i` | verified [Pt] |
| Event FLAGs | `0xFEC` | bitfield ×2912 (`0xB60`) | flag *n* at `0xFEC+(n>>3)` bit `n&7` | verified [Pt] |
| Dex upgrade markers | `0x1640..0x1643` | u8 ×4 | ≥1→[0x1642], ≥2→[0x1640], ≥3→[0x1643], ==4→[0x1641] nonzero | verified [SAV4] |
| Game clear / Nat. Dex | `0x85` bits 0/1 | bits | trainer-card progress flags | verified [SAV4] |

Named story anchors (**inferred**, [Flags] — PKHeX's curated list; not yet live-tested): Dialga
captured 208 · Palkia 209 · Uxie 295 · Azelf 294 · Heatran battleable 293 / captured 288 ·
Regigigas 283 · Giratina 289 · Rotom 329 · event legendaries Darkrai 344 / Shaymin 291 / Arceus
286 · **Hall of Fame entered 2404** · Bebe's PC 2430 · WFC 2444.

**"Have I beaten gym X"**: use the badge bitmask (`0x82`) — badge award is atomic with gym clear.
Exact gym-defeat event-flag indices are not in any primary list we found (see gaps).

## Map id → name

The save's `M` field (`0x1280`, u16) is a **map-header id** (room level), not the met-location id
shown on Pokémon summaries — different spaces, don't mix them when answering "where was this
caught" vs "where is the player".

Source table: [pp-maps] `generated/map_headers.txt` (Platinum enum order). Verified anchor:
**120 = Pastoria City** (live frame while standing there, [spike] addendum). Decomposition-derived
anchors (inferred until sampled): 3 Jubilife · 33 Canalave · 45 Oreburgh · 65 Eterna · 86 Hearthome
· 132 Veilstone · 150 Sunyshore · 165 Snowpoint · 188 Fight Area · 411 Twinleaf · 418 Sandgem ·
450 Survival Area · 457 Resort Area · 504 Great Marsh.

This supersedes the spike's implicit "120 = Veilstone" guess and confirms its Pastoria correction.

## Known gaps

1. **Badge bit order** — inferred from decomp enum order; one-sample only (`0b00010011`). Resolve
   via SaveRAM flush-pair diff around badge #4 → ticket #24.
2. **Dex terminator byte** — final byte of caught/seen regions reads `0xFF` (this save); semantics
   unknown. Masking to species ≤493 is mandatory for correct seen/caught counts.
3. **Gym-defeat event flags** — not present in PKHeX's curated Pt flag list nor surfaced by
   pokeplatinum's generated flag dumps under obvious names. Badge bitmask covers the battery need;
   pin exact flags during the #24 session if wanted for finer questions (e.g., "beat leader but
   badge case shows X" edge cases don't exist in DPPt, so low priority).
4. **Battle-items pouch extent** — next block boundary unknown (EventWork starts `0xDAC`); capacity
   documented as ≥13 legal slots.
5. **Slot-recency counter** (#23) — both partitions validate by CRC; active-slot pick still relies
   on playtime comparison. PKHeX resolves ties via `SAV4BlockDetection.CompareFooters` (counter
   fields inside footers not yet mapped here).
6. **DP / HGSS variants out of scope** — DP shifts several constants (bag base differs, dex
   upgrade bytes `0x1404..0x1415`, no Pt form extras); HGSS uses a different storage start. This
   map is Platinum-only by design; generalize later if a DP/HGSS save arrives.
7. **Met-location names** — Pokémon-origin strings use the shared Gen IV met-location bank
   (`text_hgss_00000_*` in PKHeX; `Locations4.Met0` = ids 0–234), which is *not* the map-header
   space above. A separate table join is needed before answering provenance questions.
