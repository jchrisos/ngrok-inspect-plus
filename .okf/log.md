# Changelog

Newest first. Dates are ISO (`YYYY-MM-DD`).

## 2026-10-20

- **End-to-end test harness + manual test matrix + bfcache verification** (the review's P1 items).
  - **`make e2e`** (`tests/e2e/run.mjs`, 26 checks) — a **dependency-free** e2e test: it drives a
    real Chrome over the DevTools Protocol using Node's built-in `WebSocket`/`fetch` (no Puppeteer
    install, no npm deps, consistent with the repo's no-build ethos) against a **synthetic** ngrok
    dashboard shell (`tests/e2e/dashboard-shell.html`, hand-built from `content/selectors.js`).
    It asserts: injection of all four features, the `isDashboard()` gate (an unrelated localhost app
    stays untouched), idempotency across an observer pass, the exact clipboard payloads for
    copy-as-cURL / per-header (value only) / response body, the confirmation toasts, dark mode via
    emulated `prefers-color-scheme`, and bfcache. `Makefile` gained `e2e`; `make check` now
    syntax-checks `tests/e2e/*.mjs`.
  - **Two modes, auto-detected.** Chrome 155 here ignores `--load-extension` — re-verified, not
    assumed: a CDP probe for a `service_worker` target found 0 (the one extension target was a
    built-in component extension, type `background_page`). So the harness falls back to **inject
    mode** (content scripts from `manifest.json` injected via
    `Page.addScriptToEvaluateOnNewDocument`, plus a `chrome.storage`/`chrome.runtime` shim), which
    exercises everything except manifest registration. Where the flag works (CI) it runs in
    **extension mode**. `--strict` fails instead of falling back; the mode is printed on every run.
  - **bfcache upgraded from static to verified** (`docs/plans/bfcache-verification-2026-10-20.md`):
    dashboard → other page → back reports `type=navigate reasons=null`, i.e. served from the cache
    with no new navigation entry. The check was **proved non-vacuous** by temporarily adding an
    `unload` handler to the fixture, which flipped it to `type=back_forward` + non-empty `reasons`.
  - **`docs/specs/manual-test-matrix.md`** covers what the automated suites cannot reach: FOUC on
    `:4040` vs a custom port, the SW lifecycle, ngrok's own capture limits (empty/truncated/latin1/
    binary/≥100 KiB), hover states under forced `:hover`, a11y, and a cross-Chrome/OS matrix. It
    opens with what is already automated so nothing is re-tested by hand.
  - `AGENTS.md` documents `make e2e` and the two modes under the existing "cannot automate loading
    the extension" gotcha. No extension source code changed.
