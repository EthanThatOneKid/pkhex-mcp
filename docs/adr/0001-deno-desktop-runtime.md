# Architecture Decision Record (ADR): Pokémon Gen IV Live State MCP Desktop Application

* **Status:** Accepted
* **Date:** 2026-08-21
* **Deciders:** Engineering Team

---

## 1. Context and Problem Statement

To enable AI chat clients (e.g., OpenWebUI, OpenCode, Claude Desktop) to contextually assist Pokémon Generation IV players in real-time, the system must parse live game memory/save files and expose structured data over the Model Context Protocol (MCP).

Distributing this pipeline to non-technical end users requires a self-contained, standalone desktop release artifact that combines:

* Live binary ingestion and Gen IV decoding logic.
* An MCP server interface (SSE and `stdio`).
* OpenAPI / Swagger endpoints for debugging.
* An embedded local UI for status inspection and basic chat interaction.

---

## 2. Prior Art Analyzed

* **`MadeinTaly/pkhex-mcp`:** Demonstrates exposing PKHeX data models directly over MCP tools for LLM consumption.
* **`arleypadua/PKHeX.Everywhere`:** Demonstrates exposing Pokémon save/state manipulation APIs as web/HTTP microservices decoupled from the Windows-only PKHeX WinForms GUI.

---

## 3. Decision Drivers

* **Single Toolchain & Runtime:** Unify binary parsing, schema validation, HTTP routing, MCP middleware, and desktop distribution in a single language ecosystem (TypeScript).
* **Zero-Glue Desktop Packaging:** Ability to build a native desktop artifact without managing multi-process IPC bridges, port allocations, or native C++/Zig compilation toolchains.
* **Type Safety & Single Source of Truth:** Share Zod data contracts seamlessly between binary deserialization, REST/OpenAPI schemas, and MCP tool definitions.
* **Stateless Sub-50ms Latency:** Maintain an in-memory game state snapshot fed by emulator hooks.

---

## 4. Decision

We will use **Deno** as the runtime and adopt **`deno desktop`** as the unified packaging and distribution target.

### **Core Stack Components**

* **Runtime & Desktop Shell:** Deno 2.x with native `deno desktop` (embedded OS webview directly routing to `Deno.serve()` without port exposure).
* **Web Framework:** Hono.
* **API Documentation & Schema Validation:** `@hono/zod-openapi` and Zod.
* **Protocol Integration:** `@hono/mcp` (Server-Sent Events / SSE) and standard `stdio` transport.
* **Live Ingestion Layer:** melonDS Lua 5.1 RAM polling script posting to local ingest endpoints.

---

## 5. Architectural Topology

```
+-------------------------------------------------------------+
| melonDS (Gen IV ROM)                                        |
|   ↳ Lua 5.1 Script (RAM Hook @ 500ms intervals)            |
+------------------------------+------------------------------+
                               | HTTP POST (Local Ingest)
                               v
+-------------------------------------------------------------+
| Standalone Desktop Artifact (via `deno desktop`)            |
|                                                             |
|  +-------------------------------------------------------+  |
|  | Deno Core Engine                                      |  |
|  |  • Binary Checksum & Deserialization Pipeline         |  |
|  |  • In-Memory Game State Cache                         |  |
|  +---------------------------+---------------------------+  |
|                              |                              |
|  +---------------------------v---------------------------+  |
|  | Hono Application Layer (`Deno.serve`)                 |  |
|  |  • Ingest Route: `POST /sync`                         |  |
|  |  • REST / Swagger: `@hono/zod-openapi`                |  |
|  |  • MCP SSE Transport: `@hono/mcp`                     |  |
|  +---------------------------+---------------------------+  |
|                              |                              |
|  +---------------------------v---------------------------+  |
|  | Embedded OS Webview (Native UI)                       |  |
|  |  • Live Memory/Party Inspector & Embedded Chat Client |  |
|  +-------------------------------------------------------+  |
+------------------------------+------------------------------+
                               | MCP Transport (SSE / Stdio)
                               v
+-------------------------------------------------------------+
| External MCP Clients (OpenWebUI, OpenCode, Claude Desktop)  |
+-------------------------------------------------------------+

```

---

## 6. Consequences

### **Positive**

* **Trivial Desktop Distribution:** Non-technical users receive a single standalone executable or installer (`.dmg`, `.msi`, `.AppImage`) generated via `deno desktop --all-targets`.
* **Shared Schema Pipeline:** A single Zod definition validates binary parsing, produces interactive Swagger UI documentation, and defines MCP tool calling signatures.
* **No Dynamic Port Overhead:** `deno desktop` serves the UI directly via native webview integration with `Deno.serve()`, eliminating local port collisions.

### **Negative / Trade-offs**

* **Platform Webview Parity:** Rendering depends on the host OS webview engine (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux).
