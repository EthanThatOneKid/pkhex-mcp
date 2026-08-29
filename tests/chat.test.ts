import { assertEquals, assertStringIncludes } from "@std/assert";
import { createApp } from "@/src/app.ts";

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

// --- SSE + client config override tests ------------------------------------

Deno.test("POST /chat/stream accepts client config override (no env key)", async () => {
  const res = await createApp({}).request("/chat/stream", {
    method: "POST",
    headers: { ...HOST, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Hello" }],
      config: { apiKey: "sk-client-key", model: "gpt-4o" },
    }),
  });
  // Should NOT be 501 — the client key should be used
  // It will fail at the provider level (fake key), returning 500
  assertEquals(res.status !== 501, true);
});

Deno.test("POST /chat/stream still returns 501 when neither env nor client provides key", async () => {
  const res = await createApp({}).request("/chat/stream", {
    method: "POST",
    headers: { ...HOST, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Hello" }],
    }),
  });
  assertEquals(res.status, 501);
});

// --- Client config override tests ------------------------------------------

Deno.test("POST /chat accepts client config override (no env key)", async () => {
  // No PKHEX_LLM_API_KEY set, but client supplies one via config
  const res = await createApp({}).request("/chat", {
    method: "POST",
    headers: { ...HOST, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Hello" }],
      config: { apiKey: "sk-client-key", model: "gpt-4o" },
    }),
  });
  // Should NOT be 501 — the client key should be used
  // It will fail at the provider level (fake key), returning 500
  assertEquals(res.status !== 501, true);
});

Deno.test("POST /chat still returns 501 when neither env nor client provides key", async () => {
  const res = await createApp({}).request("/chat", {
    method: "POST",
    headers: { ...HOST, "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Hello" }],
    }),
  });
  assertEquals(res.status, 501);
});

Deno.test("POST /chat client config overrides env config", async () => {
  Deno.env.set("PKHEX_LLM_API_KEY", "sk-env-key");
  try {
    const res = await createApp({}).request("/chat", {
      method: "POST",
      headers: { ...HOST, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        config: { model: "custom-model-override" },
      }),
    });
    // Should not be 501 or 400 — client config overrides work
    // It will fail at the provider level (fake env key), returning 500
    assertEquals(res.status === 500 || res.status === 200, true);
  } finally {
    Deno.env.delete("PKHEX_LLM_API_KEY");
  }
});
