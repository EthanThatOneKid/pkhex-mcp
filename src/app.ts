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
  // NOTE: body parsing is manual (handler below) -- @hono/zod-openapi's
  // built-in validator cannot express "urlencoded field containing JSON".
  // Canonical shape: application/json SyncPayload; the Bridge script sends
  // the same JSON as one application/x-www-form-urlencoded `snapshot` field.
  responses: {
    204: { description: "Snapshot accepted (full-replace)" },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description:
        "Malformed SyncPayload (bad JSON, schema mismatch, missing field)",
    },
  },
});

const integrityRoute = createRoute({
  method: "get",
  path: "/debug/sync-integrity",
  tags: ["debug"],
  summary: "Torn-read degradation counters (debug surface)",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            tornEvents: z.number().int().min(0),
            lastSyncTornSlots: z.array(z.number().int().min(1).max(6)),
          }),
        },
      },
      description: "Degradation counters; never part of MCP vocabulary",
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

  app.openapi(postSyncRoute, async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    let rawText: string;
    if (contentType.includes("application/x-www-form-urlencoded")) {
      let form: Record<string, unknown>;
      try {
        form = await c.req.parseBody();
      } catch {
        return c.json({ error: "malformed form encoding" }, 400);
      }
      const field = form["snapshot"];
      if (typeof field !== "string") {
        return c.json({ error: "missing snapshot field" }, 400);
      }
      rawText = field;
    } else {
      rawText = await c.req.text();
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(rawText);
    } catch {
      return c.json({ error: "snapshot is not valid JSON" }, 400);
    }
    const parsed = SyncPayloadSchema.safeParse(candidate);
    if (!parsed.success) {
      return c.json({ error: "malformed SyncPayload" }, 400);
    }

    options.store.recordSync(parsed.data);
    return c.body(null, 204);
  });

  app.openapi(integrityRoute, (c) => c.json(options.store.integrity(), 200));

  app.openapi(getStateRoute, (c) => {
    const snapshot = options.store.getGameState();
    if (snapshot === null) {
      return c.json({ error: "no Sync received yet" }, 503);
    }
    return c.json(snapshot satisfies GameState, 200);
  });

  // The /sync body contract is parsed manually (see NOTE above); surface it
  // in the OpenAPI document here so the debug UI stays truthful.
  app.use("/doc", async (c, next) => {
    await next();
    if (c.res.status === 200 && c.req.method === "GET") {
      const spec = await c.res.json();
      spec.paths["/sync"].post.requestBody = {
        required: true,
        description:
          "Canonical: application/json SyncPayload. The Bridge script sends the same JSON as one application/x-www-form-urlencoded field named 'snapshot'. Shape: see components.GameState slots/trainerMeta (SyncPayload is the wire-truth twin).",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/SyncPayload" } },
          "application/x-www-form-urlencoded": {
            schema: {
              type: "object",
              properties: {
                snapshot: { type: "string", description: "SyncPayload JSON string" },
              },
              required: ["snapshot"],
            },
          },
        },
      };
      c.res = c.newResponse(JSON.stringify(spec), 200, {
        "content-type": "application/json",
      });
    }
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
