import { assertEquals } from "@std/assert";
import { GameStateStore } from "../src/state/game-state.ts";
import { makeSyncPayload } from "./fixtures.ts";

Deno.test("store has no snapshot before the first Sync", () => {
  const store = new GameStateStore({ now: () => 0 });
  assertEquals(store.getGameState(), null);
});

Deno.test("a fresh Sync is live", () => {
  let clock = 1_000;
  const store = new GameStateStore({ now: () => clock });
  store.recordSync(makeSyncPayload());
  clock = 2_500; // ≤ LIVE_MS since receivedAt
  const snap = store.getGameState();
  assertEquals(snap?.sync.state, "live");
});

Deno.test("snapshot ages to stale after 2s", () => {
  let clock = 0;
  const store = new GameStateStore({ now: () => clock });
  store.recordSync(makeSyncPayload());
  clock = 30_000; // > 2s, ≤ 30s since receivedAt
  const snap = store.getGameState();
  assertEquals(snap?.sync.state, "stale");
});

Deno.test("snapshot disconnects after 30s", () => {
  let clock = 0;
  const store = new GameStateStore({ now: () => clock });
  store.recordSync(makeSyncPayload());
  clock = 60_000; // > 30s since receivedAt
  const snap = store.getGameState();
  assertEquals(snap?.sync.state, "disconnected");
});

Deno.test("re-ingest resets health to live", () => {
  let clock = 0;
  const store = new GameStateStore({ now: () => clock });
  store.recordSync(makeSyncPayload());
  clock = 60_000; // dead
  assertEquals(store.getGameState()?.sync.state, "disconnected");
  clock = 60_100; // fresh Sync arrives
  store.recordSync(makeSyncPayload());
  assertEquals(store.getGameState()?.sync.state, "live");
});
