import { assertEquals } from "@std/assert";
import { createApp } from "../src/app.ts";
import { GameStateSchema, type SyncPayload } from "../src/gen4/schemas.ts";
import { GameStateStore } from "../src/state/game-state.ts";
import { EMPTY_SLOT_BYTES, makeSyncPayload, toBase64 } from "./fixtures.ts";
import { encodeSlot, type FixtureMember } from "./codec-fixture.ts";

const HOST = { host: "127.0.0.1:8941" };

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

function emptySlots(): SyncPayload["slots"] {
  return Array.from({ length: 6 }, () => ({
    bytes: EMPTY_SLOT_BYTES,
    decryptedInPlace: false,
  })) as SyncPayload["slots"];
}

function payloadFor(
  filled: Array<[number, FixtureMember]>,
  opts: { corrupt?: number[] } = {},
): SyncPayload {
  const slots = emptySlots();
  for (const [idx, member] of filled) {
    const bytes = encodeSlot(member);
    if (opts.corrupt?.includes(idx)) bytes[0x20] ^= 0xff;
    slots[idx] = { bytes: toBase64(bytes), decryptedInPlace: false };
  }
  return { trainerMeta: makeSyncPayload().trainerMeta, slots };
}

function postForm(app: Awaited<ReturnType<typeof createApp>>, payload: unknown) {
  return app.request("/sync", {
    method: "POST",
    headers: { ...HOST, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ snapshot: JSON.stringify(payload) }).toString(),
  });
}

Deno.test("form-encoded Sync yields a fully decoded party at GET /state", async () => {
  let clock = 1_000;
  const app = createApp({ store: new GameStateStore({ now: () => clock }) });
  const res = await postForm(app, payloadFor([[0, MON_A]]));
  assertEquals(res.status, 204);

  clock = 1_400;
  const state = await app.request("/state", { headers: { ...HOST } });
  assertEquals(state.status, 200);
  const game = GameStateSchema.parse(await state.json());
  assertEquals(game.sync.state, "live");
  assertEquals(game.sync.ageMs, 400);
  const m = game.slots[0]!;
  assertEquals(m.slot, 1);
  assertEquals(m.speciesId, 392);
  assertEquals(m.speciesName.length > 0, true);
  assertEquals(m.types.length >= 1, true);
  assertEquals(m.stats.attack, 142);
  assertEquals(m.statusCondition, "par");
  assertEquals(game.slots[1], null);
  assertEquals(game.trainerMeta.playerName, "ETHAN");
});

Deno.test("malformed snapshot field answers 400 and keeps the cache intact", async () => {
  const app = createApp({ store: new GameStateStore({ now: () => 0 }) });
  await postForm(app, payloadFor([[0, MON_A]]));
  const before = await (await app.request("/state", { headers: { ...HOST } })).json();

  const bad = await app.request("/sync", {
    method: "POST",
    headers: { ...HOST, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ snapshot: "{not json" }).toString(),
  });
  assertEquals(bad.status, 400);

  const after = await (await app.request("/state", { headers: { ...HOST } })).json();
  assertEquals(after, before);
});

Deno.test("missing snapshot field answers 400", async () => {
  const app = createApp({ store: new GameStateStore() });
  const res = await app.request("/sync", {
    method: "POST",
    headers: { ...HOST, "content-type": "application/x-www-form-urlencoded" },
    body: "nonsense=1",
  });
  assertEquals(res.status, 400);
});

Deno.test("torn slot serves last-known-good invisibly and counts degradation", async () => {
  const app = createApp({ store: new GameStateStore({ now: () => 5_000 }) });
  await postForm(app, payloadFor([[0, MON_A]]));

  const res = await postForm(
    app,
    payloadFor([[0, MON_A]], { corrupt: [0] }),
  );
  assertEquals(res.status, 204); // sync itself is fine; one slot was torn

  const game = GameStateSchema.parse(
    await (await app.request("/state", { headers: { ...HOST } })).json(),
  );
  assertEquals(game.slots[0]?.speciesId, 392); // healed from last-known-good

  const integrity = await app.request("/debug/sync-integrity", {
    headers: { ...HOST },
  });
  assertEquals(integrity.status, 200);
  const report = await integrity.json();
  assertEquals(report.tornEvents >= 1, true);
});

Deno.test("a vacated slot transitions to null instead of serving stale data", async () => {
  const app = createApp({ store: new GameStateStore({ now: () => 0 }) });
  await postForm(app, payloadFor([[0, MON_A]]));
  await postForm(app, payloadFor([])); // party shrank
  const game = GameStateSchema.parse(
    await (await app.request("/state", { headers: { ...HOST } })).json(),
  );
  assertEquals(game.slots[0], null);
});
