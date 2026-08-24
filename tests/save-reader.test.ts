import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  compareCounters,
  crc16ccitt,
  GENERAL_FOOTER_REL,
  PARTITION_SIZE,
  SaveFileReader,
} from "../src/gen4/save/reader.ts";
import { getSectionMap } from "../src/gen4/save/section-map.ts";

const GENERAL_SIZE = 0xcf2c;
const FOOTER_REL = 0xcf18; // GENERAL_SIZE - 0x14

/** Build a synthetic two-partition save with controllable footers. */
function makeSave(opts: {
  major: [number, number];
  minor?: [number, number];
  crcValid?: [boolean, boolean];
  tid?: [number, number];
  playtimeHours?: [number, number];
  /** Slot-relative probe byte planted BEFORE the CRC is computed. */
  marker?: [number, number];
}): Uint8Array {
  const data = new Uint8Array(PARTITION_SIZE * 2);
  const dv = new DataView(data.buffer);
  for (let p = 0; p < 2; p++) {
    const base = p * PARTITION_SIZE;
    const major = opts.major[p];
    const minor = opts.minor?.[p] ?? 0;
    dv.setUint32(base + FOOTER_REL + 0x00, major, true);
    dv.setUint32(base + FOOTER_REL + 0x04, minor, true);
    dv.setUint32(base + FOOTER_REL + 0x08, GENERAL_SIZE, true);
    dv.setUint32(base + FOOTER_REL + 0x0c, 0x20060623, true);
    dv.setUint16(base + FOOTER_REL + 0x10, 0, true); // general block type
    // distinct trainer marker per half at slot-rel 0x78 (TID/SID u32)
    dv.setUint32(
      base + 0x78,
      opts.tid?.[p] ?? (p === 0 ? 0xaaaabbbb : 0xccccdddd),
      true,
    );
    if (opts.playtimeHours) {
      dv.setUint16(base + 0x8a, opts.playtimeHours[p], true);
    }
    if (opts.marker) data[base + 0x1234] = opts.marker[p];
    // CRC last: it covers everything above (markers included).
    const valid = opts.crcValid?.[p] ?? true;
    const crc = valid
      ? crc16ccitt(data.slice(base, base + GENERAL_SIZE - 0x14))
      : 0xdead;
    dv.setUint16(base + FOOTER_REL + 0x12, crc, true);
    // distinct trainer marker per half at slot-rel 0x78 (TID/SID u32)
    dv.setUint32(
      base + 0x78,
      opts.tid?.[p] ?? (p === 0 ? 0xaaaabbbb : 0xccccdddd),
      true,
    );
    if (opts.playtimeHours) {
      dv.setUint16(base + 0x8a, opts.playtimeHours[p], true);
    }
  }
  return data;
}

Deno.test("compareCounters applies the 0xFFFFFFFF sentinel rule", () => {
  // exactly one sentinel and counterpart != 0xFFFFFFFE -> sentinel LOSES
  assertEquals(compareCounters(0xffffffff, 3), -1);
  assertEquals(compareCounters(3, 0xffffffff), 1);
  // sentinel vs 0xFFFFFFFE -> exception does NOT apply; plain comparison
  // keeps the sentinel side (it is the larger unsigned value)
  assertEquals(compareCounters(0xffffffff, 0xfffffffe), 1);
  assertEquals(compareCounters(0xfffffffe, 0xffffffff), -1);
});

Deno.test("selects the partition with the higher major counter", () => {
  const r = SaveFileReader.fromBytes(
    makeSave({ major: [5, 9], tid: [0x11111111, 0x22222222] }),
  );
  assertEquals(r.slot.index, 1);
  assertEquals(r.u32(0x78), 0x22222222);
});

Deno.test("major tie falls back to minor counters", () => {
  const r = SaveFileReader.fromBytes(
    makeSave({
      major: [7, 7],
      minor: [100, 101],
      tid: [0x11111111, 0x22222222],
    }),
  );
  assertEquals(r.slot.index, 1);
  assertEquals(r.slot.reason, "higher-minor");
  assertEquals(r.u32(0x78), 0x22222222);
});

Deno.test("full tie defaults to partition 0 with an ambiguity warning", () => {
  const r = SaveFileReader.fromBytes(
    makeSave({ major: [4, 4], minor: [6, 6], tid: [0x11111111, 0x22222222] }),
  );
  assertEquals(r.slot.index, 0);
  assertEquals(r.slot.reason, "full-tie-default");
  assertStringIncludes(r.slot.warnings.join(" "), "ambiguous");
  assertEquals(r.u32(0x78), 0x11111111);
});

Deno.test("sentinel counters lose unless the counterpart is 0xFFFFFFFE", () => {
  // lone sentinel loses to any real counter
  const a = SaveFileReader.fromBytes(
    makeSave({ major: [0xffffffff, 3], tid: [0x11111111, 0x22222222] }),
  );
  assertEquals(a.slot.index, 1);
  assertEquals(a.slot.reason, "sentinel");
  // sentinel vs its immediate predecessor: exception N/A -> plain comparison
  // keeps the sentinel side (larger unsigned value)
  const b = SaveFileReader.fromBytes(
    makeSave({
      major: [0xfffffffe, 0xffffffff],
      tid: [0x11111111, 0x22222222],
    }),
  );
  assertEquals(b.slot.index, 1);
});

Deno.test("prefers the checksum-valid half when the winner fails its CRC", () => {
  const r = SaveFileReader.fromBytes(
    makeSave({
      major: [9, 5],
      crcValid: [false, true],
      tid: [0x11111111, 0x22222222],
    }),
  );
  assertEquals(r.slot.index, 1);
  assertEquals(r.slot.reason, "crc-override");
  assertStringIncludes(r.slot.warnings.join(" "), "CRC");
});

Deno.test("rejects a file where neither half validates", () => {
  let threw = false;
  try {
    SaveFileReader.fromBytes(
      makeSave({ major: [9, 5], crcValid: [false, false] }),
    );
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("reads come from the active half only", () => {
  const data = makeSave({
    major: [2, 8],
    tid: [0x00aa00aa, 0x00bb00bb],
    marker: [0x41, 0x42],
  });
  const r = SaveFileReader.fromBytes(data);
  assertEquals(r.read(0x1234, 1)[0], 0x42);
});

Deno.test("warns when the counter verdict disagrees with playtime", () => {
  // partition 0 wins on counters but carries the OLDER playtime
  const r = SaveFileReader.fromBytes(
    makeSave({ major: [9, 5], tid: [1, 2], playtimeHours: [10, 99] }),
  );
  assertEquals(r.slot.index, 0);
  assertStringIncludes(r.slot.warnings.join(" "), "playtime");
});

Deno.test("section map covers every battery region with confidence tags", () => {
  const map = getSectionMap();
  const names = new Set(map.map((e) => e.name));
  for (
    const expected of [
      "trainerCard.tid",
      "trainerCard.sid",
      "trainerCard.money",
      "trainerCard.badges",
      "party.count",
      "party.slots",
      "badges.byte",
      "dex.seen",
      "dex.caught",
      "bag.pouches",
      "storage.block",
      "position.mapId",
    ]
  ) {
    assertEquals(names.has(expected), true, `missing section ${expected}`);
  }
  for (const e of map) {
    assertEquals(["verified", "inferred"].includes(e.confidence), true);
  }
});
