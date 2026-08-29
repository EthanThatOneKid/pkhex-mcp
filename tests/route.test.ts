import { assertEquals, assertStringIncludes } from "@std/assert";
import { createApp } from "@/src/app.ts";

const HOST = { host: "127.0.0.1:8941" };

Deno.test("GET /save/summary answers 503 when PKHEX_SAVE_PATH is unset", async () => {
  const res = await createApp({}).request("/save/summary", {
    headers: { ...HOST },
  });
  assertEquals(res.status, 503);
  assertStringIncludes((await res.json()).error, "PKHEX_SAVE_PATH");
});

Deno.test("GET /doc serves the OpenAPI stub", async () => {
  const res = await createApp({}).request("/doc", { headers: { ...HOST } });
  assertEquals(res.status, 200);
  const doc = await res.json();
  assertEquals(doc.openapi, "3.1.0");
});

Deno.test("GET /swagger serves interactive docs", async () => {
  const res = await createApp({}).request("/swagger", { headers: { ...HOST } });
  assertEquals(res.status, 200);
  assertStringIncludes(await res.text(), "swagger");
});
