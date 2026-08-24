/**
 * Gen IV (Pokémon Platinum US) raw-save offset map — pure data, no IO.
 *
 * All numeric offsets are LITTLE-endian fields inside one 256 KiB partition of
 * a 512 KiB `.sav` file unless stated otherwise. "General-rel" means relative
 * to the start of the general ("small") block; "storage-rel" means relative to
 * the start of the PC-storage ("large") block; "partition-rel" addresses the
 * active partition directly.
 *
 * Confidence vocabulary:
 * - "verified": cross-checked against PKHeX source AND probed against
 *   `local/platinum.mln.sav` on 2026-08-23 (CRC footers, TID/SID, money,
 *   badges popcount, dex popcounts, bag contents, map id all matched).
 * - "inferred": derived from PKHeX/decomp sources but not yet confirmed by a
 *   second independent sample (e.g., pending SaveRAM flush-pair diff, #24).
 */

export type Confidence = "verified" | "inferred";

export interface OffsetEntry {
  /** Byte offset within the coordinate space named by its group. */
  readonly offset: number;
  /** Field encoding, e.g. "u16", "u32", "utf16 x7", "bitfield[8]". */
  readonly type: string;
  /** Human explanation, including citation tag. */
  readonly note: string;
  readonly confidence: Confidence;
}

export interface PouchEntry {
  /** Pouch name as shown in the bag UI family. */
  readonly name: string;
  /** Pouch-relative byte offset of the first [u16 id][u16 count] pair. */
  readonly offset: number;
  /**
   * Slots available in the save layout (distance to next pouch / 4).
   * PKHeX only reads/writes `legalItemSlots` entries; trailing bytes pad.
   */
  readonly slotCapacity: number;
  /** Entries PKHeX considers legal for this pouch in Pt (= list length). */
  readonly legalItemSlots: number;
  /** Max quantity per single item (HMs pinned to 1). */
  readonly maxStack: number;
}

/** File-level geometry: two 256 KiB partitions, each holding two blocks. */
export const fileLayout = {
  partitionSize: 0x40000,
  /** Size of the general ("small") block that starts at partition+0x00000. */
  generalBlockSize: 0xcf2c,
  /** Partition-relative start of the PC storage ("large") block. */
  storageBlockStart: 0xcf2c,
  /** Size of the storage block; ends at partition+0x1f110. */
  storageBlockSize: 0x121e4,
  /** Bytes reserved at the end of each block: checksum + save magic. */
  blockFooterSize: 0x14,
  /** SECTOR_SIGNATURE written near each block footer. */
  saveMagic: 0x20060623,
  /**
   * CRC16-CCITT (poly 0x1021, init 0xFFFF, MSB-first) over
   * block[..len-0x14], stored as u16 LE at block[len-2].
   * Both partitions validated on the reference save on 2026-08-23, so activity
   * cannot be decided by CRC alone — see ticket #23 for recency work.
   */
  checksumNote: "CRC16-CCITT over block minus 0x14-byte footer",
} as const satisfies Record<string, number | string>;

/**
 * Non-contiguous extra blocks living at fixed partition-relative offsets
 * (own footers/checksums; PKHeX BlockInfo4 entries for Pt).
 */
export const extraBlocks: ReadonlyArray<{
  readonly id: number;
  readonly name: string;
  readonly partitionOffset: number;
  readonly size: number;
}> = [
  { id: 0, name: "hallOfFame", partitionOffset: 0x20000, size: 0x2ac0 },
  { id: 1, name: "battleHall", partitionOffset: 0x23000, size: 0xbb0 },
  { id: 2, name: "battleVideoMine", partitionOffset: 0x24000, size: 0x1d60 },
  { id: 3, name: "battleVideoOther1", partitionOffset: 0x26000, size: 0x1d60 },
  { id: 4, name: "battleVideoOther2", partitionOffset: 0x28000, size: 0x1d60 },
  { id: 5, name: "battleVideoOther3", partitionOffset: 0x2a000, size: 0x1d60 },
];

