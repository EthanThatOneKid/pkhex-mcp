import { assertEquals } from "@std/assert";
import { SaveFileReader } from "../src/gen4/save/reader.ts";
import {
  findInPcBox,
  getBadges,
  getBag,
  getDexSummary,
  getPartyAudit,
  getPcBox,
  getStoryFlags,
  getTrainerCard,
  isSpeciesCaught,
  RAW_REGION_MAX_BYTES,
  readRawRegion,
} from "../src/gen4/save/scanners.ts";
import {
  makeEncryptedPartySlot,
  makeEncryptedStoredRecord,
  makeSave,
  writeStorageBox,
} from "./helpers/save-builder.ts";

const PARTITION = 0x40000;

Deno.test("read_raw_region returns base64 of the exact slot-relative window", () => {
  const { reader } = buildRichSave();
  const region = readRawRegion(reader, 0x78, 4);
  assertEquals(region.offset, 0x78);
  assertEquals(region.length, 4);
  // TID 1256 = E8 04, SID 32863 = 5F 80
  assertEquals(region.base64, "6ARfgA==");
});

Deno.test("read_raw_region rejects over-cap, invalid, and out-of-bounds calls", () => {
  const { reader } = buildRichSave();
  const expectThrow = (offset: number, length: number, needle: string) => {
    let message = "";
    try {
      readRawRegion(reader, offset, length);
    } catch (e) {
      message = String(e);
    }
    assertEquals(message.includes(needle), true, `${offset}+${length} -> ${message}`);
  };
  expectThrow(0, RAW_REGION_MAX_BYTES + 1, "paginate for larger ranges");
  expectThrow(-1, 16, "non-negative");
  expectThrow(0x78, 0, "1..");
  expectThrow(PARTITION - 2, 4, "out of bounds");
});

function buildRichSave() {
  const data = makeSave({
    money: 123456,
    badges: 0b00001001, // Coal + Fen per badgeBitOrder
    bagItemsPairs: [[79, 2], [74, 2]],
    dexSeen: [1, 25, 392],
    dexCaught: [1, 392],
    eventFlagBits: [2404],
    partySlots: [
      makeEncryptedPartySlot({
        species: 392,
        item: 610,
        moves: [394, 157, 339, 421],
        ivs: { hp: 31, atk: 30, def: 29, spe: 28, spa: 27, spd: 26 },
        evs: { hp: 12, atk: 4, def: 6, spe: 20, spa: 0, spd: 0 },
        level: 32,
        hpCur: 100,
        hpMax: 100,
      }),
    ],
  });
  const reader = SaveFileReader.fromBytes(data);
  writeStorageBox(
    data,
    reader.slot.base,
    1,
    new Map([
      [0, makeEncryptedStoredRecord({ species: 392 })],
      [5, makeEncryptedStoredRecord({ species: 77 })],
    ]),
    1,
  );
  // re-validate: writing storage touched bytes outside the general CRC scope.
  return { data, reader };
}

Deno.test("get_trainer_card reads identity, money, badges, playtime", () => {
  const { reader } = buildRichSave();
  const card = getTrainerCard(reader);
  assertEquals(card.playerName, "Ethan");
  assertEquals(card.tid, 1256);
  assertEquals(card.sid, 32863);
  assertEquals(card.money, 123456);
  assertEquals(card.badgeCount, 2);
  assertEquals(card.playtime.hours, 61);
});

Deno.test("get_badges resolves earned gym names from the bitmask", () => {
  const { reader } = buildRichSave();
  const badgeCase = getBadges(reader);
  assertEquals(badgeCase.count, 2);
  assertEquals(badgeCase.earned, ["Coal", "Fen"]);
});

Deno.test("get_bag walks pairs and resolves item names", () => {
  const { reader } = buildRichSave();
  const bag = getBag(reader);
  assertEquals(bag.pouches.length >= 1, true);
  const items = bag.pouches.find((p) => p.name === "items");
  assertEquals(
    items?.items.some((e) =>
      e.itemId === 79 && e.count === 2 && e.itemName === "Repel"
    ),
    true,
  );
  assertEquals(items?.items.some((e) => e.itemName === "Yellow Shard"), true);
});

Deno.test("dex summary applies the terminator mask and has-caught works", () => {
  const { reader } = buildRichSave();
  const summary = getDexSummary(reader);
  assertEquals(summary.seen, 3);
  assertEquals(summary.caught, 2);
  assertEquals(isSpeciesCaught(reader, 392), true);
  assertEquals(isSpeciesCaught(reader, 25), false);
});

Deno.test("story flags read notable bits and custom indices", () => {
  const { reader } = buildRichSave();
  const flags = getStoryFlags(reader);
  const hof = flags.find((f) => f.flag === 2404)!;
  assertEquals(hof.set, true);
  assertEquals(hof.name.includes("Hall of Fame"), true);
  const dialga = flags.find((f) => f.flag === 208)!;
  assertEquals(dialga.set, false);

  const custom = getStoryFlags(reader, [2404, 7]);
  assertEquals(custom, [
    { flag: 2404, name: "event flag 2404", set: true },
    { flag: 7, name: "event flag 7", set: false },
  ]);
});

Deno.test("party audit extracts IVs/EVs/nature from encrypted slots", () => {
  const { reader } = buildRichSave();
  const audit = getPartyAudit(reader);
  const first = audit[0];
  assertEquals(first.speciesName, "Infernape");
  assertEquals(first.level, 32);
  assertEquals(first.ivs.hp, 31);
  assertEquals(first.ivs.spe, 28);
  assertEquals(first.evs.spe, 20);
  assertEquals(first.moveIds, [394, 157, 339, 421]);
  // empty slots report cleanly
  assertEquals(audit[5].slot, 6);
  assertEquals(audit[5].speciesName, null);
});

Deno.test("pc box decodes stored records and finds by species", () => {
  const { reader } = buildRichSave();
  const view = getPcBox(reader);
  assertEquals(view.box, 1);
  assertEquals(view.currentBox, true);
  assertEquals(view.slots[0]?.speciesName, "Infernape");
  assertEquals(view.slots[5]?.speciesName, "Ponyta");
  assertEquals(view.slots[1]?.speciesId, null);

  const hits = findInPcBox(reader, "Ponyta");
  assertEquals(hits, [{
    box: 1,
    slot: 5,
    speciesId: 77,
    speciesName: "Ponyta",
  }]);
  assertEquals(findInPcBox(reader, 9999).length, 0);
});

Deno.test("empty PC boxes decode to all-null slots", () => {
  const { reader } = buildRichSave();
  const empty = getPcBox(reader, 17);
  assertEquals(empty.currentBox, false);
  assertEquals(empty.slots.every((s) => s.speciesId === null), true);
});
