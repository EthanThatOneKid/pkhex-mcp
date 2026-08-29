/**
 * Synthetic two-partition Gen IV save builder — field-by-field, no
 * copyrighted data. Shared by save-reader and save-scanner tests.
 */
import { crc16ccitt, PARTITION_SIZE } from "../../src/gen4/save/reader.ts";
import { lcgXorRegion, SHUFFLE_TABLE } from "../../src/gen4/crypto.ts";

export const GENERAL_SIZE = 0xcf2c;
export const FOOTER_REL = 0xcf18; // GENERAL_SIZE - 0x14

export interface SaveOptions {
  /** Footer counters; defaults mirror a real save (partition 1 active). */
  major?: [number, number];
  minor?: [number, number];
  crcValid?: [boolean, boolean];
  /** TID/SID per half; defaults are identical halves (useless for selection). */
  tid?: [number, number];
  sid?: [number, number];
  money?: number;
  badges?: number;
  otNameCodes?: number[];
  playtimeHours?: [number, number];
  /** [itemId, count] pairs written at the items-pouch base. */
  bagItemsPairs?: Array<[number, number]>;
  /** Species national-dex ids marked seen / caught (bit n-1). */
  dexSeen?: number[];
  dexCaught?: number[];
  /** Event flag indices set to 1. */
  eventFlagBits?: number[];
  /** Six encrypted 236-byte party slots (active half only). */
  partySlots?: Uint8Array[];
}

function writeGeneralFooter(
  dv: DataView,
  base: number,
  major: number,
  minor: number,
  crcValid: boolean,
  data: Uint8Array,
): void {
  dv.setUint32(base + FOOTER_REL + 0x00, major, true);
  dv.setUint32(base + FOOTER_REL + 0x04, minor, true);
  dv.setUint32(base + FOOTER_REL + 0x08, GENERAL_SIZE, true);
  dv.setUint32(base + FOOTER_REL + 0x0c, 0x20060623, true);
  dv.setUint16(base + FOOTER_REL + 0x10, 0, true); // general block type
  const crc = crcValid
    ? crc16ccitt(data.slice(base, base + GENERAL_SIZE - 0x14))
    : 0xdead;
  dv.setUint16(base + FOOTER_REL + 0x12, crc, true);
}

function setRegionBit(dv: DataView, regionAbs: number, natId: number): void {
  const bit = natId - 1;
  if (bit < 0 || bit >= 493) return; // terminator-mask rule
  const addr = regionAbs + (bit >> 3);
  dv.setUint8(addr, dv.getUint8(addr) | (1 << (bit & 7)));
}

function setFlagBit(dv: DataView, flagBaseAbs: number, flag: number): void {
  const addr = flagBaseAbs + (flag >> 3);
  dv.setUint8(addr, dv.getUint8(addr) | (1 << (flag & 7)));
}

/** ASCII -> Gen IV TableINT codepoint (subset: A-Z a-z 0-9 space). */
export function asciiToG4(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c >= 48 && c <= 57) out.push(0x121 + (c - 48));
    else if (c >= 65 && c <= 90) out.push(0x12b + (c - 65));
    else if (c >= 97 && c <= 122) out.push(0x145 + (c - 97));
    else if (ch === " ") out.push(0x00);
  }
  return out;
}