/** Trainer card / player profile fields. Offsets are general-block relative. */
export const trainerCard: Record<string, OffsetEntry> = {
  otName: {
    offset: 0x68,
    type: "utf16[7]",
    note:
      "Original trainer name, 16-byte field, null-terminated [PKHeX SAV4.cs Trainer1+0x00]",
    confidence: "verified",
  },
  tid: {
    offset: 0x78,
    type: "u16",
    note:
      "Trainer ID; read back 1256 on reference save [PKHeX SAV4.cs Trainer1+0x10]",
    confidence: "verified",
  },
  sid: {
    offset: 0x7a,
    type: "u16",
    note: "Secret ID; read back 32863 [PKHeX SAV4.cs Trainer1+0x12]",
    confidence: "verified",
  },
  money: {
    offset: 0x7c,
    type: "u32",
    note:
      "Money, clamp display/validation to <=999_999 (read 91_124) [PKHeX SAV4.cs Trainer1+0x14]",
    confidence: "verified",
  },
  gender: {
    offset: 0x80,
    type: "u8",
    note: "Player gender (0 boy / 1 girl) [PKHeX SAV4.cs Trainer1+0x18]",
    confidence: "verified",
  },
  language: {
    offset: 0x81,
    type: "u8",
    note: "Game language byte (2 = English) [PKHeX SAV4.cs Trainer1+0x19]",
    confidence: "verified",
  },
  badges: {
    offset: 0x82,
    type: "bitfield[8]",
    note:
      "Gym badge bitmask, one bit per badge; see badges.badgeBitOrder [PKHeX SAV4.cs Badges]",
    confidence: "verified",
  },
  trainerSprite: {
    offset: 0x83,
    type: "u8",
    note: "Trainer card sprite index [PKHeX SAV4.cs Trainer1+0x1B]",
    confidence: "inferred",
  },
  progressFlags: {
    offset: 0x85,
    type: "bitfield[2/8]",
    note:
      "bit0 = Game Clear, bit1 = National Dex obtained; reads 0b00000000 mid-playthrough [PKHeX SAV4.cs ProgressFlags]",
    confidence: "verified",
  },
  coins: {
    offset: 0x88,
    type: "u16",
    note: "Game Corner coins, <=50_000 (read 66) [PKHeX SAV4.cs Coin]",
    confidence: "verified",
  },
  playtimeHours: {
    offset: 0x8a,
    type: "u16",
    note: "Played hours (61 on reference save) [PKHeX SAV4.cs Trainer1+0x22]",
    confidence: "verified",
  },
  playtimeMinutes: {
    offset: 0x8c,
    type: "u8",
    note: "Played minutes [PKHeX SAV4.cs Trainer1+0x24]",
    confidence: "verified",
  },
  playtimeSeconds: {
    offset: 0x8d,
    type: "u8",
    note: "Played seconds [PKHeX SAV4.cs Trainer1+0x25]",
    confidence: "verified",
  },
  secondsToStart: {
    offset: 0x34,
    type: "u32",
    note:
      "Seconds between starting the game and new-game confirm (AdventureInfo base 0) [PKHeX SAV4.cs AdventureInfo+0x34]",
    confidence: "verified",
  },
  secondsToFame: {
    offset: 0x3c,
    type: "u32",
    note:
      "Seconds until Hall of Fame entry; 0xFFFFFFFF until champion [PKHeX SAV4.cs AdventureInfo+0x3C]",
    confidence: "verified",
  },
  rivalName: {
    offset: 0x27e8,
    type: "utf16[7]",
    note: "Rival name, 14-byte field [PKHeX SAV4Pt.cs RivalSpan]",
    confidence: "verified",
  },
};

/** Current-overworld position. Offsets are general-block relative. */
export const position: Record<string, OffsetEntry> = {
  mapHeaderId: {
    offset: 0x1280,
    type: "u16",
    note:
      "Current map-header id (room level); 120 while standing in Pastoria City, live-cross-checked [PKHeX SAV4Pt.cs M]",
    confidence: "verified",
  },
  xCoord: {
    offset: 0x1288,
    type: "u16",
    note: "Player grid X [PKHeX SAV4Pt.cs X]",
    confidence: "inferred",
  },
  yCoord: {
    offset: 0x128c,
    type: "u16",
    note: "Player grid Y [PKHeX SAV4Pt.cs Y]",
    confidence: "inferred",
  },
};

