# AGENTS.md

## What this is

`ngrok-inspect-plus` is a **Google Chrome extension** that improves the usability of the ngrok
agent dashboard, served on **any loopback port** (`http://localhost:<port>` /
`http://127.0.0.1:<port>`; the agent defaults to `:4040`). The extension targets that local
dashboard UI; it is not a general-purpose web extension and does not talk to ngrok's cloud API.

It uses **Manifest V3** (`manifest_version: 3`). Consequences to keep in mind: a background
**service worker** instead of a persistent background page (event-driven, can be terminated
at any time — no long-lived in-memory state), and no remotely hosted code (all JS ships in
the bundle).

## Status: implemented (v0.1.0)

Four features are implemented: dark mode, copy-as-cURL, per-header copy, and
response-body copy (plus response headers). No bundler, no npm runtime dependencies —
plain ES2022 files loaded unpacked from the repo root.

## Commands

- `make test` or `npm test` — unit tests for the pure logic (`node --test 'tests/*.test.js' 'tests/*.test.mjs'`).
  Single file: `node --test tests/curl.test.js`.
- `make e2e` or `npm run e2e` — end-to-end smoke test in a real Chrome (`node tests/e2e/run.mjs`,
  26 checks). **No npm dependencies**: it drives Chrome over the DevTools Protocol with Node's
  built-in `WebSocket`/`fetch`, and serves a synthetic dashboard shell
  (`tests/e2e/dashboard-shell.html`) so it needs no ngrok tunnel. See "You cannot automate loading
  the extension" below for the two modes.
- `make check` — syntax-check every JS file and validate the JSON manifests.
- `make load` — prints the load-unpacked / reload steps.
- `make` (no target) — lists all targets.
- There is **no build step**. Reload rules after an edit:
  - content script / CSS → reload the dashboard tab (`Cmd+R`).
  - `background/service-worker.js` → click the extension's **reload** icon, then reload the tab
    (the service worker is not hot-reloaded).
  - `manifest.json` → reload the extension, then the tab.

## Architecture

- `manifest.json` — MV3. Permissions: `storage`, `scripting`; host perms for
  `http://localhost/*` and `http://127.0.0.1/*` — **no explicit port**. A match pattern with a
  port only matches that port, so pinning `:4040` silently disables the whole extension when the
  agent serves its dashboard elsewhere (`ngrok http 8080 --web-addr localhost:4041`). No
  `web_accessible_resources` (icons are inline SVG / `data:` URIs) — keep it that way.
- `background/service-worker.js` (ESM) — **stateless**. Its only job is to own the *dynamic
  content-script registration* that removes dark-mode FOUC. Imports `background/settings.js`
  (a minimal ESM copy of the defaults — **keep in sync with `content/settings.js`**).
  - The pre-paint script is an unconditional `classList.add('ngpp-dark')`, so it is registered
    for the **default `:4040` origin only** (`PREPAINT_MATCHES`) — widening it to all loopback
    ports would darken every unrelated localhost app. The live-theme **broadcast** uses
    `LOOPBACK_MATCHES` instead, so a theme change still reaches a custom-port dashboard.
- `content/` — classic scripts in `manifest.json` order, sharing one isolated world via
  `globalThis.ngpp`. **Not ES modules**: they cannot `import`, so `ngpp.curl` /
  `ngpp.responseBody` / `ngpp.rawMessage` use a UMD wrapper that also `module.exports` for
  `node --test`. Preserve that wrapper when editing those three.
  - `selectors.js` is the **single source of truth** for every DOM selector; 27 of the
    dashboard's classes are CSS-module hashes, matched by attribute-prefix (`[class*="_params_"]`).
    Add selectors there, not inline.
  - Because the content scripts match **every** loopback port, `ngpp.isDashboard()` — keyed off
    the agent's stable shell markers (`<body id="ngrok">`, `<meta name="author" content="ngrok">`),
    not the class hashes — is the gate in `main.js`: on any other localhost page the bundle bails
    before doing anything (no console spam, no stray theming).
  - `observer.js` re-asserts injected UI on an rAF-coalesced `MutationObserver`; every feature's
    `ensure()` **must be idempotent** (guarded by `data-ngpp`).
  - Copy handlers read the **live DOM at click time** — never capture payloads in a closure
    (React reuses `<tr>`/`<td>` nodes across selection changes).
- `theme/dark.css` is the only stylesheet we author; it is always injected but inert without
  `html.ngpp-dark`. Scope every rule under `html.ngpp-dark` (specificity, not `!important`);
  **never use `@layer`** (unlayered page CSS would win).
  - **Hover/focus states need explicit rules.** Bootstrap (`.nav > li > a:hover` → `#eee`) and the
    page's own CSS-module rules (`._inspectSelector_… ._roundTripSelect_… tr:hover:not(._selected_…)`
    → `#ddd`) are *not* covered by the resting-state rules. A resting-state scan will miss them —
    verify with `:hover` **forced** (CDP `CSS.forcePseudoState`), not by eye at rest.
  - Keep hover (`--ngpp-surface-2`) and selected (`--ngpp-selected`) visually distinct.

