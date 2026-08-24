/**
 * Battery scanners: server-side readers over the save file that return
 * decoded answers for the eight acceptance questions (ADR-0003). Pure
 * functions over SaveFileReader; the MCP layer wraps them.
 *
 * Deterministic-helper boundary: every byte-level transform (checksums,
 * LCG, bit-order, charmap) happens HERE — never in the model.
 */

import { encodeBase64 } from "@std/encoding";
import {
  add16Checksum,
  decryptSlot,
  lcgXorRegion,
  unshuffleBlocks,
} from "../crypto.ts";
import { ITEMS } from "../data/items.ts";
import { MOVES } from "../data/moves.ts";
import { SPECIES } from "../data/species.ts";
import { natureName } from "../data/natures.ts";
import type { SaveFileReader } from "./reader.ts";
import {
  badges as badgesOffset,
  bag as bagOffsets,
  dex as dexOffsets,
  storage as storageOffsets,
  storyFlags as storyFlagsOffsets,
  trainerCard as trainerCardOffsets,
} from "./offsets.ts";

// ------------------------------ G4 charmap ------------------------------

/** PKHeX TableINT subset: digits, upper, lower; 0xFFFF terminates. */
const G4_ASCII = new Map<number, string>((() => {
  const m = new Map<number, string>([[0x00, " "]]);
  for (let i = 0; i < 10; i++) m.set(0x121 + i, String(i));
  for (let i = 0; i < 26; i++) m.set(0x12b + i, String.fromCharCode(65 + i));
  for (let i = 0; i < 26; i++) m.set(0x145 + i, String.fromCharCode(97 + i));
  return m;
})());

export function decodeG4String(codes: ArrayLike<number>): string {
  let out = "";
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;
    if (code === 0xffff) break;
    const ch = G4_ASCII.get(code);
    if (ch) out += ch;
  }
  return out;
}

function byte(reader: SaveFileReader, offset: number): number {
  return reader.read(offset, 1)[0]!;
}

function u16At(reader: SaveFileReader, offset: number): number {
  return reader.u16(offset);
}

// ---------------------------- trainer card ------------------------------

export interface TrainerCard {
  playerName: string;
  tid: number;
  sid: number;
  money: number;
  badgeCount: number;
  playtime: { hours: number; minutes: number; seconds: number };
}

export function getTrainerCard(reader: SaveFileReader): TrainerCard {
  const nameCodes: number[] = [];
  for (let i = 0; i < 7; i++) {
    nameCodes.push(u16At(reader, trainerCardOffsets.otName.offset + i * 2));
  }
  const badgeByte = byte(reader, trainerCardOffsets.badges.offset);
  let badgeCount = 0;
  for (let b = 0; b < 8; b++) if ((badgeByte >> b) & 1) badgeCount++;
  return {
    playerName: decodeG4String(nameCodes) || "?",
    tid: u16At(reader, trainerCardOffsets.tid.offset),
    sid: u16At(reader, trainerCardOffsets.sid.offset),
    money: reader.u32(trainerCardOffsets.money.offset),
    badgeCount,
    playtime: {
      hours: u16At(reader, trainerCardOffsets.playtimeHours.offset),
      minutes: byte(reader, trainerCardOffsets.playtimeMinutes.offset),
      seconds: byte(reader, trainerCardOffsets.playtimeSeconds.offset),
    },
  };
}

// -------------------------------- badges --------------------------------

export interface BadgeCase {
  count: number;
  earned: string[];
  /** bit -> gym order per offsets.badges.badgeBitOrder (confidence: inferred). */
  bitOrder: readonly string[];
}

export function getBadges(reader: SaveFileReader): BadgeCase {
  const value = byte(reader, badgesOffset.bitmaskByte.offset);
  const earned = badgesOffset.badgeBitOrder.filter((_, bit) =>
    (value >> bit) & 1
  );
  return {
    count: earned.length,
    earned: [...earned],
    bitOrder: badgesOffset.badgeBitOrder,
  };
}

