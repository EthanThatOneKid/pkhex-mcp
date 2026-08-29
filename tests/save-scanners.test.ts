import { assertEquals } from "@std/assert";
import { MOVES } from "@/src/gen4/data/moves.ts";
import { SaveFileReader } from "@/src/gen4/save/reader.ts";
import {
  decodePcBox,
  decodePokemonRecord,
  findInPcBox,
  findItem,
  getBadges,
  getBag,
  getDexSummary,
  getNamedRegionOffset,
  getPartyDetail,
  getPcBox,
  getPcInventory,
  getStoryProgress,
  getTrainerCard,
  isSpeciesCaught,
  listNamedRegions,
  RAW_REGION_MAX_BYTES,
  readRawRegion,
} from "@/src/gen4/save/scanners.ts";
import {
  makeEncryptedPartySlot,
  makeEncryptedStoredRecord,
  makeSave,
  writeStorageBox,
} from "./helpers/save-builder.ts";

const PARTITION = 0x40000;

function moveNames(ids: number[]): Array<string | null> {
  return ids.map((id) => MOVES[id]?.name ?? null);
}

Deno.test("decode_pokemon_record decodes a party record with named fields", () => {
  const { reader } = buildRichSave();
  const slotBytes = reader.read(0xa0, 236);
  const rec = decodePokemonRecord(btoa(String.fromCharCode(...slotBytes)));
  assertEquals(rec.empty, false);
  assertEquals(rec.kind, "party");
  assertEquals(rec.speciesName, "Infernape");
  assertEquals(rec.level, 32);
  assertEquals(rec.natureName.length > 0, true);
  assertEquals(rec.ivs.hp, 31);
  assertEquals(rec.moves[0], "Flare Blitz");
});

Deno.test("decode_pokemon_record decodes a stored (PC box) record", () => {
  const stored = makeEncryptedStoredRecord({ species: 77 });
  const rec = decodePokemonRecord(btoa(String.fromCharCode(...stored)));
  assertEquals(rec.empty, false);
  assertEquals(rec.kind, "stored");
  assertEquals(rec.speciesName, "Ponyta");
});

Deno.test("decode_pokemon_record flags torn records instead of decoding garbage", () => {
  const { reader } = buildRichSave();
  const slotBytes = reader.read(0xa0, 236);
  slotBytes[0x20] ^= 0xff; // corrupt inside the checksummed region
  const rec = decodePokemonRecord(btoa(String.fromCharCode(...slotBytes)));
  assertEquals(rec.torn, true);
  assertEquals(rec.speciesName, null);
});

Deno.test("read_raw_region returns base64 + hex of the exact slot-relative window", () => {
  const { reader } = buildRichSave();
  const region = readRawRegion(reader, 0x78, 4);
  assertEquals(region.offset, 0x78);
  assertEquals(region.length, 4);
  // TID 1256 = E8 04, SID 32863 = 5F 80
  assertEquals(region.base64, "6ARfgA==");
  assertEquals(region.hex, "e8 04 5f 80");
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
    assertEquals(
      message.includes(needle),
      true,
      `${offset}+${length} -> ${message}`,
    );
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
  const flags = getStoryProgress(reader);
  const hof = flags.find((f) => f.flag === 2404)!;
  assertEquals(hof.set, true);
  assertEquals(hof.name.includes("Hall of Fame"), true);
  const dialga = flags.find((f) => f.flag === 208)!;
  assertEquals(dialga.set, false);

  const custom = getStoryProgress(reader, [2404, 7]);
  assertEquals(custom, [
    { flag: 2404, name: "event flag 2404", set: true },
    { flag: 7, name: "event flag 7", set: false },
  ]);
});

Deno.test("party audit extracts IVs/EVs/nature from encrypted slots", () => {
  const { reader } = buildRichSave();
  const audit = getPartyDetail(reader);
  const first = audit[0];
  assertEquals(first.speciesName, "Infernape");
  assertEquals(first.level, 32);
  assertEquals(first.ivs.hp, 31);
  assertEquals(first.ivs.spe, 28);
  assertEquals(first.evs.spe, 20);
  assertEquals(first.moves, moveNames([394, 157, 339, 421]));
  // empty slots report cleanly
  assertEquals(audit[5].slot, 6);
  assertEquals(audit[5].speciesName, null);
});

Deno.test("pc box decodes stored records and finds by species", () => {
  const { reader } = buildRichSave();
  const view = getPcBox(reader);
  assertEquals(view.box, 1); // 1-based, matches game UI (player-verified)
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
  const empty = getPcBox(reader, 18); // last box, 1-based
  assertEquals(empty.currentBox, false);
  assertEquals(empty.slots.every((s) => s.speciesId === null), true);
});

// ---- P1: get_pc_inventory ----

Deno.test("get_pc_inventory returns occupied slots across all boxes + party", () => {
  const { reader } = buildRichSave();
  const inv = getPcInventory(reader);
  // Party: 1 member (Infernape)
  assertEquals(inv.party.length, 1);
  assertEquals(inv.party[0].speciesName, "Infernape");
  assertEquals(inv.party[0].slot, 1);
  // Boxes: Infernape in box 1 slot 0, Ponyta in box 1 slot 5
  assertEquals(inv.boxes.length, 2);
  assertEquals(
    inv.boxes.some((e) => e.box === 1 && e.slot === 0 && e.speciesId === 392),
    true,
  );
  assertEquals(
    inv.boxes.some((e) => e.box === 1 && e.slot === 5 && e.speciesId === 77),
    true,
  );
});

