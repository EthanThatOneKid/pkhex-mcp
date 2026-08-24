import { assertEquals } from "@std/assert";
import { decodePartySlot } from "../src/gen4/deserialize.ts";
import { SPECIES } from "../src/gen4/data/species.ts";
import { MOVES } from "../src/gen4/data/moves.ts";
import type { MoveInfo } from "../src/gen4/data/moves.ts";
import { encodeSlot, type FixtureMember } from "./codec-fixture.ts";

function ppMax(moveId: number, ups: number): number {
  const info: MoveInfo | undefined = MOVES[moveId];
  if (!info) return 1;
  return Math.floor((info.basePP * (5 + ups)) / 5);
}

const FIXTURE: FixtureMember = {
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
  statusWord: 0,
};

Deno.test("decodePartySlot round-trips an encoded member", () => {
  const slot = encodeSlot(FIXTURE);
  const result = decodePartySlot(1, slot);
  assertEquals(result.status, "ok");
  if (result.status !== "ok") return;
  const m = result.member;
  assertEquals(m.pid, FIXTURE.pid);
  assertEquals(m.speciesId, 392);
  assertEquals(m.speciesName, SPECIES[392]!.name);
  assertEquals(m.types, SPECIES[392]!.types);
  assertEquals(m.level, 64);
  assertEquals(m.hpCur, 187);
  assertEquals(m.hpMax, 187);
  assertEquals(m.stats.attack, 142);
  assertEquals(m.stats.defense, 94);
  assertEquals(m.stats.speed, 151);
  assertEquals(m.stats.spAttack, 139);
  assertEquals(m.stats.spDefense, 96);
  assertEquals(m.abilityName.length > 0, true);
  m.moves.forEach((mv, i) => {
    const expectedId = FIXTURE.moveIds[i];
    const expectedPpUps = FIXTURE.ppUps[i];
    assertEquals(mv?.moveId, expectedId, `move ${i}`);
    assertEquals(mv?.ppCur, FIXTURE.ppCur[i], `move ${i} cur PP`);
    assertEquals(
      mv?.ppMax,
      ppMax(expectedId, expectedPpUps),
      `move ${i} max PP`,
    );
  });
});

// NOTE: the old "decryptedInPlace slots skip the XOR" test was removed with
// the live-sync descope — save-file party bytes are ALWAYS encrypted at
// rest, so decodePartySlot no longer carries a decryptedInPlace input.

Deno.test("species 0 decodes to empty", () => {
  const slot = encodeSlot({ ...FIXTURE, speciesId: 0 });
  const result = decodePartySlot(1, slot);
  assertEquals(result.status, "empty");
});

Deno.test("a flipped block byte is detected as torn via Add16", () => {
  const slot = encodeSlot(FIXTURE);
  slot[0x20] ^= 0xff; // corrupt inside the block region
  const result = decodePartySlot(1, slot);
  assertEquals(result.status, "torn");
});

Deno.test("status word parses into contract vocabulary", () => {
  const cases: Array<[number, string | null, number | null]> = [
    [0x00000000, null, null],
    [0x00000003, "slp", 3],
    [0x00000008, "psn", null],
    [0x00000108, "psn", 1], // toxic counter in bits 8+
    [0x00000010, "brn", null],
    [0x00000020, "frz", null],
    [0x00000040, "par", null],
  ];
  for (const [statusWord, kind, detail] of cases) {
    const slot = encodeSlot({ ...FIXTURE, statusWord });
    const result = decodePartySlot(1, slot);
    assertEquals(result.status, "ok", `status word ${statusWord}`);
    if (result.status !== "ok") continue;
    assertEquals(result.member.statusCondition, kind, `kind for ${statusWord}`);
    assertEquals(
      result.member.statusDetail,
      detail,
      `detail for ${statusWord}`,
    );
  }
});
