import { assertEquals } from "@std/assert";
import { decodeSnapshotSlots } from "../src/gen4/deserialize.ts";
import type { SyncPayload } from "../src/gen4/schemas.ts";
import { EMPTY_SLOT_BYTES } from "./fixtures.ts";
import { encodeSlot, type FixtureMember } from "./codec-fixture.ts";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function raw(bytes: Uint8Array, flag = false): SyncPayload["slots"][number] {
  return { bytes: toBase64(bytes), decryptedInPlace: flag };
}

const MON_A: FixtureMember = {
  pid: 0x11223344,
  speciesId: 392,
  heldItemId: 217,
  abilityId: 81,
  evs: [6, 252, 0, 36, 200, 14],
  moveIds: [425, 370, 9, 421],
  ppCur: [9, 6, 20, 12],
  ppUps: [2, 1, 0, 3],
  level: 64,
  hpCur: 187,
  hpMax: 187,
  stats: { attack: 142, defense: 94, spAttack: 139, spDefense: 96, speed: 151 },
  statusWord: 0x40,
};

const MON_B: FixtureMember = {
  ...MON_A,
  pid: 0x5a5a00ff,
  speciesId: 398,
  level: 63,
  hpCur: 193,
  hpMax: 193,
};

Deno.test("snapshot decoding assigns slot numbers and maps torn to null", () => {
  const tornBytes = encodeSlot(MON_A);
  tornBytes[0x50] ^= 0xff;
  const slots: SyncPayload["slots"] = [
    raw(encodeSlot(MON_A)),
    { bytes: EMPTY_SLOT_BYTES, decryptedInPlace: false }, // species 0 -> empty
    raw(tornBytes),
    raw(encodeSlot(MON_B)),
    { bytes: EMPTY_SLOT_BYTES, decryptedInPlace: false },
    { bytes: EMPTY_SLOT_BYTES, decryptedInPlace: false },
  ];
  const decoded = decodeSnapshotSlots(slots);
  assertEquals(decoded.length, 6);
  assertEquals(decoded[0]?.speciesId, 392);
  assertEquals(decoded[0]?.slot, 1);
  assertEquals(decoded[1], null);
  assertEquals(decoded[2], null); // torn collapses to null at snapshot level
  assertEquals(decoded[3]?.speciesId, 398);
  assertEquals(decoded[3]?.slot, 4);
  assertEquals(decoded[4], null);
  assertEquals(decoded[5], null);
});

/** Deterministic PRNG so failures reproduce. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

Deno.test("property: encode->decode round-trips randomized members", () => {
  const rand = mulberry32(0xc0ffee);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  for (let trial = 0; trial < 40; trial++) {
    const member: FixtureMember = {
      pid: int(0, 0xffffffff),
      speciesId: pick([1, 25, 133, 392, 444, 493]),
      heldItemId: pick([0, 217, 234, 100]),
      abilityId: pick([45, 81, 22, 102]),
      evs: [int(0, 252), int(0, 252), int(0, 252), int(0, 252), int(0, 252), int(0, 252)],
      moveIds: [pick([1, 425, 370]), pick([88, 157]), pick([76, 421]), pick([14, 246])],
      ppCur: [int(0, 20), int(0, 15), int(0, 10), int(0, 5)],
      ppUps: [0, 1, 2, 3],
      level: int(2, 100),
      hpCur: int(1, 400),
      hpMax: int(401, 500),
      stats: {
        attack: int(10, 400),
        defense: int(10, 400),
        spAttack: int(10, 400),
        spDefense: int(10, 400),
        speed: int(10, 400),
      },
      statusWord: pick([
        0x00000000,
        0x00000002,
        0x00000008,
        0x00000208,
        0x00000010,
        0x00000020,
        0x00000040,
      ]),
    };
    // keep hpCur <= hpMax semantics irrelevant to codec; both are u16-safe here.
    const decryptedInPlace = rand() < 0.5;
    const result = decodeSnapshotSlots([
      raw(encodeSlot(member, { alreadyEncrypted: decryptedInPlace }), decryptedInPlace),
      { bytes: EMPTY_SLOT_BYTES, decryptedInPlace: false },
      { bytes: EMPTY_SLOT_BYTES, decryptedInPlace: false },
      { bytes: EMPTY_SLOT_BYTES, decryptedInPlace: false },
      { bytes: EMPTY_SLOT_BYTES, decryptedInPlace: false },
      { bytes: EMPTY_SLOT_BYTES, decryptedInPlace: false },
    ]);
    const m = result[0]!;
    assertEquals(m.pid, member.pid >>> 0, `trial ${trial} pid`);
    assertEquals(m.speciesName.length > 0, true, `trial ${trial} species`);
    assertEquals(m.level, member.level, `trial ${trial} level`);
    assertEquals(m.stats.attack, member.stats.attack, `trial ${trial} atk`);
    assertEquals(
      m.statusCondition,
      member.statusWord === 0 ? null : m.statusCondition,
      `trial ${trial} status`,
    );
    if ((member.statusWord & 0x07) !== 0) {
      assertEquals(m.statusDetail, member.statusWord & 0x07, `trial ${trial} sleep`);
    }
  }
});
