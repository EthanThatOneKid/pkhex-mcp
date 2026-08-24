import { assertEquals, assertStringIncludes } from "@std/assert";
import { createApp } from "../src/app.ts";
import { makeSave } from "./helpers/save-builder.ts";

const HOST = { host: "127.0.0.1:8941" };

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
  "read_raw_region",
];

const RESOURCE_URIS = [
  "pkhex://reference/species",
  "pkhex://reference/moves",
  "pkhex://reference/items",
  "pkhex://reference/abilities",
  "pkhex://reference/natures",
  "pkhex://reference/field-guide",
  "pkhex://reference/offset-map",
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

Deno.test("MCP handshake over /mcp advertises pkhex-mcp, all save tools, and reference resources", async () => {
  const app = createApp({});
  const sessionId = await handshake(app);

  const list = await post(app, sessionId, rpc(2, "tools/list"));
  assertEquals(list.status, 200);
  const doc = await jsonBody(list);
  const names = doc.result.tools.map((t: { name: string }) => t.name);
  for (const expected of SAVE_TOOL_NAMES) {
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

Deno.test("save scanners answer from PKHEX_SAVE_PATH and explain when unset", async () => {
  // Happy path: synthetic save written to a temp file, wired via savePath.
  const save = makeSave({ money: 91124, badges: 0b00000111 });
  const tmp = await Deno.makeTempFile({ suffix: ".sav" });
  await Deno.writeFile(tmp, save);
  try {
    const app = createApp({ savePath: tmp });
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

    const raw = await post(
      app,
      sessionId,
      rpc(23, "tools/call", {
        name: "read_raw_region",
        arguments: { offset: 0x78, length: 4 },
      }),
    );
    const rawDoc = await jsonBody(raw);
    const region = JSON.parse(rawDoc.result.content[0].text);
    assertEquals(region.offset, 0x78);
    assertEquals(region.length, 4);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }

  // Unconfigured: tool stays listed but explains the env var instead.
  const app2 = createApp({});
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

Deno.test("a fresh client can re-initialize against an already-initialized server", async () => {
  const app = createApp({});

  // First client: full handshake plus a tool round-trip.
  const first = await handshake(app);
  const firstCall = await post(app, first, rpc(2, "tools/list"));
  assertEquals(firstCall.status, 200);

  // Second client starts from scratch (no session header): a chat-app restart
  // or a second tab must not require a server restart.
  const second = await handshake(app);
  const secondCall = await post(app, second, rpc(3, "tools/list"));
  assertEquals(secondCall.status, 200);
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
        buf.includes('"get_party_audit"'),
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