// --------------------------------- bag ----------------------------------

export interface BagEntry {
  itemId: number;
  itemName: string | null;
  count: number;
}

export interface BagPouch {
  name: string;
  items: BagEntry[];
}

export function getBag(reader: SaveFileReader): { pouches: BagPouch[] } {
  const pouches: BagPouch[] = [];
  for (const pouch of bagOffsets.pockets) {
    const base = bagOffsets.bagBase + pouch.offset;
    const items: BagEntry[] = [];
    for (let slot = 0; slot < pouch.slotCapacity; slot++) {
      const id = u16At(reader, base + slot * 4);
      const count = u16At(reader, base + slot * 4 + 2);
      // orderingRule: compaction means trailing slots are 0000-0000; a zero
      // entry mid-pouch is skipped, not treated as end-of-pouch.
      if (id === 0 || count === 0) continue;
      items.push({
        itemId: id,
        itemName: (ITEMS as Record<string, string>)[String(id)] ?? null,
        count,
      });
    }
    if (items.length > 0) pouches.push({ name: pouch.name, items });
  }
  return { pouches };
}

// ---------------------------------- dex ---------------------------------

const DEX_SPECIES_MAX = 493;

export interface DexSummary {
  seen: number;
  caught: number;
}

function popcountDexRegion(reader: SaveFileReader, regionRel: number): number {
  let count = 0;
  const bytes = reader.read(
    dexOffsets.dexBlockBase + regionRel,
    dexOffsets.regions.caughtRegion.bytes,
  );
  for (let byteIdx = 0; byteIdx < bytes.length; byteIdx++) {
    for (let bit = 0; bit < 8; bit++) {
      const natId = byteIdx * 8 + bit + 1;
      if (natId > DEX_SPECIES_MAX) continue; // terminator-mask rule (#spike)
      if ((bytes[byteIdx]! >> bit) & 1) count++;
    }
  }
  return count;
}

export function getDexSummary(reader: SaveFileReader): DexSummary {
  return {
    caught: popcountDexRegion(reader, dexOffsets.regions.caughtRegion.offset),
    seen: popcountDexRegion(reader, dexOffsets.regions.seenRegion.offset),
  };
}

function dexBitSet(
  reader: SaveFileReader,
  regionRel: number,
  natId: number,
): boolean {
  if (natId < 1 || natId > DEX_SPECIES_MAX) return false;
  const bit = natId - 1;
  const value = byte(
    reader,
    dexOffsets.dexBlockBase + regionRel + (bit >> 3),
  );
  return ((value >> (bit & 7)) & 1) === 1;
}

export function isSpeciesCaught(
  reader: SaveFileReader,
  nationalDexId: number,
): boolean {
  return dexBitSet(
    reader,
    dexOffsets.regions.caughtRegion.offset,
    nationalDexId,
  );
}

// ------------------------------ PC storage -------------------------------

export interface PcSlot {
  slot: number;
  speciesId: number | null;
  speciesName: string | null;
}

export interface PcBoxView {
  box: number;
  currentBox: boolean;
  slots: PcSlot[];
}

const EMPTY_RECORD_BYTE = 0xff;

function isEmptyStored(record: Uint8Array): boolean {
  for (const b of record) if (b !== EMPTY_RECORD_BYTE) return false;
  return true;
}
/**
 * Decrypt a 136-byte stored record: LCG-XOR with the checksum word, then
 * unshuffle blocks. Stored PK4 has no PID-XORed battle tail.
 */
function decryptStoredRecord(record: Uint8Array): Uint8Array {
  const image = record.slice();
  const checksumWord = image[0x06]! | (image[0x07]! << 8);
  lcgXorRegion(image, 0x08, 0x88, checksumWord);
  const pid = image[0x00]! |
    (image[0x01]! << 8) |
    (image[0x02]! << 16) |
    (image[0x03]! << 24); // plaintext header
  unshuffleBlocks(image, pid, 0x08);
  return image;
}

