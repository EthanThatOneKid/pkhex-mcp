import { StreamableHTTPTransport } from "@hono/mcp";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createMcpServer } from "../mcp/server.ts";
import type { GameStateStore } from "../state/game-state.ts";

/**
 * Mount the Streamable HTTP transport at /mcp.
 * One shared server+transport instance: this is a local, single-user surface.
 */
export function mountMcpHttp(app: OpenAPIHono, store: GameStateStore): void {
  const server = createMcpServer(store);
  const transport = new StreamableHTTPTransport({
    // Stateful sessions: clients pin via Mcp-Session-Id after initialize.
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  const ready = server.connect(transport);
  app.all("/mcp", async (c) => {
    await ready;
    return transport.handleRequest(c);
  });
}