/** In-party Pokémon storage. Offsets are general-block relative. */
export const party: Record<string, OffsetEntry> = {
  partyCount: {
    offset: 0x9c,
    type: "u8",
    note:
      "Live party size 0..6 (= General[Party-4] in PKHeX); read 6 [PKHeX SAV4.cs PartyCount]",
    confidence: "verified",
  },
  firstSlot: {
    offset: 0xa0,
    type: "partyRecord[6]",
    note:
      "Six party records, stride 236 (0xEC) bytes; Gen IV party struct incl. level/status/HP block [PKHeX SAV4Pt.cs Party=0xA0; repo deserialize.ts SLOT_SIZE=236]",
    confidence: "verified",
  },
};

/** Badge case: which bit of the badges byte belongs to which gym badge. */
export const badges = {
  bitmaskByte: trainerCard.badges,
  /**
   * Bit i (LSB-first) corresponds to badge enum i. Reference save reads
   * 0b00010011 => bits {Coal, Forest, Relic}, matching its 3-badge state and
   * a Platinum route where Fantina was beaten before Maylene. Bit ORDER is
   * inferred from the decomp badge enum; pin via flush-pair diff (#24).
   */
  badgeBitOrder: [
    "Coal", // Roark, Oreburgh City
    "Forest", // Gardenia, Eterna City
    "Cobble", // Maylene, Veilstone City
    "Fen", // Crasher Wake, Pastoria City
    "Relic", // Fantina, Hearthome City
    "Mine", // Byron, Canalave City
    "Icicle", // Candice, Snowpoint City
    "Beacon", // Volkner, Sunyshore City
  ] as const,
  badgeBitConfidence: "inferred" as Confidence,
};

/**
 * Overworld bag. One contiguous region begins at general+0x630; every entry
 * is a [u16 itemId][u16 count] pair, LE. Offsets below are BAG-relative
 * (add bagBase for general-relative addresses).
 */
export const bag = {
  bagBase: 0x630,
  recordType: "[u16 itemId][u16 count] little-endian pairs",
  orderingRule:
    "Pairs occupy leading slots; empty slots are 0000-0000. The game compacts on pickup; scanners should walk pairs and stop treating count==0 as empty rather than end-of-pouch.",
  pockets: [
    {
      name: "items",
      offset: 0x000,
      slotCapacity: 165,
      legalItemSlots: 162,
      maxStack: 999,
    },
    {
      name: "keyItems",
      offset: 0x294,
      slotCapacity: 50,
      legalItemSlots: 40,
      maxStack: 1,
    },
    {
      name: "tmsHms",
      offset: 0x35c,
      slotCapacity: 100,
      legalItemSlots: 100,
      maxStack: 99,
    },
    {
      name: "mail",
      offset: 0x4ec,
      slotCapacity: 12,
      legalItemSlots: 12,
      maxStack: 999,
    },
    {
      name: "medicine",
      offset: 0x51c,
      slotCapacity: 40,
      legalItemSlots: 38,
      maxStack: 999,
    },
    {
      name: "berries",
      offset: 0x5bc,
      slotCapacity: 64,
      legalItemSlots: 64,
      maxStack: 999,
    },
    {
      name: "balls",
      offset: 0x6bc,
      slotCapacity: 15,
      legalItemSlots: 15,
      maxStack: 999,
    },
    {
      name: "battleItems",
      offset: 0x6f8,
      slotCapacity: 13,
      legalItemSlots: 13,
      maxStack: 99,
    },
  ] as const satisfies ReadonlyArray<PouchEntry>,
  /**
   * Notes: slotCapacity = distance to next pouch / 4 (verified arithmetic);
   * legalItemSlots = PKHeX ItemStorage4Pt list lengths. TM/HM stacks cap at
   * 99, HMs at 1 (HM04 etc.). Reference-save spot checks matched the spike:
   * Repel x2 @items, Antidote x7 @medicine, Poke Ball x30 @balls.
   * Battle-items region extent is unpinned (EventWork starts at 0xdac).
   */
  confidenceNotes: {
    offsets: "verified",
    capacities: "inferred",
  } as const,
};

