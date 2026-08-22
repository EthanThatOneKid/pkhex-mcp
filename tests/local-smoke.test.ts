/**
 * OPTIONAL local smoke test — inert unless you opt in.
 *
 * Verifies the full live-server path (form-encoded ingest -> decode ->
 * /state) against a RUNNING pkhex-mcp server, mirroring what the BizHawk
 * bridge does. No game data required: the payload is synthetic.
 *
 * Run: PKHEX_LOCAL_SMOKE=1 deno test --allow-read --allow-net tests/local-smoke.test.ts
 * Requires: `deno task start` already running on 127.0.0.1:8941.
 */
import { assertEquals } from "@std/assert";
import { EMPTY_SLOT_BYTES } from "./fixtures.ts";

const enabled = Deno.env.get("PKHEX_LOCAL_SMOKE") === "1";

Deno.test({
  name: "local smoke: synthetic Sync round-trips through a running server",
  ignore: !enabled,
  fn: async () => {
    const base = "http://127.0.0.1:8941";
    // Synthetic Infernape slot built by the test-side encoder (same bytes the
    // bridge would produce for a real party member).
    const { encodeSlot } = await import("./codec-fixture.ts");
    const member = {
      pid: 0x11223344,
      speciesId: 392,
      heldItemId: 217,
      abilityId: 81,
      evs: [6, 252, 0, 36, 200, 14] as [number, number, number, number, number, number],
      moveIds: [425, 370, 9, 421] as [number, number, number, number],
      ppCur: [9, 6, 20, 12] as [number, number, number, number],
      ppUps: [2, 1, 0, 3] as [number, number, number, number],
      level: 64,
      hpCur: 187,
      hpMax: 187,
      stats: { attack: 142, defense: 94, spAttack: 139, spDefense: 96, speed: 151 },
      statusWord: 0x40,
    };
    const bytes = encodeSlot(member);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);

    const payload = {
      trainerMeta: {
        tid: 12345,
        sid: 54321,
        playerName: "SMOKE",
        playtime: { hours: 1, minutes: 23, seconds: 45 },
        mapId: 66,
      },
      slots: [
        { bytes: btoa(bin), decryptedInPlace: false },
        ...Array.from({ length: 5 }, () => ({
          bytes: EMPTY_SLOT_BYTES,
          decryptedInPlace: false,
        })),
      ],
    };

    const post = await fetch(`${base}/sync`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ snapshot: JSON.stringify(payload) }).toString(),
    });
    assertEquals(post.status, 204);

    const state = await (await fetch(`${base}/state`)).json();
    assertEquals(state.slots[0].speciesName, "Infernape");
    assertEquals(state.slots[0].stats.attack, 142);
    assertEquals(state.sync.state === "live" || state.sync.state === "stale", true);
  },
});
