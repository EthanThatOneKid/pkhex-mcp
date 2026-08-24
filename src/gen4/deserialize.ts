import { add16Checksum, decryptSlot } from "./crypto.ts";
import { SPECIES } from "./data/species.ts";
import { MOVES } from "./data/moves.ts";
import { ITEMS } from "./data/items.ts";
import { ABILITIES } from "./data/abilities.ts";
import { natureName } from "./data/natures.ts";

/** Local replacements for the removed frozen-contract types (v0.2 descope). */
type StatusCondition = "slp" | "psn" | "brn" | "frz" | "par";

interface MoveSlot {
  moveId: number;
  moveName: string;
  ppCur: number;
  ppMax: number;
}

interface PartyMember {
  slot: number;
  pid: number;
  speciesId: number;
  speciesName: string;
  types: string[];
  level: number;
  hpCur: number;
  hpMax: number;
  statusCondition: StatusCondition | null;
  statusDetail: number | null;
  natureName: string;
  heldItemId: number | null;
  itemName: string | null;
  abilityName: string;
  moves: Array<MoveSlot | null>;
  stats: {
    attack: number;
    defense: number;
    speed: number;
    spAttack: number;
    spDefense: number;
  };
}

const MAX_SPECIES = 493; // Pt sanity gate (spec section 7)
export type SlotDecodeResult =
  | { status: "ok"; member: PartyMember }
  | { status: "empty" }
  | { status: "torn" };

/** Gen IV status word -> contract vocabulary. */
export function parseStatus(word: number): {
  condition: StatusCondition;
  detail: number | null;
} | null {
  const sleep = word & 0x07;
  if (sleep !== 0) return { condition: "slp", detail: sleep };
  if ((word & 0x08) !== 0) {
    const toxicCounter = (word >>> 8) & 0xff;
    return {
      condition: "psn",
      detail: toxicCounter === 0 ? null : toxicCounter,
    };
  }
  if ((word & 0x10) !== 0) return { condition: "brn", detail: null };
  if ((word & 0x20) !== 0) return { condition: "frz", detail: null };
  if ((word & 0x40) !== 0) return { condition: "par", detail: null };
  return null;
}

/**
 * Decode one raw wire slot into a contract-exact PartyMember.
 * - species 0 => empty
 * - Add16 mismatch, out-of-universe species or level => torn (cache self-heals)
 *
 * v0.2 descope note: this decoder now serves the save-file party audit
 * (`get_party_audit`) and codec round-trip tests only — live wire ingest
 * was descoped (ADR-0004).
 */
export function decodePartySlot(
  slotNumber: number,
  slot: Uint8Array,
): SlotDecodeResult {
  const image = decryptSlot(slot, false);
  const dv = new DataView(image.buffer);

  const storedChecksum = dv.getUint16(0x06, true);
  const computedChecksum = add16Checksum(image, 0x08, 0x88);
  if (computedChecksum !== storedChecksum) return { status: "torn" };

  const speciesId = dv.getUint16(0x08, true);
  if (speciesId === 0) return { status: "empty" };
  if (speciesId > MAX_SPECIES || !SPECIES[speciesId]) return { status: "torn" };

  const heldItemId = dv.getUint16(0x0a, true);
  const abilityId = image[0x15]!;

  const level = image[0x8c]!;
  if (level < 1 || level > 100) return { status: "torn" };
  const hpCur = dv.getUint16(0x8e, true);
  const hpMax = dv.getUint16(0x90, true);

  const moves: Array<MoveSlot | null> = [];
  for (let i = 0; i < 4; i++) {
    const moveId = dv.getUint16(0x28 + i * 2, true);
    if (moveId === 0) {
      moves.push(null);
      continue;
    }
    const info = MOVES[moveId];
    if (!info) return { status: "torn" };
    const ppUps = image[0x34 + i]!;
    moves.push({
      moveId,
      moveName: info.name,
      ppCur: image[0x30 + i]!,
      ppMax: Math.floor((info.basePP * (5 + ppUps)) / 5),
    });
  }

  const statusWord = dv.getUint32(0x88, true);
  const parsed = parseStatus(statusWord);
  const pid = dv.getUint32(0x00, true);

  const member: PartyMember = {
    slot: slotNumber,
    pid,
    speciesId,
    speciesName: SPECIES[speciesId]!.name,
    types: [...SPECIES[speciesId]!.types],
    level,
    hpCur,
    hpMax,
    statusCondition: parsed?.condition ?? null,
    statusDetail: parsed?.detail ?? null,
    natureName: natureName(pid % 25),
    heldItemId: heldItemId === 0 ? null : heldItemId,
    itemName: heldItemId === 0 ? null : (ITEMS[heldItemId] ?? null),
    abilityName: ABILITIES[abilityId] ?? "",
    moves: [moves[0]!, moves[1]!, moves[2]!, moves[3]!],
    stats: {
      attack: dv.getUint16(0x92, true),
      defense: dv.getUint16(0x94, true),
      speed: dv.getUint16(0x96, true),
      spAttack: dv.getUint16(0x98, true),
      spDefense: dv.getUint16(0x9a, true),
    },
  };

  return { status: "ok", member };
}
