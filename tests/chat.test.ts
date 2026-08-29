import { assertEquals, assertStringIncludes } from "@std/assert";
import { createApp } from "../src/app.ts";

const HOST = { host: "127.0.0.1:8941" };

Deno.test("GET /chat/config returns enabled:false when PKHEX_LLM_API_KEY is unset", async () => {
  const res = await createApp({}).request("/chat/config", {
    headers: { ...HOST },
  });
  assertEquals(res.status, 200);
  const cfg = await res.json();
  assertEquals(cfg.enabled, false);
  assertEquals(typeof cfg.model, "string");
  assertEquals(typeof cfg.baseUrl, "string");
});

Deno.test("GET /chat/config never leaks the API key", async () => {
  Deno.env.set("PKHEX_LLM_API_KEY", "sk-test-secret-key-12345");
  try {
    const res = await createApp({}).request("/chat/config", {
      headers: { ...HOST },
    });
    assertEquals(res.status, 200);
    const body = await res.text();
    assertStringIncludes(body, "\"enabled\":true");
    // The key must NOT appear in the response body
    assertEquals(body.includes("sk-test-secret-key-12345"), false);
  } finally {
    Deno.env.delete("PKHEX_LLM_API_KEY");
  }
});

Deno.test("POST /chat returns 501 when chat is not configured", async () => {
  const res = await createApp({}).request("/chat", {
    method: "POST",
    headers: { ...HOST, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Hello" }],
    }),
  });
  assertEquals(res.status, 501);
  const data = await res.json();
  assertStringIncludes(data.error, "PKHEX_LLM_API_KEY");
});

Deno.test("POST /chat returns 400 for empty messages array", async () => {
  Deno.env.set("PKHEX_LLM_API_KEY", "sk-test");
  try {
    const res = await createApp({}).request("/chat", {
      method: "POST",
      headers: { ...HOST, "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    assertEquals(res.status, 400);
  } finally {
    Deno.env.delete("PKHEX_LLM_API_KEY");
  }
});

Deno.test("POST /chat returns 400 for missing messages", async () => {
  Deno.env.set("PKHEX_LLM_API_KEY", "sk-test");
  try {
    const res = await createApp({}).request("/chat", {
      method: "POST",
      headers: { ...HOST, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assertEquals(res.status, 400);
  } finally {
    Deno.env.delete("PKHEX_LLM_API_KEY");
  }
});

// --- POST /chat/stream (SSE) tests ----------------------------------------

Deno.test("POST /chat/stream returns 501 when chat is not configured", async () => {
  const res = await createApp({}).request("/chat/stream", {
    method: "POST",
    headers: { ...HOST, "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
  });
  assertEquals(res.status, 501);
});

Deno.test("POST /chat/stream returns 400 for empty messages", async () => {
  Deno.env.set("PKHEX_LLM_API_KEY", "sk-test");
  try {
    const res = await createApp({}).request("/chat/stream", {
      method: "POST",
      headers: { ...HOST, "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    assertEquals(res.status, 400);
  } finally {
    Deno.env.delete("PKHEX_LLM_API_KEY");
  }
});

Deno.test("POST /chat/stream returns SSE content-type", async () => {
  Deno.env.set("PKHEX_LLM_API_KEY", "sk-test-fake-key-that-will-fail-sse-stream");
  try {
    const res = await createApp({}).request("/chat/stream", {
      method: "POST",
      headers: { ...HOST, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
    });
    assertEquals(res.status, 200);
    const ct = res.headers.get("content-type");
    assertStringIncludes(ct ?? "", "text/event-stream");
    // The stream should contain at least one event (error from bad key)
    const body = await res.text();
    assertStringIncludes(body, "event: error");
  } finally {
    Deno.env.delete("PKHEX_LLM_API_KEY");
  }
});
