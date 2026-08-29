import { parseArgs } from "@std/cli/parse-args";
import { createApp } from "./app.ts";
import { createMcpServer } from "./mcp/server.ts";
import { connectStdio } from "./mcp/stdio.ts";
import { resolveServeTarget } from "./serve-target.ts";

const USAGE = `pkhex-mcp — Pokémon Platinum save-file MCP server

Usage:
  deno task start [--stdio] [--port <n>] [-h | --help]
  deno task desktop

Options:
  --stdio     MCP over stdio (stdin/stdout framing)
  --port <n>  Dev-mode HTTP port override (default 8941)
  -h, --help  Show this help message
`;

const flags = parseArgs(Deno.args, {
  boolean: ["stdio", "help"],
  string: ["port"],
  default: { stdio: false, port: undefined as string | undefined },
  alias: { h: "help" },
  unknown: (arg) => {
    // --runtime is injected by `deno desktop`; tolerate it.
    if (arg === "--runtime") return;
    console.error(`Unknown option: ${arg}\n\n${USAGE}`);
    Deno.exit(1);
  },
});

if (flags.help) {
  console.log(USAGE);
  Deno.exit(0);
}

const savePath = Deno.env.get("PKHEX_SAVE_PATH") ?? undefined;

if (flags.stdio) {
  // stdout belongs to MCP framing; keep all logging on stderr.
  console.error("pkhex-mcp stdio mode");
  await connectStdio(createMcpServer({ savePath }));
} else {
  const app = createApp({ savePath });
  const envObject = (Deno.env as unknown as {
    toObject?: () => Record<string, string>;
  }).toObject?.() ?? {};

  // --port flag overrides PKHEX_PORT env (but not DENO_SERVE_ADDRESS desktop).
  if (flags.port) {
    const portNum = Number(flags.port);
    if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
      console.error(`Invalid port: ${flags.port}`);
      Deno.exit(1);
    }
    envObject["PKHEX_PORT"] = String(portNum);
  }

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
