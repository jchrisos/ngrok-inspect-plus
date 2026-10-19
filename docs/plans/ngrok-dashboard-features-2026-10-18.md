# ngrok-inspect-plus — Implementation Plan: Dark Mode, Copy as cURL, Header Copy, Response-Body Copy

- **Date:** 2026-10-18
- **Status:** Proposed — awaiting review before implementation
- **Target:** Chrome Manifest V3 extension that augments the ngrok agent dashboard at `http://localhost:4040`
- **Evidence baseline:** ngrok **3.39.11**, Chrome **127.0.0.0**, dashboard loaded live from
  `python3 -m http.server 8080` + `ngrok http 8080 --domain test-extension`
  (resolves to `https://test-extension.sa.ngrok.io`)
- **Scope:** this document is a plan only. No source files were created or modified.

---

## 0. Executive summary

`ngrok-inspect-plus` is a thin **DOM-augmentation layer** over the ngrok agent's built-in dashboard. It is
not a general-purpose extension and it must not depend on ngrok's cloud API.

Because the dashboard is a **React SPA served by the agent itself** and re-renders roughly
**once per second** (verified — see §1.5), the central architectural problem is *how to inject UI
that survives a 1 Hz re-render loop and a React-managed DOM*.

The plan resolves this with five decisions, each backed by evidence gathered from the live
dashboard:

| # | Decision | Why |
|---|---|---|
| **D1** | **Scrape the DOM; do not reimplement the dashboard's data layer.** | The dashboard talks to the agent over **gRPC-Web + protobuf** (`/grpc/agent.Web/Preloaded`, `/grpc/agent.Web/State`), not REST. Reusing its data would mean shipping a protobuf decoder. Meanwhile the DOM already contains the *exact raw request bytes*. |
| **D2** | **Dark mode = a class on `documentElement` (`html.ngpp-dark`) + an always-registered, inert CSS sheet, plus a per-mode `document_start` bootstrap script registered dynamically via `chrome.scripting.registerContentScripts`.** | The persisted mode is encoded in *which* bootstrap script is registered, so the class is applied **synchronously at `document_start`** — no async `chrome.storage` read, therefore **zero FOUC** and no flash-guard hack. |
| **D3** | **Copy-as-cURL reads the raw request text from `#request-pane-2`, with a byte-exact hex-dump fallback in `#request-pane-3`.** | Both panes are **always populated in the DOM** (verified), even when their tab is not selected — so no synthetic tab clicks are needed. |
| **D4** | **Injected UI is idempotent and re-asserted by a debounced `MutationObserver`; copy handlers resolve their payload from the *live* DOM at click time, never from a closure.** | Verified that injected nodes survive re-renders, but that React *reuses* row nodes across selection changes — which makes closures go **stale**. |
| **D5** | **Copy-response-body reuses D3's extraction cascade verbatim against the response panes (`#response-pane-2` raw, `#response-pane-3` hex), behind one parameterised reader.** | The request and response panes are the *same React component* with the same id scheme, so the request-side logic generalises instead of being duplicated. |

Four features ship in v1: **dark mode**, **copy request as cURL**, **header copy** (request *and*
response — this supersedes open question Q3), and **copy response body**.

Runtime is deliberately minimal: **no bundler, no npm dependencies, no build step** for v1
(plain ES2022 files loaded unpacked), no service-worker state, and **no `web_accessible_resources`**
(inline SVG / data-URI icons only).

---

## 1. Verified reconnaissance (evidence)

Everything in this section was measured against the live dashboard, not assumed. Measurements that
could not be taken are explicitly flagged as **ASSUMPTION — VERIFY** in §10.

> **Coverage note (updated for Feature 4):** the reconnaissance was performed on the **request** side
> of the inspector. The response side is rendered by the same component with the same id scheme, and
> the four things that *were* checked are marked ✅ in §1.4 — but the response panes' *contents* were
> never read. Every response-side claim beyond that is **inferred and labelled** (A7–A12 in §10.2).
> The single most consequential of these is **A8** (are inactive response panes populated?), which is
> settled by test **B-1** before any Feature 4 code is written.

### 1.1 Environment facts

| Fact | Value | How verified |
|---|---|---|
| Dashboard origin | `http://localhost:4040` | `curl -i` → `302 Location: /inspect/http` |
| Secure context | **`true`** | `window.isSecureContext` — `localhost` is a trustworthy origin |
| `navigator.clipboard.writeText` | **available and functional** | probe write returned OK; `permissions.query({name:'clipboard-write'}).state === 'granted'` |
| Dashboard JS bundle | `/static/js/app.DsEaSFMQ.js` (1.39 MB, hashed) | `<script src>` — **hash changes per ngrok release; never hardcode** |
| Dashboard CSS bundle | `/static/css/app.DsGlyouJ.css` (119 KB, minified to 1 line) | `<link rel=stylesheet>` |
| CSS framework | **Bootstrap 3.3.x** (full build: panels, modals, tooltips, glyphicons, badges) | palette `#337ab7`, `#a22`, `#3c763d`, `#f2dede`, `#dff0d8`, `#fcf8e3`, `#d9edf7` |
| Component styling | **CSS Modules** with hashed suffixes (`_inspectRoundTrip_5bda4_1`) | 40 module classes extracted from the bundle |
| Tailwind | Present in the *toolchain* (`tailwind-merge` in the bundle) but only **one** utility class actually used: `h-full` on `<html>`/`<body>` | live DOM class census |
| CSS custom properties | **none** (`grep -o '\-\-[a-z-]*:'` → 0 matches) | bundle scan |
| `prefers-color-scheme` rules | **none** (0 matches) | bundle scan |
| Shadow DOM | **none** (0 shadow hosts) | live DOM scan |
| Page data transport | **gRPC-Web protobuf** (`application/grpc-web+proto`) | `list_network_requests` |
| REST JSON API | `/api/requests/http`, `/api/requests/http/{id}`, `/api/tunnels` — **works, but is not used by the UI** (0 references to `/api/requests` in the bundle) | direct `curl` + bundle grep |
| Existing clipboard / dark / curl features | **none** (all `clipboard`/`dark`/`theme`/`curl` hits in the bundle are library keyword tables from highlight.js / Tailwind internals) | bundle grep with context |
| Syntax highlighting | highlight.js (`hljs-*` token classes) with a **light** theme | live DOM |
| DOM depth / iframes | single top-level document, **no iframes observed** | live DOM |

### 1.2 Runtime routes

| Route | Content |
|---|---|
| `/` | 302 → `/inspect/http` |
| `/inspect/http` | request list + detail inspector |
| `/status` | agent status (same navbar, `container.status`, `col-md-*` grid) |

Both routes share the identical `nav.navbar.navbar-inverse.navbar-fixed-top` chrome, so a single
content script covering `http://localhost:4040/*` covers all of it.

### 1.3 DOM map — the selectors we can actually rely on

**Stable IDs** (the safest anchors; these are hand-written, not CSS-module hashes):

| ID | Element | Notes |
|---|---|---|
| `#app` | React root | everything renders inside it |
| `#ngrok` | navbar brand link | present on every route |
| `#connection-status` | `p.navbar-text` holding the `online` label | present on every route |
| `#replay` | `div.btn-group` in the request toolbar | **the toolbar injection anchor** |
| `#replay-toggle` | its dropdown toggle | |
| `#request-tab-0..3` | Summary / Headers / Raw / Binary tabs | |
| `#request-pane-0..3` | the matching tab panes | |
| `#response-tab-0..3` | Summary / Headers / Raw / Binary tabs, response side | mirrors `#request-tab-*` exactly |
| `#response-pane-0` | Summary — status, headers, **and the body section** | body section = the `h6` matching `/\d+ bytes/` plus its `pre > code` (see §6.2) |
| `#response-pane-1` | Headers — `table tbody tr` → `th` name / `td` value | identical shape to `#request-pane-1` |
| `#response-pane-2` | Raw — `<pre><code>` with the full raw response | status line + headers + CRLF CRLF + body |
| `#response-pane-3` | Binary — hex dump | same 8-byte-per-line format as the request side |

**Structural (verified) selectors:**

```js
// request list (newest first; row 0 === newest === API list index 0)
const ROW        = 'table[class*="roundTripSelect"] tbody tr';
const ROW_SELECTED = `${ROW}[class*="_selected_"]`;   // hashed suffix → prefix match
const ROW_PATH   = 'div[class*="_path_"]';            // "POST /hello"

// the detail panel (single instance per page)
const PANEL      = 'div[class*="_inspectRoundTrip_"]';
const PANEL_TITLE= `${PANEL} h3.wrapped`;             // "PUT /edge?a=1&b=two%20words"
const TOOLBAR    = '#replay';                         // → .parentElement is the slot
const REQUEST_HEADERS_TABLE = '#request-pane-1 table tbody tr';   // th = name, td = value
const REQUEST_RAW_CODE      = '#request-pane-2 pre > code';       // exact raw bytes as text
const REQUEST_RAW_PLACEHOLDER = '#request-pane-2 .alert';         // "Binary request not displayed"
const REQUEST_HEX_CODE      = '#request-pane-3 pre > code';       // hex dump fallback
```

**Verified detail-panel structure** (indentation = nesting):

```
div[class*="_inspectRoundTrip_"]            ← single panel, DOM node reused across renders
  div._row_… > div._info_… (relative time, duration) + div._ip_… (remote addr)
  hr
  div
    h3.wrapped                              ← "PUT /edge?a=1&b=two%20words"
    div[class*="_inspector_"]
      div.pull-right                        ← exactly ONE .pull-right in the panel
        div._container_1bug4_1              ← toolbar slot
          div#replay.btn-group              ← "Replay" + caret
          form
      div
        ul[role=tablist].nav.nav-tabs > li > a#request-tab-{0..3}
        div.tab-content
          div#request-pane-{0..3}[role=tabpanel].tab-pane
  hr._withMargin_
  div                                       ← response section, same shape
    h3.text-danger                          ← "501 Unsupported method ('PUT')"
    div[class*="_inspector_"]
      (no .pull-right here)                 ← VERIFIED: the response section has NO toolbar
      ul[role=tablist] > a#response-tab-{0..3}
      div.tab-content > div#response-pane-{0..3}
```

> **Note for Feature 4:** `.pull-right` occurs **exactly once** in the whole panel — on the *request*
> side. The response section has **no toolbar slot**, so the response-body affordance has to create
> its own container (§6.7). The response `div[class*="_inspector_"]` is reachable as
> `document.querySelector('#response-pane-0').closest('div[class*="_inspector_"]')`.

**Header row markup** (`#request-pane-1`) — note there is **no `<thead>`**, and the table class is
the shared `_params_` module used for query params and form params too:

```html
<div id="request-pane-1" role="tabpanel" class="tab-pane">
  <div>
    <h6>Headers</h6>
    <table class="table _params_1j0lz_1"><tbody>
      <tr><th>Accept</th><td>*/*</td></tr>
      <tr><th>Content-Type</th><td>application/json</td></tr>
      <tr><th>X-Multi</th><td>first</td></tr>
      <tr><th>X-Multi</th><td>second</td></tr>   <!-- duplicates → separate rows -->
    </tbody></table>
  </div>
  <div></div>
</div>
```

- Header rows are **sorted alphabetically**, not in wire order.
- Duplicate header names produce **one `<tr>` per value**.
- A multi-valued header is *not* comma-joined.

**Raw pane markup** (`#request-pane-2`), normal case — `textContent` is the **byte-exact request**:

```html
<div id="request-pane-2" role="tabpanel" class="tab-pane">
  <pre><code>POST /hello?x=1 HTTP/1.1\r\nHost: …\r\n…\r\n\r\n{"name":"julio","n":2}</code></pre>
</div>
```

**Raw pane markup**, when the body is not displayable — a Bootstrap alert, **no bytes available**:

```html
<div id="request-pane-2" role="tabpanel" class="tab-pane">
  <div class="alert alert-info">Binary request not displayed</div>
</div>
```

**Binary pane markup** (`#request-pane-3`) — a **hex dump we can parse back to exact bytes**:

```
50 4f 53 54 20 2f 62 69 <TAB>P O S T   / b i
6e 61 72 79 20 48 54 54 <TAB>n a r y   H T T
…
0d 0a 00 01 02 ff fe 80 <TAB>. . . . . . . .
62 69 6e 61 72 79       <TAB>b i n a r y
```

Format: **8 lowercase hex pairs per line, space-separated, then a TAB, then the 8-char ASCII column**
(non-printable → `.`, printable → itself). The hex column is space-padded on the final line. Parsing
`line.split('\t')[0].trim().split(/\s+/)` yields the complete byte stream — verified to reproduce
all 294 bytes of a binary request including `00 01 02 ff fe 80`.

### 1.4 Data-availability matrix (measured)

