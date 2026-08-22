import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { GameStateSchema, SyncPayloadSchema } from "./gen4/schemas.ts";
import type { GameState } from "./gen4/schemas.ts";
import { GameStateStore } from "./state/game-state.ts";

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

const errorSchema = z.object({ error: z.string() });

const postSyncRoute = createRoute({
  method: "post",
  path: "/sync",
  tags: ["sync"],
  summary: "Record a Snapshot pushed by the Bridge script (a Sync)",
  request: {
    body: {
      content: { "application/json": { schema: SyncPayloadSchema } },
      description:
        "Canonical SyncPayload JSON. The Bridge script sends this string as one form field.",
      required: true,
    },
  },
  responses: {
    204: { description: "Snapshot accepted (full-replace)" },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Malformed SyncPayload",
    },
  },
});

const getStateRoute = createRoute({
  method: "get",
  path: "/state",
  tags: ["state"],
  summary: "Current GameState snapshot",
  responses: {
    200: {
      content: { "application/json": { schema: GameStateSchema } },
      description: "Newest Snapshot decoded into GameState",
    },
    503: {
      content: { "application/json": { schema: errorSchema } },
      description: "No Sync received yet this process lifetime",
    },
  },
});

export interface AppOptions {
  store: GameStateStore;
}

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

  app.openapi(postSyncRoute, (c) => {
    options.store.recordSync(c.req.valid("json"));
    return c.body(null, 204);
  });

  app.openapi(getStateRoute, (c) => {
    const snapshot = options.store.getGameState();
    if (snapshot === null) {
      return c.json({ error: "no Sync received yet" }, 503);
    }
    return c.json(snapshot satisfies GameState, 200);
  });

  app.doc31("/doc", {
    openapi: "3.1.0",
    info: {
      title: "pkhex-mcp",
      version: "0.1.0",
      description: "Live Pokémon Platinum state over HTTP and MCP.",
    },
  });
  app.get("/swagger", swaggerUI({ url: "/doc" }));

  return app;
}
