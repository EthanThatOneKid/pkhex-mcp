import { decodeBase64 } from "@std/encoding";
import { add16Checksum, decryptSlot } from "./crypto.ts";
import { SPECIES } from "./data/species.ts";
import { MOVES } from "./data/moves.ts";
import { ITEMS } from "./data/items.ts";
import { ABILITIES } from "./data/abilities.ts";
import { natureName } from "./data/natures.ts";
import type {
  GameState,
  MoveSlot,
  PartyMember,
  StatusCondition,
  SyncPayload,
} from "./schemas.ts";

const MAX_SPECIES = 493; // Pt sanity gate (spec section 7)
const SLOT_SIZE = 236;

export type SlotDecodeResult =
  | { status: "ok"; member: PartyMember }
  | { status: "empty" }
  | { status: "torn" };

/** Gen IV status word -> contract vocabulary. */
function parseStatus(word: number): {
  condition: StatusCondition;
  detail: number | null;
} | null {
  const sleep = word & 0x07;
  if (sleep !== 0) return { condition: "slp", detail: sleep };
  if ((word & 0x08) !== 0) {
    const toxicCounter = (word >>> 8) & 0xff;
    return { condition: "psn", detail: toxicCounter === 0 ? null : toxicCounter };
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
 */
export function decodePartySlot(
  slotNumber: number,
  raw: { bytes: string; decryptedInPlace: boolean },
): SlotDecodeResult {
  let slotBytes: Uint8Array;
  try {
    slotBytes = decodeBase64(raw.bytes);
  } catch {
    return { status: "torn" };
  }
  if (slotBytes.length !== SLOT_SIZE) return { status: "torn" };

  const image = decryptSlot(slotBytes, raw.decryptedInPlace);
  const dv = new DataView(image.buffer);

  const pid = dv.getUint32(0x00, true);
  const storedChecksum = dv.getUint16(0x06, true);
  const computedChecksum = add16Checksum(image, 0x08, 0x88);
  if (computedChecksum !== storedChecksum) return { status: "torn" };

  // Logical Block A lives at abs 0x08 in the unshuffled image.
  const speciesId = dv.getUint16(0x08, true);
  if (speciesId === 0) return { status: "empty" };
  if (speciesId > MAX_SPECIES || !SPECIES[speciesId]) return { status: "torn" };

  const heldItemId = dv.getUint16(0x0a, true);
  const abilityId = image[0x15]!;

  const level = image[0x8c]!;
  if (level < 1 || level > 100) return { status: "torn" };
  const hpCur = dv.getUint16(0x8e, true);
  const hpMax = dv.getUint16(0x90, true);

  const moves: MoveSlot[] = [];
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

  const speciesInfo = SPECIES[speciesId]!;

  const member: PartyMember = {
    slot: slotNumber,
    pid,
    speciesId,
    speciesName: speciesInfo.name,
    types: [...speciesInfo.types],
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

/**
 * Decode a full six-slot wire snapshot into the GameState slots tuple.
 *
 * Enrichment-miss policy: an unknown MOVE id means the slot's data is
 * inconsistent with our known universe (moves are structurally load-bearing),
 * so the slot reports torn; unknown item/ability ids are cosmetic and
 * degrade to null / empty string per the frozen contract's nullability.
 *
 * Torn slots collapse to null here; the state cache (ticket #14) applies
 * last-known-good self-heal on top using per-slot granular results.
 */
export function decodeSnapshotSlots(
  raw: SyncPayload["slots"],
): GameState["slots"] {
  const out = [
    null,
    null,
    null,
    null,
    null,
    null,
  ] as unknown as GameState["slots"];
  for (let i = 0; i < 6; i++) {
    const result = decodePartySlot(i + 1, raw[i]!);
    if (result.status === "ok") out[i] = result.member;
  }
  return out;
}
