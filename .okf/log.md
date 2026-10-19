# Changelog

Newest first. Dates are ISO (`YYYY-MM-DD`).

## 2026-10-19

- **Project renamed to `ngrok-inspect-plus`** (user request): the repo folder was renamed from
  `ngrok++` to `ngrok-inspect-plus`. Propagated the name through every identifier: `manifest.json`
  `name`/`default_title`, `package.json` `name` (was `ngrok-plus-plus`), source-header comments,
  the `[ngrok-inspect-plus]` console prefix (`selectors.js`, `observer.js`), the
  `# ngrok-inspect-plus:` curl warning prefix (`curl.js` + `tests/curl.test.js`), the fixture
  server banner, `AGENTS.md`, the plan doc, and the OKF bundle. Also fixed the one stale absolute
  path (`docs/plans/ngrok-dashboard-features-2026-10-18.md`: `…/Projects/ngrok++` →
  `…/Projects/ngrok-inspect-plus`). No functional change: `make test` (30 pass) and `make check`
  stay green. The internal `ngpp` namespace (`globalThis.ngpp`, `data-ngpp`, `html.ngpp-dark`,
  `content/ngpp.css`) is intentionally untouched.
- **Empty-dashboard state** (user report): a fresh dashboard showed Bootstrap's `.well`
  (`#f5f5f5`) for the "No requests to display yet" panel, unthemed. Added
  `html.ngpp-dark .well`. Found by clearing the request list and re-running the
  light-background scan; only the navbar hamburger (`icon-bar`) stays light, which is correct.
- **`Copy body` right-aligned with `Replay`** (user report): measured the cause — `.ngpp-toolbar-btn`
  carries `margin-right: 6px` to gap `Copy as cURL` from the Replay group, but the response
  toolbar holds only that one button, so the margin pushed it 6px off the panel edge
  (1279px vs Replay's 1285px). Zeroed it for `[data-ngpp="resp-toolbar"]`; both edges now 1285px.
- **Response body copy simplified to a single action** (user request): the dropdown caret is gone
  and "Copy body" now always copies ngrok's **Summary rendering** of the body, falling back to the
  raw body only when the Summary pane has none, and to the binary handling for non-text bodies.
  Consequently `responseBody.format`, `prettyWhenJson`, `includeHeaders` and `appendTrailingNewline`
  were removed from the defaults and the popup (dead settings).
- **All injected buttons now use the Replay button's colour** (`btn btn-primary`, `#337ab7`),
  including the per-header copy icons (verified: `copy-curl`, `copy-response` and the header
  icons all compute to `rgb(51, 122, 183)` = the Replay background).
- **Per-header copy affordance is now ALWAYS visible** (user request), superseding the plan's
  §5.2 "reveal on hover" design. The reserved `padding-right: 28px` is kept so nothing shifts.
- **Hover-state fix** (user report): the dark theme's resting-state scan missed hover states.
  Measured with CDP `CSS.forcePseudoState`: tab hover came from Bootstrap
  `.nav > li > a:hover { background:#eee }`, and request-list row hover from the page's own
  `._inspectSelector_… ._roundTripSelect_… tr:hover:not(._selected_…) { background:#ddd }`
  (specificity 0,4,1). Both now overridden under `html.ngpp-dark` by specificity. Also split the
  selected-row shade into `--ngpp-selected` so it stays distinct from hover.
- **Service-worker registration covered by tests; the real-browser path is not automatable here.**
  Chrome 155 ignores `--load-extension` (tried headless=new, headed,
  `--enable-unsafe-extension-debugging`, `--disable-features=DisableLoadExtensionCommandLineSwitch`;
  a trivial probe extension also failed). Instead, `tests/service-worker.test.mjs` loads the
  **real** `background/service-worker.js` against a mocked `chrome` API and asserts the mode→script
  decision (`dark`→`apply-dark.js`, `auto`→`apply-dark-auto.js`, `light`→nothing, plus idempotent
  re-registration). 30 tests total. End-to-end FOUC timing and the popup toggle remain manual.
- **Makefile expanded into a dev/test runner** (`help`, `test`, `check`, `load`, `serve`,
  `fixtures`, `tunnel`, `traffic`, `stop`) and `tools/fixture-server.py` added, which serves
  controlled bodies (`/empty` 204, `/truncated` with a lying `Content-Length`, `/latin1`,
  `/blob.bin`, 64 KiB, 100 KiB) from a throwaway temp dir so no fixture data lands in the repo.

## 2026-10-18

- **Dark-mode visual pass**: `theme/dark.css` injected into the live dashboard. Palette renders
  correctly (`body #14171c`, navbar `#0d1014`, borders `#2f3642`, `color-scheme: dark`, hljs tokens
  dark). An automated scan for light backgrounds under `html.ngpp-dark` found two misses, now fixed:
  the filter box (`_inputGroup_` carries the light background, not the inner input) and the active
  dropdown item (`_active_`). Only `span.icon-bar` stays light, which is correct.
- **Not verified at that point:** the service-worker registration mechanism (needs a real Chrome
  profile with the extension loaded); the visual pass exercised the CSS, not the `chrome.scripting`
  path. (Addressed on 2026-10-19.)
- **Live verification against ngrok 3.39.11** via the Chrome DevTools MCP: all required selectors
  present; **B-1/A8 resolved — inactive response panes ARE populated in the DOM**
  (`#response-pane-2` held 696 chars while `display:none`), so no synthetic tab clicks are needed.
  Content scripts were loaded into the live dashboard with a `chrome` stub and the real DOM: the
  cURL button injected, 9 request + 5 response header buttons injected, the response toolbar
  created, and the binary request read as 294 bytes from the hex pane (matching the plan).
- **Implemented v0.1.0.** Adopted the plan's recommended defaults for the open questions.
  `git init` + initial commit. No bundler; pure logic unit-tested (25 tests).
- **Plan produced** for the four features at `docs/plans/ngrok-dashboard-features-2026-10-18.md`,
  grounded in live inspection of the dashboard.
- **Local testing runbook** recorded (`python3 -m http.server 8080` + `ngrok http 8080
  --subdomain test-extension`). Verified the domain resolves to `https://test-extension.sa.ngrok.io`;
  `--subdomain test` fails as reserved. See `concepts/local-testing.md`.
- Noted that the **Chrome DevTools MCP** is available for inspecting `localhost:4040` and debugging
  the extension.
- Decided to target **Chrome Manifest V3**; see `concepts/manifest-v3.md`.
- Captured the project brief: `ngrok-inspect-plus` is a Google Chrome extension that improves the usability of
  the ngrok dashboard at `http://localhost:4040`.
- Initialized the OKF v0.2 bundle (`.okf/`). Recorded the repository's then-current state: a fresh
  scaffold with no source code, build config, or git history.
