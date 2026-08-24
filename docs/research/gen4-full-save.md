# Gen IV full-save region documentation sweep — Platinum US

**Researched:** 2026-08-24 · Ticket
[#41](https://github.com/EthanThatOneKid/pkhex-mcp/issues/41) (parent
[#33](https://github.com/EthanThatOneKid/pkhex-mcp/issues/33)) · Companion to
[`gen4-offsets.md`](gen4-offsets.md) (battery landmarks),
[`v03-core-matrix.md`](v03-core-matrix.md), and
[`v03-sidecar-shape.md`](v03-sidecar-shape.md).

Question: layouts of every remaining documented structure in the 512 KB Pt-US
save beyond the battery landmarks, so the raw-first primitives + guides cover
the entire save. Citations are `file:line` against PKHeX `master` (fetched
2026-08-24) or Bulbapedia; confidence tags per house convention.

## Verified regions

| Region             | Partition-relative offset                          | Layout                                                                                                                  | Confidence           |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------- |
| PC mail ×9         | general `0x4E80` .. `+0x1F8`                       | 9 × `Mail4` records of **0x38 B** (`Mail4.cs:8`); offset formula `index*0x38 + 0x4E80` [SAV4.cs:639-647]                | verified             |
| Daycare slots ×2   | general `0x1654`                                   | 2 × 236 B stored records; EXP u32 in each slot's last 4 bytes; RNG seed u32 at slot end [SAV4.cs:409-448, SAV4Pt.cs:51] | verified             |
| Seals pouch        | general `0x6494`                                   | Seal capsules/ball-capsules storage [SAV4.cs:228, SAV4Pt.cs:80]; layout sketch via `Seal4.cs`                           | inferred             |
| Geonet             | general `0xA4C4`                                   | flag byte + district bytes [SAV4.cs:229,383-394, SAV4Pt.cs:68]; `Geonet4.cs` record shape                               | verified             |
| Hall of Fame block | partition extra block `0x20000`, size `0x2AC0`     | `Dendou4`: data 0x2AB0 + 0x10 footer; ≤30 entries × 0x3C w/ trailing date u32 [Dendou4.cs:8-31,77,92]                   | verified (structure) |
| Battle Hall        | partition extra block `0x23000`, size `0xBB0`      | `Hall4`: data 0xBA0 + 0x10 footer; species-array 0x3DE covers 493+egg [Hall4.cs:12-19]                                  | verified (structure) |
| Pokétch records    | general (see Record4)                              | `Record4.GetSize(SAV)`: Pt = Record32×71 + Record16×77 u16s [Record4.cs:18,93-103]                                      | inferred             |
| Pokérus            | inside Pokémon records @ byte **0x82** post-decode | high nibble strain · low nibble days [PK4.cs:266-268]; reachable only via `decode_pokemon_record` output extension      | verified             |

Probes against `local/platinum.mln.sav` (active partition): mail region shows
387/504 nonzero bytes (printable G4-charmap content present ✓); both Daycare
slots read species 0 (empty ✓ plausible); HoF block head is all `0xFF`
(uninitialized flash fill for a pre-HoF save ✓ consistent).

## Enrichment notes for raw-first interpretation

- Mail bodies are G4-charcode text (same charmap as OT names); sender/ recipient
  u16s appear at fixed positions inside each 0x38 record — interpret with the
  species-independent charmap table.
- Contest conditions live INSIDE Pokémon records (@0x40 region, plaintext
  post-decode) — no standalone contest structure.
- Underground (honey trees, goods/spheres/traps) exists in Pt
  [SAV4Sinnoh.cs:118-174] but its constructor offsets were refactored out of
  master's constants — treat as TODO until re-pinned.

## Gaps & TODO

1. Underground region offsets (refactored out of master constants).
2. Gym-defeat event-flag indices (unchanged from gen4-offsets gap #3).
3. Badge bit→gym name order stays inferred pending the flush-pair diff.
4. GTS block: not located in Gen IV saves by this sweep — likely absent (GTS
   lived server-side; only Geonet is local).

Re-verify: sources fetched from
`https://raw.githubusercontent.com/kwsch/PKHeX/master/<path>` on 2026-08-24.
