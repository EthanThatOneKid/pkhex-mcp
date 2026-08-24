/**
 * Slot-aware Gen IV save-file reader.
 *
 * Selection rule (ticket #23 / docs/research/gen4-slot-recency.md): the active
 * partition is the one whose General-block footer carries the higher counter —
 * major u32 LE at footer+0x00, minor u32 LE at footer+0x04 as tiebreak,
 * full tie defaults to partition 0 with an ambiguity warning. The
 * 0xFFFFFFFF sentinel loses unless the counterpart is exactly 0xFFFFFFFE
 * (faithful port of PKHeX SAV4BlockDetection.CompareFooters).
 *
 * CRC-16-CCITT (poly 0x1021, init 0xFFFF) over the block minus its 0x14-byte
 * footer guards the choice: a counter winner that fails its CRC while the
 * loser validates is overridden (save interrupted mid-write); a file where
 * neither half validates is rejected outright.
 */

import { fileLayout } from "./offsets.ts";

export const PARTITION_SIZE = fileLayout.partitionSize;
export const GENERAL_BLOCK_SIZE = fileLayout.generalBlockSize;
export const GENERAL_FOOTER_REL = GENERAL_BLOCK_SIZE -
  fileLayout.blockFooterSize;

export type SlotIndex = 0 | 1;

export type SlotReason =
  | "higher-major"
  | "higher-minor"
  | "sentinel"
  | "full-tie-default"
  | "crc-override";

export interface SlotSelection {
  readonly index: SlotIndex;
  /** Absolute byte offset of the active partition's start. */
  readonly base: number;
  readonly reason: SlotReason;
  readonly warnings: readonly string[];
}

/** Sign convention: returns sign(a - b); negative => FIRST arg wins. */
export function compareCounters(a: number, b: number): -1 | 0 | 1 {
  const SENTINEL = 0xffffffff;
  const SENTINEL_PREV = 0xfffffffe;
  // A lone sentinel LOSES (uninitialized flash fill); against its immediate
  // predecessor the exception does not apply and plain comparison keeps it
  // (PKHeX treats the wrap race as impossible).
  if (a === SENTINEL && b !== SENTINEL_PREV) return -1;
  if (b === SENTINEL && a !== SENTINEL_PREV) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** CRC16-CCITT (poly 0x1021, init 0xFFFF, MSB-first). */
export function crc16ccitt(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

interface FooterView {
  major: number;
  minor: number;
  crcValid: boolean;
}

function readFooter(data: Uint8Array, partition: SlotIndex): FooterView {
  const base = partition * PARTITION_SIZE;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const footerAbs = base + GENERAL_FOOTER_REL;
  const storedCrc = dv.getUint16(footerAbs + 0x12, true);
  const computed = crc16ccitt(
    data.slice(base, base + GENERAL_BLOCK_SIZE - fileLayout.blockFooterSize),
  );
  return {
    major: dv.getUint32(footerAbs + 0x00, true),
    minor: dv.getUint32(footerAbs + 0x04, true),
    crcValid: storedCrc === computed,
  };
}

function selectSlot(data: Uint8Array): SlotSelection {
  if (data.length < PARTITION_SIZE * 2) {
    throw new Error(
      `expected at least ${
        PARTITION_SIZE * 2
      } bytes (two partitions); got ${data.length}`,
    );
  }
  const warnings: string[] = [];
  const footers: [FooterView, FooterView] = [
    readFooter(data, 0),
    readFooter(data, 1),
  ];
  if (!footers[0].crcValid && !footers[1].crcValid) {
    throw new Error(
      "corrupt save: neither partition's General-block CRC validates",
    );
  }

  let index: SlotIndex;
  let reason: SlotReason;
  const sentinelInvolved = footers[0].major === 0xffffffff ||
    footers[1].major === 0xffffffff;
  let cmp = compareCounters(footers[0].major, footers[1].major);
  if (cmp !== 0) {
    // compareCounters returns sign(a - b): negative => the SECOND argument
    // holds the higher counter and wins.
    index = cmp < 0 ? 1 : 0;
    reason = sentinelInvolved ? "sentinel" : "higher-major";
  } else {
    cmp = compareCounters(footers[0].minor, footers[1].minor);
    if (cmp !== 0) {
      index = cmp < 0 ? 1 : 0;
      reason = "higher-minor";
    } else {
      index = 0;
      reason = "full-tie-default";
      warnings.push(
        "slot counters fully tied; selection ambiguous — defaulting to partition 0",
      );
    }
  }

  if (!footers[index].crcValid && footers[1 - index].crcValid) {
    warnings.push(
      "counter winner failed its General CRC; preferring the checksum-valid half",
    );
    index = (1 - index) as SlotIndex;
    reason = "crc-override";
  }

  // Diagnostic sanity signal only — never decides selection (#23).
  const hours = (p: SlotIndex) =>
    new DataView(data.buffer, data.byteOffset, data.byteLength)
      .getUint16(p * PARTITION_SIZE + 0x8a, true);
  const other = (1 - index) as SlotIndex;
  if (hours(other) > hours(index)) {
    warnings.push(
      `playtime disagrees with counter verdict (inactive half ${
        hours(other)
      }h > chosen ${hours(index)}h)`,
    );
  }

  return { index, base: index * PARTITION_SIZE, reason, warnings };
}

/** Reads slot-relative offsets from the ACTIVE partition of a Gen IV save. */
export class SaveFileReader {
  readonly #data: Uint8Array;
  readonly #dv: DataView;
  readonly slot: SlotSelection;

  private constructor(data: Uint8Array, selection: SlotSelection) {
    this.#data = data;
    this.#dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.slot = selection;
  }

  static fromBytes(data: Uint8Array): SaveFileReader {
    return new SaveFileReader(data, selectSlot(data));
  }

  /** Slot-relative bytes from the active partition. */
  read(offset: number, length: number): Uint8Array {
    const start = this.slot.base + offset;
    if (offset < 0 || length < 0 || start + length > this.#data.length) {
      throw new RangeError(`read [${offset}, +${length}) out of bounds`);
    }
    return this.#data.slice(start, start + length);
  }

  u16(offset: number): number {
    return this.#dv.getUint16(this.slot.base + offset, true);
  }

  u32(offset: number): number {
    return this.#dv.getUint32(this.slot.base + offset, true);
  }
}
