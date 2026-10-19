---
type: architecture
title: "Extension Architecture"
description: "DOM-augmentation layer over the ngrok dashboard: isolated-world content scripts, a stateless service worker, and a no-FOUC theme mechanism."
status: active
verified:
  - by: "okf-init"
    at: "2026-10-18"
  - by: "okf-update"
    at: "2026-10-19"
sources:
  - uri: "file://docs/plans/ngrok-dashboard-features-2026-10-18.md"
    credibility: high
  - uri: "file://AGENTS.md"
    credibility: high
stale_after: "2027-04-18"
---

# Extension Architecture

A thin **DOM-augmentation layer** over the ngrok agent's own dashboard. It scrapes the DOM
rather than reusing the dashboard's data layer (which speaks gRPC-Web + protobuf).

## Boundaries

- **Content scripts** (`content/`) run in the **isolated world**: they share the DOM but not
  page JS objects, so React internals are unreadable. They are **classic scripts** in
  `manifest.json` order sharing one namespace, `globalThis.ngpp` — not ES modules.
- **Service worker** (`background/service-worker.js`) is **stateless** and exists only to own
  dynamic content-script registration (the no-FOUC theme mechanism). It is ESM.

## Key mechanisms

- **Any loopback port.** The manifest matches `http://localhost/*` and `http://127.0.0.1/*` with
  **no explicit port** — a match pattern that names a port matches only that port, which silently
  disabled the whole extension on a custom dashboard port. Because that also injects the bundle
  into unrelated localhost apps, `ngpp.isDashboard()` (keyed off the agent's stable shell:
  `<body id="ngrok">`, `<meta name="author" content="ngrok">`) gates `content/main.js`, which bails
  before doing anything on any other page.
- **No-FOUC dark mode.** The persisted `themeMode` *is* the content-script registration state:
  the SW registers `theme/apply-dark.js` or `theme/apply-dark-auto.js` at `document_start`, so
  the `html.ngpp-dark` class lands synchronously before first paint. `dark.css` is always
  injected but inert without the class; live toggling is a class flip. That pre-paint script is an
  unconditional `classList.add`, so it is registered for the **default `:4040` origin only** — a
  dashboard on a custom port is themed at `document_idle` by `content/theme.js` (possible brief
  flash). The live-theme broadcast, by contrast, queries **all** loopback ports.
- **Injection survival.** One debounced `MutationObserver` (`content/observer.js`) re-asserts
  injected UI; every feature's `ensure()` is idempotent (guarded by `data-ngpp`).
- **Selector registry.** `content/selectors.js` is the single source of truth; 27 of the
  dashboard's classes are CSS-module hashes matched by attribute-prefix.
- **Stale-closure avoidance.** Copy handlers read the live DOM at click time because React
  reuses `<tr>`/`<td>` nodes across selection changes.

## Injected UI (current design)

User-driven refinements on top of the original plan:

- **All injected buttons are `btn-primary`** (`#337ab7`) — the same colour as ngrok's `Replay`
  button. That includes the per-header copy icons.
- **Per-header copy is always visible** (not hover-revealed); reserved `padding-right: 28px` keeps
  the table from shifting.
- **Response body is a single action with no dropdown** — it always copies ngrok's Summary
  rendering of the body (`#response-pane-0`), falling back to the raw body only when the Summary
  pane has none, and to binary handling for non-text bodies.
- Toolbar buttons align flush to the panel's right edge (`Copy body` sits under `Replay`).

## Testing

Pure logic (`content/curl.js`, `content/response-body.js`, `content/raw-message.js`) uses a
UMD wrapper so it is both a classic content script and `module.exports` for `node --test`.
No framework, no install.

The DOM-facing and manifest-level logic is covered without a browser:

- `tests/selectors.test.mjs` loads the classic `content/selectors.js` in a **`node:vm` sandbox**
  with a stubbed `document`, so `ngpp.isDashboard()` (the gate that keeps the bundle off unrelated
  localhost pages) is unit-tested despite being a non-module content script.
- `tests/manifest.test.mjs` parses `manifest.json` and asserts the match patterns carry **no
  explicit port** — the regression guard for the non-4040 dashboard bug.
- `tests/service-worker.test.mjs` loads the real service worker against a mocked `chrome` API.

## Verified against

ngrok **3.39.11**. Verified live on 2026-10-18/19 (see `log.md`). The dark theme has its own
concept with the cascade and verification method: `concepts/dark-theme.md`.