function storedSpecies(
  reader: SaveFileReader,
  absOffset: number,
): PcSlot["speciesId"] {
  const record = reader.read(absOffset, storageOffsets.boxSlotStride);
  if (isEmptyStored(record)) return null;
  const image = decryptStoredRecord(record);
  const speciesId = image[0x08]! | (image[0x09]! << 8);
  if (speciesId === 0 || !SPECIES[speciesId]) return null;
  return speciesId;
}

const BOX_COUNT = 18;

export function getPcBox(reader: SaveFileReader, boxIndex?: number): PcBoxView {
  // reader offsets are SLOT-relative; storage constants are already
  // partition-relative, so pass them straight through (no base addition).
  const storageRel = storageOffsets.blockStartPartitionRelative;
  const currentBox = byte(
    reader,
    storageRel + storageOffsets.currentBox.offset,
  );
  const box = boxIndex ?? currentBox;
  if (!Number.isInteger(box) || box < 0 || box >= BOX_COUNT) {
    throw new Error(`box index out of range: ${box}`);
  }
  const boxStartRel = storageRel + storageOffsets.boxDataStart.offset +
    box * storageOffsets.boxDataLengthPerBox;
  const slots: PcSlot[] = [];
  for (let s = 0; s < 30; s++) {
    const speciesId = storedSpecies(
      reader,
      boxStartRel + s * storageOffsets.boxSlotStride,
    );
    slots.push({
      slot: s,
      speciesId,
      speciesName: speciesId === null ? null : SPECIES[speciesId].name,
    });
  }
  return { box, currentBox: box === currentBox, slots };
}

export interface PcHit {
  box: number;
  slot: number;
  speciesId: number;
  speciesName: string;
}

export function findInPcBox(
  reader: SaveFileReader,
  query: string | number,
): PcHit[] {
  const targetId = resolveSpeciesId(query);
  if (targetId === null) return [];
  const hits: PcHit[] = [];
  for (let box = 0; box < BOX_COUNT; box++) {
    for (const entry of getPcBox(reader, box).slots) {
      if (entry.speciesId === targetId) {
        hits.push({
          box,
          slot: entry.slot,
          speciesId: entry.speciesId!,
          speciesName: entry.speciesName!,
        });
      }
    }
  }
  return hits;
}

/** Resolve a national dex id or exact species name to its dex id. */
export function resolveSpeciesId(query: string | number): number | null {
  if (typeof query === "number") {
    return SPECIES[query] ? query : null;
  }
  const q = query.trim().toLowerCase();
  for (const [id, info] of Object.entries(SPECIES)) {
    if (info.name.toLowerCase() === q) return Number(id);
  }
  return null;
}

// ----------------------------- story flags ------------------------------

export interface StoryFlagState {
  flag: number;
  name: string;
  set: boolean;
}

function eventFlagSet(reader: SaveFileReader, flag: number): boolean {
  const base = storyFlagsOffsets.eventFlagBase.offset;
  return ((byte(reader, base + (flag >> 3)) >> (flag & 7)) & 1) === 1;
}

export function getStoryFlags(
  reader: SaveFileReader,
  indices?: number[],
): StoryFlagState[] {
  if (indices) {
    return indices.map((flag) => ({
      flag,
      name: `event flag ${flag}`,
      set: eventFlagSet(reader, flag),
    }));
  }
  return storyFlagsOffsets.notableFlags.map((n) => ({
    flag: n.flag,
    name: n.name,
    set: eventFlagSet(reader, n.flag),
  }));
}

// --------------------------- raw region reads ---------------------------

/** Hard cap per Region read (ADR-0003): paginate for larger ranges. */
export const RAW_REGION_MAX_BYTES = 1024;

export interface RawRegion {
  offset: number;
  length: number;
  base64: string;
}

/**
 * Raw slot-relative bytes as compact base64. Rejects (never truncates):
 * non-integer/negative offsets, lengths outside 1..1024, and windows past
 * the end of the active partition.
 */
