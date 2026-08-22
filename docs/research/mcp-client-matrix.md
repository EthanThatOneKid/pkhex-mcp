# pkhex-mcp — MCP Client Compatibility Matrix & Localhost Posture Research

**Researched:** August 21, 2026 (live web sources; dates verified where stated)
**Target stack:** Deno desktop app, Hono `StreamableHTTPTransport` at `http://127.0.0.1:<port>/mcp`, plus official `@modelcontextprotocol/sdk` `StdioServerTransport` mode. Loopback-only bind, Host/Origin validation, no auth tokens.

---

## Compatibility matrix

| Client | Streamable HTTP | Legacy SSE | stdio | Proxy needed | Notes |
|---|---|---|---|---|---|
| **OpenWebUI** | ✅ Native since v0.6.31 (`MCP (Streamable HTTP)` server type) | ❌ Not native | ❌ Not native | ✅ `mcpo` required for stdio/SSE servers | Admin-only config via UI form (Admin Settings → Integrations). No custom HTTP headers natively (as of Apr 2026). Auth choices: None / Bearer / OAuth 2.1. ⚠️ OWUI's MCP client runs inside the Open WebUI container/host process — if OWUI runs in Docker, `localhost` ≠ user's machine; use `host.docker.internal:<port>` and allowlist that Host value. |
| **OpenCode (SST)** | ✅ `type: "remote"` — auto-negotiates Streamable HTTP vs SSE | ✅ Same entry, negotiated | ✅ `type: "local"`, `command` array | ❌ | Key is `mcp` (singular), NOT `mcpServers`. Config: project-root `opencode.json(c)` or global `~/.config/opencode/opencode.json`. Older versions showed confusing SSE errors (405) against streamable-only endpoints; current builds probe both. |
| **Claude Desktop** | ⚠️ Partial/unclear — see notes | ❌ | ✅ Primary supported path | ✅ `npx mcp-remote http://127.0.0.1:<port>/mcp` is the reliable bridge | `claude_desktop_config.json`: `%APPDATA%\Claude\claude_desktop_config.json` (Win), `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS). Custom Connectors are cloud-egress only (reached from Anthropic's servers) and the URL form rejects non-HTTPS → **loopback servers cannot use Connectors at all**. Native `"type":"http","url"` entries in the config file have conflicting reports (v0.9+ claimed; Mar 2026 bug #37286 reported silent `mcpServers` deletion on startup when `url` used — closed invalid). Treat stdio / mcp-remote as the dependable paths. |
| **Claude Code** | ✅ First-class (`--transport http`; `"type":"http"`) | ✅ Deprecated (`--transport sse`) | ✅ `claude mcp add <name> -- cmd args` | ❌ | `.mcp.json` (project scope, committed), `~/.claude.json` (local/user scope). `streamable-http` accepted as alias of `http`. A `url` entry **without** `type` is a config error (read as stdio → skipped). Community-verified working against plain `http://127.0.0.1:<port>/mcp`. |
| **VS Code / GitHub Copilot** | ✅ `{"type":"http","url"}` — tries Streamable HTTP first | ✅ Automatic fallback to SSE | ✅ `{"type":"stdio","command","args"}` | ❌ | Top-level key is **`servers`**, not `mcpServers`. Files: workspace `.vscode/mcp.json`, user-profile `mcp.json`, or `~/.copilot/mcp-config.json`. Bonus: supports `unix:///...sock` and Windows `pipe:///...` named-pipe endpoints. Plain `http://localhost:<port>` works. |
| **Cursor** | ✅ (added late 2025; auto-detected) | ✅ Legacy | ✅ | ❌ | `~/.cursor/mcp.json` (global) / `.cursor/mcp.json` (project); key `mcpServers`; remote entries just need `url` (no transport field). Skips OAuth discovery when an `Authorization` header is configured. |
| **Gemini CLI** | ✅ `httpUrl` field | ✅ `url` field (SSE) | ✅ `command` field | ❌ | `~/.gemini/settings.json` (user) / `.gemini/settings.json` (project); key `mcpServers`. Wrong key for wrong transport fails to connect silently-ish (`url` vs `httpUrl` not interchangeable). Also `gemini mcp add -t http <name> <url>`. Note: free tier moved to Antigravity June 2026; OSS CLI continues with paid API key/enterprise license. |
| **Codex CLI (OpenAI)** | ✅ | ✅ | ✅ | ❌ | Worth a row but secondary audience; supports Streamable HTTP + OAuth. |
| **ChatGPT (web/desktop)** | Remote MCP only | — | ❌ no stdio | Cloud egress | Like Claude connectors, reached from OpenAI's cloud → loopback unreachable. Out of scope for pkhex-mcp. |

