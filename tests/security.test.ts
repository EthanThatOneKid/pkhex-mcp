import { assertEquals } from "@std/assert";
import { createApp } from "../src/app.ts";
import { GameStateStore } from "../src/state/game-state.ts";

const GOOD_HOST = { host: "127.0.0.1:8941" };

function makeApp() {
  // No snapshot ingested: /state answers 503 once security lets a request through.
  return createApp({ store: new GameStateStore({ now: () => 0 }) });
}

Deno.test("rejects non-loopback Host", async () => {
  const res = await makeApp().request("/state", {
    headers: { host: "evil.example.com", origin: "http://127.0.0.1:3000" },
  });
  assertEquals(res.status, 403);
});

Deno.test("accepts loopback and docker Hosts", async () => {
  const app = makeApp();
  for (const host of [
    "127.0.0.1:8941",
    "localhost:8941",
    "[::1]:8941",
    "host.docker.internal:8941",
  ]) {
    const res = await app.request("/state", { headers: { host } });
    assertEquals(res.status, 503, `host ${host} should pass security`);
  }
});

Deno.test("rejects disallowed Origin on a good Host", async () => {
  const res = await makeApp().request("/state", {
    headers: { ...GOOD_HOST, origin: "https://evil.example" },
  });
  assertEquals(res.status, 403);
});

Deno.test("missing Origin is accepted", async () => {
  const res = await makeApp().request("/state", { headers: { ...GOOD_HOST } });
  assertEquals(res.status, 503);
});

Deno.test("loopback Origin is accepted", async () => {
  const res = await makeApp().request("/state", {
    headers: { ...GOOD_HOST, origin: "http://127.0.0.1:3000" },
  });
  assertEquals(res.status, 503);
});
