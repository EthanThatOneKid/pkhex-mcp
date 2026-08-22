# Pokémon Platinum — Live RAM Research (pkhex-mcp)

**Scope:** reading live game state from an NDS emulator (BizHawk/DeSmuME/melonDS-family), posting JSON snapshots over HTTP.
**Primary target:** Pokémon Platinum (USA), gamecode `CPUE` (`0x45555043` LE).
**Date of research:** August 2026. Every claim is tagged **Verified** (two+ independent sources, or primary-source code + arithmetic cross-check), **Inferred** (structurally derived from one primary source), or **Unverified**.

---

## The two-anchor model (how live reads work)

Two static words in ARM9 main RAM hold pointers into the same runtime save image:

| Slot | Role | Value semantics |
|---|---|---|
| `P1 = read_u32(0x02101D2C)` | "MKDasher anchor" | Points `0xCFE0` bytes **before** the runtime save image. Party/count/TID/IGT offsets below are P1-relative. |
| `P2 = read_u32(0x021C0794)` | SaveData wrapper base | Runtime `SaveData` object; the assembled general-save image (= the `.sav` "General" block bytes) begins at **P2 + 0x14**. |

Relation: **P1 = P2 − 0xCFE0** for Platinum US (derived, see arithmetic proof in §Source disagreements #4).
The image itself is byte-for-byte identical to the `.sav` General block parsed by PKHeX (Pt `GeneralSize = 0xCF2C`). Therefore:

> **runtime_addr(general_offset) = P2 + 0x14 + general_offset = P1 + 0xCFF4 + general_offset**

All offsets in the tables below are given in both forms where useful.

---

## Offset table

### A. Anchors & party (all Verified unless noted)

| Address | Width | Field | Source | Confidence |
|---|---|---|---|---|
| `read_u32(0x02101D2C)` | ptr | P1 anchor (Pt US) | TASVideos MKDasher/Fortranm DPPt RNG lua v2.2; GameHacking.org AR DB (`62101D2C/B2101D2C`) | **Verified** |
| `read_u32(0x021C0794)` | ptr | P2 = SaveData wrapper (Pt US) | Arithmetic agreement across name/ID/playtime/map fields (PKHeX SAV4Pt ↔ pokeplatinum structs) | **Verified (by consistency)**; direct third-party observation pending |
| `P1 + 0xD090` | u32 (low byte) | Party count (decomp `Party.currentCount`, `int`) | PKHeX `SAV4.PartyCount => General[Party-4]`; decomp `party.h` | **Verified** |
| `P1 + 0xD08C` | u32 | Party capacity (`Party.capacity`) | pokeplatinum `party.h` struct order | Inferred |
| `P1 + 0xD094 + 0xEC·n` | 0xEC ×6 | Party slot *n* (n=0..5), PK4-party format | PKHeX `SIZE_4PARTY=236`, `GetPartyOffset`; claim #1; decomp `MAX_PARTY_SIZE=6` | **Verified** |

DP/Pt pointer-slot variants (same relative offsets within the pointed-to structure): DP-US `0x02106FAC`, DP-JP `0x02108804`, Pt-US `0x02101D2C`. DP image delta K_DP = `0xD210` (vs Pt's `0xCFF4`). **Verified** via TASVideos arrays; Pt-JP/EUR slots **Unverified**.

### B. Per-slot layout (base B_n = P1+0xD094+0xEC·n = P2+0xB4+0xEC·n)

| Offset in slot | Width | Field | Source | Confidence |
|---|---|---|---|---|
| +0x00 | u32 | PID (personality) | PK4.cs; decomp `BoxPokemon.personality` | **Verified** |
| +0x04 | u16 | Flags: bit0 `partyDecrypted`, bit1 `boxDecrypted`, bit2 `checksumFailed` | decomp `pokemon.h` (named bits); PKHeX calls this word `Sanity` | **Verified** |
| +0x06 | u16 | Checksum (Add16 seed) | PK4.cs; decomp `box.checksum` | **Verified** |
| +0x08–0x87 | 128 B | Data blocks (4×0x20), encrypted + PID-shuffled | claim #5; PokeCrypto.cs; decomp | **Verified** |
| +0x88 | u32 | Status condition (tail, encrypted w/ PID) | decomp `PartyPokemon.status @0x88` | **Verified** |
| +0x8C | u8 | Current level | same | **Verified** |
| +0x8D | u8 | Ball capsule ID (omitted in seeded summary) | same | **Verified** |
| +0x8E | u16 | Current HP | same | **Verified** |
| +0x90 | u16 | Max HP | same | **Verified** |
| +0x92/94/96/98/9A | u16×5 | Atk/Def/Spe/SpA/SpD | same | **Verified** |
| +0x9C | 0x38 | Mail block | decomp (mail @0x9C → capsule @0xD4 ⇒ size 0x38) | Inferred (size) |
| +0xD4 | 0x18 | Ball capsule | decomp; total 0xEC ✓ | Inferred (size) |

### C. Decrypted block contents (after XOR-decrypt if needed + unshuffle; absolute in slot)

Logical block order A–D selected by `sv = (PID >> 13) & 31` (see shuffle table). Offsets are the standard Gen-4 logical view:

| Abs. offset | Field | Source | Confidence |
|---|---|---|---|
| 0x08 | Species u16 | PK4.cs:44; decomp BlockA | **Verified** |
| 0x0A | Held item u16 | PK4.cs:45 | **Verified** |
| 0x0C | OT ID u32 (low16 TID, high16 SID) | PK4.cs:46–48 | **Verified** |
| 0x10 | EXP u32 | PK4.cs:49 | **Verified** |
| 0x14–0x17 | Friendship, Ability, Markings, OriginLanguage (u8×4) | PK4.cs:50–53 | **Verified** |
| 0x18–0x1D | EVs HP/Atk/Def/Spe/SpA/SpD (u8×6) | PK4.cs:54–59 | **Verified** |
| 0x1E–0x23 | Contest cool/beauty/cute/smart/tough/sheen | PK4.cs:60–65 | **Verified** |
| 0x24–0x27 | Ribbons DS set 1 (u32 bitfield) | PK4.cs:67+ | **Verified** |
| **Block B base = 0x28** | moves u16[4] @+0x00–07 | PK4.cs:110–113 | **Verified** (claim #4 ✓) |
| +0x30 | Current PP u8[4] (+0x08 in block) | PK4.cs:114–117 | **Verified** |
| +0x34 | PP Ups u8[4] (+0x0C in block) | PK4.cs:118–121 | **Verified** |
| +0x38 | IV u32 bitfield (+0x10 in block): HP@0, Atk@5, Def@10, Spe@15, SpA@20, SpD@25 (5 bits each), isEgg@30, Nicknamed@31 | PK4.cs:122–130; decomp BlockB | **Verified** |
| 0x3C | Ribbons GBA u32; 0x40 fateful/gender/form byte | PK4.cs; decomp | **Verified** |
| 0x48 | Nickname u16[11] (Gen-4 charcode); 0x5E unused; 0x5F origin game; 0x60 ribbons DS2 u64 | decomp BlockC; PK4.cs region | **Verified** (layout), sizes |
| 0x68 | OT name u16[8]; 0x78 egg Y/M/D; 0x7B met Y/M/D; 0x7E/0x80 egg/met location (DP era) u16; 0x82 pokerus; 0x83 ball; 0x84 metLevel:7‖otGender:1; 0x85 met terrain; 0x86 u16 unused | decomp BlockD; PK4.cs region | **Verified** (layout) |
| — | Nature = PID % 25 | G4PKM.cs:51 `(Nature)(PID % 25)` | **Verified** (claim #4 ✓) |

### D. Shuffle table (`sv=(PID>>13)&31` → physical position of blocks A,B,C,D)

Identical in PKHeX `BlockPosition` and pokeplatinum `DATA_BLOCK_SHUFFLE_CASE` switch (sv 24–31 mirror sv−24... precisely: cases {k, k+24} share one permutation for k<8):

```
sv%24: 0 ABCD   1 ABDC   2 ACBD   3 ACDB   4 ADBC   5 ADCB
       6 BACD   7 BADC   8 BCAD   9 BCDA  10 BDAC  11 BDCA
      12 CABD  13 CADB  14 CBAD  15 CBDA  16 CDAB  17 CDBA
      18 DABC  19 DACB  20 DBAC  21 DBCA  22 DCAB  23 DCBA
```
(each letter = which physical 0x20 slot holds that logical block). **Verified** in both codebases + LostMyPlaintext writeup.

---

## Structure notes (encryption / checksum / torn reads)

**Encryption (claim #5 — Verified, with one operational refinement).**
At rest, a party slot's blocks (0x08–0x87) are XOR-encrypted and block-shuffled; the battle-stats tail (0x88–0xEB) is separately XOR-encrypted.
- Blocks cipher: LCG `seed = 0x41C64E6D·seed + 0x6073 (mod 2³²)`, seeded with the **checksum word at +0x06**; per u16: `word ^= seed >> 16`. (PKHeX `CryptArray`, PokeCrypto.cs:327–337.)
- Tail cipher: same LCG seeded with the **PID**, applied over bytes 0x88–0xEB. (PKHeX Decrypt45 line 177; decomp encrypts `&mon->party` with `mon->box.personality`.)

**Refinement vs seeded summary:** the decomp keeps an in-RAM state flag — `BoxPokemon.flags.bit0 ("partyDecrypted")`. During gameplay the game transiently decrypts slots *in place* inside "decryption contexts" (pokeplatinum `Pokemon_EnterDecryptionContext/ExitDecryptionContext`, pokemon.c:311–351) and re-encrypts on exit. **Live readers must check flags bit0 per slot:** if set, skip the XOR layer but still unshuffle (shuffling persists regardless — accessors always map blocks by PID). If clear, full decrypt+unshuffle. Validate every read via checksum (below) and retry the frame on mismatch.

**Checksum (claim #6 — Verified).**
Entity checksum = **Add16**: sum of decrypted/unshuffled u16s over bytes **0x08–0x87**, truncated to 16 bits, stored little-endian at +0x06. NOT CRC.
- PKHeX: `G4PKM.CalculateChecksum => Checksums.Add16(Data[8..SIZE_4STORED])`.
- Decomp: `Pokemon_GetDataChecksum` = plain u16 accumulation.
**CRC16-CCITT appears only in save-block integrity:** whole General/Storage blocks end with a footer checked as `CRC16-CCITT(data minus 0x14-byte footer)` (SAV4.cs:113), plus per-table page checksums (`SavePageInfo.checksum`, `SECTOR_SIGNATURE 0x20060623` magic; Korean builds use magic `0x20070903`). Live RAM reads never need CRC.

**Torn reads / consistency.**
The emulator snapshots memory asynchronously; a frame boundary can split a slot read. Recommended protocol:
1. Read count byte; clamp to [0,6].
2. Per slot: read PID (u32 @B_n), then the full 0xEC bytes, then re-read PID; retry until equal.
3. Decrypt (per flag bit0) + unshuffle; recompute Add16 over 0x08–0x87 and compare to stored checksum; mismatch ⇒ discard frame and re-read.
4. Sanity-gate species ≤ 493 (Pt) and level ≤ 100 before publishing JSON.

---

## Trainer meta offsets

All relative to **P2** (image = P2+0x14; `.sav` General offset in parentheses). Sources: PKHeX SAV4.cs/SAV4Pt.cs field getters + pokeplatinum `PlayerSave`/`TrainerInfo`/`PlayTime` structs. Layout math: PlayerSave = `{Options u16 @0, pad2, TrainerInfo @4{name u16[8], id u32 @+0x10, money u32, gender, language, badgeMask, appearance, gameCode, progressFlags}, coins u16 @0x24, PlayTime @0x26{hours u16, minutes u8, seconds u8}}`.

| P2 addr | Image (.sav) | Width | Field | Confidence |
|---|---|---|---|---|
| +0x7C | 0x68 (Trainer1, Pt) | 16 B | OT name, Gen-4 charcode u16[8] (7 chars + terminator) | **Verified** (claim #7 confirmed — no longer "≈") |
| **+0x8C** | 0x78 | u32 | **TID (low16) ‖ SID (high16)** | **Verified** (claim #2; also MKDasher P1+0xD06C/D06E) |
| +0x90 | 0x7C | u32 | Money | **Verified** |
| +0x94 | 0x80 | u8 | Gender | **Verified** |
| +0x95 | 0x81 | u8 | Language (save-side; prefer gamecode detection) | **Verified** (offset); enum values Inferred |
| +0x96 | 0x82 | u8 | Badge bitmask | **Verified** |
| +0x97 | 0x83 | u8 | Union-room appearance/sprite | **Verified** |
| +0x98 | 0x84 | u8 | ROM/game code byte | **Verified** |
| +0x99 | 0x85 | u8 | Progress flags: bit0 game-clear, bit1 National Dex | **Verified** |
| +0x9C | 0x88 | u16 | Coins | **Verified** |
| **+0x9E** | 0x8A | u16 | **Playtime hours** | **Verified** (claim #7 confirmed; = MKDasher IGT @P1+0xD07E) |
| **+0xA0** | 0x8C | u8 | **Playtime minutes** | **Verified** |
| **+0xA1** | 0x8D | u8 | **Playtime seconds** | **Verified** |
| **+0x1294** | 0x1280 | u16 | **Current map index (M)** | **Verified** (claim #2; PKHeX `M => General[0x1280]`) |
| +0x129C | 0x1288 | u16 | Player X | **Verified** |
| +0x12A0 | 0x128C | u16 | Player Y | **Verified** |
| +0x48 / +0x50 | 0x34 / 0x3C | u32 | Seconds-to-start / Seconds-to-fame (AdventureInfo) | **Verified** |
| +0xDC0 | 0xDAC | — | EventWork array base (u16 entries; e.g. work 60 = lottery @ P1+0xDE18 ✓ matches TASVideos `LIDAddrOffset`) | **Verified** |
| +0x1000 | 0xFEC | — | EventFlag bitfield base | **Verified** |

**Arithmetic proof of the two anchors (why claims 1/2/7 all reconcile):** MKDasher gives TID @P1+0xD06C; PKHeX puts TID at image+0x78 ⇒ image starts at **P1+0xCFF4**. Then party slot 0 = P1+0xCFF4+0xA0 = **P1+0xD094** ✓, count = **P1+0xD090** ✓, IGT hours = P1+CFF4+0x8A = **P1+0xD07E** ✓ (script reads bytes +0/+2/+3 = h/m/s ✓). Lottery @P1+0xDE18 ⇒ image 0xE24 ⇒ work index (0xE24−0xDAC)/2 = **60** = PKHeX `Lottery => GetWork(60)` ✓✓. Finally P1+0xCFF4−0x14 = P1−0xCFE0 ⇒ if P2=[0x021C0794] points at the wrapper, TID lands exactly at P2+0x8C and map M at P2+0x1294 — matching claim #2 verbatim.

**Save-file mapping (claim #8 — Verified, Pt-specific).**
`.sav` = two 0x40000 partitions; active copies chosen by footer comparison (CRC16-CCITT over block minus trailing 0x14 footer). Pt: GeneralSize **0xCF2C**, Storage starts at 0xCF2C, size **0x121E4**. Key General offsets (file coords): Trainer1 **0x68**, Party **0xA0**, map M **0x1280**, EventWork 0xDAC, EventFlag 0xFEC, Daycare 0x1654, PokéDex 0x1328, Mystery Gift 0xB4C0, RivalName 0x27E8, Box data at Storage+4. Runtime adds the 0x14 wrapper header (image = file-General bytes; runtime = P2+0x14+off). Diamond/Pearl use Trainer1 **0x64** / Party **0x98** / GeneralSize 0xC100 — the ProjectPokemon wiki figure "party at 0x00098" is **DP, not Pt**.

**Game/language detection (claim #9a — Verified; #9b corrected).**
- melonDS-family ARM9 bus mirrors the cartridge header at **0x02FFFE00**: title 12 B @+0x00, **gamecode u32 LE @0x02FFFE0C** (`CPUE`=0x45555043 Pt-US; `ADAE`/`APAE` D/P-US; JP codes end `J`). Claimed range 0x2FFFE08–0x0F covers title tail + gamecode. (melonDS fork source: `ARM9Write32(0x02FFFE00+i, …)` while loading cardIside.)
- DeSmuME/BizHawk DesMuME core exposes a boot-time header copy in main RAM at **0x023FFE00** (gamecode @0x023FFE0C) — the TASVideos script reads it there.
- Robust fallback: read language byte at P2+0x95 and/or decode the OT-name charcode table once TID validates.
- **Correction:** there is **no language-based shift of save-table offsets**. What differs between regions/builds are *static addresses*: pointer slots (e.g., Pt money-pointer variable JPN `0x02101140` vs USA `0x02101D40` — a **+0xC00 delta between pointer variables**, almost certainly the origin of the seeded "+0xC00" claim), cheat/code addresses (universal-ds-lua-script PL Cheats.lua: EN 0x2060C20, EU +0xA4, JP −0x738), and RNG/frame globals. Structure-relative offsets are identical across languages (MKDasher uses identical offsets for DP-US and DP-JP; cross-language trading requires one layout).

**Bonus verified globals (Pt US, static):** main RNG seed u32 @`0x021BFB14`; frame counter @`0x021BF6A8`; RTC clock triple @`0x021BF5E8`; step counters @P1+`0x2E834`(rate)/`0xDE34`(÷128); land-mode @P1+`0x3090A`; encounter-rate bytes @P1+`0x303C4`(grass)/`0x30490`(water).

---

## Source disagreements

1. **Party start offset 0x98 vs 0xA0.** ProjectPokemon's "PKM Structure – Generation 4" doc says party begins at `0x00098`. That is the **Diamond/Pearl** value (PKHeX `SAV4DP.Party = 0x98`); Platinum is **0xA0** (`SAV4Pt`). Both agree with DP↔Pt SYSTEM-table growth of 4 bytes (Trainer1 0x64→0x68). Resolution: use per-version constants.
2. **"JPN→USA +0xC00 shift" (seeded summary #9b).** Rejected as a save-layout rule. No primary source shows language-dependent table offsets; saves must stay cross-language compatible. The real +0xC00 observed (ProjectPokemon forum, M@T 2010) is between **pointer-variable addresses** in AR cheat lines (JP `B2101140` vs US `B2101D40`). Document regional deltas only for static slots/codes.
3. **Claim #7 status.** Seeded as "structurally inferred, UNVERIFIED". Now **Verified**: player name @P2+0x7C and playtime @P2+0x9E/A0/A1 follow exactly from PlayerSave/TrainerInfo/PlayTime in the decomp and match PKHeX (Trainer1+0x22/24/25) and TASVideos IGT offsets simultaneously.
4. **Identity of the P1 container.** P1-relative offsets reach past the save image (step counter at +0x2E834 ≫ 0xCF2C), so `[0x02101D2C]` anchors a larger runtime structure in which the save image sits at +0xCFF4. Operationally irrelevant (offsets verified three ways), but the container's identity remains unnamed — flagged as an open item, not a blocker.
5. **Decomp constant mismatch (caveat).** pokeplatinum's WIP `savedata.h` declares `body = SAVE_SECTOR_SIZE(0x1000) × SAVE_PAGE_MAX(32) = 0x8000`, smaller than Pt's 0xCF2C image; its table packing (`pageInfo[id].location`) is dynamic. Treat the decomp as authoritative for *struct layouts* (Pokemon/PlayerSave/etc.) but not yet for aggregate save sizing — PKHeX + live scripts define the empirical map.
6. **Field-state scripts ≠ save reads.** universal-ds-lua-script (Bizhawk PL) tracks heap state via a pointer at `0x2000BA8` and reads field-system objects (player NPC struct @0x2385C, chunk/map tables @0x21804/0x218A8, camera @0x21800). Complementary to this document (live coordinates/maps) but a different address space than the save image — do not mix bases.

---

## Citations

**Local clones inspected** (under `%TEMP%\opencode\clones\`):
- `PKHeX/PKHeX.Core/PKM/Util/PokeCrypto.cs` — Decrypt45/Encrypt45, CryptArray LCG (lines 166–200, 327–337), SIZE_4PARTY=236/SIZE_4STORED=136/SIZE_4BLOCK=32 (33–37), IsEncrypted45 (415).
- `PKHeX/PKHeX.Core/PKM/Shared/G4PKM.cs` — Add16 checksum over 8..0x88 (41), Nature=PID%25 (51).
- `PKHeX/PKHeX.Core/PKM/PK4.cs` — full block-A/B field offsets (40–160).
- `PKHeX/PKHeX.Core/Saves/SAV4.cs` — PartyCount=General[Party−4], TID16/SID16 @Trainer1+0x10/12, playtime @Trainer1+0x22/24/25, CRC16-CCITT footers (111–203, 248–366).
- `PKHeX/PKHeX.Core/Saves/SAV4Pt.cs` — Trainer1=0x68, Party=0xA0, M=0x1280, X/Y=0x1288/0x128C, GeneralSize=0xCF2C, StorageSize=0x121E4, ExtraBlocks (33–83, 135–149).
- `PKHeX/PKHeX.Core/Saves/SAV4DP.cs` — DP Trainer1=0x64, Party=0x98 (57–75).
- `pokeplatinum/include/struct_defs/pokemon.h` — BoxPokemon flags/checksum/blocks, PartyPokemon @0x88..0xEC, Pokemon total.
- `pokeplatinum/src/pokemon.c` — Enter/ExitDecryptionContext (311–351), GetDataBlock shuffle switch ((pid&0x3E000)>>13, ~4861), GetDataChecksum Add16 (~4940), EncryptData(personality)/checksum seeding (292–305).
- `pokeplatinum/include/{party,savedata,save_player,trainer_info,play_time}.h`, `include/constants/savedata/*.h`, `src/save_player.c`, `src/savedata.c` — Party{capacity,count,pokemon[6]}, SaveData wrapper, PlayerSave layout, TRAINER_NAME_LEN=7, MAX_PARTY_SIZE=6.
- `universal-ds-lua-script/Scripts/Bizhawk/PL/Platinum.lua` + `Templates/Gen4/Data/*.lua` + `PL/Data/Cheats.lua` — field-system addresses; regional code-address deltas.
- `NPO-197-melonds-lua/src/DSi.cpp:599` — cart header loaded at 0x02FFFE00 (ARM9 bus).
- `desmume` clone — header/gamecode handling (context for 0x023FFE00 mirror).

**Web sources:**
- TASVideos user file #45122848531803525 — MKDasher/Fortranm "pearl_plat_rng_v2_2.lua": `pointerAddr={0x02106FAC(DP-US), 0x02101D2C(Pt-US), 0x02108804(DP-JP)}`, TID@+0xD06C/D06E, IGT@+0xD07E(+0,+2,+3), LID@+0xDE18, RNG 0x021BFB14, framecount 0x021BF6A8, clock 0x021BF5E8, game-ID @0x023FFE0C.
- GameHacking.org — Pokémon Platinum (USA) page: AR lines dereferencing `0x02101D2C` (`62101D2C/B2101D2C`).
- ProjectPokemon forums, M@T (2010), "Changing JPN code format to ENG format" — JPN `B2101140` vs US `B2101D40` money-pointer codes (+0xC00 pointer-variable delta).
- ProjectPokemon docs, "PKM Structure – Generation 4" — party @0x00098 (DP-era), 236-byte slots, PC storage @0xC104.
- LostMyPlaintext (2021), "Reverse Engineering Pokemon NDS save files" — independent walkthrough: LCG constants, shuffle table, Add16, party @0xA0 (Pt small block).
- raymond-h/pokesav-ds-gen5 `savefile-offsets.md` — Pt General length 53036=0xCF2C, storage start 0xCF2C.
