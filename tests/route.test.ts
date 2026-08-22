import { assertEquals, assertStringIncludes } from "@std/assert";
import { createApp } from "../src/app.ts";
import { GameStateSchema } from "../src/gen4/schemas.ts";
import { GameStateStore } from "../src/state/game-state.ts";
import { makeSyncPayload } from "./fixtures.ts";

const HOST = { host: "127.0.0.1:8941" };

Deno.test("GET /state answers 503 before any Sync", async () => {
  const app = createApp({ store: new GameStateStore({ now: () => 0 }) });
  const res = await app.request("/state", { headers: { ...HOST } });
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error, "no Sync received yet");
});

Deno.test("POST /sync then GET /state yields contract-shaped GameState", async () => {
  let clock = 1_000;
  const store = new GameStateStore({ now: () => clock });
  const app = createApp({ store });

  const post = await app.request("/sync", {
    method: "POST",
    headers: { ...HOST, "content-type": "application/json" },
    body: JSON.stringify(makeSyncPayload()),
  });
  assertEquals(post.status, 204);

  clock = 1_500;
  const res = await app.request("/state", { headers: { ...HOST } });
  assertEquals(res.status, 200);
  // Throws if the served shape drifts from the frozen contract:
  const parsed = GameStateSchema.parse(await res.json());
  assertEquals(parsed.sync.state, "live");
  assertEquals(parsed.sync.ageMs, 500);
  assertEquals(parsed.trainerMeta.playerName, "ETHAN");
  assertEquals(parsed.trainerMeta.locationName, null);
  assertEquals(parsed.slots.length, 6);
});

Deno.test("POST /sync rejects malformed payloads with 400", async () => {
  const app = createApp({ store: new GameStateStore() });
  const res = await app.request("/sync", {
    method: "POST",
    headers: { ...HOST, "content-type": "application/json" },
    body: JSON.stringify({ trainerMeta: {}, slots: [] }),
  });
  assertEquals(res.status, 400);
});

Deno.test("GET /doc exposes both routes and GameState schema", async () => {
  const res = await createApp({ store: new GameStateStore() }).request("/doc", {
    headers: { ...HOST },
  });
  assertEquals(res.status, 200);
  const doc = await res.json();
  assertEquals(doc.openapi, "3.1.0");
  assertEquals(typeof doc.paths["/state"], "object");
  assertEquals(typeof doc.paths["/sync"], "object");
  assertStringIncludes(JSON.stringify(doc), "PartyMember");
});

Deno.test("GET /swagger serves interactive docs", async () => {
  const res = await createApp({ store: new GameStateStore() }).request("/swagger", {
    headers: { ...HOST },
  });
  assertEquals(res.status, 200);
  assertStringIncludes(await res.text(), "swagger");
});