Deno.test("get_pc_inventory returns empty arrays when nothing exists", () => {
  const data = makeSave({});
  const reader = SaveFileReader.fromBytes(data);
  const inv = getPcInventory(reader);
  assertEquals(inv.party.length, 0);
  assertEquals(inv.boxes.length, 0);
});

// ---- P2: decode_pc_box (rich) ----

Deno.test("decodePcBox returns nature and moves for stored records", () => {
  const { reader } = buildRichSave();
  const view = decodePcBox(reader);
  assertEquals(view.decoded, true);
  assertEquals(view.box, 1); // current box (1-based)
  assertEquals(view.currentBox, true);
  // Slot 0: Infernape
  const slot0 = view.slots[0]!;
  assertEquals(slot0.speciesName, "Infernape");
  assertEquals(typeof slot0.natureName, "string");
  assertEquals((slot0.natureName ?? "").length > 0, true);
  // Slot 5: Ponyta
  const slot5 = view.slots[5]!;
  assertEquals(slot5.speciesName, "Ponyta");
  assertEquals((slot5.natureName ?? "").length > 0, true);
  // Empty slots have null fields
  assertEquals(view.slots[1]?.speciesId, null);
  assertEquals(view.slots[1]?.moves, [null, null, null, null]);
});

Deno.test("decodePcBox with explicit box number", () => {
  const data = makeSave({});
  const reader = SaveFileReader.fromBytes(data);
  // Box 18 (last box) should be empty
  const view = decodePcBox(reader, 18);
  assertEquals(view.decoded, true);
  assertEquals(view.box, 18);
  assertEquals(view.currentBox, false);
  assertEquals(view.slots.every((s) => s.speciesId === null), true);
});

// ---- P3: named-region read_raw_region ----

Deno.test("read_raw_region with named 'trainer' region resolves correctly", () => {
  const { reader } = buildRichSave();
  // TID/SID at offset 0x78 = trainer offset (0x68) + 0x10
  const region = readRawRegion(reader, 0x10, 4, "trainer");
  // offset field reflects the resolved absolute address
  assertEquals(region.offset, 0x68 + 0x10);
  assertEquals(region.length, 4);
  // TID 1256 = E8 04, SID 32863 = 5F 80
  assertEquals(region.hex, "e8 04 5f 80");
});

Deno.test("read_raw_region with named 'party' region resolves party+0x00", () => {
  const { reader } = buildRichSave();
  // Party count at party.firstSlot.offset (0xa0)
  const region = readRawRegion(reader, 0x9c - 0xa0, 1, "party");
  assertEquals(region.offset, 0x9c);
  assertEquals(region.length, 1);
});

Deno.test("read_raw_region with named 'bag' region resolves bag base", () => {
  const { reader } = buildRichSave();
  // Read the first item slot from the bag
  const region = readRawRegion(reader, 0, 4, "bag");
  assertEquals(region.offset, 0x630);
  assertEquals(region.length, 4);
});

Deno.test("read_raw_region with 'pc-box-1' resolves to box 1 start", () => {
  const { reader } = buildRichSave();
  const region = readRawRegion(reader, 0, 136, "pc-box-1");
  // pc-box-1 should start at storage + boxDataStart + 0 * 0xff0
  assertEquals(region.offset, 0xcf2c + 0x04);
  assertEquals(region.length, 136);
});

Deno.test("read_raw_region rejects unknown region names", () => {
  const { reader } = buildRichSave();
  let message = "";
  try {
    readRawRegion(reader, 0, 4, "nonexistent");
  } catch (e) {
    message = String(e);
  }
  assertEquals(message.includes("unknown region"), true);
});

Deno.test("listNamedRegions returns expected region names", () => {
  const regions = listNamedRegions();
  assertEquals(regions.includes("party"), true);
  assertEquals(regions.includes("trainer"), true);
  assertEquals(regions.includes("bag"), true);
  assertEquals(regions.includes("pc-box-1"), true);
  assertEquals(regions.includes("pc-box-18"), true);
  assertEquals(regions.length, 3 + 18); // 3 common + 18 boxes
});

Deno.test("getNamedRegionOffset returns null for unknown regions", () => {
  assertEquals(getNamedRegionOffset("party") !== null, true);
  assertEquals(getNamedRegionOffset("nonexistent"), null);
});

// ---- P4: find_item ----

Deno.test("find_item substring-matches item names across all pouches", () => {
  const { reader } = buildRichSave();
  const hits = findItem(reader, "Repel");
  assertEquals(hits.length > 0, true);
  assertEquals(
    hits.some((h) => h.itemId === 79 && h.count === 2 && h.pouch === "items"),
    true,
  );
});

Deno.test("find_item is case-insensitive", () => {
  const { reader } = buildRichSave();
  const lower = findItem(reader, "repel");
  const upper = findItem(reader, "REPEL");
  assertEquals(lower.length, upper.length);
  assertEquals(lower.length > 0, true);
});

Deno.test("find_item returns empty array for no matches", () => {
  const { reader } = buildRichSave();
  const hits = findItem(reader, "ZZZZZZZ_NONEXISTENT");
  assertEquals(hits, []);
});

Deno.test("find_item returns empty array for empty query", () => {
  const { reader } = buildRichSave();
  const hits = findItem(reader, "");
  assertEquals(hits, []);
});