/** Defaults tuned so the ACTIVE partition is index 1 (mirrors real saves). */
export function makeSave(opts: SaveOptions = {}): Uint8Array {
  const data = new Uint8Array(PARTITION_SIZE * 2);
  const dv = new DataView(data.buffer);

  // ---- active-half general content (partition 1) ----
  const a = PARTITION_SIZE;
  const tidA = opts.tid?.[1] ?? 1256;
  const sidA = opts.sid?.[1] ?? 32863;
  dv.setUint16(a + 0x78, tidA, true);
  dv.setUint16(a + 0x7a, sidA, true);
  dv.setUint32(a + 0x7c, opts.money ?? 91124, true);
  dv.setUint8(a + 0x82, opts.badges ?? 0b00000111);
  const name = opts.otNameCodes ?? asciiToG4("Ethan");
  name.forEach((code, i) => dv.setUint16(a + 0x68 + i * 2, code, true));
  if (name.length < 7) dv.setUint16(a + 0x68 + name.length * 2, 0xffff, true);
  dv.setUint16(a + 0x8a, opts.playtimeHours?.[1] ?? 61, true);
  dv.setUint8(a + 0x8c, 40);
  dv.setUint8(a + 0x8d, 14);
  dv.setUint16(a + 0x1280, 120, true); // Pastoria City anchor
  const partySlots = opts.partySlots ?? [];
  dv.setUint8(a + 0x9c, Math.min(6, partySlots.length)); // live party count
  (opts.bagItemsPairs ?? []).forEach(([id, count], i) => {
    dv.setUint16(a + 0x630 + i * 4, id, true);
    dv.setUint16(a + 0x630 + i * 4 + 2, count, true);
  });
  const dexBase = a + 0x1328;
  for (const n of opts.dexSeen ?? []) setRegionBit(dv, dexBase + 0x44, n);
  for (const n of opts.dexCaught ?? []) setRegionBit(dv, dexBase + 0x04, n);
  for (const f of opts.eventFlagBits ?? []) setFlagBit(dv, a + 0xfec, f);
  partySlots.forEach((slot, i) => {
    if (!slot || i >= 6) return;
    data.set(slot.subarray(0, Math.min(236, slot.length)), a + 0xa0 + i * 236);
  });

  // ---- stale-half general content (partition 0) ----
  const b = 0;
  dv.setUint16(b + 0x78, opts.tid?.[0] ?? tidA, true);
  dv.setUint16(b + 0x7a, opts.sid?.[0] ?? sidA, true);
  dv.setUint16(b + 0x8a, opts.playtimeHours?.[0] ?? 21, true);

  // footers last (CRC covers everything above). Partition 1 wins on major.
  writeGeneralFooter(
    dv,
    0,
    opts.major?.[0] ?? 0x0c,
    opts.minor?.[0] ?? 0x0e,
    opts.crcValid?.[0] ?? true,
    data,
  );
  writeGeneralFooter(
    dv,
    a,
    opts.major?.[1] ?? 0x0d,
    opts.minor?.[1] ?? 0x0f,
    opts.crcValid?.[1] ?? true,
    data,
  );
  return data;
}

/**
 * Storage block: current-box byte then 18 boxes x 30 x 136 B records.
 * boxNumber is 1-based (matching the game UI and getPcBox convention).
 */
export function writeStorageBox(
  data: Uint8Array,
  activeBase: number,
  boxNumber: number,
  records: Map<number, Uint8Array>, // slot -> encrypted 136 B record
  currentBox = boxNumber,
): void {
  const storageStart = activeBase + 0xcf2c;
  const dv = new DataView(data.buffer);
  dv.setUint8(storageStart, currentBox - 1); // currentBox is 0-based in storage byte
  const boxIndex = boxNumber - 1; // 1-based -> 0-based
  const boxStart = storageStart + 0x04 + boxIndex * 0xff0;
  for (let s = 0; s < 30; s++) {
    const rec = records.get(s);
    const at = boxStart + s * 136;
    data.fill(0xff, at, at + 136);
    if (rec) data.set(rec.subarray(0, 136), at);
  }
}

const PACK_IVS_ORDER = ["hp", "atk", "def", "spe", "spa", "spd"] as const;

function packIvs(ivs: Record<string, number>): number {
  let word = 0;
  PACK_IVS_ORDER.forEach((k, i) => {
    word |= (ivs[k] ?? 0) << (i * 5);
  });
  return word >>> 0;
}

/**
 * Build an ENCRYPTED 236-byte party record with known fields (audit tests).
 * Layout constants are public PKHeX PartyPokemon facts.
 */
