import { assertEquals, assertStringIncludes } from "@std/assert";

const SCRIPT = await Deno.readTextFile("bridge/platinum-sync.lua");

/** Static smoke checks: the Bridge script must reference the verified
 * anchors/transport/cadence before it can be smoke-tested against a real
 * BizHawk instance (manual step, see bridge/README.md). */
Deno.test("bridge script reads the verified Pt-US party anchors", () => {
  assertStringIncludes(SCRIPT, "0x02101D2C");
  assertStringIncludes(SCRIPT, "0xD094");
  assertStringIncludes(SCRIPT, "0xEC");
  assertStringIncludes(SCRIPT, "0xCFE0");
});

Deno.test("bridge script gates on the CPUE gamecode", () => {
  assertStringIncludes(SCRIPT, "0x45555043");
  assertStringIncludes(SCRIPT, "CPUE");
});

Deno.test("bridge script posts raw JSON over comm.httpPost (BizHawk owns the form encoding)", () => {
  assertStringIncludes(SCRIPT, "comm.httpPost");
  assertStringIncludes(SCRIPT, "comm.httpPost(SERVER_URL, snapshotJson)");
});

Deno.test("bridge script uses a wall-clock accumulator on the frame hook", () => {
  assertStringIncludes(SCRIPT, "event.onframeend");
  assertStringIncludes(SCRIPT, "POLL_INTERVAL_MS = 500");
  assertStringIncludes(SCRIPT, "os.clock()");
});

Deno.test("bridge script builds contract-shaped SyncPayload", () => {
  assertStringIncludes(SCRIPT, '"decryptedInPlace":');
  assertStringIncludes(SCRIPT, "base64_encode");
  assertEquals(SCRIPT.includes("--"), true); // documented lua file
});