| Case | `#request-pane-2` (Raw) | `#request-pane-3` (Binary) | REST API `request.raw` | Curl fidelity |
|---|---|---|---|---|
| GET, no body | full text | hex dump | present | ✅ perfect |
| POST, JSON body | full text incl. body | hex dump | present | ✅ perfect |
| Duplicate headers, quotes, `$`, backticks, multi-line body | full text | hex dump | present | ✅ perfect |
| **Non-UTF-8 body** (12 B) | ⚠️ `.alert` placeholder | ✅ **hex dump present** | present (base64) | ✅ perfect **via hex fallback** |
| **Large body, 64 KiB** | ✅ full 65 810-char text, body intact | hex dump (345 KB of DOM text) | present (65 810 B) | ✅ perfect |
| **Large body, ≥ ~100 KiB** | ⚠️ `.alert` placeholder | ❌ **empty** | ❌ **`raw` absent** | ⚠️ **degraded** — headers only |

Empirically measured capture threshold: **65 536 B captured, 102 400 B not captured** (the exact
boundary between those two values was not pinned down). When the body is not captured the dashboard
summary itself says `(0 bytes captured)`, so **both** the DOM and the REST API lose the body
simultaneously — this is an ngrok-side capture limit, not an extension bug. The plan therefore
degrades gracefully instead of pretending it can recover the bytes (§4.6).

**Response side — mirrored, only partially measured.** The response panes are rendered by the same
component with the same id scheme, so the request-side results above are expected to carry over —
but they were **not** re-measured pane-by-pane. This table separates what is **verified** from what
is **inferred** (tracked as A7–A11 in §10.2):

| Claim | Status |
|---|---|
| `#response-pane-0..3` and `#response-tab-0..3` exist, same 4-tab scheme (Summary / Headers / Raw / Binary) | ✅ verified |
| `#response-pane-1` is a `table` with the same `th`/`td` row shape as `#request-pane-1` | ✅ verified |
| `#response-pane-0` renders the response body: an HTML response body was observed rendered in the Summary pane beneath `h6 "410 bytes text/html; charset=utf-8"` | ✅ verified |
| `#response-pane-2` holds the full raw response (`status line + headers + CRLF CRLF + body`) | ⚠️ **assumed** — inferred from the identical request-side markup |
| The response panes are populated **while their tab is inactive** (as the request panes are) | ⚠️ **assumed** — verified on the request side only |
| The ~64 KiB capture limit applies to response bodies too | ⚠️ **assumed** |
| The Summary pane *reformats* a JSON body (whitespace inserted) instead of echoing raw bytes | ✅ verified **on the request side** (`{"name":"julio","n":2}` rendered as `{ "name": "julio", "n": 2 }`); the exact indentation was not measured, and the response side is assumed identical |
| The response section has **no** `.pull-right` toolbar slot | ✅ verified (`.pull-right` occurs exactly once in the panel, request-side) |

### 1.5 Re-render behaviour (measured over a 16.8 s window)

- The dashboard polls `/grpc/agent.Web/State` continuously.
- `#app` received **22 mutation batches / ~954 added nodes in 16.8 s** — i.e. **≈1 re-render per
  second**, with occasional larger bursts (46–48 records) when data arrives.
- The `div[class*="_inspectRoundTrip_"]` **DOM node reference is stable** across renders (React
  reuses it).
- **Injected nodes survive**: four probe buttons placed in `div.pull-right`, in
  `div._container_1bug4_`, in a `#request-pane-1` `<td>`, and in a list `<td>` all survived **15 s**
  of 1 Hz re-rendering **and** a subsequent selection change.
- **But** the header-row count changed `7 → 9` across a selection change while React **reused the
  `tr`/`td` nodes**. So an injected button can end up attached to a row that now represents a
  *different* header. This is the single most important consequence for the design: **never capture
  the copy payload in a closure; read it from the live row at click time** (§5.4).

### 1.6 Dark-mode surface (the actual override target)

A live class census across `/inspect/http` and `/status` returned **76 distinct classes**. The
complete list to style:

- **Bootstrap components:** `navbar`, `navbar-inverse`, `navbar-fixed-top`, `navbar-header`,
  `navbar-brand`, `navbar-text`, `navbar-nav`, `navbar-right`, `navbar-toggle`, `navbar-collapse`,
  `collapse`, `collapsed`, `icon-bar`, `container`, `row`, `col-md-5`, `col-md-6`,
  `col-md-offset-1`, `table`, `table-hover`, `nav`, `nav-tabs`, `tab-content`, `tab-pane`,
  `btn`, `btn-primary`, `btn-default`, `btn-group`, `dropdown-toggle`, `dropdown-menu`,
  `dropdown-menu-right`, `caret`, `label`, `label-success`, `glyphicon`, `glyphicon-time`,
  `glyphicon-user`, `list-unstyled`, `alert`, `alert-info`, `pull-right`, `sr-only`, `active`
- **ngrok custom utility classes:** `inspect`, `status`, `muted`, `text-muted`, `text-small`,
  `text-danger`, `wrapped`
- **highlight.js tokens:** `hljs-attr`, `hljs-keyword`, `hljs-meta`, `hljs-name`, `hljs-string`,
  `hljs-tag`
- **Tailwind:** `h-full`
- **27 CSS-module classes** (`_inspectContainer_…`, `_roundTripSelect_…`, `_selected_…`, `_path_…`,
  `_params_…`, `_inspector_…`, `_section_…`, `_selector_…`, `_inspectPage_…`, `_inspectSelector_…`,
  `_allRequests_…`, `_row_…`, `_info_…`, `_ip_…`, `_duration_…`, `_remoteAddr_…`, `_withMargin_…`,
  `_input_…`, `_inputGroup_…`, `_inputContainer_…`, `_container_…`, `_activeContainer_…`,
  `_active_…`, `_measuringTape_…`, `_unit_…`, `_loading_…`)

Because module hashes change per build, module classes must be matched by **attribute-prefix**
(`[class*="_params_"]`), never by exact class name.

---

## 2. Architecture

### 2.1 Extension structure

```
manifest.json
├─ background/service-worker.js      event-driven, stateless; owns content-script registration
├─ content/                          isolated world, all run on http://localhost:4040/*
│   ├─ main.js                       bootstrap: mount feature modules, start observer
│   ├─ observer.js                   debounced MutationObserver + idempotent ensure() dispatch
│   ├─ selectors.js                  SINGLE SOURCE OF TRUTH for every DOM selector
│   ├─ settings.js                   chrome.storage.sync wrapper + defaults + validation
│   ├─ clipboard.js                  writeText + execCommand fallback + toast
│   ├─ toast.js                      transient, aria-live announcements
│   ├─ raw-message.js                parameterised DOM reader → {text | bytes | unavailable}
│   │                                (parseHexDump + createMessageReader; used for BOTH sides)
│   ├─ raw-request.js                readRawRequest()  = reader over #request-pane-2/3
│   ├─ raw-response.js               readRawResponse() = reader over #response-pane-2/3
│   ├─ response-body.js              bytes → copyable body (charset decode, text/binary class)
│   ├─ curl.js                       RawRequest → curl string (pure, unit-testable)
│   ├─ features/copy-curl.js         toolbar button + dropdown item
│   ├─ features/copy-header.js       per-row copy affordance (parameterised by pane id)
│   ├─ features/copy-response.js     response-body button + its own toolbar container
│   └─ theme.js                      live class toggle (responds to SW messages)
├─ theme/
│   ├─ dark.css                      all overrides, scoped to html.ngpp-dark (always registered)
│   ├─ apply-dark.js                 1 line: add the class unconditionally
│   └─ apply-dark-auto.js            1 line: add the class iff prefers-color-scheme: dark
└─ popup/
    ├─ popup.html / popup.css / popup.js
icons/{16,32,48,128}.png
```

**Why a service worker at all?** Only to own *dynamic content-script registration*, which is the
mechanism that removes the FOUC race. It holds **no in-memory state** — every wake-up re-reads
`chrome.storage.sync` (consistent with the MV3 constraint recorded in `.okf/concepts/manifest-v3.md`).

### 2.2 Isolation-world note (important)

Content scripts run in an **isolated world**: they share the DOM but **not** page JavaScript
objects. Two consequences:

1. React's `__reactFiber$…` expandos on DOM nodes are **not readable** from a content script, so
   "reach into React state to find the request ID" is not an option. (It was not needed — the DOM
   already exposes the raw bytes.)
2. All of our scripts share *one* isolated world, so an ordered `js: [...]` array with a shared
   namespace object (`const ngpp = (globalThis.ngpp ||= {})`) is sufficient — **no bundler needed**.

### 2.3 Selector registry — non-negotiable maintainability rule

Every selector lives in `content/selectors.js` and is documented with the ngrok version it was
verified against. Rationale: 27 of the 76 classes are hashed and will change on the next ngrok
release. One file to fix, plus a startup assertion:

```js
// content/selectors.js
export const SEL = {
  app: '#app',
  navbar: 'nav.navbar',
  connectionStatus: '#connection-status',
  listRow: 'table[class*="roundTripSelect"] tbody tr',
  listRowSelected: 'table[class*="roundTripSelect"] tbody tr[class*="_selected_"]',
  panel: 'div[class*="_inspectRoundTrip_"]',
  panelTitle: 'div[class*="_inspectRoundTrip_"] h3.wrapped',
  toolbarSlot: '#replay',                    // stable id; use .parentElement to append
  reqHeaderRow: '#request-pane-1 table tbody tr',
  reqRawCode: '#request-pane-2 pre > code',
  reqRawPlaceholder: '#request-pane-2 .alert',
  reqHexCode: '#request-pane-3 pre > code',

  // Response side — same component, same id scheme (see §1.4 for verification status).
  respSection: '#response-pane-0',           // anchor for the response section
  respInspector: 'div[class*="_inspector_"]',// reached via .closest() from respSection
  respHeaderRow: '#response-pane-1 table tbody tr',
  respRawCode: '#response-pane-2 pre > code',
  respRawPlaceholder: '#response-pane-2 .alert',
  respHexCode: '#response-pane-3 pre > code',
  respSummaryBody: '#response-pane-0 pre > code',   // reformatted body (ngrok's own pretty form)
};

/** Verified against ngrok 3.39.11. Logs a one-line warning if the DOM shape moved on. */
export function assertDashboardShape() {
  const required = ['app', 'navbar', 'listRow', 'panel', 'toolbarSlot'];
  const missing = required.filter((k) => !document.querySelector(SEL[k]));
  if (missing.length) {
    console.warn(
      `[ngrok-inspect-plus] dashboard DOM changed — missing: ${missing.join(', ')}. ` +
      `Verified against ngrok 3.39.11; this build may be newer. Features will no-op.`
    );
    return false;
  }
  return true;
}
```

### 2.4 Injection and re-render survival

A single `MutationObserver` on `#app` (`childList`, `subtree`, `characterData`) drives everything:

```js
// content/observer.js  (concept)
let scheduled = false;

function ensureAll() {
  scheduled = false;
  if (!assertDashboardShape()) return;
  for (const feature of features) {
    try { feature.ensure(); }            // MUST be idempotent
    catch (err) { console.warn('[ngrok-inspect-plus] feature failed', feature.id, err); }
  }
}

export function start() {
  const app = document.querySelector(SEL.app);
  if (!app) return;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(ensureAll);     // coalesce the ~1 Hz poll into ≤1 pass/frame
  }).observe(app, { childList: true, subtree: true, characterData: true });
  ensureAll();
}
```

Rules that make this safe:

1. **Idempotency:** every injected node carries `data-ngpp="<feature>"`; `ensure()` queries for it
   first and returns early if present. Re-running `ensureAll()` is always a no-op when nothing
   changed.
2. **No self-observation loop:** we only *add* nodes we then find by `data-ngpp`, so the next
   `ensure()` pass short-circuits and stops mutating.
3. **`requestAnimationFrame` coalescing** (not `setTimeout`) keeps the observer off the critical
   path during the poll burst.
4. **Never trust a stale closure.** Handlers read the DOM at event time (§4.4, §5.4).
5. **Teardown on route change is unnecessary** — the observer re-asserts on every mutation, so
   navigating `/inspect/http` → `/status` → back simply re-runs `ensure()`.

---

## 3. Feature 1 — Dark mode

### 3.1 Requirements

- A dark theme for the whole dashboard (all routes, all tabs, including the Bootstrap
  `alert`, `dropdown-menu`, `pre`/`code`, hljs tokens, tables and nav-tabs).
- **No flash of light theme (FOUC)** on page load.
- No layout shift, no `!important` arms race, no fight with the SPA's own styling.

### 3.2 The FOUC problem, and why the obvious solution fails

`chrome.storage.sync.get()` is **asynchronous**. A naive `document_start` content script that reads
the stored mode and then adds a class will race the first paint on a warm cache — producing a white
flash for dark-mode users. The standard workarounds are bad:

