import { createApp } from "./app.ts";
import { GameStateStore } from "./state/game-state.ts";

const store = new GameStateStore();
const app = createApp({ store });

const port = Number(Deno.env.get("PKHEX_PORT") ?? 8941);
Deno.serve({ hostname: "127.0.0.1", port }, app.fetch);
console.log(`pkhex-mcp listening on http://127.0.0.1:${port} (loopback only)`);