---

## Config snippets per client

All snippets target `http://127.0.0.1:8787/mcp` — replace `8787` with pkhex-mcp's actual advertised port. Stdio variants assume pkhex-mcp ships an executable/binary named `pkhex-mcp` on PATH (adjust to real launch command, e.g. `["deno", "run", "-A", "..."]`).

### OpenWebUI (no JSON — UI form only)

> Do **not** paste JSON anywhere here; per official docs the integrations form is field-based and MCP-style JSON crashes it.

```
Path:    ⚙️ Admin Settings → Integrations → ➕ Add Server
Type:        MCP (Streamable HTTP)
Server URL:  http://host.docker.internal:8787/mcp   ← Docker installs
             http://127.0.0.1:8787/mcp             ← native/bare-metal install
Auth:        None
```

Requires **Open WebUI ≥ v0.6.31** and admin rights (regular users' "Direct Tool Servers" integration is OpenAPI-only). After saving: enable the tools per-model (Function Calling = *Native* recommended) and toggle them in chat's Tools menu.

### OpenCode (SST)

Project root `opencode.json` (or `~/.config/opencode/opencode.json` for global):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "pkhex": {
      "type": "remote",
      "url": "http://127.0.0.1:8787/mcp",
      "enabled": true
    },
    "pkhex-local": {
      "type": "local",
      "command": ["pkhex-mcp", "--stdio"],
      "enabled": true,
      "timeout": 15000
    }
  }
}
```

Notes: key is `mcp`; local option names are `command` (array), `environment`, `cwd`, `enabled`, `timeout` (ms). Remote supports `headers` and `oauth` if ever needed.

### Claude Desktop

Reliable default (stdio bridge over loopback HTTP):

```json
{
  "mcpServers": {
    "pkhex": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:8787/mcp"]
    }
  }
}
```

File locations: `%APPDATA%\Claude\claude_desktop_config.json` (Windows), `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS). Restart Desktop fully after editing (tray icon → Exit).

Experimental direct-HTTP variant (test before shipping docs; behavior has regressed between versions):

```json
{
  "mcpServers": {
    "pkhex": {
      "type": "http",
      "url": "http://127.0.0.1:8787/mcp"
    }
  }
}
```

⚠️ Back up `claude_desktop_config.json` first: GitHub issue anthropics/claude-code#37286 (Mar 2026) documented Desktop silently deleting the whole `mcpServers` block on startup when a `url`-only entry was present. If tools don't appear after restart, check whether your config was rewritten and fall back to the `mcp-remote` snippet.

Do **not** document the "Add custom connector" route for pkhex-mcp — connector traffic originates from Anthropic's cloud and the form enforces HTTPS-only public URLs, so a loopback server is unreachable by design.

### Claude Code

```bash
# Streamable HTTP (recommended)
claude mcp add --transport http pkhex http://127.0.0.1:8787/mcp

# stdio mode
claude mcp add --transport stdio pkhex -- pkhex-mcp --stdio

# Project-shared .mcp.json equivalent:
```

```json
{
  "mcpServers": {
    "pkhex": {
      "type": "http",
      "url": "http://127.0.0.1:8787/mcp"
    }
  }
}
```

Scopes: default writes to `~/.claude.json` under the current project (local scope); `--scope user` for all projects; `--scope project` writes `.mcp.json` (requires interactive approval on first use). Verify with `claude mcp list` / `/mcp`.

### VS Code / GitHub Copilot

Workspace `.vscode/mcp.json` (or user-profile `mcp.json` / `~/.copilot/mcp-config.json`):