- ❌ *Inline a flash guard* (`html { background:#111 }`) → flashes **dark** for light-mode users.
- ❌ *Use `@media (prefers-color-scheme: dark)` only* → cannot express a manual override.
- ❌ *Inject the class from the SW with `insertCSS`* → always after paint, always a flash.
- ❌ *CSS `@layer`* → **layered styles lose to unlayered styles**, so `@layer` makes our overrides
  *lose* to Bootstrap. Actively harmful here.

### 3.3 Chosen strategy — encode the mode in the *registration*, not in a runtime read

`chrome.scripting.registerContentScripts()` persists a content-script registration in the profile.
So the persisted theme mode **is** the registration state, and the class can be applied
**synchronously at `document_start`** with no async read anywhere in the page's critical path.

**Static registration** (in `manifest.json`) — always present, but **inert without the class**:

```jsonc
{ "matches": ["http://localhost:4040/*", "http://127.0.0.1:4040/*"],
  "css": ["theme/dark.css"], "run_at": "document_start" }
```

**Dynamic registration** (owned by the service worker) — a 1-line bootstrap script:

| `themeMode` | Dynamically registered script | Effect |
|---|---|---|
| `light` | *(none)* | `dark.css` present but inert |
| `dark` | `theme/apply-dark.js` | class added unconditionally |
| `auto` | `theme/apply-dark-auto.js` | class added iff the OS is dark |

```js
// theme/apply-dark.js
document.documentElement.classList.add('ngpp-dark');

// theme/apply-dark-auto.js
if (matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.classList.add('ngpp-dark');
}
```

`matchMedia` is **synchronous**, so even `auto` mode is decided before first paint. No async
storage read, no flash guard, no `insertCSS`.

```js
// background/service-worker.js (concept)
const SCRIPT_ID = 'ngpp-theme-apply';
const APPLY = { dark: 'theme/apply-dark.js', auto: 'theme/apply-dark-auto.js' };

async function reconcileThemeRegistration() {
  const { themeMode = 'auto' } = await getSettings();
  const existing = (await chrome.scripting.getRegisteredContentScripts())
    .find((s) => s.id === SCRIPT_ID);
  if (existing) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });

  const js = APPLY[themeMode];
  if (!js) return;                                   // 'light' → nothing to register
  await chrome.scripting.registerContentScripts([{
    id: SCRIPT_ID,
    matches: ['http://localhost:4040/*', 'http://127.0.0.1:4040/*'],
    js: [js],
    runAt: 'document_start',
    allFrames: false,
  }]);
}

chrome.runtime.onInstalled.addListener(reconcileThemeRegistration);
chrome.runtime.onStartup.addListener(reconcileThemeRegistration);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) { reconcileThemeRegistration(); broadcastTheme(); }
});
```

**Live toggling of already-open tabs** is then purely a class flip — no CSS insertion needed,
because `dark.css` is already there:

```js
// background: push to open dashboards
const tabs = await chrome.tabs.query({ url: ['http://localhost:4040/*', 'http://127.0.0.1:4040/*'] });
for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'ngpp:theme', mode }).catch(() => {});

// content/theme.js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'ngpp:theme') return;
  const on = msg.mode === 'dark' ||
    (msg.mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('ngpp-dark', on);
});
```

**`auto` + live OS change:** one extra listener in `theme.js` keeps the class honest without a
reload:

```js
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (getCachedMode() !== 'auto') return;
  document.documentElement.classList.toggle('ngpp-dark', e.matches);
});
```

### 3.4 Cascade strategy — win on specificity, not on `!important`

Two mechanisms, both needed:

1. **Scope every rule under `html.ngpp-dark`.** This gives specificity `(0,1,1)` — it beats
   Bootstrap's single-class rules `(0,1,0)` (`body`, `.navbar-inverse`, `.table > tbody > tr > td`)
   *without* `!important`.
2. **Never use `@layer`** (unlayered page CSS would win), and reserve `!important` for the handful
   of Bootstrap rules that themselves use it.

For hashed module classes, combine both: `html.ngpp-dark [class*="_params_"]` = `(0,2,1)`.

```css
/* theme/dark.css — structure, not the full list */
html.ngpp-dark {
  color-scheme: dark;                    /* native scrollbars, form controls, caret */
  background-color: var(--ngpp-bg);
}
html.ngpp-dark body        { background-color: var(--ngpp-bg); color: var(--ngpp-fg); }
html.ngpp-dark .navbar-inverse { background-color: var(--ngpp-nav); border-color: var(--ngpp-line); }
html.ngpp-dark .container,
html.ngpp-dark .row        { background: transparent; }
html.ngpp-dark hr          { border-color: var(--ngpp-line); }
html.ngpp-dark .table > tbody > tr > td,
html.ngpp-dark .table > tbody > tr > th { border-color: var(--ngpp-line); }
html.ngpp-dark .table-hover > tbody > tr:hover { background-color: var(--ngpp-surface-2); }
html.ngpp-dark .nav-tabs > li > a          { color: var(--ngpp-fg-muted); border-color: transparent; }
html.ngpp-dark .nav-tabs > li.active > a   { background-color: var(--ngpp-surface); border-color: var(--ngpp-line); }
html.ngpp-dark .dropdown-menu              { background-color: var(--ngpp-surface); border-color: var(--ngpp-line); }
html.ngpp-dark .form-control               { background-color: var(--ngpp-surface); color: var(--ngpp-fg); }
html.ngpp-dark .btn-default                { background-color: var(--ngpp-surface-2); color: var(--ngpp-fg); }
html.ngpp-dark .alert-info                 { background-color: var(--ngpp-info-bg); color: var(--ngpp-info-fg); }
html.ngpp-dark .muted,
html.ngpp-dark .text-muted                 { color: var(--ngpp-fg-muted) !important; }
html.ngpp-dark [class*="_params_"] th,
html.ngpp-dark [class*="_params_"] td      { border-color: var(--ngpp-line); }
html.ngpp-dark pre, html.ngpp-dark code    { background-color: var(--ngpp-code-bg); color: var(--ngpp-fg); }
```

`dark.css` is the *only* stylesheet we author, and it opens with a token block so the palette is
tunable in one place:

```css
html.ngpp-dark {
  --ngpp-bg: #14171c;  --ngpp-surface: #1b1f26;  --ngpp-surface-2: #232833;
  --ngpp-nav: #0d1014; --ngpp-line: #2f3642;
  --ngpp-fg: #dfe3ea;  --ngpp-fg-muted: #98a1b0;
  --ngpp-code-bg: #0f1216;
  --ngpp-info-bg: #17262f; --ngpp-info-fg: #9fd3ee;
}
```

**Also required** (Bootstrap 3 has no dark variant, so these are the fiddly ones):

- **highlight.js** ships a *light* token theme. Provide dark values for `hljs-attr`, `hljs-string`,
  `hljs-keyword`, `hljs-name`, `hljs-tag`, `hljs-meta` (they are the body preview in the Summary tab).
- **Glyphicons** are a font — they inherit `color`, so they need no rule beyond the parent.
- **`::selection`** should be restyled, otherwise the light default is jarring.
- **`color-scheme: dark`** on `html.ngpp-dark` handles native scrollbars and the `<input>` caret.

### 3.5 Where does the toggle live?

**Primary control: the extension popup.** Reasons: it cannot be wiped by a React re-render, it is
the discoverable, conventional place for extension settings, and it avoids injecting interactive
chrome into the dashboard's own navbar (which ngrok may restructure). The popup is a 3-way
`radiogroup` (`Auto` / `Light` / `Dark`) — a native radiogroup is keyboard-navigable for free and
needs no custom ARIA.

**Optional secondary (Phase 6): a toggle button injected into the navbar**, anchored to
`#connection-status` (a stable id present on every route). Only worth adding if the popup proves
annoying; it adds a fifth injection site to maintain, so it is explicitly deferred.

Persistence: `chrome.storage.sync` under a single `settings` key (survives service-worker
termination; syncs across the user's Chrome profiles). Default `auto`.

### 3.6 Dark mode — task list

1. `theme/dark.css`: tokens + overrides for the 76-class census in §1.6.
2. `theme/apply-dark.js`, `theme/apply-dark-auto.js`.
3. Static `content_scripts` CSS entry for `dark.css` at `document_start`.
4. SW `reconcileThemeRegistration()` + `onInstalled` / `onStartup` / `storage.onChanged`.
5. `content/theme.js`: message handler + `prefers-color-scheme` change listener.
6. Popup radiogroup writing `settings.themeMode`.
7. Visual pass over every tab: Summary / Headers / Raw / Binary × request / response, plus
   `/status`, the filter dropdown, the "Clear Requests" button, the Replay dropdown, and the
   `alert-info` binary placeholder.

---

## 4. Feature 2 — Copy raw request as cURL

### 4.1 Where the button goes

The request toolbar already contains `#replay` inside `div.pull-right`. Inject a sibling **before**
the Replay group, inside `#replay.parentElement` (verified: that container holds exactly the Replay
`btn-group` and an empty `<form>`), so it reads as part of the same action cluster:

```
div.pull-right
  div._container_1bug4_1
    [ Copy as cURL ]            ← our button (data-ngpp="copy-curl")
    div#replay.btn-group        ← ngrok's
    form
```

Use Bootstrap's own `btn btn-default` classes so it inherits the dashboard's look (and our dark
overrides) for free. **Reuse `#replay`'s parent rather than the hashed `_container_1bug4_1` class** —
`#replay` is a hand-written stable id.

Also add a `Copy as cURL` item to the existing Replay `dropdown-menu` (Phase 6, optional) — it is a
`<ul role="menu">` with one `<li role="presentation"><a role="menuitem">`, so appending one more
`<li>` is trivial and low-risk.

### 4.2 Obtaining the raw request — the extraction cascade

Read **only** from the DOM (D1). Three sources, tried in order:

```js
// content/raw-request.js  (concept)
/**
 * @returns {{ kind: 'text'|'bytes'|'unavailable', bytes?: Uint8Array, text?: string, reason?: string }}
 */
export function readRawRequest() {
  // 1. Preferred: the Raw pane holds the exact request as text (verified for UTF-8 bodies ≤ 64 KiB).
  const code = document.querySelector(SEL.reqRawCode);
  if (code && code.textContent.trim()) {
    return { kind: 'text', text: code.textContent };
  }

  // 2. Fallback: the Binary pane holds a hex dump covering the FULL request byte-for-byte.
  //    Covers non-UTF-8 bodies and any case where the Raw pane bails out.
  const hex = document.querySelector(SEL.reqHexCode);
  if (hex && hex.textContent.trim()) {
    const bytes = parseHexDump(hex.textContent);
    if (bytes.length) return { kind: 'bytes', bytes };
  }

  // 3. Degraded: ngrok did not capture the body (observed at ~100 KiB+). Headers are still
  //    available from #request-pane-1, so the caller can still emit a headers-only curl.
  return { kind: 'unavailable', reason: 'ngrok did not capture this request body' };
}

function parseHexDump(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const hexCol = line.split('\t')[0];                 // "50 4f 53 54 20 2f 62 69"
    for (const tok of hexCol.trim().split(/\s+/)) {
      if (/^[0-9a-f]{2}$/i.test(tok)) out.push(parseInt(tok, 16));
    }
  }
  return Uint8Array.from(out);
}
```

**Why this order matters:** the hex pane is byte-exact for *everything*, but a 64 KiB body produces
**345 KB of DOM text** (measured) and requires a parse. The Raw pane is cheaper and already
human-readable, so it is preferred; the hex pane is the correctness net.

> **Do not read the REST API.** It happens to expose the same bytes today
> (`/api/requests/http/{id}` → base64 `request.raw`) but the UI does not use it, it **omits `raw`
> entirely above the capture limit** (verified), and it is a legacy surface that could be removed.
> If a secondary source is ever wanted, fetch it **from the service worker** with the
> `http://localhost:4040/*` host permission (which bypasses CORS) rather than from the page.

### 4.3 Parsing the raw request

```js
// content/curl.js  (pure — no DOM, no chrome.*, unit-testable)
export function parseRawRequest(bytes) {
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const splitAt = raw.indexOf('\r\n\r\n');
  const head = splitAt === -1 ? raw : raw.slice(0, splitAt);
  const body = splitAt === -1 ? '' : raw.slice(splitAt + 4);

  const lines = head.split('\r\n').filter(Boolean);
  const m = /^(\S+)\s+(\S+)\s+HTTP\/(\d\.\d)$/.exec(lines[0]);
  if (!m) return null;                                   // not a parseable request line

  const headers = [];
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':');
    if (i === -1) continue;                              // obs-fold / malformed → skip
    headers.push({ name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() });
  }
  return { method: m[1], target: m[2], version: m[3], headers, body };
}
```

Notes: tolerate `\n`-only line endings by normalising `\r\n`→`\n` first; the request line may use
**absolute-form** (`GET http://host/path HTTP/1.1`) for proxy-style requests — handle it (§4.4).

### 4.4 Curl generation rules (normative)

Given `{ method, target, headers, body }` and settings, emit:

```
curl -X POST 'https://test-extension.sa.ngrok.io/hello?x=1' \
  -H 'Accept: */*' \
  -H 'Content-Type: application/json' \
  --data-raw '{"name":"julio","n":2}'
```

**R1 — URL.**
- If `target` is absolute-form (`/^https?:\/\//`), use it verbatim.
- Else if a `Host` header exists → `` `https://${host}${target}` ``.
- Else → `` `${location.origin}${target}` ``.
- The dashboard only shows requests that arrived through the tunnel, so `https://` is the correct
  default scheme. `http://` is offered as a setting for HTTP-only tunnels (open question Q2).
- **Always wrap the URL in single quotes**, even when unnecessary — one rule, no special cases.

**R2 — method.** Always emit `-X <METHOD>`, including `GET`. Explicit beats implicit and matches the
convention of Chrome DevTools / Postman.

**R3 — header selection, preserving wire order and duplicates.**
- **Drop `Host`** — it is already encoded in the URL, and curl sets it from the URL.
- **Drop `Content-Length`** — curl recomputes it; emitting it risks a mismatch.
- **Drop `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Port`,
  `X-Real-Ip`** by default (`stripForwardedHeaders: true`) — these were **injected by ngrok**, not
  sent by the original client. Verified present on every captured request. Turning this off is
  useful when the goal is to *replay* the exact bytes ngrok forwarded.
- **Keep everything else**, including duplicates (`X-Multi: first` / `X-Multi: second` → two `-H`
  flags) and in the **original wire order** (the Raw pane preserves it; the Headers *tab* is
  alphabetised, which is why the Raw pane is the source of truth).
- **Empty header value:** curl needs the `Name;` form to send an empty-valued header, so emit
  `-H 'X-Foo;'`. A naive `-H 'X-Foo:'` makes curl *remove* the header.
- **`--compressed` (optional, default off):** when enabled and `Accept-Encoding` is present, drop
  that header and add `--compressed`. Default off keeps byte fidelity.

**R4 — body.**
- UTF-8 body → **`--data-raw '<body>'`**.
  - `--data-raw`, not `--data`: `--data` **strips newlines** (a `@`-prefixed value also becomes a
    file reference). `--data-raw` is literal. This matters — verified a body containing
    `line1\nline2 'single' "double"`.
  - `--data-binary` is equivalent for our purposes but `--data-raw` is the clearer intent.
- Non-UTF-8 body → the bytes came from the **hex** path. Emit a header-only curl plus a comment
  (`# body omitted: 12 bytes, non-UTF-8`), with an opt-in setting to emit an ANSI-C-quoted
  `--data-binary $'\x00\x01\x02\xff…'` (bash/zsh only).
- No body captured → header-only curl plus `# body not captured by ngrok (N bytes)`.
- Empty body → emit no body flag at all (do **not** emit `--data-raw ''`, which would send
  `Content-Length: 0`).

**R5 — shell quoting.** POSIX single-quote style, applied to the URL, every header value and the
body:

```js
export const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
```

Single-quote style is chosen deliberately: inside it **everything is literal** except `'` — so
`$`, `` ` ``, `"`, `\`, newlines and tabs need no special handling. Verified against a request
carrying `X-Dollar: $HOME \`id\``, `X-Quote: it's "quoted"` and a multi-line body.

**R6 — formatting.**
- **Multi-line (default):** first line `curl -X METHOD 'URL'`, then each `-H` on its own line, then
  the body flag last; every line but the last ends with ` \` (space + backslash + `\n`).
  Continuations are what DevTools and most tools emit and paste cleanly into bash/zsh.
- **Single-line (setting):** join with a single space. Required for Windows `cmd.exe`, where `\` is
  not a line continuation — document this in the popup.
- **Never** append a trailing newline to the clipboard payload (it makes paste-into-terminal
  immediately execute the command). `writeText` without `\n`.

**R7 — degraded mode.** When the body is unavailable, still emit the full curl **plus** a leading
comment, and surface a toast saying the body could not be included:

```
# ngrok-inspect-plus: body not captured by ngrok (100000 bytes) — headers only
curl -X POST 'https://test-extension.sa.ngrok.io/big' \
  -H 'Accept: */*' \
  -H 'Content-Type: text/plain'
```

### 4.5 Clipboard

`navigator.clipboard.writeText()` **works directly from the content script** — no offscreen
document, no `chrome.clipboard`, no `clipboardWrite` permission (which does not exist in MV3).

Verified on this exact target: `http://localhost:4040` **is a secure context** (localhost is
potentially-trustworthy), `navigator.clipboard.writeText` is present, and
`navigator.permissions.query({name:'clipboard-write'}).state` is `granted` by default for the
active tab. A probe write succeeded.

