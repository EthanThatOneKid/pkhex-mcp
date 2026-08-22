import { createApp } from "./app.ts";
import { createMcpServer } from "./mcp/server.ts";
import { connectStdio } from "./mcp/stdio.ts";
import { resolveServeTarget } from "./serve-target.ts";
import { GameStateStore } from "./state/game-state.ts";

const store = new GameStateStore();

if (Deno.args.includes("--stdio")) {
  // stdout belongs to MCP framing; keep all logging on stderr.
  console.error("pkhex-mcp stdio mode");
  await connectStdio(createMcpServer(store));
} else {
  const app = createApp({ store });
  const envObject = (Deno.env as unknown as {
    toObject?: () => Record<string, string>;
  }).toObject?.() ?? {};
  const target = resolveServeTarget(envObject);

  // Under deno desktop the runtime auto-opens its window (titled via
  // desktop.app.name); constructing BrowserWindow with options currently
  // deadlocks on Windows (denoland/deno#36515), so we do not touch it.

  Deno.serve({ hostname: target.hostname, port: target.port }, app.fetch);
  console.error(
    `pkhex-mcp listening on http://${target.hostname}:${target.port}` +
      (target.desktop ? " (desktop)" : " (loopback only)"),
  );
}