export function readRawRegion(
  reader: SaveFileReader,
  offset: number,
  length: number,
): RawRegion {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError("offset must be a non-negative integer");
  }
  if (
    !Number.isInteger(length) || length < 1 || length > RAW_REGION_MAX_BYTES
  ) {
    throw new RangeError(
      `length must be 1..${RAW_REGION_MAX_BYTES} bytes per call; paginate for larger ranges`,
    );
  }
  const bytes = reader.read(offset, length);
  return { offset, length, base64: encodeBase64(bytes) };
}

// ----------------------------- party audit ------------------------------

interface StatBlock {
  hp: number;
  atk: number;
  def: number;
  spe: number;
  spa: number;
  spd: number;
}

export interface PartyAuditMember {
  slot: number;
  speciesName: string | null;
  level: number | null;
  natureName: string;
  ivs: StatBlock;
  evs: StatBlock;
  moveIds: Array<number | null>;
  /** True when the slot failed its Add16 checksum (stale/mid-write data). */
  torn?: boolean;
}

const partyCountOffset = () => 0x9c; // party.partyCount anchor (offsets.ts)

function emptyMember(slot: number): PartyAuditMember {
  return {
    slot,
    speciesName: null,
    level: null,
    natureName: "",
    ivs: zeroStats(),
    evs: zeroStats(),
    moveIds: [null, null, null, null],
  };
}

const IV_SHIFT: Record<string, number> = {
  hp: 0,
  atk: 5,
  def: 10,
  spe: 15,
  spa: 20,
  spd: 25,
};

function zeroStats(): StatBlock {
  return { hp: 0, atk: 0, def: 0, spe: 0, spa: 0, spd: 0 };
}

/** Party audit reads raw decrypted fields the curated tools don't expose:
 * IVs (packed u32 @0x38), EVs (u8 x6 @0x18) per public PKHeX layout.
 * Slots beyond the live party count report empty (stale post-boxing data is
 * never surfaced), and each member must pass its Add16 checksum or it is
 * reported as a torn row instead of decoded garbage. */
export function getPartyAudit(reader: SaveFileReader): PartyAuditMember[] {
  const out: PartyAuditMember[] = [];
  const partyCount = Math.min(
    6,
    byte(reader, partyCountOffset()),
  );
  for (let i = 0; i < 6; i++) {
    if (i >= partyCount) {
      out.push(emptyMember(i + 1));
      continue;
    }
    const base = 0xa0 + i * 236; // party.firstSlot anchor (offsets.ts)
    const record = reader.read(base, 236);
    const image = decryptSlot(record, false);
    const dv = new DataView(image.buffer);
    const storedChecksum = dv.getUint16(0x06, true);
    const computedChecksum = add16Checksum(image, 0x08, 0x88);
    if (computedChecksum !== storedChecksum) {
      out.push({ ...emptyMember(i + 1), torn: true });
      continue;
    }
    const speciesId = dv.getUint16(0x08, true);
    const ivWord = dv.getUint32(0x38, true);
    const ivs = Object.fromEntries(
      Object.entries(IV_SHIFT).map((
        [k, shift],
      ) => [k, (ivWord >>> shift) & 31]),
    ) as unknown as StatBlock;
    const evs = {
      hp: image[0x18]!,
      atk: image[0x19]!,
      def: image[0x1a]!,
      spe: image[0x1b]!,
      spa: image[0x1c]!,
      spd: image[0x1d]!,
    };
    const pid = dv.getUint32(0x00, true);
    const moveIds = [0, 1, 2, 3].map((m) => {
      const id = dv.getUint16(0x28 + m * 2, true);
      return id === 0 ? null : id;
    });
    out.push({
      slot: i + 1,
      speciesName: SPECIES[speciesId]?.name ?? null,
      level: image[0x8c]!,
      natureName: natureName(pid % 25),
      ivs,
      evs,
      moveIds,
    });
  }
  return out;
}
