import { StreamableHTTPTransport } from "@hono/mcp";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createMcpServer } from "../mcp/server.ts";

/**
 * Mount the Streamable HTTP transport at /mcp.
 * Stateless: no session ids are issued, so any client can initialize at any
 * time -- a restarted chat app or a second tab must never need a server
 * restart. This is safe because every tool reads the shared GameStateStore;
 * there is no per-session state on this local, single-user surface.
 */
export function mountMcpHttp(
  app: OpenAPIHono,
  options: { savePath?: string } = {},
): void {
  const server = createMcpServer(options);
  const transport = new StreamableHTTPTransport();
  const ready = server.connect(transport);
  app.all("/mcp", async (c) => {
    await ready;
    return transport.handleRequest(c);
  });
}
