/**
 * Typed section map over the Gen IV save: every region the acceptance
 * battery touches, expressed as partition-relative offsets with confidence
 * tags. Pure aggregation of the authoritative data in offsets.ts — no
 * IO, so it stays unit-testable and LLM-renderable.
 */

import {
  badges,
  bag,
  type Confidence,
  dex,
  fileLayout,
  party,
  position,
  storage,
  storyFlags,
  trainerCard,
} from "./offsets.ts";

export interface SectionMapEntry {
  /** Dotted name, group-prefixed (e.g. "trainerCard.money"). */
  readonly name: string;
  /** Partition-relative byte offset within the ACTIVE slot. */
  readonly offset: number;
  readonly length?: number;
  readonly confidence: Confidence;
  readonly note: string;
}

function fromRecord(
  group: string,
  record: Record<
    string,
    { offset: number; type: string; note: string; confidence: string }
  >,
): SectionMapEntry[] {
  return Object.entries(record).map(([key, e]) => ({
    name: `${group}.${key}`,
    offset: e.offset,
    confidence: e.confidence as Confidence,
    note: `${e.type} — ${e.note}`,
  }));
}

export function getSectionMap(): readonly SectionMapEntry[] {
  const out: SectionMapEntry[] = [];

  out.push(...fromRecord("trainerCard", trainerCard));

  // party: expose count + the six-slot span explicitly.
  for (const e of fromRecord("party", { count: party.partyCount })) out.push(e);
  out.push({
    name: "party.slots",
    offset: party.firstSlot.offset,
    length: 6 * 236,
    confidence: party.firstSlot.confidence,
    note: party.firstSlot.note,
  });

  // badges: bitmask byte is the battery-relevant row.
  for (const e of fromRecord("badges", { byte: badges.bitmaskByte })) {
    out.push(e);
  }

  // dex: seen/caught regions live inside the dex block at dexBlockBase.
  const dexBase = dex.dexBlockBase;
  for (const key of ["seenRegion", "caughtRegion"] as const) {
    const r = dex.regions[key];
    out.push({
      name: `dex.${key.replace("Region", "")}`,
      offset: dexBase + r.offset,
      length: r.bytes,
      confidence: "verified",
      note: `bit = national-dex id - 1, LSB-first per byte (${
        dex.speciesBitRule ?? ""
      })`.trim(),
    });
  }

  // bag: one summary entry spanning base..last pouch end, plus per-pouch rows.
  const pouches = bag.pockets;
  let bagEnd = 0;
  for (const p of pouches) {
    const end = p.offset + p.slotCapacity * 4;
    if (end > bagEnd) bagEnd = end;
  }
  out.push({
    name: "bag.pouches",
    offset: bag.bagBase,
    length: bagEnd - bag.bagBase,
    confidence: "verified",
    note:
      `[u16 id][u16 count] pairs; ${pouches.length} pouches (spike-verified contents)`,
  });
  for (const p of pouches) {
    out.push({
      name: `bag.pouch.${p.name}`,
      offset: bag.bagBase + p.offset,
      length: p.slotCapacity * 4,
      confidence: "verified",
      note:
        `${p.legalItemSlots} legal slots of ${p.slotCapacity}; max stack ${p.maxStack}`,
    });
  }

  // storage: PC boxes live in their own block past the general block.
  out.push({
    name: "storage.block",
    offset: storage.blockStartPartitionRelative,
    length: storage.blockSize,
    confidence: "verified",
    // 18 boxes x 30 slots per offsets.ts boxDataStart ("pk4[18][30]").
    note: "18 boxes x 30 slots x 136 B records (+ current-box byte)",
  });

  // position.mapId under its battery-facing name.
  for (const e of fromRecord("position", { mapId: position.mapHeaderId })) {
    out.push(e);
  }

  // story flags: bit n at eventFlagBase + (n >> 3), bit n & 7.
  for (
    const e of fromRecord("storyFlags", {
      eventFlags: storyFlags.eventFlagBase,
    })
  ) {
    out.push({ ...e, length: Math.ceil(2912 / 8) });
  }

  void fileLayout;
  return out;
}