```json
{
  "servers": {
    "pkhex": {
      "type": "http",
      "url": "http://127.0.0.1:8787/mcp"
    },
    "pkhex-local": {
      "type": "stdio",
      "command": "pkhex-mcp",
      "args": ["--stdio"]
    }
  }
}
```

Top-level key is `servers` — using `mcpServers` makes VS Code ignore everything silently. Requires VS Code ≥ 1.99 and Copilot agent mode for tool invocation. Check Output panel → "MCP" channel for logs.

### Cursor

`%USERPROFILE%\.cursor\mcp.json` (global) or `<project>\.cursor\mcp.json`:

```json
{
  "mcpServers": {
    "pkhex": {
      "url": "http://127.0.0.1:8787/mcp"
    },
    "pkhex-local": {
      "command": "pkhex-mcp",
      "args": ["--stdio"]
    }
  }
}
```

Remote entries take a bare `url` (transport auto-negotiated; do not invent a `"transport": "http"` field). Reload via Settings → Tools & MCP.

### Gemini CLI

`~/.gemini/settings.json` (user) or `.gemini/settings.json` (project):

```json
{
  "mcpServers": {
    "pkhex": {
      "httpUrl": "http://127.0.0.1:8787/mcp",
      "timeout": 10000
    },
    "pkhex-local": {
      "command": "pkhex-mcp",
      "args": ["--stdio"],
      "trust": true
    }
  }
}
```

`httpUrl` = Streamable HTTP; `url` = legacy SSE; `command` = stdio. Mixing them up fails connection. Verify with `/mcp`.

---

## Localhost gotchas

Each of these maps to a concrete risk for a loopback-bound Hono + `@hono/mcp` server with Host/Origin validation:

1. **Spec mandates Origin checking — but pass absent Origins.** MCP transports spec (rev 2025-11-25): servers MUST validate `Origin` on all incoming connections and MUST return 403 when present-and-invalid; browsers attach `Origin` on cross-origin requests, while non-browser clients (Claude Code, Cursor, Gemini CLI, OpenCode, mcp-remote) send **no Origin header at all**. Implementation rule for pkhex-mcp: reject only `Origin` present ∧ hostname ∉ {`localhost`, `127.0.0.1`, `[::1]`} (port-agnostic compare). Rejecting missing Origin breaks every mainstream client.

2. **Host validation must be loopback-spelling-complete and port-tolerant.** DNS-rebinding protection (CVE-2025-66414 TS SDK / CVE-2025-66416 Python SDK; fixed TS ≥ 1.24.0, Py ≥ 1.23.0) validates the `Host` header against `allowedHosts`. Clients will send any of `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>` — and OpenWebUI-in-Docker sends `host.docker.internal:<port>`. The Python SDK pattern allows exact matches plus `host:*` wildcard-port patterns; mirror that. A strict single-entry allowlist (e.g., only `127.0.0.1:8787`) produces confusing 421/403 failures users can't self-diagnose.

3. **Accept-header requirement.** Clients MUST POST with `Accept: application/json, text/event-stream`. Fine for `@hono/mcp`, but any user-added CORS/body middleware must not rewrite or narrow that header. Likewise never strip `MCP-Protocol-Version` and `Mcp-Session-Id` request headers (tunnels/proxies are the usual culprit).

4. **GET `/mcp` → 405 is legal and expected** for servers that don't maintain standalone SSE streams; verified working with Claude Code. Don't "fix" 405s by opening unbounded GET streams — but be aware older OpenCode builds probed GET-SSE first and surfaced scary `SSE error: Non-200 status code (405)` messages while still connecting fine afterward (cosmetic; fixed in current releases).

5. **No trailing-slash redirects on the endpoint.** A `POST /mcp` → 301/302 → `/mcp/` redirect can drop the `Mcp-Session-Id` header mid-session and break stateful transports. Serve exactly the configured path.

6. **POST Content-Type must stay `application/json`** — SDK-side validation returns 400 otherwise. Hono's body parser shouldn't interfere, but watch for future middleware.