/**
 * Pokédex block (Zukan4). Base is general-block relative.
 * Layout: u32 magic, then four 0x40-byte bit regions, then forms/languages.
 */
export const dex = {
  dexBlockBase: 0x1328,
  magic: {
    offset: 0x0,
    type: "u32",
    note: "Observed 0xBEEFCAFE on reference save [PKHeX Zukan4.cs Magic]",
    confidence: "verified",
  },
  regions: {
    caughtRegion: { offset: 0x04, bytes: 0x40 },
    seenRegion: { offset: 0x44, bytes: 0x40 },
    seenGenderFirst: { offset: 0x84, bytes: 0x40 },
    seenGenderSecond: { offset: 0xc4, bytes: 0x40 },
  } as const,
  speciesBitRule:
    "Species national-dex id n -> bit (n-1) of the region, LSB-first within each byte (byte[i>>3] >> (i&7)) & 1 [PKHeX Zukan4.cs GetRegionFlag]. Gender regions: 00 male-only-seen, 01 male-first, 10 female-first, 11 female-only.",
  terminatorByteCaveat:
    "Final byte (region+0x3f) of caught and seen regions read 0xff on the reference save (gender regions read 0x00). Popcounts must ignore indices >= 493: masking them turned 49->41 caught and 110->102 seen, exactly matching player truth.",
  spindaPid: {
    offset: 0x104,
    type: "u32",
    note: "Spinda spot-shaping PID [PKHeX Zukan4.cs OFS_SPINDA]",
  },
  formFlagsBase: {
    offset: 0x108,
    type: "bytes",
    note:
      "Shellos/Gastrodon/Burmy/Wormadam form counters then 28 Unown form slots (+0x10c..0x127) [PKHeX Zukan4.cs OFS_FORM1]",
    confidence: "inferred",
  },
  languageFlagsBase: {
    offset: 0x128,
    type: "bytes[0x1f4]",
    note:
      "One byte per species, low 3 bits = languages seen (Pt layout) [PKHeX Zukan4.cs PokeDexLanguageFlags]",
    confidence: "inferred",
  },
  ptFormExtrasBase: {
    offset: 0x31c,
    type: "u32+bytes",
    note:
      "Rotom u32 form mask @+0x31c, Shaymin @+0x320, Giratina @+0x321 [PKHeX Zukan4.cs FormOffset2]",
    confidence: "inferred",
  },
} as const;

/** PC storage system ("a box is not in the general block"). Storage-relative. */
export const storage = {
  blockStartPartitionRelative: fileLayout.storageBlockStart,
  blockSize: fileLayout.storageBlockSize,
  currentBox: {
    offset: 0x0,
    type: "u8",
    note:
      "Currently-viewed box index 0..17; read 1 [PKHeX SAV4Sinnoh.cs CurrentBox]",
    confidence: "verified",
  },
  boxDataStart: {
    offset: 0x4,
    type: "pk4[18][30]",
    note:
      "18 boxes x 30 slots x 136-byte encrypted-at-rest Gen IV stored records, no inter-box padding (0xFF0/box) [PKHeX SAV4Sinnoh.cs BOX_* consts]",
    confidence: "verified",
  },
  boxSlotStride: 136 as const,
  boxDataLengthPerBox: 0xff0 as const,
  boxNames: {
    offset: 0x11ee4,
    type: "utf16[8] x18",
    note: "40 bytes per box name (max 8 chars) [PKHeX SAV4Sinnoh.cs BOX_NAME]",
    confidence: "verified",
  },
  boxWallpapers: {
    offset: 0x121b4,
    type: "u8 x18",
    note:
      "Wallpaper id per box (Pt special wallpapers shifted +8) [PKHeX SAV4Pt.cs OFS_Wallpaper area]",
    confidence: "verified",
  },
  boxFlags: {
    offset: 0x121c6,
    type: "bitfield",
    note:
      "Box flags byte; also hosts Pt unlockable-wallpaper bits [PKHeX SAV4Sinnoh.cs BOX_FLAGS / SAV4Pt.cs GetWallpaperUnlocked]",
    confidence: "inferred",
  },
  locationNote:
    "Gen IV keeps PC storage OUTSIDE the general block: general occupies partition[0x00000..0x0CF2C), storage occupies partition[0x0CF2C..0x1F110). Each has an independent CRC footer; both partitions usually hold valid copies of both blocks.",
};