```js
// content/clipboard.js
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);      // needs transient activation — our click provides it
    return { ok: true };
  } catch (err) {
    return legacyCopy(text) ? { ok: true, legacy: true }
                            : { ok: false, error: err?.name ?? 'unknown' };
  }
}

/** Fallback for a blurred/older document. execCommand is deprecated but still functional. */
function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  const ok = (() => { try { return document.execCommand('copy'); } catch { return false; } })();
  ta.remove();
  return ok;
}
```

Failure mode to handle: `writeText` rejects with `NotAllowedError` when the document is **not
focused** (e.g. the user clicked in DevTools). The fallback covers it; if both fail, show an error
toast rather than failing silently.

**Clipboard from the popup:** the popup document *is* focused, so it may use `navigator.clipboard`
directly. The **service worker may not** — `navigator.clipboard` is unavailable in a worker, and
that is the *only* case where a `chrome.offscreen` document would be needed. This plan never copies
from the SW, so **no offscreen document is required**.

### 4.6 Copy-as-cURL — task list

1. `content/raw-message.js` — the parameterised 3-source extraction cascade (`createMessageReader`)
   plus `parseHexDump`; `content/raw-request.js` re-exports `readRawRequest` from it. Extracting the
   factory here (rather than in Feature 4) keeps the curl feature free of a later refactor — see
   R17 and G-5.
2. `content/curl.js` — `parseRawRequest`, `sh`, `toCurl` (pure functions; the unit-test surface).
3. `content/clipboard.js` — `copyText` + `legacyCopy`.
4. `content/toast.js` — `Copied!` / error announcements via `aria-live="polite"`.
5. `content/features/copy-curl.js` — idempotent button injection into `#replay.parentElement`,
   `data-ngpp="copy-curl"`, Bootstrap `btn btn-default`, `aria-label="Copy request as cURL"`.
6. Degraded-mode comment + toast when the body is unavailable.
7. Settings: `multiline`, `stripForwardedHeaders`, `includeCompressed`, `includeMethodAlways`.
8. Unit tests for `toCurl` against the fixtures in §9.2 (this is the one place where tests pay for
   themselves immediately).

---

## 5. Feature 3 — Copy per-request header

### 5.1 Locating header rows robustly

Scope to the request headers pane; the table class `_params_` is **shared** with the query-param and
form-param tables, so the pane id is mandatory:

```js
const rows = document.querySelectorAll('#request-pane-1 table tbody tr');   // name = th, value = td
```

This is the most robust anchor available: `#request-pane-1` is a **stable, hand-written id**, and
the `th`/`td` split is semantic rather than presentational. Duplicate header names appear as
separate rows (verified) — each gets its own copy button, which is exactly right.

Deliberately **not** used: the hashed `._headerTable_okyq9_54` / `._params_1j0lz_1` classes, which
change per build.

> **Response headers are now in scope** — this supersedes open question Q3. The response pane
> (`#response-pane-1`) has an **identical** structure, so the feature is implemented as one
> parameterised module instantiated twice:
> `createHeaderCopyFeature({ pane: '#request-pane-1', label: 'header' })` and
> `createHeaderCopyFeature({ pane: '#response-pane-1', label: 'response header' })`. See §6.6.

### 5.2 The affordance

Append a real `<button>` inside the existing `<td>` (a third `<td>` would make the row ragged —
the table has no `<thead>`):

```html
<tr>
  <th>Content-Type</th>
  <td>application/json<button type="button" data-ngpp="copy-header"
      class="ngpp-hdr-copy" aria-label="Copy header Content-Type">⧉</button></td>
</tr>
```

- **Real `<button>`**, not a clickable `<div>`: keyboard reachable, announced as a button, and
  `aria-label` gives it a name (an icon-only control without one is a WCAG 4.1.2 failure).
- Icon is an **inline SVG built with `createElementNS`** or a CSS `background-image` with a
  **`data:` URI** — deliberately avoiding `chrome.runtime.getURL()` assets, which would force a
  `web_accessible_resources` entry and expose extension internals to the page.
- Reveal on hover **and** `:focus-within` (keyboard users must see it), with space reserved
  permanently so hovering causes **no layout shift**:

```css
/* theme/dark.css owns only theme; this lives in the content-script sheet */
#request-pane-1 table tbody td { padding-right: 28px; position: relative; }
.ngpp-hdr-copy {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  opacity: 0; transition: opacity .12s ease; border: 0; background: transparent;
  color: var(--ngpp-fg-muted); cursor: pointer; line-height: 1;
}
#request-pane-1 table tbody tr:hover .ngpp-hdr-copy,
#request-pane-1 table tbody tr:focus-within .ngpp-hdr-copy,
.ngpp-hdr-copy:focus-visible { opacity: 1; }
.ngpp-hdr-copy:focus-visible { outline: 2px solid #4c9aff; outline-offset: 1px; }
```

**Opacity, not `display`/`visibility`** — `display:none` would remove the button from the tab order,
making it unreachable by keyboard.

### 5.3 Copy payload

One line, `Name: Value`:

```js
`${row.querySelector('th').textContent}: ${headerValue(row)}`
```

### 5.4 Reading the value at click time (the stale-closure trap)

Verified hazard: React **reuses the `tr`/`td` nodes** across selection changes while the header
count changes (`7 → 9`). An injected button therefore *survives* but may end up on a row that now
shows a **different** header. Any payload captured in a closure at injection time becomes wrong.

Two rules:

1. **One delegated listener per pane**, never one listener per button:

```js
pane.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-ngpp="copy-header"]');
  if (!btn) return;
  const row = btn.closest('tr');
  const name = row.querySelector('th')?.textContent?.trim() ?? '';
  const value = headerValue(row);
  if (name) copyText(`${name}: ${value}`);
});

/**
 * The button lives INSIDE the td, so a naive td.textContent would include the icon's text.
 * Clone, strip our nodes, then read.
 */
function headerValue(row) {
  const td = row.querySelector('td');
  if (!td) return '';
  const clone = td.cloneNode(true);
  clone.querySelectorAll('[data-ngpp]').forEach((n) => n.remove());
  return clone.textContent.trim();
}
```

2. **Refresh `aria-label` during the `ensure()` pass** so the accessible name never lies, and
   **re-inject if React replaced the row** (the `data-ngpp` check catches both cases):

```js
// content/features/copy-header.js
export function ensure() {
  for (const row of document.querySelectorAll(SEL.reqHeaderRow)) {
    const name = row.querySelector('th')?.textContent?.trim();
    const td = row.querySelector('td');
    if (!name || !td) continue;

    let btn = td.querySelector('[data-ngpp="copy-header"]');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.ngpp = 'copy-header';
      btn.className = 'ngpp-hdr-copy';
      btn.innerHTML = COPY_ICON_SVG;            // inline, no web_accessible_resources
      td.appendChild(btn);
    }
    const label = `Copy header ${name}`;
    if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);  // heal staleness
  }
}
```

### 5.5 Rejected alternative (documented on purpose)

A **zero-injection** design is possible: one delegated listener on the pane plus a CSS `::after`
affordance on `td:hover` (pseudo-elements are part of the parent's hit area, so the whole cell
becomes the copy target and no DOM mutation is needed — completely immune to re-renders). It was
rejected because it makes the **entire cell** clickable, which conflicts with selecting a header
value to copy manually, and it offers **no keyboard access** (pseudo-elements cannot receive
focus). Recording it here so the trade-off is not re-litigated later.

### 5.6 Per-header copy — task list

1. `content/features/copy-header.js` — idempotent `ensure()` + delegated click listener,
   **parameterised by pane id**.
2. Inline SVG icon constant (no external asset, no `web_accessible_resources`).
3. CSS for the affordance (hover + `:focus-within` + `:focus-visible`), reserved padding.
4. `aria-live="polite"` toast on copy.
5. Instantiate it **twice**: `#request-pane-1` (name = the header name) and `#response-pane-1`
   (name = the response header name). See §6.6 — this supersedes the former Q3.

---

## 6. Feature 4 — Copy response body

This is the counterpart to Feature 2. Where Feature 2 reconstructs the *request*, this feature hands
back the *response payload* the dashboard received. It also absorbs the response-headers copy (§6.6),
which closes the former open question Q3.

### 6.1 Where the response body lives in the DOM