7. **Windows dual-stack trap.** Some resolvers try `::1` for `localhost` first; if pkhex-mcp binds IPv4 `127.0.0.1` only, a client pointed at `http://localhost:8787` gets connection-refused. Mitigations: advertise literal `127.0.0.1` URLs in docs/UI, and/or bind dual-stack (Deno `serve({ hostname: "::", ... })` with IPv6 mapped-v4 enabled) while keeping firewall posture loopback-only. (Recommendation derived from general platform behavior; verify on Win11 24H2.)

8. **Port assumptions: none hard-coded, except mcp-remote's OAuth callback (default 3334)** — irrelevant for our no-auth posture since mcp-remote only opens the callback listener during OAuth flows. All surveyed clients accept arbitrary ports in the pasted URL.

9. **Claude-family cloud egress is a dead end for loopback.** Both claude.ai and Claude Desktop *custom connectors* fetch the MCP URL from Anthropic's infrastructure (explicitly documented across all Claude clients), so `127.0.0.1` is unreachable there regardless of TLS. Any pkhex-mcp docs must steer Claude users exclusively toward `claude_desktop_config.json` stdio/mcp-remote entries or Claude Code CLI config.

10. **Config-file fragility (Claude Desktop).** Beyond #37286 above: Desktop rewrites its config on startup and strips unrecognized keys. Ship instructions telling users to quit fully (system-tray Exit on Windows) before editing, and to keep a backup copy.

11. **OpenWebUI container boundary.** Repeated because it's the most likely real-world support ticket: OWUI's MCP client executes inside the Open WebUI server (often Docker), so "localhost" resolves to the container. Document `host.docker.internal` (Docker Desktop) or `--network host` alternatives, and make sure the Host allowlist tolerates those spellings — this slightly widens the trusted-Host surface, which is acceptable because OWUI still connects from the same machine, but note it in docs.

12. **Stateless friendliness.** Several clients (and all cloud-egress ones) behave best with stateless/streamable responses; `@hono/mcp` handles session IDs internally — just ensure Hono isn't behind a cookie/session middleware that mutates response headers on `/mcp`.

---

## Citations

