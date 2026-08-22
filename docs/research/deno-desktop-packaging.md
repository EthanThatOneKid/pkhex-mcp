# Research: `deno desktop` packaging & runtime facts for pkhex-mcp

Researched: 2026-08-21 (live web sources). Context: pkhex-mcp is a Hono app served via `Deno.serve()`, packaged as a standalone desktop app, exposing MCP over HTTP + stdio alongside the UI. Windows-primary dev, tri-OS cross-compiles planned.

**Version landscape:** `deno desktop` shipped **experimental** in Deno 2.9.0 (2026-06-25, PR #33441). Current stable: **v2.9.5** (2026-08-06). Patch cadence: 2.9.1 (Jul 1), 2.9.2 (Jul 8), 2.9.3 (Jul 15), 2.9.4 (Jul 23), 2.9.5 (Aug 6).

---

## deno.json desktop config reference

Source: <https://docs.deno.com/runtime/desktop/configuration/> (official, last updated 2026-06-30). All config lives in the `"desktop"` block of `deno.json`. Every field is optional; a project with no `desktop` block still compiles using defaults.

### Full schema (verified field names)

```jsonc
{
  "name": "pkhex-mcp",
  "version": "0.1.0",
  "exports": "./main.ts",
  "desktop": {
    "app": {
      "name": "PKHex MCP",                      // display name; falls back to root "name"
      "identifier": "com.ethanthatsomekid.pkhex-mcp", // reverse-DNS; default synthetic "com.deno.desktop.<app-slug>"
      "icons": {
        "macos": "./icons/app.icns",            // or array of { "path": "...", "size": 16|32|128|256|512 }
        "windows": "./icons/app.ico",
        "linux": "./icons/app.png"
      },
      "deepLinks": ["pkhex-mcp"]                // optional custom URL schemes (RFC 3986 grammar; reserved schemes rejected)
    },
    "backend": "webview",                       // "cef" | "webview" | "raw". Default: "webview"
    "output": {
      "macos": "./dist/PKHexMcp.app",           // ext decides format: .app | .dmg (dmg needs hdiutil/macOS host)
      "windows": "./dist/pkhex-mcp",            // directory+launcher | .msi
      "linux": "./dist/pkhex-mcp.AppImage"      // directory | .AppImage | .deb | .rpm
    },
    "macos": {
      "codesignIdentity": "Developer ID Application: ..." // "-" = ad-hoc (default behavior anyway)
    },
    "release": {
      "baseUrl": "https://releases.example.com/pkhex-mcp" // auto-update poll: <baseUrl>/latest.json
    },
    "errorReporting": {
      "url": "https://errors.example.com/report" // unset => "alert only" mode (native alert, no POST)
    }
  }
}
```

### Key corrections to our assumptions

1. **Default backend is `"webview"`, NOT `"cef"`** (PR #35442 "feat(desktop): default UI backend to webview"). The user-facing context that said "cef default" is wrong as shipped.
2. **The `--backend` CLI flag accepts only `cef` and `webview`.** The `"raw"` backend can be selected *only* through `desktop.backend` in `deno.json`.
3. **Window options (`width`/`height`/`title`/`resizable`/devTools) are NOT part of the `desktop` config block.** There is no per-window config in `deno.json`. Those are `Deno.BrowserWindow` **constructor options** (see Runtime integration notes below). The `desktop` block only carries app metadata, backend, outputs, signing, update, and error-reporting settings.

### Validation performed at build time

- `backend` must be one of the three values.
- Icon paths must resolve to existing files; `.icns`/`.ico` passed through unchanged; PNGs assembled into multi-resolution containers.
- Output paths must be writable.
- `release.baseUrl` must parse as a URL.
- `deepLinks` entries validated as non-reserved URL schemes; invalid scheme fails the build.
- Windows deep-link quirk: no in-bundle registration — the bundler drops `register-deep-links.bat` next to the launcher writing `HKCU\Software\Classes\<scheme>`; an installer or the user runs it once. URL delivery to running code ("open-url" event) is **not yet implemented** (tracked in #35465).

### Related config notes

- Compiled binary runs with CWD = user's cwd, not the binary's dir. Use `import.meta` resolution; framework build outputs are embedded into a virtual filesystem and self-extracted at runtime.
- `deno check --desktop` exists since 2.9.1 (#35644) to type-check against the desktop API surface.
- Config discovery for `deno desktop .` in the project dir fixed post-2.9.0 (#35660); `desktop.backend` from deno.json was initially ignored and fixed in #35815 (landed in a 2.9.x patch) — pin ≥ 2.9.2 to be safe.

---

## Command reference (dev/build/targets/compress)

### Development

```sh
deno desktop main.ts          # run host-platform app (compiles then launches)
deno desktop .                # framework autodetect (Next.js, Astro, Fresh, Remix, Nuxt,
                              # SvelteKit, SolidStart, TanStack Start, Vite SSR, React Router)
deno desktop --hmr main.ts    # hot module replacement (dev only)
deno desktop --hmr .          # HMR in a framework project
deno desktop --inspect main.ts          # unified debugger, default 127.0.0.1:9229
deno desktop --inspect-wait / --inspect-brk
```

- **HMR modes** (auto-selected): detected framework → the framework's own dev server drives the webview; plain `Deno.serve()` script → file watcher + V8 `Debugger.setScriptSource` hot-swap (listener stays bound; module-level state preserved; new imports require restart).
- HMR limitations: static asset changes not detected (#35494 open); icon sets unsupported in HMR mode; `console.log` silently dropped on Windows under `--hmr` (#36501 open); do not ship binaries built with `--hmr`.
- Permission/runtime flags mirror `deno run`; permissions are **baked into the compiled binary** (`deno desktop -A ...` typical).

### Compile / distribute

```sh
# Host platform build (format follows --output extension)
deno desktop --output ./dist/PKHexMcp.msi main.ts

# Cross-compile single target
deno desktop --target x86_64-pc-windows-msvc main.ts

# All five supported targets at once
deno desktop --all-targets main.ts

# Self-extracting compressed bundle
deno desktop --compress main.ts           # default codec
deno desktop --compress=xz main.ts        # smallest artifact
deno desktop --compress=zstd main.ts      # faster first-launch decompress
```

### Valid `--target` triples (exactly five, same as `deno compile`)

| Triple | OS | Arch |
| --- | --- | --- |
| `x86_64-pc-windows-msvc` | Windows | x86_64 |
| `aarch64-apple-darwin` | macOS | arm64 |
| `x86_64-apple-darwin` | macOS | Intel |
| `x86_64-unknown-linux-gnu` | Linux | x86_64 |
| `aarch64-unknown-linux-gnu` | Linux | arm64 |

**No Windows ARM64 desktop target** in official docs. Note: plain `deno compile` gained `aarch64-pc-windows-msvc` in 2.9.3 (#36004), but the desktop docs' supported-triples table still lists only Windows x64 — treat desktop-on-Windows-ARM as unsupported.

### How installers relate to compiled binaries

`deno desktop` **emits installers itself** based on the `--output` extension — no external wrapper tooling needed:

| Extension (platform) | Output | Notes |
| --- | --- | --- |
| none/dir (Win) | App directory: `<App>.bat` launcher (pre-#35709) → post-#35709 `<App>.exe` + `<App>.dll` layout, plus backend DLLs, `resources.pak`, `locales/` | zip it yourself or feed to Inno Setup/NSIS/WiX |
| `.msi` (Win) | Windows Installer package, per-machine install under `%ProgramFiles%\<AppName>`, registers uninstaller. **Authored in pure Rust → cross-compiles from any host** (#35378) | sign externally (signtool) |
| `.app` (macOS) | Bundle with Info.plist, launcher, icons, Frameworks/ | ad-hoc signed by default |
| `.dmg` (macOS) | Built via `hdiutil` — **only on a macOS host** | everything else cross-compiles fine |
| `.AppImage` (Linux) | SquashFS + Type-2 runtime, zstd (#35506); any host | most portable Linux option |
| `.deb` / `.rpm` (Linux) | Pure Rust, cross-compiles from any host (#35296); installs `/usr/lib/<pkg>` + `/usr/bin` symlink + `.desktop` entry | metadata bug: version/author/license fall back to 1.0.0/unknown/MIT (#36503 open) |

Output-path priority: `--output` flag > `desktop.output` in deno.json > project-name default.

### `--compress` behavior and caveats

- Ships runtime + rendering backend compressed inside the distributed app; unpacked to a **per-user data directory on first launch**, reused afterward.
- Size: webview hello-world ≈ **66 MB → 19 MB**.
- Costs a one-time first-launch decompression delay. `xz` smaller; `zstd` faster.
- Interaction with the self-extracting virtual filesystem: framework assets already extract on first run regardless of `--compress`.

### Other flags

- `--icon <file>` (.ico Windows / .icns/.png macOS), `--include` / `--exclude` (+ `--exclude-unused-npm` wired through in 2.9.2), `--engine v8|quickjs` (QuickJS experimental, smaller, weaker security-update cadence).
- Cross-compilation mechanics: downloads SHA-256–verified prebuilt `denort` + backend archive matching your Deno version; cached under `<deno_dir>/`. No Rust toolchain involved anywhere except none — MSI/deb/rpm/AppImage all assembled in-process.

---

## Runtime integration notes

### `DENO_SERVE_ADDRESS` auto-binding semantics (source: docs.deno.com/runtime/desktop/serving/)

1. At startup the runtime picks an unused local port and sets `DENO_SERVE_ADDRESS=tcp:127.0.0.1:<port>` (set by Deno itself, not the user).
2. `Deno.serve(...)` reads it and binds there, **ignoring whatever port you pass** — you cannot override the port in desktop mode (intentional; the webview navigates to the runtime's address).
3. Webview navigates to `http://127.0.0.1:<port>` once the listener is ready.
4. Address is **always** loopback (`127.0.0.1` / `[::1]`); passing `0.0.0.0` is ignored. Never exposes beyond the machine — relevant because pkhex-mcp also wants LAN/HTTP MCP exposure; that part must stay outside `deno desktop` (run separately with `deno serve/run`) or be reconsidered.
5. Read it for building URLs: `Deno.env.get("DENO_SERVE_ADDRESS")!.split(":").pop()` → port string.
6. Default-export `{ fetch(req) }` form works too. Multiple windows all load from the same local server (different paths per window).

This matches pkhex-mcp perfectly for the UI + local MCP-over-HTTP: zero port wiring, but the HTTP listener is loopback-locked.

### `Deno.BrowserWindow` API surface (source: docs.deno.com/runtime/desktop/windows/)

Constructor `BrowserWindowOptions`:

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `title` | `string` | app name (was `laufey_webview`; fixed #35541) | |
| `width` | `number` | `800` | logical pixels |
| `height` | `number` | `600` | logical pixels |
| `x`, `y` | `number` | centered | initial position |
| `resizable` | `boolean` | `true` | |
| `alwaysOnTop` | `boolean` | `false` | |
| `frameless` | `boolean` | `false` | creation-only |
| `noActivate` | `boolean` | `false` | creation-only |
| `transparentTitlebar` | `boolean` | `false` | creation-only |

**There is no `devTools` constructor option** in the documented API (third-party posts showing `devTools:` in the constructor are inaccurate for the shipped surface). DevTools is runtime-controlled: `win.openDevtools()` or `--inspect*` flags.

Lifecycle/semantics:
- A window opens automatically on startup and is navigated to the local server; the **first** `new Deno.BrowserWindow()` *adopts* that window; later constructions open new windows.
- One shared async runtime per process regardless of window count.
- Methods: `show`, `hide`, `focus`, `close`, `reload`, `isClosed`, `isVisible`, `getSize`/`setSize`, `getPosition`/`setPosition`, `isResizable`/`setResizable`, `isAlwaysOnTop`/`setAlwaysOnTop`, `setTitle`, `navigate(url)` (any http/https/file/data URL), `executeJs(script)` (JSON-serializable result, rejects with thrown value), `bind(name, fn)` / `unbind(name)`, `getNativeWindow()` (WebGPU `UnsafeWindowSurface`), `openDevtools({ deno?, renderer? })`.
- Property `windowId` (stable numeric id).
- EventTarget events: `resize`, `move`, `focus`, `blur`, `close` (cancelable via `preventDefault()`), `keydown`, `keyup`, `mousemove`, `mouseenter`, `mouseleave`, `mousedown`, `mouseup`, `click`, `dblclick`, `wheel`, `menuclick`, `contextmenuclick` (resize/move/menu events carry `detail` payloads).
- Process exits when all windows closed AND no live async tasks; explicit `Deno.exit(0)` otherwise.
- Window geometry is NOT persisted across runs; save/restore yourself.

### Bindings RPC (source: docs.deno.com/runtime/desktop/bindings/)

- Register Deno-side: `win.bind("readSettings", async () => {...})`. Call webview-side via the injected global proxy: `await bindings.readSettings()`.
- Not IPC — in-process channels between runtime threads/backend; no preload script or contextBridge needed.
- Serialization: JSON semantics; plain objects/arrays/primitives/null pass; **`Uint8Array` supported**; `undefined`/optional props dropped; `Date`/`Map`/`Set`/`RegExp`/other typed arrays/**ArrayBuffer** not preserved; functions/DOM nodes/cycles not transferable; handler errors arrive as `{ name, message, stack }`.
- Per-window: bindings registered on winA aren't callable from winB. Fix #35654 attributes bind calls to the registering window id.
- Bindings inherit process permissions; webview cannot escalate. Desktop ops bypass Deno's permission system entirely (flagged upstream in #35269 §4).
- No built-in type bridge; write a shared `bindings.d.ts`.

### Native dialogs

Confirmed (source: docs.deno.com/runtime/desktop/dialogs/): **`prompt()`, `alert()`, `confirm()` become native modal dialogs** in a desktop app. Called from Deno-side code they render native popups (blocking the calling handler, not the renderer); called from webview JS, the webview's own native dialogs are used. Caveat: **no native file-picker API yet** — use `<input type="file">` or drag-drop + binding. Clipboard: use `navigator.clipboard` from the webview side. Notifications: standard Web `Notification` API from Deno-side code (needs a real `app.identifier` on macOS).

### DevTools story (source: docs.deno.com/runtime/desktop/devtools/)

- Unified CDP multiplexer fronts both V8 isolates (Deno runtime + renderer): `--inspect`, `--inspect-wait`, `--inspect-brk`, `--inspect=host:port`, `--inspect-renderer`. Attach via `chrome://inspect`.
- **Backend support matrix: `cef` = full unified DevTools; `webview` = NONE** ("system webviews speak a different inspector protocol"); `raw` = Deno-side `--inspect` only. With `--inspect` on webview you can still debug the Deno side like normal `deno run --inspect`.
- `win.openDevtools()` shows an in-app DevTools window (both isolates by default; filterable) — useful for debug builds.
- Known limits: Network panel doesn't show Deno-side fetch; no cross-realm step-through across the binding boundary; `--inspect-brk` pauses both isolates independently.

---

## Windows status & workarounds

### Issue #35645 — "desktop: windows webview fails to launch" — **OPEN (reopened)** as of 2026-08-21

Timeline reconstructed from the issue + comments:

| Date | Event |
| --- | --- |
| 2026-06-30 | Filed by @ondras. Deno 2.9.0, Windows 11, `webview` backend: stuck empty loading window; webview never commits initial navigation. Repro includes manual `new Deno.BrowserWindow()` + `win.bind` — so **manual BrowserWindow creation is NOT a workaround**. |
| 2026-07-01 | divybot diagnosis: same class of bug as #35576/#35590 — the `app://` custom scheme introduced by #35272 served correct bytes but WebView2 wouldn't render them as a document (never committed navigation to `app://desktop/`). Distinct from earlier crash #35562 (fixed by laufey v0.4.1 COM/STA thread fix). Fix pending: **#35670 = revert of #35272**, restoring TCP loopback + `http://127.0.0.1:PORT` navigation. |
| 2026-07-01/02 | #35670 landed on `main` (commit 25289debc). Issue closed; maintainer comment "Fixed in main". |
| 2026-07-07 | @FrancescoLuzzi reproduced again on canary `712895271fa`: `error: LAUFEY backend exited with status: exit code: 0xc0000409` (stack buffer overrun) with `--hmr`. |
| 2026-07-10 | @RickCogley confirmed broader repro: **default backend, no BrowserWindow, plain `Deno.serve()`** — server healthy (`Listening on http://127.0.0.1:49580/`) but auto-opened webview never renders → blank window → "not responding". Regression bisected between canaries: ✅ `796a222842f0` (Jul 1) → ❌ `ddebb900558c` (Jul 10, post-#35709 `<App>.exe`+`<App>.dll` layout). |
| 2026-08-21 | Still open, assigned littledivy + divybot, `state_reason: reopened`. |

**Practical reading:** the original `app://` cause was reverted, but Windows webview launch/render remains fragile — at least one subsequent regression landed in canaries after the "fix," and neither reporter confirmed a green stable release. Affected versions: 2.9.0 certainly; 2.9.1+ status mixed/unconfirmed; no issue comment pins the fix to a numbered stable release.

Workarounds ranked:
1. **Switch backend**: `--backend cef` (or `"backend": "cef"` in deno.json). Backends are documented as interchangeable for app code (windows/bindings/events/navigation identical). CEF bundles Chromium (~150 MB) but sidesteps both WebView2 quirks and the missing-WebView2-runtime risk. This is the strongest lever for a Windows-first ship.
2. Manual `BrowserWindow` construction: **does not help** (both repro styles fail identically).
3. Avoid `--hmr` on Windows for validation runs (separate LAUFEY 0xc0000409 crash reported under `--hmr`); test compiled builds.
4. Pin the exact Deno version you validate against; re-validate every patch (regressions have landed mid-cycle).

### Other open Windows-blocking issues (label scan, 2026-08-21)

| Issue | State | Impact |
| --- | --- | --- |
| **#36515** (Aug 9, updated Aug 18, `windows`+`needs info`) | Open, 2.9.5 | **BrowserWindow constructor params (`title`/`width`/`height`) prevent the window from appearing on Win 11** — `laufey`(cef)/`laufey_webview`(webview) process runs headless; removing the params makes it work. Directly threatens our planned sized/titled window. Verify on your exact 2.9.5 build before relying on constructor options. |
| **#36500** (Aug 8) | Open, 2.9.5 | `laufey_webview.exe` survives app shutdown on Win 11, locks the cached `.dll` under `AppData` → subsequent builds/runs hit access-denied until force-killed in Task Manager. Dev-loop hazard. |
| **#36501** (Aug 8) | Open, 2.9.5 | `console.log` silently dropped on Windows under `--hmr` (works on Linux). Debug-output hazard. |
| **#36503** (Aug 8) | Open | Installer metadata missing (rpm defaults to version 1.0.0/author unknown/license MIT). Check `.msi` equivalents before shipping installers. |
| **#35269** (Jun 16, maintained follow-up tracker) | Open | Platform gaps: **auto-updater is unix-only — Windows dylib-swap/rollback is a no-op** (`#[cfg(unix)]`); **NAPI symbol promotion unix-only — native addons may fail to load on Windows**; Linux X11-only (Wayland support later landed per #35425); `Deno.dock` macOS-only; icon sets unsupported in `--hmr`; desktop ops bypass permission system; launcher shell-injection guard etc. flagged for more tests. |
| #35494 | Open | `--hmr` doesn't detect changes to static assets (HTML/CSS). |
| #36318 / #36001 | Open | WebGPU desktop apps fail to launch / raw-backend panic (`ext\webgpu\canvas.rs`). |
| #36119 | Open | macOS webview: programmatic `BrowserWindow.close()` segfaults (tri-OS relevance). |
| #35500 | Open | Wayland: generic `W` icon instead of configured icon. |

Patch-release desktop changelog highlights (from GitHub release notes):
- 2.9.1: laufey 0.5.0; deep-link scheme registration at bundle time (#35466); `deno check --desktop`.
- 2.9.2: HMR via framework dev servers; window opacity/transparency APIs (#35646); React Router autodetect; `--exclude-unused-npm`.
- 2.9.3: `.deb`/`.rpm` (#35296) and `.msi` (#35378) installers; `--compress` self-extracting bundles (#35420); `deno compile` gains aarch64-pc-windows-msvc.
- 2.9.4: React Router HMR; V8 150.2.0. Also in cycle: "repair webview and raw backends on Windows (laufey v0.4.1)", launcher renamed to self-load runtime (#35709), `desktop.backend` honored from deno.json (#35815), BrowserWindow bindings typeable (#35907), Wayland native support (#35425).
- 2.9.5: experimental QuickJS engine backend; various desktop fixes (HMR colored URLs #36316, startup-error surfacing, update-signature op retention).

---

## Shipping caveats (v0.1 to non-technical users)

1. **Explicit experimental status.** Official language: "`deno desktop` is experimental in 2.9. The surface described here is stabilizing and some platform features are still landing." The CLI prints `⚠ deno desktop is experimental and subject to change`. Docs pages carry "Available in Deno 2.9" info boxes. Expect API churn: the backend default flipped pre-release, the launcher/bundle layout changed mid-cycle (#35709), and `desktop.backend` was silently ignored until #35815.
2. **Windows webview reliability is the top risk.** #35645 reopened; #36515 (constructor params break window creation) and #36500 (orphaned backend process locking caches) are open against 2.9.5. For a Windows-primary audience, either (a) ship `backend: "cef"` and eat ~150 MB, or (b) hold v0.1 until #35645/#36515 close in a tagged release you've personally validated.
3. **DevTools unavailable on the webview backend.** If you develop on `webview`, you cannot inspect the renderer at all; only the Deno isolate via `--inspect`. Develop against `cef` when you need DevTools; consider a debug build shipping `win.openDevtools()`.
4. **Auto-update is a no-op on Windows today** (unix-only implementation, #35269). Don't promise updates to Windows users from `Deno.autoUpdate()`; distribute fresh installers manually for now.
5. **WebView2 runtime presence.** The `webview` backend uses the OS's WebView2 (Evergreen). Per Microsoft, it's preinstalled on Windows 11 and delivered to essentially all eligible Windows 10 devices — but stripped/managed/offline machines can lack it. **No Deno doc documents a detection/bootstrapper step in the `.msi` flow** (unlike Tauri's configurable `webviewInstallMode`). Mitigations: link Microsoft's Evergreen Standalone Installer in your release notes, or choose `cef` to remove the dependency. Flagged below as an unknown.
6. **Code signing.** Windows: nothing is signed for you — sign the produced backend `.exe` + `denort.dll` externally (`signtool sign /f cert.pfx /tr <timestamp> <file>`); unsigned MSIs/exes trigger SmartScreen "Unknown publisher" walls for non-technical users. macOS: ad-hoc signature by default; set `macos.codesignIdentity` for distributable builds; notarization is a separate `xcrun notarytool` step.
7. **`--compress` tradeoff:** ~66 MB → ~19 MB artifact, at the cost of a first-launch extraction pause to a per-user data dir. Fine for v0.1; mention first-run delay in release notes.
8. **Loopback-only serving:** the embedded server can never bind a public interface — good for safety, but pkhex-mcp's MCP-over-HTTP story for other devices cannot ride the desktop listener; keep that as a separate `deno serve` deployment or accept localhost-only.
9. **Permissions baked at compile time; desktop ops ungated.** `-A` is typical, but remember bindings/native handles bypass the permission system (#35269) — validate inputs on trust-boundary bindings (save-file pickers etc.).
10. **Misc:** no native file-picker API yet (use `<input type="file">` + binding); window geometry not persisted (DIY); `prompt/alert/confirm` work natively; Linux ships X11-first with newer Wayland support; `deepLinks` register at bundle time but URL delivery to the app isn't implemented yet.

---

## Citations

Official documentation (docs.deno.com):
- Desktop overview: https://docs.deno.com/runtime/desktop/ (2026-07-27)
- Configuration (`desktop` block schema): https://docs.deno.com/runtime/desktop/configuration/ (2026-06-30)
- Backends: https://docs.deno.com/runtime/desktop/backends/ (2026-07-08)
- HTTP serving / DENO_SERVE_ADDRESS: https://docs.deno.com/runtime/desktop/serving/ (2026-06-25)
- Windows (BrowserWindow API): https://docs.deno.com/runtime/desktop/windows/ (2026-07-27)
- Bindings: https://docs.deno.com/runtime/desktop/bindings/ (2026-06-25)
- Dialogs: https://docs.deno.com/runtime/desktop/dialogs/ (2026-06-25)
- DevTools: https://docs.deno.com/runtime/desktop/devtools/ (2026-06-25)
- HMR: https://docs.deno.com/runtime/desktop/hmr/ (2026-06-25)
- Distribution (targets, installers, compress, signing): https://docs.deno.com/runtime/desktop/distribution/ (2026-08-06)
- CLI reference: https://docs.deno.com/runtime/reference/cli/desktop/ (2026-06-27)
- Deno 2.9 announcement: https://deno.com/blog/v2.9 (2026-06-25)

GitHub (denoland/deno):
- #35645 webview fails to launch on Windows (OPEN/reopened): https://github.com/denoland/deno/issues/35645 + comments via API
- #36515 BrowserWindow params break window on Win 11: https://github.com/denoland/deno/issues/36515
- #36500 laufey_webview.exe orphan/lock: https://github.com/denoland/deno/issues/36500
- #36501 console.log silent under --hmr on Windows: https://github.com/denoland/deno/issues/36501
- #36503 installer metadata defaults: https://github.com/denoland/deno/issues/36503
- #35269 desktop follow-ups/platform gaps tracker: https://github.com/denoland/deno/issues/35269
- #35465 deep links tracking: https://github.com/denoland/deno/issues/35465
- Releases v2.9.0–v2.9.5 (patch notes incl. #35378 MSI, #35296 deb/rpm, #35420 compress, #35709 launcher, #35815 backend honor, #36004 win-arm64 compile): https://github.com/denoland/deno/releases
- PR #33441 (original deno desktop subcommand): referenced in blog/releases

Third-party corroboration (used cautiously, secondary to official docs):
- Mamezou hands-on (laufey backend download flow, experimental warning): https://developer.mamezou-tech.com/en/blogs/2026/07/07/deno-2_9-desktop/
- youngju.dev 2.9 analysis (webview-vs-cef tradeoff framing, targets): https://www.youngju.dev/blog/2026-07-17-deno-2-9-desktop-lockfile-migration-node-26.en
- digitalapplied guide (bundle-size context): https://www.digitalapplied.com/blog/deno-cross-platform-desktop-apps-web-framework-2026
- Microsoft WebView2 Evergreen distribution (runtime preinstalled Win11 / eligible Win10): https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version
- Tauri WebView2 install-mode comparison (context for the missing-bootstrapper gap): https://tauri.app/distribute/windows-installer/