The response section is the second half of `div[class*="_inspectRoundTrip_"]` (§1.3). Its panes are
**the same React component as the request panes**, with the same four tabs and the same id scheme:

| Pane | Tab | Holds | Role for this feature |
|---|---|---|---|
| `#response-pane-0` | Summary | status line, headers, **and the body section** | the **reformatted** body (ngrok's own pretty form, hljs-highlighted) |
| `#response-pane-1` | Headers | `table tbody tr` → `th` / `td` | `Content-Type` + `Content-Length` discovery; and the response-header copy (§6.6) |
| `#response-pane-2` | Raw | `<pre><code>`: status line + headers + CRLF CRLF + body | **primary byte source** |
| `#response-pane-3` | Binary | hex dump | **byte-exact fallback** |

**Is a tab switch required?** On the request side, **no** — all four panes are populated in the DOM
even while their tab is inactive (verified). The response panes are **assumed** to behave identically
because they are the same component; this is **A8 in §10.2** and is the first thing to confirm in
Phase 4, because it determines whether the feature is a pure DOM read or needs synthetic tab clicks.

> **Fallback if A8 turns out false:** synthesise a tab click via
> `document.getElementById('response-tab-2').click()`, wait for React's async re-render (verified to
> be async — a synchronous read straight after `.click()` returns stale content), then restore the
> previously active tab. This is strictly worse: it mutates the user's visible tab state, so it must
> only be used as a last resort, and the restore step must run even if the copy throws.

### 6.2 Extraction cascade — mirrors §4.2 exactly

The request reader is generalised rather than duplicated. One factory, two instances:

```js
// content/raw-message.js
/** @returns {{kind:'text'|'bytes'|'unavailable', text?:string, bytes?:Uint8Array, reason?:string}} */
export function createMessageReader({ rawCode, hexCode }) {
  return function read() {
    // 1. Preferred: the Raw pane holds the exact message as text.
    const code = document.querySelector(rawCode);
    if (code && code.textContent.trim()) return { kind: 'text', text: code.textContent };

    // 2. Fallback: the Binary pane holds a byte-exact hex dump of the FULL message.
    const hex = document.querySelector(hexCode);
    if (hex && hex.textContent.trim()) {
      const bytes = parseHexDump(hex.textContent);
      if (bytes.length) return { kind: 'bytes', bytes };
    }

    // 3. Degraded: ngrok did not capture the payload.
    return { kind: 'unavailable', reason: 'ngrok did not capture this response body' };
  };
}

export const readRawRequest  = createMessageReader({ rawCode: SEL.reqRawCode,  hexCode: SEL.reqHexCode  });
export const readRawResponse = createMessageReader({ rawCode: SEL.respRawCode, hexCode: SEL.respHexCode });
```

`parseHexDump` is unchanged from §4.2 (8 lowercase hex pairs per line, TAB, ASCII column).

**Splitting the body out of the raw response.** Unlike the curl feature, this one wants the *body
only*, so the head must be discarded:

```js
// content/response-body.js
export function splitRawResponse(text) {
  const at = text.indexOf('\r\n\r\n');
  if (at === -1) return { head: text, body: '' };     // no body separator → nothing to copy
  return { head: text.slice(0, at), body: text.slice(at + 4) };
}
```

