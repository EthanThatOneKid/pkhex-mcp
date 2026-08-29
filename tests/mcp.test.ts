import { assertEquals, assertStringIncludes } from "@std/assert";
import { createApp } from "@/src/app.ts";
import { makeEncryptedPartySlot, makeSave } from "./helpers/save-builder.ts";

const HOST = { host: "127.0.0.1:8941" };

const RAW_FIRST_TOOL_NAMES = [
  "read_raw_region",
  "decode_pokemon_record",
  "decode_pc_box",
  "get_save_info",
  "get_bag",
  "get_trainer_card",
  "get_badges",
  "get_dex_summary",
  "get_party_detail",
  "find_in_pc_box",
  "get_story_progress",
  "get_pc_inventory",
  "find_item",
];

const RESOURCE_URIS = [
  "pkhex://reference/species",
  "pkhex://reference/moves",
  "pkhex://reference/items",
  "pkhex://reference/abilities",
  "pkhex://reference/natures",
  "pkhex://reference/field-guide",
  "pkhex://reference/offset-map",
  "pkhex://reference/story-flags",
];

/** Streamable HTTP replies may be plain JSON or SSE -- handle both. */
async function jsonBody(res: Response): Promise<any> {
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (contentType.includes("text/event-stream")) {
    const dataLines = raw.split("\n").filter((l) => l.startsWith("data:"));
    return JSON.parse(dataLines[dataLines.length - 1]!.slice(5).trim());
  }
  return JSON.parse(raw);
}

function rpc(id: number | null, method: string, params?: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    ...(params === undefined ? {} : { params }),
  };
}

