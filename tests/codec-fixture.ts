/**
 * Test-side ENCODER: builds valid encrypted+shuffled party slots from
 * plaintext fields, implemented independently from the research document
 * (docs/research/platinum-memory-map.md). Round-trip agreement with the
 * decoder under src/gen4/ is therefore real behavioral signal.
 *
 * Wire layout (per-slot, 236 bytes):
 *   +0x00 u32 PID            +0x04 u16 flags   +0x06 u16 Add16 checksum
 *   +0x08..0x87 4x32B data blocks, shuffled per (PID>>13)&31, LCG-XORed
 *     with the checksum word as seed
 *   +0x88..0xEB battle tail, LCG-XORed with PID as seed
 */
import type { Stats } from "../src/gen4/schemas.ts";

const SHUFFLE = [
  "ABCD", "ABDC", "ACBD", "ACDB", "ADBC", "ADCB",
  "BACD", "BADC", "BCAD", "BCDA", "BDAC", "BDCA",
  "CABD", "CADB", "CBAD", "CBDA", "CDAB", "CDBA",
  "DABC", "DACB", "DBAC", "DBCA", "DCAB", "DCBA",
] as const;

const BLOCK_SIZE = 32;

function lcgXor(bytes: Uint8Array, start: number, end: number, seed: number): void {
  for (let i = start; i < end; i += 2) {
    seed = (Math.imul(0x41c64e6d, seed) + 0x6073) >>> 0;
    const word = bytes[i]! | (bytes[i + 1]! << 8);
    const xored = word ^ (seed >>> 16);
    bytes[i] = xored & 0xff;
    bytes[i + 1] = (xored >>> 8) & 0xff;
  }
}

function add16(bytes: Uint8Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i += 2) {
    sum += bytes[i]! | (bytes[i + 1]! << 8);
  }
  return sum & 0xffff;
}

export interface FixtureMember {
  pid: number;
  speciesId: number;
  heldItemId: number;
  abilityId: number;
  evs: [number, number, number, number, number, number]; // HP Atk Def Spe SpA SpD
  moveIds: [number, number, number, number];
  ppCur: [number, number, number, number];
  ppUps: [number, number, number, number];
  level: number;
  hpCur: number;
  hpMax: number;
  stats: Stats; // attack defense spAttack spDefense speed
  statusWord: number; // raw u32 tail status word
}

/** Build the four logical plaintext blocks + plaintext tail for a member. */
function plaintext(member: FixtureMember) {
  const a = new Uint8Array(BLOCK_SIZE);
  const b = new Uint8Array(BLOCK_SIZE);
  // Block A (logical): species@0x08 abs -> offset 0x00 within block
  const dvA = new DataView(a.buffer);
  dvA.setUint16(0x00, member.speciesId, true);
  dvA.setUint16(0x02, member.heldItemId, true); // abs 0x0A
  dvA.setUint32(0x04, 0, true); // OT ID abs 0x0C
  a[0x0c] = 0; // friendship abs 0x14
  a[0x0d] = member.abilityId; // ability abs 0x15
  // EVs abs 0x18..0x1D -> block offset 0x10..0x15
  member.evs.forEach((ev, i) => {
    a[0x10 + i] = ev;
  });

  // Block B (logical): moves at block offset 0x00 (abs 0x28)
  const dvB = new DataView(b.buffer);
  member.moveIds.forEach((m, i) => dvB.setUint16(i * 2, m, true));
  member.ppCur.forEach((pp, i) => {
    b[0x08 + i] = pp;
  });
  member.ppUps.forEach((ups, i) => {
    b[0x0c + i] = ups;
  });
  // IV bitfield abs 0x38 -> block offset 0x10
  const ivWord =
    (31 << 0) | (13 << 5) | (25 << 10) | (12 << 15) | (30 << 20) | (7 << 25);
  dvB.setUint32(0x10, ivWord, true);

  // Tail (abs 0x88..0xEB, 100 bytes)
  const tail = new Uint8Array(100);
  const dvT = new DataView(tail.buffer);
  dvT.setUint32(0x00, member.statusWord, true); // abs 0x88
  tail[0x04] = member.level; // abs 0x8C
  tail[0x06] = member.hpCur & 0xff; // abs 0x8E
  tail[0x07] = (member.hpCur >> 8) & 0xff;
  tail[0x08] = member.hpMax & 0xff; // abs 0x90
  tail[0x09] = (member.hpMax >> 8) & 0xff;
  const statOrder = [
    member.stats.attack,
    member.stats.defense,
    member.stats.speed,
    member.stats.spAttack,
    member.stats.spDefense,
  ];
  statOrder.forEach((s, i) => dvT.setUint16(0x0a + i * 2, s, true)); // abs 0x92..

  return { blocks: [a, b, new Uint8Array(BLOCK_SIZE), new Uint8Array(BLOCK_SIZE)], tail };
}

/**
 * Encode a member into wire-format slot bytes.
 * Pass alreadyEncrypted=true to simulate flags.bit0 (blocks shuffled but NOT
 * XOR-encrypted; tail likewise).
 */
export function encodeSlot(
  member: FixtureMember,
  opts: { alreadyEncrypted?: boolean } = {},
): Uint8Array {
  const { blocks, tail } = plaintext(member);
  const sv = ((member.pid >>> 13) & 31) % 24;
  const perm = SHUFFLE[sv];

  // checksum over PLAINTEXT logical order (decoder recomputes after decrypt+unshuffle)
  const flatPlain = new Uint8Array(128);
  blocks.forEach((blk, i) => flatPlain.set(blk, i * BLOCK_SIZE));
  const checksum = add16(flatPlain, 0, 128);

  // physical arrangement: perm[i] = which logical block sits in physical slot i
  const letters = ["A", "B", "C", "D"] as const;
  const physical = new Uint8Array(128);
  blocks.forEach((blk, logicalIndex) => {
    const phys = perm.indexOf(letters[logicalIndex]);
    physical.set(blk, phys * BLOCK_SIZE);
  });

  const slot = new Uint8Array(236);
  const dv = new DataView(slot.buffer);
  dv.setUint32(0x00, member.pid, true);
  dv.setUint16(0x04, opts.alreadyEncrypted ? 0x0001 : 0x0000, true); // flags bit0
  dv.setUint16(0x06, checksum, true);
  slot.set(physical, 0x08);
  slot.set(tail, 0x88);

  if (!opts.alreadyEncrypted) {
    lcgXor(slot, 0x08, 0x88, checksum); // block cipher
    lcgXor(slot, 0x88, 0xEC, member.pid); // tail cipher
  }
  // alreadyEncrypted: game left both regions plaintext in place; only bit0 set.

  return slot;
}