`head` is parsed for the status line and headers only if the caller needs them (§6.5, "copy full raw
response"); the default path uses `body` alone.

**Third source — the Summary pane's reformatted body.** `#response-pane-0` contains a body section:
an `h6` whose text matches `/^\s*[\d,]+ bytes/`, immediately followed by a `pre > code`. This is
**ngrok's own rendering**, not the raw bytes — verified on the request side that it *reformats*
whitespace (`{"name":"julio","n":2}` → `{ "name": "julio", "n": 2 }`). It is therefore **never** used
for the default (fidelity) path, and is offered only as the "pretty" variant in §6.5.

```js
/** ngrok's reformatted body, or null. Locates the h6 that starts with "<n> bytes". */
function readSummaryBody() {
  for (const h6 of document.querySelectorAll('#response-pane-0 h6')) {
    if (!/^\s*[\d,]+\s+bytes/.test(h6.textContent)) continue;
    const code = h6.parentElement?.querySelector('pre > code');
    if (code?.textContent) return code.textContent;
  }
  return null;
}
```

### 6.3 Text vs binary classification, and charset handling

Classification is **data-driven, not content-type-sniffed**, in this order:

1. **`#response-pane-2 .alert` present, or no `pre > code`** → the dashboard itself refused to render
   the body as text. Treat as binary and go to the hex pane. (Verified behaviour on the request side:
   the alert text is literally `Binary request not displayed`.)
2. **Hex path taken** (`kind === 'bytes'`) → attempt `new TextDecoder('utf-8', { fatal: true })`.
   - decodes → the payload is UTF-8 text; copy it as text.
   - throws → genuine binary; do not emit mojibake (§6.5).
3. **Text path taken** (`kind === 'text'`) → the dashboard already decoded the bytes for display, so
   the text is trustworthy as-is.

**Charset.** Read `Content-Type` from `#response-pane-1` (the same `th`/`td` shape as the request
headers) and honour its `charset` parameter when decoding from bytes:

```js
function declaredCharset() {
  const rows = document.querySelectorAll(SEL.respHeaderRow);
  for (const row of rows) {
    if (row.querySelector('th')?.textContent.trim().toLowerCase() !== 'content-type') continue;
    const v = row.querySelector('td')?.textContent ?? '';
    return /charset=([\w-]+)/i.exec(v)?.[1]?.toLowerCase() ?? null;
  }
  return null;
}
// decode order: declaredCharset() → 'utf-8' → binary
```

Notes and edge cases:

- `TextDecoder` accepts many labels (`iso-8859-1`, `windows-1252`, `utf-16le`, …). Guard with
  `try/catch` — an unknown label throws `RangeError` — and fall back to UTF-8.
- A declared `charset` only matters on the **hex** path; on the **text** path the browser has already
  decoded, and re-decoding would corrupt the text.
- A leading **UTF-8 BOM** is preserved byte-for-byte in the raw path. Copying it is correct
  (fidelity) but it will look like a stray character in some editors — mention it in the popup help,
  do **not** strip it silently.
- `Content-Type` is frequently absent (the python test server's 501 has `text/html;charset=utf-8`,
  but a bare `204` has none). Absence is not an error — fall through to UTF-8.

### 6.4 Large, truncated and empty responses

Three distinct failure modes, all of which must be handled **without ever copying the wrong bytes**:

| Case | Detection | Behaviour |
|---|---|---|
| **Not captured** (above ngrok's capture limit) | `readRawResponse()` returns `kind:'unavailable'`; the Summary pane also reads `(0 bytes captured)` | **Disable** the button with `disabled` + a `title`/toast explaining *"response body not captured by ngrok"*. Never silently copy the headers instead. |
| **Truncated** (captured, but shorter than `Content-Length`) | compare the body byte length against `Content-Length` from `#response-pane-1` | Copy the bytes **and** append nothing, but surface a warning toast: *"copied N of M bytes (truncated by ngrok)"*. Also set a `title` on the button so the state is discoverable before clicking. |
| **Empty** (204 / 304 / HEAD, or `Content-Length: 0`) | body length is 0 | **Disable** the button with `title="no response body"`. Do not copy an empty string silently — the user cannot distinguish "nothing copied" from "copied nothing". |

The **request-side capture threshold was measured at "65 536 B captured, 102 400 B not"** (§1.4).
Whether the response side uses the same limit is **assumed, not measured** (**A9 in §10.2**) — ngrok
may cap request and response bodies independently. The degraded path above is therefore written to
trigger on *observed* absence rather than on a hard-coded threshold, so it stays correct either way.

A further unverified case: a **still-streaming / chunked** response. ngrok's inspector generally
lists only completed round trips, but if a body is captured mid-flight the copy would be partial and
would look like the truncation case above. Assumed low-frequency; tracked as **A10**.

### 6.5 Formatting options

Consistent with the curl feature's philosophy — **byte fidelity by default, transformations opt-in**:

| Setting | Default | Effect |
|---|---|---|
| `responseBody.format` | `raw` | `raw` = the exact body bytes as text (or as an escape sequence for binary). `pretty` = ngrok's reformatted body from `#response-pane-0` (JSON/HTML indented as the dashboard shows it). |
| `responseBody.prettyWhenJson` | `false` | Convenience: use `pretty` automatically when the decoded body parses as JSON. Off by default so the clipboard never disagrees with the Raw tab. |
| `responseBody.normaliseNewlines` | `false` | `\r\n` → `\n`. Helpful when pasting into an editor; off by default because it changes the bytes. |
| `responseBody.binaryFallback` | `comment` | `comment` = copy a placeholder line (`# binary response body, 512 bytes — not copied`) plus the metadata; `escaped` = emit an ANSI-C `$'…\xNN…'` string (bash/zsh only); `base64` = emit the base64 of the bytes. Never emit raw binary into the clipboard. |
| `responseBody.includeHeaders` | `false` | When true, copy the status line + headers + body ("copy full raw response") instead of the body alone. Exposed as a separate affordance rather than the default, since the brief asked for the *body*. |
| `responseBody.appendTrailingNewline` | `false` | **Off** — and note this is the *opposite* of the curl rule (§4.4 R6). For a curl command a trailing newline is dangerous (paste-to-terminal auto-executes); for a response body a trailing newline is **data**, so it is copied exactly as captured and never added. |

Two rules that must not be broken:

- **No silent normalisation.** Whatever is copied must be reproducible from the Raw tab. Any
  transformation is opt-in and named.
- **No `JSON.parse` → `JSON.stringify` round trip on the default path.** It would reorder nothing but
  *would* rewrite number precision and whitespace — a fidelity bug. Pretty output comes from ngrok's
  own rendering (`#response-pane-0`), not from us re-serialising.

### 6.6 Response headers (closes Q3)

Implemented by instantiating Feature 3's module against the response pane — no new logic:

```js
createHeaderCopyFeature({ pane: SEL.respHeaderRow, label: 'response header' });
```

Everything in §5 applies unchanged: `th` name / `td` value, one `Name: Value` line, the injected
button inside the existing `td` (the table has no `<thead>`, so no third cell), value read from a
cloned `td` with our own nodes stripped, and `aria-label` healed on every `ensure()` pass. The
staleness hazard of §5.4 applies identically here.

### 6.7 The affordance

**There is no existing toolbar to reuse.** `.pull-right` occurs exactly once in the panel and it is
on the *request* side (verified, §1.3). So the response-body control builds its own container,
mirroring the request layout so the two halves of the panel look alike:

```
div[class*="_inspectRoundTrip_"]
  div                                     ← request section (unchanged)
    h3.wrapped
    div[class*="_inspector_"]
      div.pull-right  → [ Copy as cURL ]  → div#replay.btn-group
      ul[role=tablist] + .tab-content
  hr._withMargin_
  div                                     ← response section
    h3.text-danger
    div[class*="_inspector_"]             ← anchor: #response-pane-0 → .closest(...)
      div.pull-right                      ← CREATED BY US (data-ngpp="resp-toolbar")
        div.btn-group                     ← [ Copy body ▾ ]
      ul[role=tablist] + .tab-content
```

```js
// content/features/copy-response.js
export function ensure() {
  const pane = document.querySelector(SEL.respSection);
  const inspector = pane?.closest(SEL.respInspector);
  if (!inspector) return;                       // no request selected, or DOM drifted → no-op

  let bar = inspector.querySelector('[data-ngpp="resp-toolbar"]');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'pull-right';
    bar.dataset.ngpp = 'resp-toolbar';
    bar.innerHTML = '<div class="btn-group">…</div>';   // Bootstrap classes → inherits the theme
    inspector.prepend(bar);                     // before the tab list, matching the request side
  }
  syncResponseButtonState(bar);                 // disabled / warning state per §6.4
}
```

Design decisions, matching Feature 2:

- **Bootstrap `btn btn-default` / `btn-group` classes**, so the control inherits the dashboard's look
  *and* our dark-mode overrides for free.
- **`prepend` before the `ul[role=tablist]`**, which is where the request side's `.pull-right` sits —
  so the two toolbars line up visually.
- **Idempotent via `data-ngpp="resp-toolbar"`**, re-asserted by the shared observer (§2.4). No new
  observer is introduced.
- **A single primary button** ("Copy body"), with an optional `btn-group` caret exposing
  "Copy body as pretty JSON", "Copy full raw response", and the binary-format override. The caret is
  only rendered when it adds something (i.e. when the payload is JSON or binary) — an always-visible
  caret that usually contains nothing useful is worse than no caret.
- **Disabled state carries the reason** via `title` + `aria-label`, because a disabled button is not
  focusable and therefore cannot show a tooltip to a keyboard user — so the reason is *also* mirrored
  into the toast on click of the surrounding group. (Concretely: when disabled, we keep it focusable
  with `aria-disabled="true"` and a click handler that explains, instead of the `disabled` attribute.
  This is the standard accessible pattern for "disabled with a reason".)
- **Keyboard:** `aria-label="Copy response body"`, visible `:focus-visible` ring, reachable by `Tab`.

### 6.8 Clipboard

Identical to §4.5 — `navigator.clipboard.writeText()` from the content script, with the
`document.execCommand` fallback, and the same `aria-live="polite"` toast. Nothing about this feature
changes the clipboard story:

- `http://localhost:4040` is a **secure context** and `clipboard-write` is **granted by default**
  (verified) → **no permission needed**, no `chrome.clipboard`, no offscreen document.
- Our button click supplies the required transient user activation.
- On failure (e.g. the document lost focus to DevTools), the fallback runs, and if both fail an error
  toast is shown rather than failing silently.

One difference worth stating: the payload can be **large** (a 64 KiB body was verified to render in
full). `writeText` handles that, but the toast must not echo the payload — announce only
*"Copied 65 536 bytes"* / *"Copied 12 lines"*.

### 6.9 Copy-response-body — task list

1. Refactor `raw-request.js` → `raw-message.js` (`parseHexDump` + `createMessageReader` factory) and
   re-export `readRawRequest` from it, keeping §4.2's behaviour byte-identical. **Land this before
   Feature 4** so Feature 2 is not regressed.
2. `content/raw-response.js` — `readRawResponse` over `#response-pane-2` / `#response-pane-3`.
3. `content/response-body.js` — `splitRawResponse`, `declaredCharset`, `classifyBody`
   (text | utf8 | binary), `toCopyableBody(bytes, settings)` (raw / pretty / escaped / base64).
4. `content/features/copy-response.js` — create the `.pull-right` container inside the response
   `_inspector_`, idempotent via `data-ngpp="resp-toolbar"`.
5. State machine for §6.4: available / empty / truncated / not-captured, driving `aria-disabled`,
   `title` and the toast message.
6. Optional caret: "Copy body as pretty JSON" (from `#response-pane-0`), "Copy full raw response".
7. `createHeaderCopyFeature({ pane: SEL.respHeaderRow, label: 'response header' })` — closes Q3 (§6.6).
8. Settings additions: `responseBody.*` (§6.5), surfaced in the popup.
9. Unit tests for `splitRawResponse` + `classifyBody` + `toCopyableBody` against the §9.2 fixtures
   (pure functions, no DOM — same rationale as `curl.js`).

---

## 7. `manifest.json` sketch

```jsonc
{
  "manifest_version": 3,
  "name": "ngrok-inspect-plus",
  "version": "0.1.0",
  "description": "Dark mode, copy-as-cURL and per-header copy for the local ngrok dashboard.",
  "minimum_chrome_version": "120",

  // Needed to own the theme's dynamic content-script registration (the no-FOUC mechanism),
  // and for tabs.query({url}) when broadcasting a live theme change.
  "permissions": ["storage", "scripting"],

  // Required so content scripts may be injected into the dashboard, and so
  // chrome.scripting.registerContentScripts accepts these matches.
  // Both loopback spellings are covered: the dashboard is reachable as either.
  "host_permissions": [
    "http://localhost:4040/*",
    "http://127.0.0.1:4040/*"
  ],

  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },

  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "ngrok-inspect-plus",
    "default_icon": { "16": "icons/16.png", "32": "icons/32.png" }
  },

  "content_scripts": [
    {
      // The theme sheet is ALWAYS injected but is inert unless <html> has .ngpp-dark,
      // which is applied synchronously at document_start by a dynamically registered
      // 1-line script. This is what removes the flash-of-light-theme.
      "matches": ["http://localhost:4040/*", "http://127.0.0.1:4040/*"],
      "css": ["theme/dark.css"],
      "run_at": "document_start",
      "all_frames": false
    },
    {
      // The feature layer only needs the DOM to be up.
      "matches": ["http://localhost:4040/*", "http://127.0.0.1:4040/*"],
      "js": [
        "content/selectors.js",
        "content/settings.js",
        "content/toast.js",
        "content/clipboard.js",
        "content/raw-message.js",
        "content/raw-request.js",
        "content/raw-response.js",
        "content/response-body.js",
        "content/curl.js",
        "content/theme.js",
        "content/features/copy-curl.js",
        "content/features/copy-header.js",
        "content/features/copy-response.js",
        "content/observer.js",
        "content/main.js"
      ],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],

  "icons": { "16": "icons/16.png", "32": "icons/32.png",
             "48": "icons/48.png", "128": "icons/128.png" }
}
```

### Permission justification (each one, and each omission)

> **Feature 4 changes no permissions and no registration.** Copying the response body is a pure DOM
> read plus a clipboard write — the same capabilities Features 2 and 3 already require. The only
> manifest delta is the three new `js` entries above (`raw-message.js`, `raw-response.js`,
> `response-body.js`) and `features/copy-response.js`. **No new `permissions`, no new
> `host_permissions`, no new `web_accessible_resources`.**

| Key | Needed? | Justification |
|---|---|---|
| `manifest_version: 3` | ✅ | Project decision (`.okf/concepts/manifest-v3.md`). |
| `storage` | ✅ **required** | Persist `themeMode` + curl options. Mandatory because the MV3 service worker is terminated at will — no in-memory state may be assumed. |
| `scripting` | ✅ **required** | `registerContentScripts` / `unregisterContentScripts` is the no-FOUC mechanism (§3.3). Without it, dark mode flashes. |
| `host_permissions: http://localhost:4040/*` | ✅ **required** | Content-script injection into the dashboard, and `chrome.scripting.registerContentScripts` requires host permission for its `matches`. Match patterns **do** accept a port. |
| `host_permissions: http://127.0.0.1:4040/*` | ✅ recommended | The agent dashboard answers on both spellings of loopback; omitting this silently breaks anyone who browses to `127.0.0.1:4040`. |
| `activeTab` | ❌ **not needed** | It is a *substitute* for host permissions granted on user gesture. We hold explicit `host_permissions` for the exact origin, so `activeTab` would be dead weight. |
| `tabs` | ❌ **not needed** | `chrome.tabs.query`/`sendMessage` work without it. Only *reading* `tab.url`/`tab.title` needs `tabs` (or host permission) — and filtering `tabs.query({url: [...]})` is covered by our host permissions. |
| `clipboardWrite` | ❌ **does not exist** | Not a valid MV3 permission. `navigator.clipboard.writeText()` on a user gesture needs none (verified: `clipboard-write` is `granted` by default). |
| `web_accessible_resources` | ❌ **not needed** | Nothing is loaded from the page by extension URL: icons are inline SVG / `data:` URIs, and no MAIN-world script is injected. **Deliberately avoiding this keeps extension internals out of the page.** |
| `all_frames` | ❌ left `false` | Verified: the dashboard is a single top-level document with no iframes. `true` would double-inject UI for no benefit. |
| `optional_host_permissions` | ❌ v1 | Would enable a configurable dashboard port/origin (§10, Q1). Deferred until asked for. |

---

## 8. Build & dev tooling

**Recommendation: none. Plain ES2022 files, loaded unpacked from the repo root.**

Rationale, given this is a ~10-file extension with **zero runtime dependencies**:

- **No bundler is required to ship.** MV3 loads `content_scripts.js` as **classic scripts in array
  order**, sharing one isolated-world global. That is sufficient module structure for this size
  (verified: all content scripts share the extension's isolated world).
- **The service worker supports ESM natively** via `"type": "module"`, so it can `import` shared
  files without a bundler.
- **No `eval`, no remote code** — trivially satisfied by shipping plain files, which is the
  cleanest possible answer to the MV3 remote-code constraint.
- **No build step means no stale-`dist` class of bug** and no `npm install` before the first run,
  which matters for a tool whose whole purpose is local convenience.
- The dark-mode design needs **one** CSS file, so the usual bundler motivation (generating a
  media-query variant) evaporates — §3.3 encodes the mode in the registration instead.

**Load-unpacked workflow** (documented in `AGENTS.md` once code lands):

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the repo root.
2. After editing content scripts: reload the **dashboard tab** (`Cmd+R`).
3. After editing `background/service-worker.js`: click the **reload** icon on the extension card
   (the SW is not hot-reloaded), then reload the dashboard tab.
4. After editing `manifest.json`: reload the extension, then the tab.

**When to graduate to a bundler** — explicitly out of scope now, revisit only if:

- TypeScript is wanted (then: **esbuild**, `--format=iife --bundle`, one entry per content script,
  no code splitting — the smallest possible config);
- or the CSS override surface grows enough that a shared `@media`-wrapped variant is worth
  generating;
- or a runtime dependency appears.

**Optional niceties** (nice-to-have, not required):

- `package.json` with **prettier + eslint only** (dev-only, no runtime deps) so `npm run lint` exists.
- A `Makefile` with `make load` (prints the load-unpacked steps) and `make test` (runs the
  `curl.js` unit tests) — matches the Makefile convention used across this workspace.
- **Do not** add `webpack`/`vite`/`rollup`/React/TypeScript for a 10-file extension.

**Git:** this directory is not a repository yet. `git init` + an initial commit is a prerequisite
step (`.okf` and `docs/` should be committed; a `dist/` dir should not exist at all).

---

## 9. Testing & verification

### 9.1 Bring up the target (from the runbook)

```bash
cd /Users/julio/Projects/ngrok-inspect-plus
python3 -m http.server 8080 &                 # serves the workspace
ngrok http 8080 --domain test-extension       # → https://test-extension.sa.ngrok.io
# dashboard: http://localhost:4040  (302 → /inspect/http)
```

> `--subdomain` is deprecated in 3.39.11 and maps to `--domain`; `test` is reserved to another
> account — use `test-extension` (recorded in `.okf/concepts/local-testing.md`).

### 9.2 Fixture corpus (reproduces every branch)

These are the exact commands used to gather the evidence in §1; they double as the regression set:

```bash
B=https://test-extension.sa.ngrok.io

# 1. GET, no body
curl -s -o /dev/null "$B/"

# 2. POST, JSON body
curl -s -o /dev/null -X POST "$B/hello?x=1" \
  -H 'X-Custom-Header: abc123' -H 'Content-Type: application/json' \
  --data-raw '{"name":"julio","n":2}'

# 3. PUT: duplicate headers, quotes, $, backticks, multi-line body
curl -s -o /dev/null -X PUT "$B/edge?a=1&b=two%20words" \
  -H 'X-Multi: first' -H 'X-Multi: second' \
  -H 'X-Quote: it'"'"'s "quoted"' -H 'X-Dollar: $HOME `id`' \
  --data-raw "line1
line2 'single' \"double\""

# 4. non-UTF-8 body  → must exercise the HEX fallback
printf '\x00\x01\x02\xff\xfe\x80binary' > /tmp/bin.dat
curl -s -o /dev/null -X POST "$B/binary" \
  -H 'Content-Type: application/octet-stream' --data-binary @/tmp/bin.dat

# 5. 64 KiB body → Raw pane must still be complete
python3 -c "import sys;sys.stdout.write('B'*65536)" > /tmp/big.txt
curl -s -o /dev/null -X POST "$B/size65536" -H 'Content-Type: text/plain' --data-binary @/tmp/big.txt

# 6. ~100 KiB body → DEGRADED path (body not captured by ngrok)
python3 -c "import sys;sys.stdout.write('B'*102400)" > /tmp/huge.txt
curl -s -o /dev/null -X POST "$B/huge" -H 'Content-Type: text/plain' --data-binary @/tmp/huge.txt

# 7. empty header value
curl -s -o /dev/null "$B/emptyhdr" -H 'X-Empty;'
```

**Response-body fixtures (Feature 4).** Every fixture above gets a *response* too, but fixtures 2–7
all return python's 501 error page, which only exercises one body shape. Controlled bodies need a
custom handler:

```bash
# Serve a THROWAWAY directory on :8080 so (a) no fixture files land in the repo and (b)
# Content-Type / status / charset are under our control. Kill the runbook's
# `python3 -m http.server 8080` first — this replaces it on the same port, so the ngrok
# tunnel (and therefore the dashboard) is unaffected.
FIX=$(mktemp -d)
printf '{"a":1,"b":[true,null,"x"],"c":{"d":2}}'              > "$FIX/data.json"
printf '<!doctype html><html><body><h1>hi</h1></body></html>' > "$FIX/page.html"
printf 'caf\xe9 na\xefve'                                     > "$FIX/latin1.bin"
head -c 4096 /dev/urandom                                     > "$FIX/blob.bin"
python3 -c "import sys;sys.stdout.write('L'*65536)"           > "$FIX/large.txt"
python3 -c "import sys;sys.stdout.write('L'*102400)"          > "$FIX/huge.txt"

cat > "$FIX/server.py" <<'PY'
import http.server
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/empty':                       # 204 → EMPTY branch
            self.send_response(204); self.end_headers(); return
        if self.path == '/latin1':                      # declared non-UTF-8 charset
            b = open('latin1.bin','rb').read()
            self.send_response(200)
            self.send_header('Content-Type','text/plain; charset=iso-8859-1')
            self.send_header('Content-Length',str(len(b))); self.end_headers()
            self.wfile.write(b); return
        if self.path == '/truncated':                   # Content-Length lies → TRUNCATED branch
            b = b'0123456789'
            self.send_response(200)
            self.send_header('Content-Type','text/plain')
            self.send_header('Content-Length','9999'); self.end_headers()
            self.wfile.write(b); return
        return super().do_GET()
H.extensions_map['.bin'] = 'application/octet-stream'
http.server.ThreadingHTTPServer(('127.0.0.1', 8080), H).serve_forever()
PY
(cd "$FIX" && python3 server.py &)   # replaces the runbook server on :8080

B=https://test-extension.sa.ngrok.io
curl -s -o /dev/null "$B/data.json"     #  8. JSON body      → raw + pretty branches, charset from Content-Type
curl -s -o /dev/null "$B/page.html"     #  9. HTML body      → text path, hljs-rendered Summary
curl -s -o /dev/null "$B/latin1"        # 10. charset=iso-8859-1 → decode branch (non-UTF-8 but NOT binary)
curl -s -o /dev/null "$B/empty"         # 11. 204           → EMPTY branch (button must disable)
curl -s -o /dev/null "$B/truncated" || true   # 12. Content-Length mismatch → TRUNCATED branch
curl -s -o /dev/null "$B/blob.bin"      # 13. binary        → alert + hex fallback
curl -s -o /dev/null "$B/large.txt"     # 14. 64 KiB        → full body
curl -s -o /dev/null "$B/huge.txt"      # 15. 100 KiB       → NOT-CAPTURED branch
```

> Fixture 12 deliberately makes curl exit non-zero (premature end of body), hence `|| true`; the
> request is still recorded by ngrok, which is all the test needs.

### 9.3 Per-feature verification

**Dark mode**

| # | Check | Method |
|---|---|---|
| D-1 | Class applied before first paint | `chrome-devtools` `performance_start_trace` + hard reload; assert no light frame; or screenshot at `document_start` |
| D-2 | No FOUC on a warm cache | Reload 10× with the cache warm; watch for a white flash (screencast) |
| D-3 | All three modes | Popup Auto/Light/Dark → assert `document.documentElement.classList.contains('ngpp-dark')` and the computed `body` background |
| D-4 | Live toggle without reload | Flip the popup while the dashboard is open; assert the class and colours change immediately |
| D-5 | Survives navigation | `/inspect/http` → `/status` → back; assert the theme persists with no flash |
| D-6 | Full coverage | Visit Summary / Headers / Raw / Binary × request / response, `/status`, the filter dropdown, the Replay dropdown, and the binary `.alert-info` placeholder; screenshot each |
| D-7 | Contrast | Run the `chrome-devtools` `lighthouse_audit` a11y pass; body text must be ≥ 4.5:1 |
| D-8 | `auto` follows the OS | `emulate` a dark `prefers-color-scheme`; assert the class appears without a reload |

**Copy as cURL**

| # | Check | Method |
|---|---|---|
| C-1 | Byte-fidelity of the generated command | For fixtures 1–3, compare the generated `--data-raw` payload against `base64 -d` of `/api/requests/http/{id}.request.raw` — must match **exactly** |
| C-2 | Duplicate headers | Fixture 3 → exactly two `-H 'X-Multi: …'` flags, in wire order |
| C-3 | Quoting | Fixture 3 → paste into zsh; the server must receive the same `X-Quote`/`X-Dollar` bytes |
| C-4 | Multi-line body | Fixture 3 → the body keeps its newline (proves `--data-raw`, not `--data`) |
| C-5 | Hex fallback | Fixture 4 → assert a `# body omitted` comment (or the opt-in `$'…'` form) and **no crash** |
| C-6 | 64 KiB body | Fixture 5 → the full body is present in the output |
| C-7 | Degraded path | Fixture 6 → headers-only curl + comment + warning toast |
| C-8 | Empty header value | Fixture 7 → `-H 'X-Empty;'` (with the semicolon) |
| C-9 | **End-to-end round trip** | Run the generated curl, then confirm the *new* request in the dashboard has identical method, path and headers. **This is the strongest single test.** |
| C-10 | No trailing newline | Paste into a terminal; the command must not auto-execute |
| C-11 | Button survives | Let the page sit 60 s (≈60 re-renders) and click copy — must still work |
| C-12 | Selection change | Switch between fixtures 1→5→4 and copy each time; output must track the **current** selection |

**Per-header copy**

| # | Check | Method |
|---|---|---|
| H-1 | One button per header row | Fixture 3 → 13 rows, 13 buttons |
| H-2 | Payload format | Click `Content-Type` → clipboard is exactly `Content-Type: application/json` |
| H-3 | Duplicates are distinct | Click both `X-Multi` rows → `X-Multi: first`, then `X-Multi: second` |
| H-4 | Value excludes the icon | Assert no stray glyph in the clipboard payload |
| H-5 | **Staleness heal** | Select fixture 3 (13 headers), then fixture 1 (7 headers), then copy row 0 — the payload must match the *currently displayed* header, and `aria-label` must agree |
| H-6 | Keyboard only | `Tab` to a button → it becomes visible (`:focus-within`) → `Enter` copies |
| H-7 | No layout shift | Hover a row; assert no reflow of the value column |
| H-8 | Idempotency | After 60 s of re-renders, `document.querySelectorAll('[data-ngpp="copy-header"]').length === rowCount` (no duplicates) |
| H-9 | **Response headers** (Q3) | Same as H-1…H-4 against `#response-pane-1`; assert the payload uses the response header name and that the two panes' buttons do not interfere |
| H-10 | Response staleness | Repeat H-5 across a response change (fixture 8 → fixture 15, different header sets) |

**Copy response body** (fixtures 8–15)

| # | Check | Method |
|---|---|---|
| B-1 | **A8 first** — panes populated while inactive | With the Summary tab active, read `#response-pane-2 pre > code` and `#response-pane-3 pre > code` directly. If empty, A8 is false and the synthetic-tab-click fallback in §6.1 is required. **Do this before writing any Feature 4 code.** |
| B-2 | JSON body, raw fidelity | Fixture 8 → clipboard must equal the exact bytes of `/data.json` (`{"a":1,"b":[true,null,"x"],"c":{"d":2}}`), **not** the reformatted Summary rendering |
| B-3 | JSON body, pretty variant | Fixture 8 → "Copy as pretty JSON" must come from `#response-pane-0`, must be valid `JSON.parse`-able, and must not be produced by our own re-serialisation |
| B-4 | HTML body | Fixture 9 → full `<!doctype html>…` string, byte-identical |
| B-5 | Body excludes the status line and headers | Assert the payload does **not** start with `HTTP/1.` and contains no `Content-Length:` line (i.e. `splitRawResponse` worked) |
| B-6 | Non-UTF-8, non-binary charset | Fixture 10 → the payload is `café naïve` decoded via the declared `iso-8859-1`, **not** mojibake (`cafÃ© naÃ¯ve`) |
| B-7 | Binary body | Fixture 13 → **no raw binary** on the clipboard; a placeholder/escaped/base64 form per §6.5, and the hex fallback is exercised (compare the recovered bytes against the fixture file with `cmp`) |
| B-8 | 64 KiB body | Fixture 14 → the full 65 536 bytes are copied; compare with `cmp` against `large.txt` |
| B-9 | Not-captured body | Fixture 15 → button is `aria-disabled`, the reason is announced, and **nothing** is copied |
| B-10 | Empty body (204) | Fixture 11 → button is `aria-disabled` with "no response body"; no empty-string copy |
| B-11 | Truncated body | Fixture 12 → copies the 10 received bytes **and** warns "copied 10 of 9999 bytes" |
| B-12 | **A9** — response capture threshold | Repeat fixtures 14/15 at 65 537 and 81 920 bytes to pin the response-side limit and confirm whether it matches the request side |
| B-13 | Toolbar placement | Assert `[data-ngpp="resp-toolbar"]` is inside the **response** `_inspector_` (not the request one) and sits before `ul[role=tablist]` |
| B-14 | Idempotency + survival | After 60 s of re-renders and a selection change, exactly one `[data-ngpp="resp-toolbar"]` exists |
| B-15 | State tracks selection | Fixture 15 → 8 → 11 in sequence; the button's enabled/disabled state must track the *current* response (guards against a stale state closure) |
| B-16 | Keyboard + focus | `Tab` reaches the button, `:focus-visible` ring renders, `Enter` copies |
| B-17 | No payload echoed in the toast | Copy a 64 KiB body → the toast says "Copied 65 536 bytes", not the content |

**Global**

| # | Check |
|---|---|
| G-1 | `list_console_messages` → no errors/warnings from the extension |
| G-2 | `assertDashboardShape()` logs nothing on ngrok 3.39.11 |
| G-3 | Extension is inert on any other origin (no injected nodes on `example.com`) |
| G-4 | No `web_accessible_resources` entry in the manifest |
| G-5 | Feature 2 (curl) still passes C-1…C-12 **after** the `raw-request.js` → `raw-message.js` refactor |

### 9.4 Tooling

The **Chrome DevTools MCP** is available in this environment and is the intended driver for
`D-1…D-8`, `C-11`, `H-5`, `H-8`, `B-1`, `B-14`, `B-15` and `G-1`: `evaluate_script` for DOM
assertions, `take_screenshot`
for the dark-mode visual pass, `list_console_messages` for errors, `emulate` for
`prefers-color-scheme`, and `performance_start_trace` for the FOUC check.

---

## 10. Risks, unknowns and open questions

### 10.1 Risks (with mitigations)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **CSS-module hashes change** on the next ngrok release (27 of 76 classes are hashed) | High | Prefix-match `[class*="_name_"]`; all selectors in one file; `assertDashboardShape()` warns loudly and features no-op instead of corrupting the page. |
| R2 | **React reuses row nodes across selection changes** → stale copy payloads | High | Read the payload from the live DOM at click time; heal `aria-label` in `ensure()`; verified test H-5. |
| R3 | ~1 Hz re-render storm | Medium | One debounced observer with `requestAnimationFrame` coalescing; idempotent `ensure()` short-circuits. |
| R4 | **Bodies ≥ ~100 KiB are never captured** by ngrok (verified) | Medium | Degraded path: headers-only curl + comment + toast. Never silently emit a wrong body. |
| R5 | Non-UTF-8 bodies have no `textContent` | Medium | Hex-dump fallback in `#request-pane-3` recovers exact bytes (verified, 294/294). |
| R6 | `navigator.clipboard` rejects when the document is unfocused | Low | `execCommand` fallback + error toast. |
| R7 | Bundle filenames are hashed (`app.DsEaSFMQ.js`) | Low | Never reference them; we touch only the DOM. |
| R8 | Injecting into a React-managed container could be wiped by a future React version | Low | Verified to survive today; the observer re-asserts regardless. Fallback: render into a `document.body`-level floating layer. |
| R9 | Dashboard port differs (`--web-addr`) | Low | Not supported in v1 (Q1). |
| R10 | Reading a 64 KiB body via the hex pane costs ~345 KB of DOM text | Low | Text pane preferred; hex only as fallback. |
| R11 | **A8 may be false** — response panes might not be populated while their tab is inactive | **High** | Settle it with test **B-1** *before* writing Feature 4 code; documented fallback is a synthetic tab click + async re-render wait + tab restore (§6.1). |
| R12 | The **response** capture limit may differ from the request one (A9) | Medium | Trigger the degraded state on *observed* absence, never on a hard-coded threshold, so the code is correct for either limit. |
| R13 | A **truncated or streaming** response body is silently short | Medium | Compare the copied length against `Content-Length` from `#response-pane-1`; warn ("copied N of M bytes") rather than copying quietly (B-11). |
| R14 | Copying a **binary** body puts unusable/corrupting bytes on the clipboard | Medium | Never copy raw binary by default; placeholder + metadata, with opt-in `base64` / `$'…'` (B-7, Q11). |
| R15 | An **empty or disabled** control gives no feedback, so "nothing copied" is indistinguishable from "copied nothing" | Low | Use the accessible `aria-disabled` + reason pattern, keeping the control focusable (§6.7, B-10). |
| R16 | The new response toolbar is the only **wholly new container** we add, so it is the most likely to look bolted-on or to be wiped | Low | Anchor it via `#response-pane-0` → `.closest('div[class*="_inspector_"]')`, `prepend` to match the request side, re-assert in `ensure()` (B-13, B-14). |
| R17 | The `raw-request.js` → `raw-message.js` refactor could **regress Feature 2** | Medium | Land the refactor before Feature 4 exists (Phase 2) and re-run the full curl suite afterwards (**G-5**). |

### 10.2 Assumptions to verify against the live page

The following were **not** directly observed and are marked accordingly:

- **A1 — VERIFY:** that the Raw pane keeps its `<pre><code>` shape (and does not switch to a
  `<textarea>`, whose content would need `.value` instead of `.textContent`) for all body types.
  *Confirmed only for text/JSON/form bodies and the 64 KiB case.*
- **A2 — VERIFY:** the exact body-capture threshold. Measured only as "65 536 B captured,
  102 400 B not". If the limit is relevant to users, binary-search it (65 537 / 81 920).
- **A3 — VERIFY:** whether ngrok ever renders **multi-valued headers as a single comma-joined row**
  in the Headers pane. Observed duplicates rendered as separate rows, but only for a 2-value case.
- **A4 — VERIFY:** behaviour when **no request is selected** (empty list, or immediately after
  *Clear Requests*). The detail panel may not render at all — `ensure()` must tolerate a missing
  `#request-pane-1`/`#request-pane-2` without throwing. *`assertDashboardShape()` intentionally does
  not require the panes for this reason.*
- **A5 — VERIFY:** the `/status` page and the "Replay with Modifications" editor
  (`._replayEditor_okyq9_1`, `._addHeader_okyq9_112`, `._headerTable_okyq9_54`) — these classes
  exist in the CSS bundle but were **not exercised**. The editor is a plausible place for a
  "paste cURL" feature later.
- **A6 — VERIFY:** whether ngrok is reachable at `http://127.0.0.1:4040` in this environment
  (the match pattern is included on the reasonable assumption that it is).

Response-side assumptions (Feature 4):

- **A7 — VERIFY:** that `#response-pane-2` follows the **same raw markup** as the request side, i.e.
  `<pre><code>` holding `status line + headers + CRLF CRLF + body`. Inferred from the identical
  component; the response Raw pane was **never read**. If it instead renders body-only, the
  `splitRawResponse` head/body split in §6.2 must be skipped.
- **A8 — VERIFY:** that the **response panes are populated while their tab is inactive**, as the
  request panes are. This is the single most consequential assumption in Feature 4 — if false, every
  response-body copy needs a synthetic tab click plus an async re-render wait and a tab restore
  (§6.1). **Test B-1 exists specifically to settle this before any code is written.**
- **A9 — VERIFY:** whether the **response** capture limit equals the request-side one
  ("65 536 B captured, 102 400 B not"). ngrok may cap request and response bodies independently. The
  implementation deliberately triggers on *observed* absence rather than a hard-coded threshold so
  that it is correct either way.
- **A10 — VERIFY:** behaviour for a **still-streaming / chunked** response, where the captured body
  may be partial. Assumed low-frequency (the inspector generally lists completed round trips) and
  indistinguishable from the truncation case; no special handling planned beyond the §6.4 warning.
- **A11 — VERIFY:** the **exact reformatted output** of the Summary pane for a JSON body. Verified
  only that it is *not* byte-identical to the raw body (`{"name":"julio","n":2}` rendered with
  inserted whitespace); the indentation was not measured because the probe collapsed whitespace. The
  "pretty" variant therefore promises *ngrok's rendering*, never a specific indentation.
- **A12 — VERIFY:** whether `#response-pane-0`'s body section is reliably locatable by the
  `h6` matching `/^\s*[\d,]+ bytes/` heuristic (§6.2). Confirmed for a JSON request body and for an
  HTML response body, but not for form-encoded, empty, or non-ASCII bodies.

### 10.3 Open questions for the user

| # | Question | Why it matters | Recommendation |
|---|---|---|---|
| **Q1** | Should the extension support a **configurable dashboard origin/port** (ngrok `--web-addr`)? | Host permissions and match patterns are currently pinned to `:4040`; a non-default port silently disables everything. | **v1: no.** Add `optional_host_permissions` + a settings field only if someone actually runs a custom port. |
| **Q2** | When generating the URL, assume **`https://`**? | The dashboard only shows tunnelled traffic, and the tunnel here is HTTPS. An HTTP-only tunnel would produce a wrong URL. | **Default `https://`**, with an `http://` toggle in the popup. |
| ~~Q3~~ | ~~Should per-header copy also cover response headers?~~ | — | **RESOLVED — yes, in scope.** Implemented by instantiating Feature 3's module against `#response-pane-1` (§6.6). |
| **Q4** | Default curl layout: **multi-line with `\` continuations**, or single-line? | `\` does not continue lines in Windows `cmd.exe`. | **Multi-line default** (matches DevTools), single-line toggle. |
| **Q5** | Strip the **ngrok-injected `X-Forwarded-*`** headers by default? | They were added by ngrok, not the client — but they are often exactly what someone wants to spoof when reproducing a bug. | **Strip by default** (`stripForwardedHeaders: true`), toggle in the popup. |
| **Q6** | Should the theme toggle also be injected into the dashboard navbar? | More discoverable, but adds a fifth injection site to maintain against DOM drift. | **Defer.** Popup first. |
| **Q7** | Is a `git init` + initial commit acceptable as step 0? | The directory is not a repository; the OKF workflow wants a `git log`. | **Recommend yes.** |
| **Q8** | Add unit tests (node:test) for `curl.js` only? | It is the one module with real logic and no DOM dependency; the rest is verified through the DevTools MCP. | **Recommend yes** — small, high-value, no framework. |
| **Q9** | **New.** What should "copy response body" mean by default — the **exact captured bytes** or the **pretty/decoded view the dashboard shows**? | These differ: the Summary pane reformats JSON (A11). A user who wants a paste-ready payload may prefer pretty; a user filing a bug report wants bytes. | **Exact bytes by default** (`format: 'raw'`), pretty as an explicit variant — consistent with the curl feature's fidelity-first philosophy. |
| **Q10** | **New.** Should the response-body button also offer **"Copy full raw response"** (status line + headers + body)? | It is a different, also-useful payload, and the raw text is already parsed. | **Yes, as a secondary item in the caret menu**, not as the default (the brief asked for the body). |
| **Q11** | **New.** For a **binary** response body, what should land on the clipboard? | Raw binary in a clipboard is unusable and can corrupt pastes. | **Default: a placeholder + metadata line.** Offer `base64` and ANSI-C `$'…'` as opt-in settings. |
| **Q12** | **New.** Should the extension add a **dedicated response-body toolbar** to the response section, given the dashboard provides none? | It is the one place where we add a new visible container rather than extending an existing one, so it is the most likely to look "bolted on". | **Yes, mirroring the request toolbar's position** (§6.7); confirm the placement visually during Phase 4. |

---

## 11. Implementation phases

| Phase | Deliverable | Depends on |
|---|---|---|
| **0** | `git init`, directory skeleton, `manifest.json`, icons, load-unpacked smoke test | — |
| **1** | `selectors.js` + `assertDashboardShape()` + `observer.js` + `main.js` — prove injection survives the 1 Hz re-render (H-8, C-11) | 0 |
| **2** | `raw-message.js` (the parameterised reader) + `raw-request.js` + `curl.js` + `clipboard.js` + `toast.js` — pure logic first, verified against fixtures 1–7 | 1 |
| **3** | `features/copy-curl.js` — toolbar button, E2E round trip (C-9) | 2 |
| **4** | **Settle A8 (test B-1) before writing code**, then `features/copy-header.js` — affordance, keyboard a11y, staleness heal (H-1…H-10) | 2 |
| **5** | `raw-response.js` + `response-body.js` + `features/copy-response.js` — extraction cascade, text/binary/charset classification, the four states of §6.4, the response toolbar (B-1…B-17) | 4 |
| **6** | Dark mode: `dark.css`, the two bootstrap scripts, SW registration, `theme.js`, popup | 1 |
| **7** | Optional: Replay-dropdown menu item, navbar toggle, "copy full raw response", configurable origin | 3–6 |
| **8** | Update `AGENTS.md` (permissions, build/reload workflow, content-script boundary) and run the `okf-update` skill to record the decisions in `.okf/log.md` + affected concepts | all |

Phase-ordering notes:

- **The injection-survival proof (Phase 1) comes before any feature code.** If it fails, the
  fallback is a `document.body`-level floating layer — much cheaper to discover before four features
  are built on top of it.
- **A8 is settled at the start of Phase 4, not during Phase 5.** It decides whether response-pane
  reads are pure DOM reads or need synthetic tab clicks, and that changes the shape of
  `raw-response.js`. Phase 4 is where the dashboard is already open for the header work, so the check
  is nearly free there.
- **The `raw-request.js` → `raw-message.js` refactor lands in Phase 2, before Feature 4 exists**, so
  Feature 2 is never left in a half-refactored state; G-5 re-runs the curl suite afterwards.

---

## Appendix A — Raw request grammar (as observed)

```
<METHOD> SP <request-target> SP "HTTP/1.1" CRLF
<header-name> ":" SP? <header-value> CRLF
...
CRLF
<optional body bytes, length == Content-Length>
```

- Line endings are **CRLF**; the body's own line endings are **not** normalised
  (verified: a body of `line1\nline2 'single' "double"` kept bare `\n`).
- Duplicate header names are permitted and meaningful → **never** collapse into a map.
- `Host` is always present (verified on every captured request).
- `X-Forwarded-For` / `-Host` / `-Proto` are **added by ngrok** (verified on every captured request).
- The request-target may be origin-form (`/path?q=1`) or absolute-form (`http://host/path`).

## Appendix B — curl quoting rules (summary)

| Rule | Value |
|---|---|
| Quote style | POSIX single quotes |
| Escape | `'` → `'\''` (`sh` helper in §4.4 R5) |
| Always quoted | URL, every header value, the body |
| Body flag | `--data-raw` (never `--data`, which strips newlines) |
| Empty header | `-H 'Name;'` (the trailing semicolon is required) |
| Dropped headers | `Host`, `Content-Length`, and (by default) `X-Forwarded-*`, `X-Real-Ip` |
| Method | Always explicit `-X METHOD` |
| Line continuation | ` \` + `\n`; **omitted on the last line** |
| Trailing newline | **Never** appended to the clipboard payload |
| Binary body | Omitted with a comment, unless the ANSI-C `$'…'` option is enabled (bash/zsh only) |

## Appendix C — Evidence log (how each claim in §1 was obtained)

| Claim | Method |
|---|---|
| 302 → `/inspect/http`; `/api/tunnels` shape | `curl -i`, `curl \| python3 -m json.tool` |
| gRPC-Web transport | `chrome-devtools.list_network_requests` → `POST /grpc/agent.Web/{Preloaded,State}` |
| No REST use by the UI | `grep -c 'api/tunnels' app.js` → 0; `grep 'api/requests'` → 0 |
| No existing dark/clipboard/curl features | `grep` with ±110-char context over the 1.39 MB bundle → all hits are library keyword tables |
| Bootstrap 3.3.x + CSS Modules | bundle palette extraction + 40 hashed class names |
| No CSS custom properties / no `prefers-color-scheme` | `grep -o '\-\-[a-z-]*:'` → 0; `grep -c prefers-color-scheme` → 0 |
| Secure context + working clipboard | `isSecureContext`, `permissions.query`, probe `writeText` |
| Exact pane markup and ids | `outerHTML` dumps of `#request-pane-{0..3}` and `#response-pane-{0..3}` |
| Panes populated while inactive | read `#request-pane-2` `textContent` after switching to the Summary tab |
| Duplicate headers → separate rows | fixture 3, `#request-pane-1 tbody tr` dump |
| Hex-dump format | `#request-pane-3` `textContent`, 294/294 bytes matched against the API's base64 `raw` |
| Capture threshold | fixtures at 16 384 / 65 536 / 102 400 B against `/api/requests/http` |
| ~1 Hz re-render | `MutationObserver` on `#app` over 16.8 s → 22 batches, ~954 added nodes |
| Injection survival + node reuse | 4 probe buttons, 15 s soak + a selection change; header rows 7 → 9 with the node preserved |
| Full class census | live `classList` union over `/inspect/http` (with all tabs clicked) and `/status` |
| `.pull-right` occurs once, request-side only | `panel.querySelectorAll('.pull-right').length === 1`; `#replay` count `=== 1` |
| Response panes/tabs exist with the same scheme | `[...document.querySelectorAll('[id^="response-pane-"]')].map(e => e.id)` → `response-pane-0..3` (same for `response-tab-*`) |
| `#response-pane-1` is a table | `!!document.querySelector('#response-pane-1 table')` → `true` |
| Response Summary renders a body | the first a11y snapshot showed `heading "410 bytes text/html; charset=utf-8"` followed by the HTML body as text nodes |
| Summary pane **reformats** JSON | request-side probe: raw body `{"name":"julio","n":2}` vs Summary `textContent` `{ "name": "julio", "n": 2 }` (whitespace inserted; probe collapsed newlines, so indentation is unmeasured → A11) |
| Response body not measured (A7–A12) | **no response pane content was ever read**; every response-side claim beyond the four above is inferred and listed in §10.2 |
