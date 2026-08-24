# v0.3 Core coverage matrix — the battery over PKHeX.Core

**Researched:** 2026-08-24 · Ticket
[#35](https://github.com/EthanThatOneKid/pkhex-mcp/issues/35) (parent
[#33](https://github.com/EthanThatOneKid/pkhex-mcp/issues/33)) · Companion to
[`gen4-offsets.md`](gen4-offsets.md) and the sibling sidecar-shape doc.

Question: for each of the eight battery questions, what does **PKHeX.Core**
(kwsch/PKHeX `master`, fetched 2026-08-24) answer out-of-the-box, what needs a
thin wrapper, and what remains genuinely fog? Every citation below is
`file:line` against master at fetch time.

Classifications:

- **out-of-the-box** — a public accessor answers the question directly.
- **thin-wrapper** — storage access exists publicly, but composing the answer
  (iteration, joins, masking) is on us.
- **fog** — the bytes/storage are reachable but the _meaning_ lives elsewhere
  (curated lists, decomp-space tables).

## Matrix

| # | Battery question               | Core surface (file:line)                                                                                                                                                                                                                                                                                                                                           | Classification     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| - | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ① | Badges                         | `SAV4.Badges` byte property @ `Trainer1+0x1A` — SAV4.cs:302-306 (`Trainer1=0x68` ⇒ general `0x82`, matching our map); `ProgressFlags`/`GameClear`/`NationalDex` — SAV4.cs:320-336                                                                                                                                                                                  | **out-of-the-box** | Bit _i_ = gym enum order is **not named anywhere in Core** — no badge-name resource exists; the bit→“Coal/Forest/…” join stays ours ([pp-badges]). Bit order remains inferred until #24.                                                                                                                                                                                                                                                                     |
| ② | Bag by pocket w/ quantities    | `SAV4Pt.Inventory => new PlayerBag4Pt(this)` — SAV4Pt.cs:133; pouch offsets/caps — PlayerBag4Pt.cs:9-27 (`BaseOffset=0x630`); pair reader `GetPouch` u16 id/u16 count — InventoryPouch4.cs:20-33; legal-lists per pocket — ItemStorage4Pt.cs:25-36 (+ ItemStorage4.cs:10-123); HM cap-1 override — PlayerBag4Pt.cs:33-38                                           | **out-of-the-box** | `LoadAll` decodes every pocket in one call; pocket capacities derive from legal-list lengths, which also pins the battle-items extent at 13 (ItemStorage4.cs:116-123) — closes our gap #4 arithmetic-wise. Max stacks come from pouch `MaxCount`.                                                                                                                                                                                                            |
| ③ | Dex seen/caught + has-caught-X | `Zukan4.GetCaught/GetSeen` — Zukan4.cs:41-42; region math `ofs=4+region*0x40+(idx>>3)` — Zukan4.cs:47-51; LSB-first bit read — FlagUtil.cs:16-20; delegated from save — SAV4.cs:471-472; dex block base `PokeDex=0x1328` — SAV4Pt.cs:57                                                                                                                            | **thin-wrapper**   | Per-species `GetCaught(X)` (= has-caught-X) is out-of-the-box. But there is **no count/popcount accessor**: totals require iterating species 1..493 ourselves. Core never touches bits ≥494 (its own loops cap at `MaxSpeciesID_4`, Zukan4.cs:507-511), which is exactly why our 0xFF-terminator masking rule reproduces Core's behavior by construction. Probe: Core bit semantics reproduce 41 caught / 102 seen on the reference save.                    |
| ④ | PC box contents                | Storage layout constants (18×30×136 B, box stride 0xFF0, names @+0x11EE4, wallpapers @+0x121B4, flags @+0x121C6) — SAV4Sinnoh.cs:21-33; `CurrentBox` — SAV4Sinnoh.cs:35-39; box names/wallpapers via `IBoxDetailName`/`IBoxDetailWallpaper` — SAV4Sinnoh.cs:10,47-57; wallpaper unlock bits — SAV4Pt.cs:97-130; generic `Boxes`/`GetBoxData` — SaveFile.cs:420-470 | **out-of-the-box** | There is **no `BoxLayout4` class** in master — box access lives directly on `SAV4Sinnoh` + `SaveFile` generic plumbing. Records arrive decrypted: `PK4(Memory<byte>)` runs `PokeCrypto.DecryptIfEncrypted45` (PK4.cs:23-34 → Decrypt45 PokeCrypto.cs:166-179), so consumers never see the at-rest encryption.                                                                                                                                                |
| ⑤ | Trainer card incl money        | The gen-4 “trainer card” **is** the `Trainer1` region exposed as save properties: `Money` @ `Trainer1+0x14` — SAV4.cs:284-288; OT/TID16/SID16/ID32 — SAV4.cs:260-282; Coin/playtime — SAV4.cs:340-362; `SecondsToStart/Fame` — SAV4.cs:380-381; `Trainer1=0x68`, map `M @0x1280`, `RivalName @0x27E8` — SAV4Pt.cs:59-83,135,139-145                                | **out-of-the-box** | No `TrainerCard` class for Gen 4 (that's Gen 8+) despite the ticket's shorthand — `SAV4` implements `ITrainerInfo` directly. Probe: money reads **91,124** on the active slot, matching player truth.                                                                                                                                                                                                                                                        |
| ⑥ | Notable story flags            | Accessors public: `SAV4 : IEventFlag37` — SAV4.cs:14; `GetEventFlag/SetEventFlag` — SAV4.cs:535-547; `GetWork/SetWork` — SAV4.cs:549-550; counts 0xB60 flags / works — SAV4.cs:97-98; bases `EventWork=0xDAC`, `EventFlag=0xFEC` — SAV4Pt.cs:48-49; bulk `GetEventFlags()` extension — IEventFlagArray.cs:8-12,19-28                                               | **fog**            | Exactly the predicted locus: **storage is out-of-the-box, meaning is curated elsewhere.** The name lists exist only as embedded text resources (`Resources/text/script/gen4/flags_pt_en.txt` et al.) and are consumed solely by the WinForms editor via `GetStringList(sav.Version, "flags")` (WinForms SAV_EventWork.cs:36-38) — no typed runtime API maps flag number → story meaning. Our curated anchor subset (from that same file) remains hand-owned. |
| ⑦ | Party audit IVs/EVs/nature     | Slots: `PartyCount` @ `General[Party-4]` — SAV4.cs:248-252; `GetPartyOffset` — SAV4.cs:254 (`Party=0xA0`, SAV4Pt.cs:63); `GetPartySlotAtIndex` — SaveFile.cs:212-213. Fields on `PK4`: EVs ×6 @0x18-0x1D — PK4.cs:54-59; IVs 6×5-bit packed @IV32(0x38) — PK4.cs:123-128; moves/PP/PPUps @0x30-0x37 — PK4.cs:114-121; `Nature = PID % 25` — G4PKM.cs:51            | **out-of-the-box** | Encryption fully hidden: `Decrypt45` XORs the body with a per-**u16** stepped LCG seeded from the record checksum (PokeCrypto.cs:327-337) and the party-stat tail with the PID. Probe: replicating `CryptArray` in JS validated **12/12** party records across both partitions (checksums match post-decrypt).                                                                                                                                               |
| ⑧ | Specific PC slot lookup        | `GetBoxSlotAtIndex(box, slot)` — SaveFile.cs:556; offset math `GetBoxSlotOffset` — SaveFile.cs:555 over `SAV4Sinnoh.GetBoxOffset` (SAV4Sinnoh.cs:31); lock/overwrite guards `GetBoxSlotFlags`/`IsBoxSlotLocked` — SaveFile.cs:483-488                                                                                                                              | **out-of-the-box** | Same decryption path as ④. Slot indexing is `(box*30)+slot`; `GetBoxSlotFromIndex` inverts it (SaveFile.cs:558-563).                                                                                                                                                                                                                                                                                                                                         |

**Row tally:** 6 out-of-the-box (①②④⑤⑦⑧) · 1 thin-wrapper (③) · 1 fog (⑥).

## Enrichment parity audit vs our shipped tables

Our v0.2 reference resources (`src/gen4/data/*`) vs what Core can supply:

| Our table                               | Core equivalent                                                                                                                                                                     | Parity?                   | Verdict                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Species names + types (493)             | `GameStrings.specieslist` — GameStrings.cs:14,102 (prop :40); types via `PersonalTable.Pt` — SAV4Pt.cs:29 (`PersonalInfo4.Type1/Type2`)                                             | Yes — names **and** types | Core can replace both halves if Core becomes the decode engine; arrays are full-game (all gens) so a subset view is on us            |
| Move names + base PP (467)              | `movelist` — GameStrings.cs:90; **public** `MoveInfo.GetPP(EntityContext.Gen4, mv)` — MoveInfo.cs:18 backed by `MoveInfo4.PP` — MoveInfo4.cs:10-36; move type — MoveInfo.cs:229-231 | Yes                       | Base PP is a public facade call, not just a private table                                                                            |
| Item names (514)                        | `itemlist` — GameStrings.cs:100, plus Gen-4 mail-name overlay `g4items` — GameStrings.cs:158-159                                                                                    | Yes                       | Ids line up with game_index space (probe: 79=Repel, 74=Yellow Shard, 78=Escape Rope resolved against Core's own `text_Items_en.txt`) |
| Ability names (123)                     | `abilitylist` — GameStrings.cs:88 (prop :43)                                                                                                                                        | Yes                       | —                                                                                                                                    |
| Natures (25)                            | `natures` — GameStrings.cs:86 (prop :45)                                                                                                                                            | Yes                       | Index aligns with `PID % 25` ordering                                                                                                |
| Map-id names via pret `map_headers.txt` | **None.** `Locations4.Met0/Met2/Met3` — Locations4.cs:19-70 and `GameStrings.Gen4 = Get4("hgss")` — GameStrings.cs:144,162-168 cover only the **met-location** id space             | **No**                    | Stays ours. Map-header ids (save `M` field @0x1280, e.g. 120=Pastoria City) are decomp-space and absent from Core entirely           |

Net: **5 of 6 enrichment categories have Core equivalents**; map-id names are
irreducibly ours. Even where Core has parity, our shipped subsets are far
smaller and token-cheaper than loading full-game string banks — adopting Core's
tables makes sense only alongside adopting Core as the decoder itself (see
sidecar-shape discussion).

## Fog list (genuine gaps after this audit)

1. **Story-flag semantics (biggest).** `GetEventFlag(n)` returns bits; the
   number→meaning layer exists only as GUI-consumed text resources. Every
   notable-progress answer (“beat Fantina?”, “Hall of Fame entered?”) depends on
   a curated table we must own — currently our inferred anchor list in
   [`gen4-offsets.md`](gen4-offsets.md#story-progress-machinery). Option for
   later: parse `flags_pt_en.txt` out of Core's repo at build time instead of
   hand-curating.
2. **Badge bit → gym name.** No badge-name resource anywhere in Core; the
   bitmask itself is trivially readable. pret `badges.txt` stays ours, and bit
   order stays inferred until the #24 flush-pair session.
3. **Map-header id → location name.** Absent from Core (met-location space
   only); pret-derived table stays ours.
4. **Gym-defeat event-flag indices.** Not surfaced by any Core surface nor its
   curated Pt list (unchanged finding from gen4-offsets.md gap #3); badge
   bitmask covers the battery need.
5. **Active-slot selection.** Core resolves it internally during load — `SAV4`
   constructor picks General/Storage partitions via
   `SAV4BlockDetection.CompareFooters` (SAV4.cs:53-67,180-184) — but the exact
   tie-break counters inside footers are still unmapped in our doc; if we adopt
   Core this comes for free, otherwise #23 continues.

## Sanity probes (read-only, `local/platinum.mln.sav`, this session)

Throwaway Deno scripts replicating Core semantics against the reference save:

- Money @ active-slot `Trainer1+0x14`: **91,124** ✓ (player truth; inactive slot
  reads 89,332)
- Badges byte: `0b00010011` ✓ · map id 120 ✓ · dex magic `0xBEEFCAFE` ✓
- Dex popcount with Zukan4 bit math masked to ≤493: **41 caught / 102 seen** ✓
- Bag head via PlayerBag4Pt base 0x630: Repel ×2 (id 79), Yellow Shard ×2 (id
  74), Escape Rope ×1 (id 78) ✓ — spike ground truth reproduced
- Party: per-u16 `CryptArray(checksum)` decrypt validates **12/12** records
  (both partitions × 6 slots); lead reads species 303, nature 16, sane IVs
- First attempt at party/PC reads without decrypting produced garbage —
  empirical confirmation that Core's transparent-decrypt constructor is doing
  real work for rows ④⑦⑧

Re-verify: sources fetched from
`https://raw.githubusercontent.com/kwsch/PKHeX/master/<path>`; line numbers are
master @ 2026-08-24.
