import { assertEquals } from "@std/assert";
import { resolveServeTarget } from "../src/serve-target.ts";

Deno.test("desktop runtime address wins and parses the injected port", () => {
  const target = resolveServeTarget({
    DENO_SERVE_ADDRESS: "tcp:127.0.0.1:49580",
    PKHEX_PORT: "1234",
  });
  assertEquals(target.desktop, true);
  assertEquals(target.hostname, "127.0.0.1");
  assertEquals(target.port, 49580);
});

Deno.test("dev mode defaults to loopback 8941", () => {
  const target = resolveServeTarget({});
  assertEquals(target.desktop, false);
  assertEquals(target.hostname, "127.0.0.1");
  assertEquals(target.port, 8941);
});

Deno.test("PKHEX_PORT overrides the dev default", () => {
  const target = resolveServeTarget({ PKHEX_PORT: "9000" });
  assertEquals(target.desktop, false);
  assertEquals(target.port, 9000);
});

Deno.test("malformed desktop address falls back safely", () => {
  const target = resolveServeTarget({ DENO_SERVE_ADDRESS: "garbage" });
  assertEquals(target.desktop, true);
  assertEquals(target.port, 8941);
});