- **Chrome Web Store Best Practices review, plus the P0 submission content.** A section-by-section
  review against [Google's guideline](https://developer.chrome.com/docs/webstore/best-practices)
  (`docs/plans/cws-best-practices-review-2026-10-20.md`) found the extension **compliant in every
  area checkable from the repo**: single purpose, MV3 with no remote code and no
  `web_accessible_resources`, no `eval`, one `innerHTML` that writes a constant
  (`content/features/copy-header.js:31`), page-derived data always handled via `textContent`, and
  **bfcache-safe** (grep for `unload`/`beforeunload`/`pagehide`/`WebSocket`/`RTCPeerConnection`/
  `EventSource`/`sendBeacon`/`XMLHttpRequest` → 0 hits; the DOM watch stays `MutationObserver` +
  rAF). The `document_start` block is CSS-only, so it cannot block parsing. Gaps are
  **submission-side, not code**: no e2e test (guideline recommends Puppeteer; `--load-extension` is
  ignored in this environment), and the required listing images (tile/marquee/screenshots) are
  absent — the four icons are present and pixel-exact. Decisions recorded: **category = Developer
  Tools** (not Accessibility), a **non-affiliation disclaimer** for the third-party brand in the
  name, and a **"no data collected"** privacy posture. New concept
  `concepts/chrome-web-store.md`; ready-to-paste listing copy, Privacy-tab answers, permission
  justifications, test instructions and the image checklist in
  `docs/specs/store-listing-2026-10-20.md`, and the publishable policy in
  `docs/specs/privacy-policy.md`. No source code changed.
- **Front-end validation review, then the fixes** (`docs/plans/frontend-validation-2026-10-20.md`).
  A full read-only review of every source/test/doc file plus a live dashboard inspection found no
  Critical or security defects, and three real bugs — all now fixed:
  - **B1 (High) — false "truncated" state for non-ASCII bodies.** `copy-response.js` compared the
    text body's UTF-16 code-unit length against `Content-Length` (a **byte** count), so any accented
    text / emoji / UTF-8 JSON reported as truncated (wrong button `title`, wrong toast). Now the text
    path measures bytes with `new TextEncoder().encode(...)`. Pinned by a new vm-based test
    (`tests/copy-response-state.test.mjs`), verified to fail against the pre-fix code.
  - **B2 (Medium) — misleading shape gate.** `assertDashboardShape()` required `listRow`/`panel`/
    `toolbarSlot`, which are absent on an empty list or when nothing is selected (a normal state),
    so it warned `"dashboard DOM changed …"` on every observer pass. It now gates on the stable
    shell (`app` + `navbar`) only and warns **once**; the per-feature `ensure()` early returns remain
    the guards for "nothing selected".
  - **B3 (Low) — theme-registration race.** Overlapping `reconcileThemeRegistration()` calls (rapid
    theme toggles) could double-register the same id and throw an unhandled rejection. The SW now
    serialises reconciles through a promise chain with a `catch` (and still returns the chain so the
    mocked-SW test can `await` it).
  - Improvements applied: `contentLength`/`declaredCharset` now short-circuit instead of cloning
    every header cell (I1); the inline `#response-pane-0 h6` selector moved to the registry as
    `SEL.respSummaryHeading` (I2); `splitBodyBytes` de-duplicated into `content/response-body.js`
    (I3); `main.js` warns when a feature file fails to load (I4); `make check` now also
    syntax-checks `background/*.js` (I5); the SW only reconciles/broadcasts on an actual `themeMode`
    change (N5); and the injected header-copy icon gets a dark-mode colour that clears the palette's
    lowest contrast (~3.6:1) (I7). New guards added: `tests/settings-sync.test.mjs` (content vs
    background DEFAULTS drift), `assertDashboardShape` cases, `splitBodyBytes` cases, the
    `includeCompressed` curl branch, and manifest invariants (permissions, no
    `web_accessible_resources`, version ↔ `package.json`, icons on disk, description length).
    `make check` and `make test` green — **35 → 52 tests**. AGENTS.md's "debounced observer" wording
    corrected to rAF-coalesced (N2).
- **Removed the "Non-UTF-8 body" setting** (user request: *"remove it"*). `curl.binaryBody`
  (`comment` | `escaped` | `base64`) was dropped from the popup and from `content/settings.js` /
  `background/settings.js`. A non-UTF-8 request body is now always **omitted** from the curl command
  with the leading warning comment `# ngrok-inspect-plus: body omitted: N bytes, non-UTF-8` (the old
  default) — raw bytes are never emitted, and the `--data-binary` escaped/base64 forms are gone.
  The now-unused `ansiC` / `toBase64` helpers were removed from `content/curl.js` (its
  `sh`/`parseRawRequest`/`toCurl`/`buildUrl`/`schemeFromHeaders` remain). With no `<select>` left,
  the popup's `SELECTS` handling in `popup/popup.js` was removed too. `tests/curl.test.js` updated
  (dropped the `ansiC` test); `make test` → 35 pass. Verified live: a binary request yields the
  comment + a body-less `curl -X POST …`.
- **Copy as cURL now derives the URL scheme from the request** (user request: *"the setting url scheme
  is not necessary, mantain the url scheme from request"*). The `curl.scheme` setting (https/http)
  was removed from the popup and from `content/settings.js` / `background/settings.js`; `buildUrl`
  now reads ngrok's injected `X-Forwarded-Proto` header (verified live: `https`) and uses it for the
  `scheme://Host` URL, falling back to `https` when the header is absent. An absolute-form target
  still keeps its own scheme, and a missing Host header still falls back to the page origin.
  `X-Forwarded-Proto` continues to be stripped from the emitted `-H` flags as before. New tests in
  `tests/curl.test.js` cover the `http` case, the `https` fallback and the absolute-target case;
  `make test` → 36 pass. Verified live against the dashboard: `curl -X GET
  'https://zonaazul.sa.ngrok.io/'`.
- **Per-header copy now copies the value only** (user report: *"the copy header is copying key and
  value, must copy only value"*). The click handler built the clipboard payload as
  `` `${name}: ${value}` ``; it now copies `ngpp.dom.cellValue(td)` verbatim, so pasting a header
  yields the bare value (e.g. `application/json`) instead of `Content-Type: application/json`.
  The confirmation toast was then made explicit (user request: *"the message must be explicit:
  'Copied header {{header name}} value.'"*): it now reads `` `Copied ${label} ${name} value.` ``
  → `Copied header Content-Type value.` (request) / `Copied response header Content-Type value.`
  (response). One-line change in `content/features/copy-header.js`; no markup, selector, or CSS
  change. `make check` and `make test` stay green (37 pass).
- **Header names no longer wrap** (user report: *"the header name is breaking line must be one
  line"*). Measured live (ngrok 3.39.11): the dashboard's auto table layout squeezes the `<th>`
  column to ~83px, so hyphenated names wrap — `Sec-Ch-Ua-Platform` onto 4 lines,
  `Upgrade-Insecure-Requests` and `X-Forwarded-Proto` onto 2. Fix: `white-space: nowrap` on the
  header-name cells (`#request-pane-1`/`#response-pane-1` `table tbody th`) in `content/ngpp.css`.
  The column then sizes to the longest name (~178px request / ~253px response). Safe because the
  table already lives in ngrok's own `overflow-x: auto` `div[class*="_section_"]`, so the extra
  width scrolls rather than breaking the layout — verified visually against the live dashboard.
- **Copy body now IGNORES binary responses** (user request: *"copy body must ignore binary
  response"*). Previously a binary body copied a placeholder comment
  (`# binary response body, N bytes — not copied`), or base64 / ANSI-C when the
  `responseBody.binaryFallback` setting was changed. Now a binary body writes **nothing** to the
  clipboard: `currentState()` classifies the hex-decoded bytes and returns a `binary` state,
  `copyBody()` bails with an error toast (`binary response body — not copied`), and the button is
  marked unavailable (`aria-disabled` + `title`), like the `empty`/`not-captured` states. The
  now-dead `responseBody.binaryFallback` setting was removed from `content/settings.js`,
  `background/settings.js` (kept in sync) and the popup, and the unused `toCopyableBody` / `ansiC`
  / `toBase64` helpers were dropped from `content/response-body.js` (its `decodeBytes`,
  `classifyBody`, `splitRawResponse` remain; `decodeBytes` is still used by copy-as-cURL). Verified
  live on the dashboard by injecting the scripts with a `chrome` stub: a real text body still copies
  (`Copied response body (39042 chars)`) while a monkeypatched binary reader yields 0 clipboard
  writes and the binary toast. Tests: `tests/response-body.test.js` updated (the `toCopyableBody`
  cases replaced by a `classifyBody` binary-bytes assertion); `make test` → 33 pass.

## 2026-10-19

- **Per-header copy icons moved to the LEFT of the value** (user request: *"the copy header values
  must be in the left"*). The icon was pinned to the right edge of the value cell (`right: 4px`); it
  is now pinned to the left edge (`left: 4px`) so it precedes the value instead of trailing it. The
  reserved space flips from `padding-right: 28px` to `padding-left: 28px` (still always reserved, so
  nothing shifts). CSS-only change in `content/ngpp.css` — no markup or copy behaviour change;
  `padding-left` is equally safe because `cellValue()` strips the button via `[data-ngpp]` before
  reading the `<td>` text.
- **Dashboard on a non-4040 port now works** (user report: *"if port is not 4040, the extension is
  not working"*). Root cause: a Chrome match pattern with an explicit port matches **only** that
  port ("Match patterns match all ports unless an explicit port is specified"), and `:4040` was
  pinned in `manifest.json` (`host_permissions` + both `content_scripts.matches`) and in the
  service worker. Fix: match **all** loopback ports (`http://localhost/*`, `http://127.0.0.1/*`).
  Because that also injects the bundle into unrelated localhost apps, added `ngpp.isDashboard()`
  — keyed off the agent's stable HTML shell (`<body id="ngrok">`, `<meta name="author"
  content="ngrok">`, verified live against 3.39.11) — as a gate at the top of `content/main.js`,
  and `content/theme.js` now also applies the mode at `document_idle` (custom-port catch-up).
  The no-FOUC pre-paint script stays pinned to the **default `:4040` origin** (it is an
  unconditional `classList.add`; a loopback-wide match would darken every localhost app), while
  the live-theme broadcast queries all loopback ports. New tests: `tests/manifest.test.mjs`
  (patterns carry no port) and `tests/selectors.test.mjs` (detection). `make test` → 37 pass.
- **Repository re-created and pushed.** The `.git` directory was replaced; history was rebuilt as
  a single initial commit (`feat: initial ngrok-inspect-plus MV3 extension`) and pushed to
  `https://github.com/jchrisos/ngrok-inspect-plus.git` (`main`).
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
