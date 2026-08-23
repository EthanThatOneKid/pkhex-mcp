/**
 * One-shot: decode a REAL Gen IV .sav through pkhex-mcp's pipeline.
 * Usage: deno run -A --no-lock scripts/read-save.ts <path-to-sav> [--post]
 *
 * Save layout (Pt US): two 256KB partitions; General block at partition
 * start; Trainer1 @0x68; Party @0xA0 stride 0xEC x6; count @0xD090;
 * map @0x1280. Party slots are stored encrypted+shuffled exactly like our
 * wire format, so decodePartySlot consumes them directly.
 */
import { decodePartySlot } from "../src/gen4/deserialize.ts";
import type { GameState, SyncPayload } from "../src/gen4/schemas.ts";

const path = Deno.args[0];
if (!path) {
  console.error("usage: read-save.ts <sav-path> [--post]");
  Deno.exit(1);
}
const doPost = Deno.args.includes("--post");
const data = await Deno.readFile(path);

const CHARS: Record<number, string> = {
  [0x00]: " ",
  [0x121]: "0", [0x122]: "1", [0x123]: "2", [0x124]: "3", [0x125]: "4",
  [0x126]: "5", [0x127]: "6", [0x128]: "7", [0x129]: "8", [0x12a]: "9",
  [0x12b]: "A", [0x12c]: "B", [0x12d]: "C", [0x12e]: "D", [0x12f]: "E",
  [0x130]: "F", [0x131]: "G", [0x132]: "H", [0x133]: "I", [0x134]: "J",
  [0x135]: "K", [0x136]: "L", [0x137]: "M", [0x138]: "N", [0x139]: "O",
  [0x13a]: "P", [0x13b]: "Q", [0x13c]: "R", [0x13d]: "S", [0x13e]: "T",
  [0x13f]: "U", [0x140]: "V", [0x141]: "W", [0x142]: "X", [0x143]: "Y",
  [0x144]: "Z",
  [0x145]: "a", [0x146]: "b", [0x147]: "c", [0x148]: "d", [0x149]: "e",
  [0x14a]: "f", [0x14b]: "g", [0x14c]: "h", [0x14d]: "i", [0x14e]: "j",
  [0x14f]: "k", [0x150]: "l", [0x151]: "m", [0x152]: "n", [0x153]: "o",
  [0x154]: "p", [0x155]: "q", [0x156]: "r", [0x157]: "s", [0x158]: "t",
  [0x159]: "u", [0x15a]: "v", [0x15b]: "w", [0x15c]: "x", [0x15d]: "y",
  [0x15e]: "z",
};

function decodeName(bytes: Uint8Array, off: number): string {
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    const code = bytes[off + i * 2]! | (bytes[off + i * 2 + 1]! << 8);
    if (code === 0xffff) break;
    const ch = CHARS[code];
    if (ch) out.push(ch);
  }
  return out.join("") || "?";
}

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

for (const partStart of [0, 0x40000]) {
  const dv = new DataView(data.buffer, partStart);
  // Party count lives right before the first slot (PKHeX: General[Party-4]).
  const countByte = data[partStart + 0x9c]!;
  if (countByte > 6) continue; // not the active partition
  const trainerName = decodeName(data, partStart + 0x68);
  if (!/^[A-Za-z0-9 ]+$/.test(trainerName)) continue;

  console.log(`=== active partition @ 0x${partStart.toString(16)} ===`);
  const tidSid = dv.getUint32(0x78, true);
  const trainerMeta = {
    tid: tidSid & 0xffff,
    sid: tidSid >>> 16,
    playerName: trainerName,
    playtime: {
      hours: dv.getUint16(0x8a, true),
      minutes: data[partStart + 0x8c]!,
      seconds: data[partStart + 0x8d]!,
    },
    mapId: dv.getUint16(0x1280, true),
  };
  console.log(
    `trainer: ${trainerMeta.playerName} TID ${trainerMeta.tid} / SID ${trainerMeta.sid}`,
  );
  console.log(
    `playtime: ${trainerMeta.playtime.hours}h ${trainerMeta.playtime.minutes}m ${trainerMeta.playtime.seconds}s · mapId ${trainerMeta.mapId}`,
  );

  const slots: SyncPayload["slots"] = [];
  for (let i = 0; i < 6; i++) {
    const base = partStart + 0xa0 + i * 236;
    const slotBytes = data.subarray(base, base + 236);
    const result = decodePartySlot(i + 1, {
      bytes: b64(slotBytes),
      decryptedInPlace: false,
    });
    if (result.status === "ok") {
      slots.push({ bytes: b64(slotBytes), decryptedInPlace: false });
      const m = result.member;
      console.log(
        `slot ${m.slot}: ${m.speciesName} Lv.${m.level} · HP ${m.hpCur}/${m.hpMax}` +
          ` · ${m.natureName} · item ${m.itemName ?? "none"} · status ${m.statusCondition ?? "none"}`,
      );
      console.log(
        `         stats ATK ${m.stats.attack} / DEF ${m.stats.defense} / SPA ${m.stats.spAttack} / SPD ${m.stats.spDefense} / SPE ${m.stats.speed}`,
      );
    } else if (result.status === "torn") {
      console.log(`slot ${i + 1}: TORN (checksum failed)`);
    }
  }

  if (doPost && slots.length > 0) {
    while (slots.length < 6) {
      slots.push({ bytes: b64(new Uint8Array(236)), decryptedInPlace: false });
    }
    const payload: SyncPayload = { trainerMeta, slots };
    const post = await fetch("http://127.0.0.1:8941/sync", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ snapshot: JSON.stringify(payload) }).toString(),
    });
    console.log(`POST /sync -> ${post.status}`);
    void (await fetch("http://127.0.0.1:8941/state")).body?.cancel();
    const state = (await (await fetch("http://127.0.0.1:8941/state")).json()) as GameState;
    const liveCount = state.slots.filter((s) => s !== null).length;
    console.log(`GET /state -> sync ${state.sync.state}, party size ${liveCount}`);
  }
  break; // first sane partition wins
}