1. Open WebUI official MCP docs (native support, v0.6.31+, Streamable HTTP only, admin gating): https://docs.openwebui.com/features/extensibility/mcp
2. Open WebUI mcpo proxy docs (bridge for stdio/SSE): https://docs.openwebui.com/features/extensibility/plugin/tools/openapi-servers/mcp
3. Agentcy OpenWebUI integration guide (field labels, auth dropdown values, "pasting JSON crashes UI", verified Apr 9 2026): https://www.goagentcy.com/integrations/open-webui
4. Apigene — MCP Streamable HTTP client landscape (OpenWebUI v0.6.31+, no native custom headers; Cursor late-2025; client comparison table): https://apigene.ai/blog/mcp-streamable-http
5. OpenCode official MCP server docs (`mcp` key, local/remote shapes, options tables): https://opencode.ai/docs/mcp-servers
6. OpenCode issue #8058 — maintainer confirms remote type negotiates SSE *and* HTTP-streamable automatically (Jan 13 2026 comment by rekram1-node): https://github.com/anomalyco/opencode/issues/8058
7. Zenn — configuring MCP in OpenCode (`mcp` vs `mcpServers`, `$schema`, `type`, `enabled`): https://zenn.dev/ritaneco/articles/372e734864ade5?locale=en
8. Claude Code bug #37286 — Claude Desktop destroys `claude_desktop_config.json` on `url`-only entries; includes working `settings.json` `"type":"http"` example against `http://127.0.0.1:7677/mcp` and mcp-remote workaround: https://github.com/anthropics/claude-code/issues/37286
9. Claude Code bug #32708 — `streamable-http` type ignored (must be `http`); GET→405 acceptable; loopback daemon context: https://github.com/anthropics/claude-code/issues/32708
10. Flowstep docs — "Native HTTP (Claude Desktop v0.9+)" `{"type":"http","url":…}` claim: https://docs.flowstep.ai/mcp/clients/claude-desktop
11. Claude Directory example — third-party guide showing `"type":"streamable-http","url"` accepted by multiple clients incl. Claude Desktop: https://www.claudedirectory.org/mcp-servers/acedatacloud-seedreammcp
12. Anthropic support — custom connectors reached from Anthropic's cloud, public-internet requirement: https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
13. anthropics/claude-ai-mcp issues #9 & #56 — connector form rejects `http://` even on localhost; HTTPS-only validation: https://github.com/anthropics/claude-ai-mcp/issues/9 , https://github.com/anthropics/claude-ai-mcp/issues/56
14. Claude.ai docs — custom connectors (Remote vs Local command, transport choice SSE/Streamable HTTP): https://claude.com/docs/claude-science/custom-connectors
15. LocalCan guide — three walls for localhost→Claude (cloud egress, HTTPS-only form, trusted certs); curl smoke-test with dual `Accept` header: https://www.localcan.com/blog/test-local-mcp-server-in-claude-ai
16. sunpeak debugging guide — required headers (`Accept`, `MCP-Protocol-Version`, `Mcp-Session-Id`), trailing-slash redirect hazard, tunnel gotchas: https://sunpeak.ai/blogs/debugging-claude-connectors/
17. Claude Code official MCP reference — `claude mcp add --transport http`, scopes, `.mcp.json` shape, `streamable-http` alias, url-without-type error: https://code.claude.com/docs/en/mcp
18. MCP specification rev 2025-11-25, Transports — Origin MUST-validate/403 rule, bind-to-localhost SHOULD, dual Accept header MUST: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
19. vulnerablemcp.info — CVE-2025-66414 / CVE-2025-66416 (SDK DNS-rebinding fixes: TS ≥ 1.24.0, Py ≥ 1.23.0): https://vulnerablemcp.info/vuln/cve-2025-66414-66416-dns-rebinding-mcp-sdks.html
20. MCP Python SDK `TransportSecuritySettings` / middleware source (421 on bad Host, 403 on bad Origin, `host:*` port patterns, absent-Origin pass-through): https://py.sdk.modelcontextprotocol.io/v2/api/mcp/server/transport_security
21. MCP TypeScript SDK origin-validation middleware docs (`originValidation(['localhost','127.0.0.1','[::1]'])`, port-agnostic, absent-Origin passes): https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/express/middleware/originValidation.html
22. brave/brave-search-mcp-server PR #314 — worked example of enabling `enableDnsRebindingProtection` + loopback default bind, before/after Host-spoof repro: https://github.com/brave/brave-search-mcp-server/pull/314
23. Bindfort research — localhost MCP servers still need Host/Origin validation (threat model, good-default checklist): https://bindfort.com/research/localhost-mcp-servers-need-host-origin-validation
24. VS Code official MCP docs — `servers` key, `type:http`/`sse`, streamable-first-with-SSE-fallback, unix/pipe endpoints: https://code.visualstudio.com/docs/agent-customization/mcp-servers and reference https://code.visualstudio.com/docs/agents/reference/mcp-configuration
25. Gemini CLI official docs — `command`/`url`/`httpUrl` tri-field design, headers, timeouts: https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html ; policylayer config reference incl. `gemini mcp add -t http`: https://policylayer.com/integrations/gemini-cli ; Tembo 2026 overview (Antigravity tier change June 2026): https://www.tembo.io/blog/gemini-cli-mcp
26. Cursor configuration guides — `mcpServers` + bare `url` remote entries, global/project files, Authorization-header short-circuit: https://www.truefoundry.com/blog/mcp-servers-in-cursor-setup-configuration-and-security-guide , https://www.mcpforge.tech/blog/cursor-mcp-json , Cursor forum thread on streamable HTTP config attempts: https://forum.cursor.com/t/connect-streamable-http-on-cursor-mcp/111252
27. mcp-rubber-duck issue #57 — cross-client transport support snapshot (Codex/ChatGPT rows): https://github.com/nesquikm/mcp-rubber-duck/issues/57
28. Threat-Modeling writeup — CVE-2026-11624 (pre-0.25 MCP servers lacking Origin validation; defense-in-depth guidance): https://threat-modeling.com/cve-2026-11624-mcp-dns-rebinding/
