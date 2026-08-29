import { assertEquals } from "@std/assert";
import { ABILITIES } from "@/src/gen4/data/abilities.ts";
import { ITEMS } from "@/src/gen4/data/items.ts";
import { MOVES } from "@/src/gen4/data/moves.ts";
import { SPECIES } from "@/src/gen4/data/species.ts";

/**
 * Regression anchors for generated enrichment tables.
 * The items table is keyed by Gen IV IN-GAME INDEX (not PokeAPI item_id) --
 * those diverge starting in the berry range (398/514 rows differ), which
 * once mislabeled every held item above ~index 133. These known-good
 * anchors come from Bulbapedia's Gen IV item index list + a real save.
 */
Deno.test("ITEMS is keyed by Gen IV game index", () => {
  assertEquals(ITEMS[1], "Master Ball");
  assertEquals(ITEMS[28], "Revive");
  assertEquals(ITEMS[216], "Exp. Share"); // would be "Miracle Seed" under pokeapi-id keying
  assertEquals(ITEMS[217], "Quick Claw");
  assertEquals(ITEMS[223], "Amulet Coin"); // ditto ("Never-Melt Ice")
});

Deno.test("SPECIES/MOVES/ABILITIES anchors hold", () => {
  assertEquals(SPECIES[392]?.name, "Infernape");
  assertEquals(SPECIES[392]?.types.includes("Fire"), true);
  assertEquals(MOVES[425]?.name, "Shadow Sneak");
  assertEquals(Object.keys(ABILITIES).length >= 123, true); // gens 1-4 ability count
});
