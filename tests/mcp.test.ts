import { assertEquals, assertStringIncludes } from "@std/assert";
import { createApp } from "../src/app.ts";
import { GameStateStore } from "../src/state/game-state.ts";
import { makeSyncPayload } from "./fixtures.ts";
import { makeSave } from "./helpers/save-builder.ts";

const HOST = { host: "127.0.0.1:8941" };

const TOOL_NAMES = [
  "get_party",
  "get_game_state",
  "get_sync_status",
  "get_pokemon_by_slot",
  "find_party_member_by_species",
];

const SAVE_TOOL_NAMES = [
  "get_section_map",
  "get_trainer_card",
  "get_badges",
  "get_bag",
  "get_dex_summary",
  "is_species_caught",
  "get_pc_box",
  "find_in_pc_box",
  "get_story_flags",
  "get_party_audit",
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

Deno.test("MCP handshake over /mcp advertises pkhex-mcp and the five tools", async () => {
  const app = createApp({ store: new GameStateStore({ now: () => 0 }) });
  const sessionId = await handshake(app);

  const list = await post(app, sessionId, rpc(2, "tools/list"));
  assertEquals(list.status, 200);
  const doc = await jsonBody(list);
  assertEquals(doc.result.serverInfo?.name ?? null, null); // tools/list has no serverInfo
  const names = doc.result.tools.map((t: { name: string }) => t.name);
  for (const expected of TOOL_NAMES) {
    assertEquals(names.includes(expected), true, `missing tool ${expected}`);
  }
  for (const expected of SAVE_TOOL_NAMES) {
    assertEquals(
      names.includes(expected),
      true,
      `missing save tool ${expected}`,
    );
  }
});

Deno.test("save scanners answer from PKHEX_SAVE_PATH and explain when unset", async () => {
  const save = makeSave({ money: 91124, badges: 0b00000111 });
  const tmp = await Deno.makeTempFile({ suffix: ".sav" });
  await Deno.writeFile(tmp, save);
  try {
    const app = createApp({
      store: new GameStateStore({ now: () => 0 }),
      savePath: tmp,
    });
    const sessionId = await handshake(app);

    const res = await post(
      app,
      sessionId,
      rpc(20, "tools/call", {
        name: "get_trainer_card",
        arguments: {},
      }),
    );
    assertEquals(res.status, 200);
    const doc = await jsonBody(res);
    assertEquals(doc.result.isError ?? false, false);
    const card = JSON.parse(doc.result.content[0].text);
    assertEquals(card.playerName, "Ethan");
    assertEquals(card.money, 91124);
    assertEquals(card.badgeCount, 3);

    const caught = await post(
      app,
      sessionId,
      rpc(21, "tools/call", {
        name: "is_species_caught",
        arguments: { species: "Turtwig" },
      }),
    );
    const caughtDoc = await jsonBody(caught);
    const verdict = JSON.parse(caughtDoc.result.content[0].text);
    assertEquals(verdict.caught, false);
    assertEquals(verdict.nationalDexId, 387);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }

  // Unconfigured: tool stays listed but explains the env var instead.
  const app2 = createApp({ store: new GameStateStore({ now: () => 0 }) });
  const sid2 = await handshake(app2);
  const res2 = await post(
    app2,
    sid2,
    rpc(22, "tools/call", {
      name: "get_badges",
      arguments: {},
    }),
  );
  const doc2 = await jsonBody(res2);
  assertEquals(doc2.result.isError, true);
  assertStringIncludes(doc2.result.content[0].text, "PKHEX_SAVE_PATH");
});

Deno.test("reference resources list and read over /mcp", async () => {
  const app = createApp({ store: new GameStateStore({ now: () => 0 }) });
  const sessionId = await handshake(app);

  const list = await post(app, sessionId, rpc(30, "resources/list"));
  assertEquals(list.status, 200);
  const listDoc = await jsonBody(list);
  const uris: string[] = listDoc.result.resources.map((r: { uri: string }) =>
    r.uri
  );
  for (
    const expected of [
      "pkhex://reference/species",
      "pkhex://reference/moves",
      "pkhex://reference/items",
      "pkhex://reference/abilities",
      "pkhex://reference/natures",
      "pkhex://reference/field-guide",
      "pkhex://reference/offset-map",
    ]
  ) {
    assertEquals(uris.includes(expected), true, `missing resource ${expected}`);
  }

  const species = await post(
    app,
    sessionId,
    rpc(31, "resources/read", {
      uri: "pkhex://reference/species",
    }),
  );
  assertEquals(species.status, 200);
  const speciesDoc = await jsonBody(species);
  assertEquals(
    speciesDoc.result.contents[0].text.includes("Infernape"),
    true,
  );

  const guide = await post(
    app,
    sessionId,
    rpc(32, "resources/read", {
      uri: "pkhex://reference/field-guide",
    }),
  );
  const guideDoc = await jsonBody(guide);
  assertStringIncludes(guideDoc.result.contents[0].text, "Scanner first");

  const offsets = await post(
    app,
    sessionId,
    rpc(33, "resources/read", {
      uri: "pkhex://reference/offset-map",
    }),
  );
  const offsetsDoc = await jsonBody(offsets);
  assertStringIncludes(offsetsDoc.result.contents[0].text, "footer");
});

Deno.test("data tools hard-error only before the first-ever Sync", async () => {
  const app = createApp({ store: new GameStateStore({ now: () => 0 }) });
  const sessionId = await handshake(app);

  const status = await post(
    app,
    sessionId,
    rpc(3, "tools/call", {
      name: "get_sync_status",
      arguments: {},
    }),
  );
  assertEquals(status.status, 200);
  const statusDoc = await jsonBody(status);
  assertEquals(statusDoc.result.isError ?? false, false);
  const parsedStatus = JSON.parse(statusDoc.result.content[0].text);
  assertEquals(parsedStatus.state, "disconnected");
  assertEquals(parsedStatus.receivedAt, null);

  const party = await post(
    app,
    sessionId,
    rpc(4, "tools/call", {
      name: "get_party",
      arguments: {},
    }),
  );
  const partyDoc = await jsonBody(party);
  assertEquals(partyDoc.result.isError, true);
  assertEquals(
    partyDoc.result.content[0].text.includes("no Sync received"),
    true,
  );
});

Deno.test("tools serve contract-verbatim decoded data after a Sync", async () => {
  let clock = 1_000;
  const store = new GameStateStore({ now: () => clock });
  store.recordSync(makeSyncPayload());
  const app = createApp({ store });
  const sessionId = await handshake(app);

  clock = 1_500;
  const partyRes = await post(
    app,
    sessionId,
    rpc(5, "tools/call", {
      name: "get_party",
      arguments: {},
    }),
  );
  const partyDoc = await jsonBody(partyRes);
  assertEquals(partyDoc.result.isError ?? false, false);
  const slots = JSON.parse(partyDoc.result.content[0].text);
  assertEquals(slots.length, 6);

  const bySlot = await post(
    app,
    sessionId,
    rpc(6, "tools/call", {
      name: "get_pokemon_by_slot",
      arguments: { slot: 1 },
    }),
  );
  const bySlotDoc = await jsonBody(bySlot);
  assertEquals(JSON.parse(bySlotDoc.result.content[0].text), null); // fixture slots are empty

  const gameState = await post(
    app,
    sessionId,
    rpc(7, "tools/call", {
      name: "get_game_state",
      arguments: {},
    }),
  );
  const gsFrame = await jsonBody(gameState);
  const gs = JSON.parse(
    (gsFrame.result as { content: Array<{ text: string }> }).content[0].text,
  );
  assertEquals(gs.trainerMeta.playerName, "ETHAN");
  assertEquals(gs.sync.ageMs, 500);
});

Deno.test("a fresh client can re-initialize against an already-initialized server", async () => {
  const app = createApp({ store: new GameStateStore({ now: () => 0 }) });

  // First client: full handshake plus a tool round-trip.
  const first = await handshake(app);
  const firstCall = await post(
    app,
    first,
    rpc(2, "tools/call", {
      name: "get_sync_status",
      arguments: {},
    }),
  );
  assertEquals(firstCall.status, 200);

  // Second client starts from scratch (no session header): a chat-app restart
  // or a second tab must not require a server restart.
  const second = await handshake(app);
  const secondCall = await post(
    app,
    second,
    rpc(3, "tools/call", {
      name: "get_sync_status",
      arguments: {},
    }),
  );
  assertEquals(secondCall.status, 200);
  const doc = await jsonBody(secondCall);
  assertEquals(doc.result.isError ?? false, false);
});

/** The stdio subprocess is load-sensitive under parallel emulator/test runs
 * (#21): a single missed deadline fails the whole suite. Retry once. */
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
        buf.includes('"get_party"'),
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
  } catch (first) {
    console.warn("stdio test: first attempt failed, retrying once");
    await attempt();
  }
});