/**
 * Story-progress machinery. Event flags are the game script's boolean store;
 * works are u16 variables. Both live in the general block.
 */
export const storyFlags = {
  eventWorkBase: {
    offset: 0xdac,
    type: "u16[]",
    note:
      "Event WORK array base; work i at base+2i (e.g., lottery work index 60) [PKHeX SAV4Pt.cs EventWork]",
    confidence: "verified",
  },
  eventFlagBase: {
    offset: 0xfec,
    type: "bitfield[2912]",
    note:
      "Event FLAG array; flag n lives at base+(n>>3), bit n&7, LSB-first. 0xB60 = 2912 flags total [PKHeX SAV4.cs EventFlagCount/GetEventFlag]",
    confidence: "verified",
  },
  dexUpgradeBytes: {
    offset: 0x1640,
    type: "u8 x4",
    note:
      "Pt dex upgrade markers: >=1 -> [0x1642], >=2 -> [0x1640], >=3 -> [0x1643], ==4 -> [0x1641] nonzero [PKHeX SAV4.cs DexUpgraded (Pt)]",
    confidence: "verified",
  },
  /**
   * Notable named flags from PKHeX's curated Pt flag list. These answer
   * legendary/story questions directly; gym-beaten flags are NOT in the
   * curated list — use badges.bitmaskByte for gyms (see gaps doc).
   */
  notableFlags: [
    { flag: 208, name: "Dialga captured" },
    { flag: 209, name: "Palkia captured" },
    { flag: 295, name: "Uxie captured" },
    { flag: 294, name: "Azelf captured" },
    { flag: 293, name: "Heatran battleable" },
    { flag: 288, name: "Heatran captured" },
    { flag: 283, name: "Regigigas captured" },
    { flag: 289, name: "Giratina captured" },
    { flag: 329, name: "Rotom captured" },
    { flag: 344, name: "Darkrai captured (event)" },
    { flag: 291, name: "Shaymin captured (event)" },
    { flag: 286, name: "Arceus captured (event)" },
    { flag: 2404, name: "Entered Hall of Fame (trainer card upgrade)" },
    { flag: 2444, name: "Connected to Nintendo WFC" },
    { flag: 2430, name: "Bebe's PC unlocked" },
  ] as const,
  notableFlagsConfidence: "inferred" as Confidence,
  gymProgressRule:
    "For 'have I beaten gym X', read badges.bitmaskByte bit X (badge award is atomic with gym clear in DPPt). Exact gym-defeat EVENT FLAGS remain unpinned — see docs/research/gen4-offsets.md gaps.",
};

/**
 * Map-id -> name resolution. The save stores a MAP HEADER id (room-level),
 * not the met-location id used on Pokémon summaries — two distinct spaces.
 */
export const mapIds = {
  sourceTable:
    "pret/pokeplatinum generated/map_headers.txt (Platinum, 0-based enum order ending at MAP_HEADER_COUNT)",
  sampleAnchors: [
    { id: 3, name: "Jubilife City" },
    { id: 33, name: "Canalave City" },
    { id: 45, name: "Oreburgh City" },
    { id: 65, name: "Eterna City" },
    { id: 86, name: "Hearthome City" },
    { id: 120, name: "Pastoria City" },
    { id: 132, name: "Veilstone City" },
    { id: 150, name: "Sunyshore City" },
    { id: 165, name: "Snowpoint City" },
    { id: 188, name: "Fight Area" },
    { id: 411, name: "Twinleaf Town" },
    { id: 418, name: "Sandgem Town" },
    { id: 450, name: "Survival Area" },
    { id: 457, name: "Resort Area" },
    { id: 504, name: "Great Marsh (area 1)" },
  ] as const,
  anchorConfidence: "inferred" as Confidence,
  anchorException:
    "id 120 = Pastoria City is 'verified' via live frame cross-check (docs/research/context-layer-spike.md addendum).",
};