## Local testing

To exercise the dashboard with real tunnel data, two processes are needed (three terminals):

```bash
make serve      # or `make fixtures` for controlled edge-case bodies, on :8080
make tunnel     # ngrok http 8080 --subdomain test-extension
make traffic    # send every fixture through the tunnel
make stop       # kill the tunnel + servers when done
```

`make serve` = plain `python3 -m http.server 8080`. `make fixtures` runs
`tools/fixture-server.py`, which serves controlled bodies (`/empty` 204, `/truncated` with a
lying `Content-Length`, `/latin1` non-UTF-8, `/blob.bin` binary, 64 KiB and 100 KiB) from a
throwaway temp dir — **no fixture data lands in the repo**. Then open
`http://localhost:4040/inspect/http`, or drive it via the Chrome DevTools MCP.

`--subdomain test-extension` resolves to `https://test-extension.sa.ngrok.io`; the ngrok
dashboard then appears at `http://localhost:4040` and is what the extension targets. The agent's
dashboard port is configurable (`--web-addr`, or `web_addr` in `ngrok.yml`); the extension follows
it to any loopback port. Only the pre-paint dark-mode script is pinned to `:4040`, so a custom
port may flash light→dark on load (see the service-worker note above).

Gotchas observed with the installed ngrok **3.39.11**:

- `--subdomain` is **deprecated**; it still works but is mapped to `--domain`. The account's
  region is `sa`, so names resolve to `<name>.sa.ngrok.io`.
- Use the name `test-extension` (reserved to this account). Other names such as `test`
  **fail** with `This domain is reserved for another account`.
- The authtoken is already configured in
  `~/Library/Application Support/ngrok/ngrok.yml`.

## Tooling

The **Chrome DevTools MCP** (`chrome-devtools` tools) is configured in this environment.
Use it to work against the target dashboard directly: open `http://localhost:4040`, inspect
DOM / console / network, and debug content-script or service-worker changes. It is not
configured via a repo-local `opencode.json` (this repo has none), so treat it as
environment-provided rather than project-owned.

## Docs

- `docs/plans/` — implementation plans and review/validation reports.
- `docs/specs/` — written specs describing intended behavior.

## Knowledge Management (OKF v0.2)
This project uses the official Open Knowledge Format (OKF v0.2) located in `./.okf/`.
- **Before starting tasks:** Read `./.okf/index.md` and load only the required concept files from `./.okf/concepts/`.
- **When finishing tasks:** Use the `okf-update` skill to record design decisions in `./.okf/log.md` and update affected concepts.
- **Plans and specs go under `docs/`, never `.opencode/`.** Plan, review and validation reports are `docs/plans/<topic>-<YYYY-MM-DD>.md`; specifications are `docs/specs/`. Do **not** write them to `.opencode/` (or any other tool/agent directory): that path is not part of the project layout, it is **not** gitignored (so anything left there shows up as untracked noise in `git status`), and reports written there are invisible to `git log` and to the OKF bundle. If a tool's default output directory is `.opencode/plans/`, write to `docs/plans/` instead.

## Gotchas

- **You cannot automate loading the extension.** Chrome 155 here **ignores `--load-extension`**
  (even with `--enable-unsafe-extension-debugging` and
  `--disable-features=DisableLoadExtensionCommandLineSwitch`; verified with a trivial extension).
  Load it by hand via `chrome://extensions` → **Load unpacked**. The SW registration logic is
  covered by `tests/service-worker.test.mjs` instead.
  - `tests/e2e/run.mjs` detects this and falls back to **inject mode**: it injects the content
    scripts listed in `manifest.json` into the fixture page with
    `Page.addScriptToEvaluateOnNewDocument` (plus a `chrome.storage`/`chrome.runtime` shim). That
    exercises everything except manifest-based registration, and it is the mode you get here. On a
    Chrome that honours the flag (CI), it runs in **extension mode** and covers the full path. Pass
    `--strict` to make the harness fail instead of falling back. The mode is printed at the top of
    every run — never read a green run as "the extension loaded".
- **Never leave the ngrok tunnel running.** `ngrok http 8080 --subdomain test-extension`
  exposes the served directory to the public internet. Kill it (and the fixture server) when
  done — a subagent has already leaked this once.
- Clipboard writes need **no permission** on a loopback origin (secure context, `clipboard-write`
  granted by default); `navigator.clipboard.writeText()` from the content script is correct.
  There is no `clipboardWrite` MV3 permission.
- Bodies **≥ ~100 KiB are never captured by ngrok** — the degraded path is headers-only plus a
  warning, by design. Do not "fix" it by reading the REST API.
