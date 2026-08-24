import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { mountMcpHttp } from "./routes/mcp.ts";
import indexHtml from "./ui/index.html" with { type: "text" };
import uiJs from "./ui/ui.js" with { type: "text" };
import stylesCss from "./ui/styles.css" with { type: "text" };
import { SaveFileReader } from "./gen4/save/reader.ts";
import {
  getBadges,
  getBag,
  getDexSummary,
  getPartyAudit,
  getTrainerCard,
} from "./gen4/save/scanners.ts";

/** Hostnames allowed in the Host header — port-wildcard per spec §9. */
const ALLOWED_HOSTNAMES = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
  "host.docker.internal",
]);

function hostnameOf(hostHeader: string): string {
  if (hostHeader.startsWith("[")) {
    return hostHeader.slice(1, hostHeader.indexOf("]"));
  }
  const parts = hostHeader.split(":");
  // One colon = host:port; multiple colons = bare IPv6 literal.
  return parts.length === 2 ? parts[0] : hostHeader;
}

function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  return ALLOWED_HOSTNAMES.has(hostnameOf(host));
}

/** Missing Origin passes (non-browser clients); present Origin must be loopback-class. */
export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    return ALLOWED_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export interface AppOptions {
  /** Path to the player's Platinum .sav copy; enables every scanner surface. */
  savePath?: string;
}

const NO_SAVE =
  "save file not configured: set PKHEX_SAVE_PATH to your Platinum .sav copy and restart";

export function createApp(options: AppOptions): OpenAPIHono {
  const app = new OpenAPIHono();

  app.use("*", async (c, next) => {
    const host = c.req.header("host");
    const origin = c.req.header("origin");
    if (!hostAllowed(host) || !originAllowed(origin)) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  });

  // Save-file overview backing the Inspector and any REST client.
  app.get("/save/summary", async (c) => {
    if (!options.savePath) return c.json({ error: NO_SAVE }, 503);
    try {
      const reader = SaveFileReader.fromBytes(
        await Deno.readFile(options.savePath),
      );
      return c.json({
        trainerCard: getTrainerCard(reader),
        badges: getBadges(reader),
        dex: getDexSummary(reader),
        partyAudit: getPartyAudit(reader),
        bag: getBag(reader),
      });
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  // Inspector UI (ticket #17) -- text imports survive `deno desktop` compile.
  app.get("/", (c) => c.html(indexHtml));
  app.get("/ui.js", (c) => {
    c.header("content-type", "text/javascript; charset=utf-8");
    return c.body(uiJs);
  });
  app.get("/styles.css", (c) => {
    c.header("content-type", "text/css; charset=utf-8");
    return c.body(stylesCss);
  });

  // Interactive API explorer (MCP tool schemas live in resources/list).
  app.get(
    "/doc",
    (c) =>
      c.json({
        openapi: "3.1.0",
        info: { title: "pkhex-mcp", version: "0.2.0" },
        paths: {},
      }),
  );
  app.get(
    "/swagger",
    swaggerUI({ url: "/doc", title: "pkhex-mcp API" }),
  );

  mountMcpHttp(app, { savePath: options.savePath });

  return app;
}