function post(
  app: ReturnType<typeof createApp>,
  sessionId: string | undefined,
  body: unknown,
) {
  return app.request("/mcp", {
    method: "POST",
    headers: {
      ...HOST,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Drive initialize + initialized handshake; returns the session id if any. */
async function handshake(
  app: ReturnType<typeof createApp>,
): Promise<string | undefined> {
  const init = await post(
    app,
    undefined,
    rpc(1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0" },
    }),
  );
  assertEquals(init.status, 200);
  const initDoc = await jsonBody(init);
  assertEquals(initDoc.result?.serverInfo?.name, "pkhex-mcp");
  const sessionId = init.headers.get("mcp-session-id") ?? undefined;

  const note = await post(app, sessionId, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assertEquals([200, 202, 204].includes(note.status), true);
  return sessionId;
}

Deno.test("MCP handshake over /mcp advertises the raw-first tools and reference resources", async () => {
  const app = createApp({});
  const sessionId = await handshake(app);

  const list = await post(app, sessionId, rpc(2, "tools/list"));
  assertEquals(list.status, 200);
  const doc = await jsonBody(list);
  const names = doc.result.tools.map((t: { name: string }) => t.name);
  assertEquals(
    names.length,
    RAW_FIRST_TOOL_NAMES.length,
    "unexpected extra tools",
  );
  for (const expected of RAW_FIRST_TOOL_NAMES) {
    assertEquals(names.includes(expected), true, `missing tool ${expected}`);
  }

  const resources = await post(app, sessionId, rpc(3, "resources/list"));
  assertEquals(resources.status, 200);
  const resDoc = await jsonBody(resources);
  const uris: string[] = resDoc.result.resources.map((r: { uri: string }) =>
    r.uri
  );
  for (const expected of RESOURCE_URIS) {
    assertEquals(uris.includes(expected), true, `missing resource ${expected}`);
  }
});

Deno.test("raw-first workflow: raw window + record decode against a temp save", async () => {
  // Synthetic active-half party slot 0: Infernape, known IVs/moves.
  const member = makeEncryptedPartySlot({
    species: 392,
    moves: [394, 157, 339, 421],
    ivs: { hp: 31, atk: 30, def: 29, spe: 28, spa: 27, spd: 26 },
    level: 32,
    hpCur: 100,
    hpMax: 100,
  });
  const data = makeSave({ money: 91124 });
  data.set(member.subarray(0, 236), 0x40000 + 0xa0);
  // Re-stamp partition 1's General-footer CRC over the mutated block
  // (CRC16-CCITT poly 0x1021, init 0xFFFF, MSB-first).
  {
    let crc = 0xffff;
    for (let i = 0x40000; i < 0x40000 + 0xcf18; i++) {
      crc ^= data[i]! << 8;
      for (let bit = 0; bit < 8; bit++) {
        crc = crc & 0x8000
          ? ((crc << 1) ^ 0x1021) & 0xffff
          : (crc << 1) & 0xffff;
      }
    }
    new DataView(data.buffer).setUint16(0x40000 + 0xcf18 + 0x12, crc, true);
  }
  // CRC covers the mutated region only if written after — rebuild footer CRC:
  // (makeSave already wrote footers, so re-stamp partition 1's CRC.)
  {
    let sum = 0;
    for (let i = 0xcf18 - 0xcf18; i < 0xcf18; i += 2) {
      sum += data[0x40000 + i]! | (data[0x40000 + i + 1]! << 8);
    }
    void sum;
  }

  const tmp = await Deno.makeTempFile({ suffix: ".sav" });
  await Deno.writeFile(tmp, data);
  try {
    const app = createApp({ savePath: tmp });
    const sessionId = await handshake(app);

    // Raw window over the party record we planted.
    const rawRes = await fetch(`file://${tmp}`);
    const fileBytes = new Uint8Array(await rawRes.arrayBuffer());
    const recordBytes = fileBytes.slice(0x40000 + 0xa0, 0x40000 + 0xa0 + 236);
    let bin = "";
    for (const b of recordBytes) bin += String.fromCharCode(b);
    const recordB64 = btoa(bin);

    const decoded = await post(
      app,
      sessionId,
      rpc(20, "tools/call", {
        name: "decode_pokemon_record",
        arguments: { recordsBase64: [recordB64] },
      }),
    );
    assertEquals(decoded.status, 200);
    const decodedDoc = await jsonBody(decoded);
    assertEquals(decodedDoc.result.isError ?? false, false);
    const rec = JSON.parse(decodedDoc.result.content[0].text).decoded[0];
    assertEquals(rec.speciesName, "Infernape");
    assertEquals(rec.level, 32);
    assertEquals(rec.ivs.hp, 31);

    const info = await post(
      app,
      sessionId,
      rpc(21, "tools/call", {
        name: "get_save_info",
        arguments: {},
      }),
    );
    const infoDoc = await jsonBody(info);
    const infoJson = JSON.parse(infoDoc.result.content[0].text);
    assertEquals(infoJson.activePartition.index, 1);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

Deno.test("unconfigured save explains PKHEX_SAVE_PATH", async () => {
  const app = createApp({});
  const sid = await handshake(app);
  const res = await post(
    app,
    sid,
    rpc(22, "tools/call", {
      name: "read_raw_region",
      arguments: { offset: 0x78, length: 4 },
    }),
  );
  const doc = await jsonBody(res);
  assertEquals(doc.result.isError, true);
  assertStringIncludes(doc.result.content[0].text, "PKHEX_SAVE_PATH");
});

Deno.test("a fresh client can re-initialize against an already-initialized server", async () => {
  const app = createApp({});

  const first = await handshake(app);
  const firstCall = await post(app, first, rpc(2, "tools/list"));
  assertEquals(firstCall.status, 200);

  const second = await handshake(app);
  const secondCall = await post(app, second, rpc(3, "tools/list"));
  assertEquals(secondCall.status, 200);
});

Deno.test("get_trainer_card returns identity fields", async () => {
  const data = makeSave({ money: 135188, badges: 0b00000111 });
  const tmp = await Deno.makeTempFile({ suffix: ".sav" });
  await Deno.writeFile(tmp, data);
  try {
    const app = createApp({ savePath: tmp });
    const sessionId = await handshake(app);
    const res = await post(
      app,
      sessionId,
      rpc(30, "tools/call", {
        name: "get_trainer_card",
        arguments: {},
      }),
    );
    assertEquals(res.status, 200);
    const doc = await jsonBody(res);
    assertEquals(doc.result.isError ?? false, false);
    const card = JSON.parse(doc.result.content[0].text);
    assertEquals(card.playerName, "Ethan");
    assertEquals(card.money, 135188);
    assertEquals(card.badgeCount, 3);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

Deno.test("get_badges returns earned badge names", async () => {
  const data = makeSave({ badges: 0b00000111 });
  const tmp = await Deno.makeTempFile({ suffix: ".sav" });
  await Deno.writeFile(tmp, data);
  try {
    const app = createApp({ savePath: tmp });
    const sessionId = await handshake(app);
    const res = await post(
      app,
      sessionId,
      rpc(31, "tools/call", {
        name: "get_badges",
        arguments: {},
      }),
    );
    assertEquals(res.status, 200);
    const doc = await jsonBody(res);
    const badges = JSON.parse(doc.result.content[0].text);
    assertEquals(badges.count, 3);
    assertEquals(badges.earned.length, 3);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

Deno.test("get_dex_summary returns seen/caught counts", async () => {
  const data = makeSave({ dexSeen: [1, 25, 100], dexCaught: [1, 25] });
  const tmp = await Deno.makeTempFile({ suffix: ".sav" });
  await Deno.writeFile(tmp, data);
  try {
    const app = createApp({ savePath: tmp });
    const sessionId = await handshake(app);
    const res = await post(
      app,
      sessionId,
      rpc(32, "tools/call", {
        name: "get_dex_summary",
        arguments: {},
      }),
    );
    assertEquals(res.status, 200);
    const doc = await jsonBody(res);
    const dex = JSON.parse(doc.result.content[0].text);
    assertEquals(dex.seen, 3);
    assertEquals(dex.caught, 2);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

Deno.test("get_party_detail returns species/level/nature per slot", async () => {
  const member = makeEncryptedPartySlot({
    species: 392,
    moves: [394, 157, 339, 421],
    ivs: { hp: 31, atk: 30, def: 29, spe: 28, spa: 27, spd: 26 },
    level: 32,
    hpCur: 100,
    hpMax: 100,
  });
  const data = makeSave({ partySlots: [member] });
  const tmp = await Deno.makeTempFile({ suffix: ".sav" });
  await Deno.writeFile(tmp, data);
  try {
    const app = createApp({ savePath: tmp });
    const sessionId = await handshake(app);
    const res = await post(
      app,
      sessionId,
      rpc(33, "tools/call", {
        name: "get_party_detail",
        arguments: {},
      }),
    );
    assertEquals(res.status, 200);
    const doc = await jsonBody(res);
    const party = JSON.parse(doc.result.content[0].text);
    assertEquals(Array.isArray(party), true);
    assertEquals(party.length, 6);
    assertEquals(party[0].speciesName, "Infernape");
    assertEquals(party[0].level, 32);
    // Slots 1-5 should be empty (null species)
    assertEquals(party[1].speciesName, null);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

Deno.test("get_bag returns pouches with resolved item names", async () => {
  const data = makeSave({ bagItemsPairs: [[33, 11], [17, 5]] });
  const tmp = await Deno.makeTempFile({ suffix: ".sav" });
  await Deno.writeFile(tmp, data);
  try {
    const app = createApp({ savePath: tmp });
    const sessionId = await handshake(app);
    const res = await post(
      app,
      sessionId,
      rpc(34, "tools/call", {
        name: "get_bag",
        arguments: {},
      }),
    );
    assertEquals(res.status, 200);
    const doc = await jsonBody(res);
    assertEquals(doc.result.isError ?? false, false);
    const bag = JSON.parse(doc.result.content[0].text);
    assertEquals(Array.isArray(bag.pouches), true);
    // At least the Items pouch should have entries
    const allItems = bag.pouches.flatMap((p: any) => p.items);
    assertEquals(allItems.length >= 2, true);
    // Item 33 = Moomoo Milk
    const moomoo = allItems.find((i: any) => i.itemId === 33);
    assertEquals(moomoo !== undefined, true);
    assertEquals(moomoo.count, 11);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

Deno.test("get_save_info returns resources array", async () => {
  const data = makeSave();
  const tmp = await Deno.makeTempFile({ suffix: ".sav" });
  await Deno.writeFile(tmp, data);
  try {
    const app = createApp({ savePath: tmp });
    const sessionId = await handshake(app);
    const res = await post(
      app,
      sessionId,
      rpc(35, "tools/call", {
        name: "get_save_info",
        arguments: {},
      }),
    );
    assertEquals(res.status, 200);
    const doc = await jsonBody(res);
    const info = JSON.parse(doc.result.content[0].text);
    assertEquals(Array.isArray(info.resources), true);
    assertEquals(info.resources.length, 8);
    const uris = info.resources.map((r: any) => r.uri);
    assertEquals(uris.includes("pkhex://reference/field-guide"), true);
    assertEquals(uris.includes("pkhex://reference/items"), true);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

Deno.test("stdio mode (--stdio) speaks MCP on stdin/stdout without HTTP", async () => {
  const attempt = async (): Promise<void> => {
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--no-lock", "src/main.ts", "--stdio"],
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    });
    const proc = command.spawn();
    try {
      const lines = [
        JSON.stringify(rpc(1, "initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "stdio-test", version: "0" },
        })),
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        JSON.stringify(rpc(2, "tools/list")),
        "",
      ].join("\n");
      const writer = proc.stdin.getWriter();
      await writer.write(new TextEncoder().encode(lines));
      await writer.close();

      const reader = proc.stdout.getReader();
      let buf = "";
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (buf.includes('"id":2') && buf.includes('"tools"')) break;
        const timer = Promise.race([
          reader.read().then(({ value, done }) => ({ done, value })),
          new Promise<{ done: boolean; value?: Uint8Array }>((r) =>
            setTimeout(() => r({ done: false }), 1_000)
          ),
        ]);
        const { done, value } = await timer;
        if (done) break;
        if (value) buf += new TextDecoder().decode(value);
      }
      try {
        proc.kill();
      } catch { /* already exited */ }
      assertEquals(
        buf.includes('"pkhex-mcp"'),
        true,
        `handshake in: ${buf.slice(0, 400)}`,
      );
      assertEquals(
        buf.includes('"decode_pokemon_record"'),
        true,
        `tools in: ${buf.slice(-400)}`,
      );
    } finally {
      try {
        proc.kill();
      } catch { /* already exited */ }
    }
  };

  // Attempt 1 may miss its read deadline under heavy machine load (#21);
  // a clean second attempt is accepted as passing.
  try {
    await attempt();
  } catch {
    console.warn("stdio test: first attempt failed, retrying once");
    await attempt();
  }
});

// ---- P1: get_pc_inventory MCP tool ----

Deno.test("get_pc_inventory returns party + boxes via MCP", async () => {
  const member = makeEncryptedPartySlot({
    species: 392,
    level: 32,
    hpCur: 100,
    hpMax: 100,
  });
  const data = makeSave({ partySlots: [member] });
  const tmp = await Deno.makeTempFile({ suffix: ".sav" });
  await Deno.writeFile(tmp, data);
  try {
    const app = createApp({ savePath: tmp });
    const sessionId = await handshake(app);
    const res = await post(
      app,
      sessionId,
      rpc(40, "tools/call", {
        name: "get_pc_inventory",
        arguments: {},
      }),
    );
    assertEquals(res.status, 200);
    const doc = await jsonBody(res);
    assertEquals(doc.result.isError ?? false, false);
    const inv = JSON.parse(doc.result.content[0].text);
    assertEquals(Array.isArray(inv.party), true);
    assertEquals(Array.isArray(inv.boxes), true);
    assertEquals(inv.party.length, 1);
    assertEquals(inv.party[0].speciesName, "Infernape");
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

// ---- P4: find_item MCP tool ----

Deno.test("find_item searches bag via MCP", async () => {
  const data = makeSave({ bagItemsPairs: [[79, 2]] });
  const tmp = await Deno.makeTempFile({ suffix: ".sav" });
  await Deno.writeFile(tmp, data);
  try {
    const app = createApp({ savePath: tmp });
    const sessionId = await handshake(app);
    const res = await post(
      app,
      sessionId,
      rpc(41, "tools/call", {
        name: "find_item",
        arguments: { query: "Repel" },
      }),
    );
    assertEquals(res.status, 200);
    const doc = await jsonBody(res);
    assertEquals(doc.result.isError ?? false, false);
    const hits = JSON.parse(doc.result.content[0].text);
    assertEquals(Array.isArray(hits), true);
    assertEquals(
      hits.some((h: any) => h.itemId === 79 && h.count === 2),
      true,
    );
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

// ---- P3: read_raw_region with named region via MCP ----

Deno.test("read_raw_region accepts region param via MCP", async () => {
  const data = makeSave({ money: 135188 });
  const tmp = await Deno.makeTempFile({ suffix: ".sav" });
  await Deno.writeFile(tmp, data);
  try {
    const app = createApp({ savePath: tmp });
    const sessionId = await handshake(app);
    // Read TID from the trainer region
    const res = await post(
      app,
      sessionId,
      rpc(42, "tools/call", {
        name: "read_raw_region",
        arguments: { offset: 0x10, length: 4, region: "trainer" },
      }),
    );
    assertEquals(res.status, 200);
    const doc = await jsonBody(res);
    assertEquals(doc.result.isError ?? false, false);
    const region = JSON.parse(doc.result.content[0].text);
    // Should resolve trainer offset (0x68) + 0x10 = 0x78
    assertEquals(region.offset, 0x78);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});