export function makeEncryptedPartySlot(opts: {
  pid?: number;
  species: number;
  item?: number;
  moves?: [number, number, number, number];
  ivs?: Record<string, number>;
  evs?: Record<string, number>;
  level: number;
  hpCur: number;
  hpMax: number;
}): Uint8Array {
  const img = new Uint8Array(236);
  const dv = new DataView(img.buffer);
  const pid = opts.pid ?? 0x12345678;
  dv.setUint32(0x00, pid, true);
  dv.setUint16(0x08, opts.species, true); // growth block: species
  dv.setUint16(0x0a, opts.item ?? 0, true); // held item
  const evs = opts.evs ?? {};
  PACK_IVS_ORDER.forEach((k, i) => img[0x18 + i] = evs[k] ?? 0);
  (opts.moves ?? [1, 0, 0, 0]).forEach((mv, i) =>
    dv.setUint16(0x28 + i * 2, mv, true)
  );
  [35, 25, 20, 10].forEach((pp, i) => img[0x30 + i] = pp);
  dv.setUint32(0x38, packIvs(opts.ivs ?? {}), true);
  img[0x8c] = opts.level;
  dv.setUint16(0x8e, opts.hpCur, true);
  dv.setUint16(0x90, opts.hpMax, true);

  let sum = 0;
  for (let i = 0x08; i < 0x88; i += 2) sum += img[i]! | (img[i + 1]! << 8);
  const checksum = sum & 0xffff;
  dv.setUint16(0x06, checksum, true);

  // Encrypt: shuffle logical->physical, then LCG-XOR blocks (checksum) and
  // tail (PID) -- exact inverse of decryptSlot.
  const sv = ((pid >>> 13) & 31) % 24;
  const perm = SHUFFLE_TABLE[sv];
  const shuffled = new Uint8Array(236);
  const letters = ["A", "B", "C", "D"] as const;
  for (let phys = 0; phys < 4; phys++) {
    const li = letters.indexOf(perm[phys] as "A" | "B" | "C" | "D");
    shuffled.set(
      img.subarray(0x08 + li * 32, 0x08 + (li + 1) * 32),
      0x08 + phys * 32,
    );
  }
  shuffled.set(img.subarray(0, 0x08), 0);
  shuffled.set(img.subarray(0x88), 0x88);
  lcgXorRegion(shuffled, 0x08, 0x88, checksum);
  lcgXorRegion(shuffled, 0x88, 0xec, pid);
  return shuffled;
}

/** Build an ENCRYPTED 136-byte stored (PC box) record. */
export function makeEncryptedStoredRecord(opts: {
  pid?: number;
  species: number;
  item?: number;
  moves?: [number, number, number, number];
}): Uint8Array {
  const img = new Uint8Array(136);
  const dv = new DataView(img.buffer);
  const pid = opts.pid ?? 0x87654321;
  dv.setUint32(0x00, pid, true);
  dv.setUint16(0x08, opts.species, true);
  dv.setUint16(0x0a, opts.item ?? 0, true);
  if (opts.moves) {
    (opts.moves).forEach((mv, i) => dv.setUint16(0x28 + i * 2, mv, true));
  }
  let sum = 0;
  for (let i = 0x08; i < 0x88; i += 2) sum += img[i]! | (img[i + 1]! << 8);
  const checksum = sum & 0xffff;
  dv.setUint16(0x06, checksum, true);
  const sv = ((pid >>> 13) & 31) % 24;
  const perm = SHUFFLE_TABLE[sv];
  const shuffled = new Uint8Array(136);
  const letters = ["A", "B", "C", "D"] as const;
  for (let phys = 0; phys < 4; phys++) {
    const li = letters.indexOf(perm[phys] as "A" | "B" | "C" | "D");
    shuffled.set(
      img.subarray(0x08 + li * 32, 0x08 + (li + 1) * 32),
      0x08 + phys * 32,
    );
  }
  shuffled.set(img.subarray(0, 0x08), 0);
  lcgXorRegion(shuffled, 0x08, 0x88, checksum);
  return shuffled;
}
