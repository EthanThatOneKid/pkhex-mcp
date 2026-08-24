import { assertEquals, assertStringIncludes } from "@std/assert";
import { createApp } from "../src/app.ts";

const HOST = { host: "127.0.0.1:8941" };

Deno.test("GET / serves the Inspector shell", async () => {
  const res = await createApp({}).request("/", { headers: { ...HOST } });
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/html");
  const html = await res.text();
  assertStringIncludes(html, "ui.js");
  assertStringIncludes(html, "styles.css");
});

Deno.test("GET /ui.js serves the save-file Inspector client", async () => {
  const res = await createApp({}).request("/ui.js", { headers: { ...HOST } });
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "javascript");
  const js = await res.text();
  assertStringIncludes(js, "/save/summary");
});

Deno.test("GET /styles.css serves the stylesheet", async () => {
  const res = await createApp({}).request("/styles.css", {
    headers: { ...HOST },
  });
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/css");
});
