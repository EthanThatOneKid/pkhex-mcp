import { assertEquals } from "@std/assert";
import { createApp } from "../src/app.ts";
import { GameStateStore } from "../src/state/game-state.ts";
import { makeSyncPayload } from "./fixtures.ts";

const HOST = { host: "127.0.0.1:8941" };

const TOOL_NAMES = [
  "get_party",
  "get_game_state",
  "get_sync_status",
  "get_pokemon_by_slot",
  "find_party_member_by_species",
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
async function handshake(app: ReturnType<typeof createApp>): Promise<string | undefined> {
  const init = await post(app, undefined, rpc(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0" },
  }));
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
});

Deno.test("data tools hard-error only before the first-ever Sync", async () => {
  const app = createApp({ store: new GameStateStore({ now: () => 0 }) });
  const sessionId = await handshake(app);

  const status = await post(app, sessionId, rpc(3, "tools/call", {
    name: "get_sync_status",
    arguments: {},
  }));
  assertEquals(status.status, 200);
  const statusDoc = await jsonBody(status);
  assertEquals(statusDoc.result.isError ?? false, false);
  const parsedStatus = JSON.parse(statusDoc.result.content[0].text);
  assertEquals(parsedStatus.state, "disconnected");
  assertEquals(parsedStatus.receivedAt, null);

  const party = await post(app, sessionId, rpc(4, "tools/call", {
    name: "get_party",
    arguments: {},
  }));
  const partyDoc = await jsonBody(party);
  assertEquals(partyDoc.result.isError, true);
  assertEquals(partyDoc.result.content[0].text.includes("no Sync received"), true);
});

Deno.test("tools serve contract-verbatim decoded data after a Sync", async () => {
  let clock = 1_000;
  const store = new GameStateStore({ now: () => clock });
  store.recordSync(makeSyncPayload());
  const app = createApp({ store });
  const sessionId = await handshake(app);

  clock = 1_500;
  const partyRes = await post(app, sessionId, rpc(5, "tools/call", {
    name: "get_party",
    arguments: {},
  }));
  const partyDoc = await jsonBody(partyRes);
  assertEquals(partyDoc.result.isError ?? false, false);
  const slots = JSON.parse(partyDoc.result.content[0].text);
  assertEquals(slots.length, 6);

  const bySlot = await post(app, sessionId, rpc(6, "tools/call", {
    name: "get_pokemon_by_slot",
    arguments: { slot: 1 },
  }));
  const bySlotDoc = await jsonBody(bySlot);
  assertEquals(JSON.parse(bySlotDoc.result.content[0].text), null); // fixture slots are empty

  const gameState = await post(app, sessionId, rpc(7, "tools/call", {
    name: "get_game_state",
    arguments: {},
  }));
  const gsFrame = await jsonBody(gameState);
  const gs = JSON.parse((gsFrame.result as { content: Array<{ text: string }> }).content[0].text);
  assertEquals(gs.trainerMeta.playerName, "ETHAN");
  assertEquals(gs.sync.ageMs, 500);
});

Deno.test("a fresh client can re-initialize against an already-initialized server", async () => {
  const app = createApp({ store: new GameStateStore({ now: () => 0 }) });

  // First client: full handshake plus a tool round-trip.
  const first = await handshake(app);
  const firstCall = await post(app, first, rpc(2, "tools/call", {
    name: "get_sync_status",
    arguments: {},
  }));
  assertEquals(firstCall.status, 200);

  // Second client starts from scratch (no session header): a chat-app restart
  // or a second tab must not require a server restart.
  const second = await handshake(app);
  const secondCall = await post(app, second, rpc(3, "tools/call", {
    name: "get_sync_status",
    arguments: {},
  }));
  assertEquals(secondCall.status, 200);
  const doc = await jsonBody(secondCall);
  assertEquals(doc.result.isError ?? false, false);
});

Deno.test("stdio mode (--stdio) speaks MCP on stdin/stdout without HTTP", async () => {
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
    try { proc.kill(); } catch { /* already exited */ }
    assertEquals(buf.includes('"pkhex-mcp"'), true, `handshake in: ${buf.slice(0, 400)}`);
    assertEquals(buf.includes('"get_party"'), true, `tools in: ${buf.slice(-400)}`);
  } finally {
    try { proc.kill(); } catch { /* already exited */ }
  }
});
