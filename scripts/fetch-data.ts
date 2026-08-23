/**
 * One-shot enrichment-table generator (spec section 6).
 * Pulls PokeAPI's bulk CSVs (few requests, deterministic) and writes
 * checked-in modules under src/gen4/data/.
 *
 * Run: deno run -A scripts/fetch-data.ts
 */

const BASE =
  "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/";

interface Row {
  [col: string]: string;
}

function parseCsv(text: string): Row[] {
  const rows: Row[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitLine(lines[0]);
  for (const line of lines.slice(1)) rows.push(zip(header, splitLine(line)));
  return rows;
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function zip(header: string[], values: string[]): Row {
  const row: Row = {};
  header.forEach((h, i) => (row[h] = values[i] ?? ""));
  return row;
}

async function csv(name: string): Promise<Row[]> {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

const ENGLISH_LANGUAGE_ID = "9";
const MAX_GEN = "4"; // Gen IV era only

function englishName(rows: Row[], idCol: string, nameCol: string, langCol: string) {
  const map: Record<number, string> = {};
  for (const r of rows) {
    if (r[langCol] !== ENGLISH_LANGUAGE_ID) continue;
    map[Number(r[idCol])] = r[nameCol];
  }
  return map;
}

// --- species: national dex id -> { name, types } ---
const speciesNames = englishName(
  await csv("pokemon_species_names.csv"),
  "pokemon_species_id",
  "name",
  "local_language_id",
);
const defaultFormIdBySpecies: Record<number, number> = {};
for (const r of await csv("pokemon.csv")) {
  if (r["is_default"] === "1") {
    defaultFormIdBySpecies[Number(r["species_id"])] = Number(r["id"]);
  }
}
const typeIdToName = englishName(
  await csv("type_names.csv"),
  "type_id",
  "name",
  "local_language_id",
);
const typesByForm: Record<number, string[]> = {};
{
  const slots = new Map<string, string>();
  for (const r of await csv("pokemon_types.csv")) {
    slots.set(
      `${r["pokemon_id"]}#${r["slot"]}`,
      typeIdToName[Number(r["type_id"])],
    );
  }
  for (const [formId] of Object.entries(defaultFormIdBySpecies)) {
    const types: string[] = [];
    for (const slot of ["1", "2"]) {
      const t = slots.get(`${formId}#${slot}`);
      if (t && !types.includes(t)) types.push(t);
    }
    typesByForm[Number(formId)] = types;
  }
}
const species: Record<number, { name: string; types: string[] }> = {};
for (const [idStr, name] of Object.entries(speciesNames)) {
  const id = Number(idStr);
  if (id > 493) continue; // Pt sanity gate: national dex <= 493
  const formId = defaultFormIdBySpecies[id];
  const types = formId ? typesByForm[formId] : undefined;
  if (!name || !types || types.length === 0) continue;
  species[id] = { name, types };
}

// --- moves: move id -> { name, basePP } (gens 1-4; ids ARE indexes) ---
const moveRows = await csv("moves.csv");
const moveNames = englishName(
  await csv("move_names.csv"),
  "move_id",
  "name",
  "local_language_id",
);
const moves: Record<number, { name: string; basePP: number }> = {};
for (const r of moveRows) {
  if (Number(r["generation_id"]) > Number(MAX_GEN)) continue;
  const id = Number(r["id"]);
  const name = moveNames[id];
  const basePP = Number(r["pp"]);
  if (!name || !(basePP > 0)) continue;
  moves[id] = { name, basePP };
}

// --- items: KEY = Gen IV in-game index ---
// PokeAPI's internal item_id DIVERGES from the Gen IV game_index starting in
// the berry range (398/514 rows differ), and saves store game_index values,
// so join through item_game_indices.csv (generation 4).
const itemNames = englishName(
  await csv("item_names.csv"),
  "item_id",
  "name",
  "local_language_id",
);
const items: Record<number, string> = {};
{
  const byIndex = new Map<number, number>(); // game_index -> smallest item_id (deterministic)
  for (const r of await csv("item_game_indices.csv")) {
    if (r["generation_id"] !== "4") continue;
    const gi = Number(r["game_index"]);
    const itemId = Number(r["item_id"]);
    const prev = byIndex.get(gi);
    if (prev === undefined || itemId < prev) byIndex.set(gi, itemId);
  }
  for (const [gi, itemId] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    const name = itemNames[itemId];
    if (name) items[gi] = name;
  }
}

// --- abilities: ability id -> name (gens 1-4) ---
// NOTE: no ability_game_indices divergence exists -- PokeAPI ability ids for
// gens 1-4 are sequential and match the in-game ability ordering.
const abilityRows = await csv("abilities.csv");
const abilityNames = englishName(
  await csv("ability_names.csv"),
  "ability_id",
  "name",
  "local_language_id",
);
const abilities: Record<number, string> = {};
for (const r of abilityRows) {
  if (Number(r["generation_id"]) > Number(MAX_GEN)) continue;
  const id = Number(r["id"]);
  if (abilityNames[id]) abilities[id] = abilityNames[id];
}

// --- write modules ---
function recordModule(comment: string, body: string): string {
  return `/**
 * GENERATED by scripts/fetch-data.ts -- do not edit by hand.
 * ${comment}
 */

${body}
`;
}

await Deno.writeTextFile(
  "src/gen4/data/species.ts",
  recordModule(
    "National dex id -> display name + type(s). Gens 1-4 (<=493).",
    `export interface SpeciesInfo {\n  name: string;\n  types: string[];\n}\n\nexport const SPECIES: Record<number, SpeciesInfo> = ${JSON.stringify(species)};\n`,
  ),
);

await Deno.writeTextFile(
  "src/gen4/data/moves.ts",
  recordModule(
    "Move id -> display name + base PP. Gens 1-4.",
    `export interface MoveInfo {\n  name: string;\n  basePP: number;\n}\n\nexport const MOVES: Record<number, MoveInfo> = ${JSON.stringify(moves)};\n`,
  ),
);

await Deno.writeTextFile(
  "src/gen4/data/items.ts",
  recordModule(
    "Gen IV in-game item index -> display name (joined via item_game_indices).",
    `export const ITEMS: Record<number, string> = ${JSON.stringify(items)};\n`,
  ),
);

await Deno.writeTextFile(
  "src/gen4/data/abilities.ts",
  recordModule(
    "Ability index -> display name. Gens 1-4.",
    `export const ABILITIES: Record<number, string> = ${JSON.stringify(abilities)};\n`,
  ),
);

console.log(
  `wrote tables: species=${Object.keys(species).length} moves=${Object.keys(moves).length} items=${Object.keys(items).length} abilities=${Object.keys(abilities).length}`,
);
