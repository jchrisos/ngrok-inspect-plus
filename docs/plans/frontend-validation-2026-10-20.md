# ngrok-inspect-plus — Front-End Validation & Code Review

- **Date:** 2026-10-20
- **Scope:** full read of every source, test, tooling, and doc file in the repo; `make check` and
  `make test` executed; live DOM of the ngrok 3.39.11 dashboard inspected read-only via the Chrome
  DevTools MCP.
- **Reviewer:** front-end architecture review (read-only; no source file was modified).
- **Target:** Chrome Manifest V3 extension, `v0.1.0`, plain ES2022 classic content scripts sharing
  `globalThis.ngpp`, no bundler, no runtime dependencies.

## 0. Executive summary

The codebase is small, well-organised, and unusually disciplined for its size: one selector
registry, one observer, one settings module, pure-logic modules that are unit-tested, no
`innerHTML` with user data, no remote code, no `web_accessible_resources`, and a genuinely clever
no-FOUC theme mechanism (the persisted mode *is* the dynamic content-script registration).

The review found **no Critical or security defects**. It found **one High-severity correctness bug**
(a false "truncated" state for any non-ASCII response body), **two Medium issues** (a misleading
shape-warning gate that fires in normal states, and avoidable per-frame work in the response-body
feature), and a set of Low/Improvement/Nit items around selector-registry discipline, duplicated
code, and test coverage.

Most of the documented design claims in `AGENTS.md` / `.okf/` **match the code**. Three small
doc/code drifts were found (see §6). The biggest real-world risk is not a code bug but the number
of **untested code paths**: `raw-message.js` (the hex-dump correctness net), the entire
`copy-response` state machine, and all DOM-facing feature/observer/theme/popup code have no unit
tests.

### Command results (actual)

| Command | Result |
|---|---|
| `make check` | **PASS** (exit 0) — `manifest.json OK`, `package.json OK`. Note: it does **not** syntax-check `background/*.js` (finding I5). |
| `make test` | **PASS** — `tests 35 / pass 35 / fail 0` (66 ms). |

---

## 1. Bugs (ranked by severity)

### B1 — **High** — Truncation detection compares character count against `Content-Length` bytes

**File:** `content/features/copy-response.js:37-52`

```js
37:    const byteLength = bodyBytes
38:      ? bodyBytes.length
39:      : ngpp.responseBody.splitRawResponse(read.text).body.length;   // <-- UTF-16 code units
...
49:    const declared = ngpp.dom.contentLength(ngpp.SEL.respHeaderRow);
50:    if (declared != null && byteLength < declared) {
51:      return { state: 'truncated', read, byteLength, declared };
52:    }
```

**Why it is a bug.** On the text path, `read.text` is ngrok's rendering of the raw response in a
`<pre><code>`, i.e. a JS string. `.length` is the number of UTF-16 code units, but `Content-Length`
is a **byte** count. For any response body containing non-ASCII characters (accented text, emoji,
UTF-8 JSON, most HTML with a language other than English), the character count is *less* than the
byte count, so the comparison is a **false positive**: the feature reports the body as truncated,
sets `title="body appears truncated by ngrok"` on the button, and the success toast says
`copied N of M bytes (truncated by ngrok)`.

Reproduced with the repo's own pure module:

```
body "café"  →  splitRawResponse(...).body.length = 4   (code units)
             →  Content-Length                    = 5–6 (bytes)
             →  byteLength < declared              = true  →  FALSE "truncated"
```

The copy payload itself is still correct (the size is not what is copied), so this is a
*trust/misinformation* defect rather than data corruption — but it fires on extremely common
content, and it defeats the stated purpose of the state machine ("warn only when genuinely
truncated", plan §6.4 / B-11).

**Concrete fix.** Measure bytes on both paths:

```js
const bodyText = read.kind === 'text' ? ngpp.responseBody.splitRawResponse(read.text).body : '';
const bodyBytes = read.kind === 'bytes' ? splitBodyBytes(read.bytes) : null;
const byteLength = bodyBytes
  ? bodyBytes.length
  : new TextEncoder().encode(bodyText).length;   // bytes, not code units
```

(`TextEncoder` is available in the content-script world.) If measuring the byte length of every
text body is judged too costly for large bodies, an acceptable alternative is to skip the
truncation check when the body is not pure ASCII — but the byte-accurate version is cheap enough
and is the correct fix.

---

### B2 — **Medium** — `assertDashboardShape()` reports "DOM changed" for the normal "nothing selected / empty list" state

**Files:** `content/selectors.js:55-67`, called from `content/observer.js:9`

```js
56:    const required = ['app', 'navbar', 'listRow', 'panel', 'toolbarSlot'];
57:    const missing = required.filter((k) => !document.querySelector(ngpp.SEL[k]));
58:    if (missing.length) {
59:      console.warn(`[ngrok-inspect-plus] dashboard DOM changed — missing: ${missing.join(', ')}. ...`);
```

**Why it is a bug.** `listRow` requires at least one `<tr>` in the request list; `panel`
(`div[class*="_inspectRoundTrip_"]`) and `toolbarSlot` (`#replay`) only exist **once a request is
selected**. So on a fresh dashboard (the documented empty state is a `.well` "No requests to
display yet" — see `.okf/log.md`, 2026-10-19) or with nothing selected, `missing` is non-empty on
**every** observer pass, and:

1. `console.warn` is emitted repeatedly (the observer runs on every `requestAnimationFrame` after a
   mutation, and `characterData: true` means mutations are frequent on the ~1 Hz dashboard).
2. All four features no-op — which is harmless when nothing is selected, but the *reason* is
   misreported.
3. The message is actively misleading: `"dashboard DOM changed … this build may be newer"` sends a
   maintainer looking for a selector regression when in fact the list is simply empty.

The plan itself flags this exact scenario (assumption **A4**: *"the detail panel may not render at
all … `assertDashboardShape()` intentionally does not require the panes for this reason"*) — but the
implemented `required` list *does* require the panel and the toolbar slot, so the intent was not
carried through.

**Concrete fix.** Keep the hard gate to the stable shell only, and warn once:

```js
let shapeWarned = false;
ngpp.assertDashboardShape = function () {
  const missing = ['app', 'navbar'].filter((k) => !document.querySelector(ngpp.SEL[k]));
  if (missing.length) {
    if (!shapeWarned) {
      shapeWarned = true;
      console.warn(`[ngrok-inspect-plus] dashboard shell changed — missing: ${missing.join(', ')} …`);
    }
    return false;
  }
  return true;
};
```

The per-feature early returns (`copy-curl.ensure()` already bails without `#replay`;
`copy-response.ensure()` already bails without the response inspector) remain the correct guards for
the "nothing selected" case.

---

### B3 — **Low** — Service-worker theme registration race → unhandled rejection

**File:** `background/service-worker.js:22-34` (listeners at `44-52`)

```js
22: async function reconcileThemeRegistration() {
25:   const existing = (await chrome.scripting.getRegisteredContentScripts()).find(...);
26:   if (existing) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
...
31:   await chrome.scripting.registerContentScripts([{ id: SCRIPT_ID, ... }]);
```

**Why it is a bug.** `reconcileThemeRegistration` is async and is fired from `onInstalled`,
`onStartup`, and **every** `storage.onChanged`. Two overlapping invocations (e.g. a rapid
Auto → Dark → Light toggle in the popup) can interleave as: A unregisters → B unregisters (no-op) →
A registers → B registers the **same id** → `registerContentScripts` rejects with *"Duplicate script
ID"*. Nothing catches it, so it surfaces as an unhandled rejection in the service worker.

**Concrete fix.** Serialise the reconciles and catch:

```js
let chain = Promise.resolve();
function scheduleReconcile() {
  chain = chain
    .then(reconcileThemeRegistration)
    .catch((e) => console.warn('[ngrok-inspect-plus] theme registration failed', e));
}
chrome.runtime.onInstalled.addListener(scheduleReconcile);
chrome.runtime.onStartup.addListener(scheduleReconcile);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) { scheduleReconcile(); broadcastTheme(); }
});
```

---

## 2. Improvements

### I1 — **Medium** — `copy-response.ensure()` re-parses the full payload and re-clones every header cell on every observer pass

**Files:** `content/features/copy-response.js:62-102` → `currentState()` (`:32-54`) →
`readRawResponse()` (`content/raw-message.js:27-43`) and
`dom.declaredCharset` / `dom.contentLength` (`content/selectors.js:90-107` → `headerRows` `:72-81`
→ `cellValue` `:84-88`, which does `td.cloneNode(true)`).

**Why it is a problem.** `ensure()` → `syncState()` → `currentState()` runs on **every** coalesced
observer pass (≈1 Hz, plus every mutation burst), and `currentState()`:

- calls `readRawResponse()`, which — for a binary / non-UTF-8 response — runs `parseHexDump` over the
  **entire** hex pane. On the live dashboard I measured a hex pane of **208 399 characters**; this
  would be split and regex-scanned on every frame.
- calls `declaredCharset(...)` (bytes path) and `contentLength(...)`, each of which materialises the
  **whole** header-row list via `headerRows()` → `cellValue()` → `cloneNode(true)` per row. That is
  two full clone sweeps per pass for a bytes-path response, one for a text response.

**Concrete fixes (pick per cost/benefit).**

1. Make the two header lookups short-circuit instead of building the full list:

```js
contentLength(rowsSelector) {
  for (const row of document.querySelectorAll(rowsSelector)) {
    const name = row.querySelector('th')?.textContent?.trim().toLowerCase();
    if (name !== 'content-length') continue;
    const td = row.querySelector('td');
    if (!td) continue;
    const n = parseInt(ngpp.dom.cellValue(td), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
```

(same shape for `declaredCharset`). This avoids the `cloneNode` sweep entirely for the common case.

2. Do not call `parseHexDump` in the availability pass. Whether the body is binary can be inferred
   from the presence of the Raw-pane `.alert` placeholder / absence of raw text plus the declared
   `Content-Type`, deferring the byte-exact decode to `copyBody()` (click time), where it already
   happens.

3. Alternatively, cache `currentState()` keyed on the selected request (the panel node is reused but
   its content changes) and invalidate on mutation — but option 1+2 is simpler and removes the
   hot-path cost without added state.

### I2 — **Medium** — Selector-registry discipline is violated by an inline selector (and one selector is dead)

**File:** `content/features/copy-response.js:23`

```js
23:    for (const h6 of document.querySelectorAll('#response-pane-0 h6')) {
```

`AGENTS.md` is explicit: *"`selectors.js` is the single source of truth for every DOM selector …
Add selectors there, not inline."* Meanwhile `SEL.respSummaryBody`
(`content/selectors.js:38`) is defined but never referenced anywhere.

**Concrete fix.** Add the heading selector to the registry and use it; delete or use
`respSummaryBody`:

```js
// content/selectors.js
respSummaryHeading: '#response-pane-0 h6',
```

```js
// content/features/copy-response.js
for (const h6 of document.querySelectorAll(ngpp.SEL.respSummaryHeading)) {
```

### I3 — **Medium** — `splitBodyBytes` is duplicated verbatim

**Files:** `content/features/copy-curl.js:6-13` and `content/features/copy-response.js:12-19` are
byte-identical.

**Concrete fix.** Move it into `content/response-body.js` (already a dual-consumable pure module
with a UMD wrapper) and call it from both feature files:

```js
// content/response-body.js
function splitBodyBytes(bytes) {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return bytes.slice(i + 4);
    }
  }
  return new Uint8Array(0);
}
// export alongside splitRawResponse/decodeBytes/classifyBody
```

### I4 — **Low/Medium** — `main.js` silently drops a missing feature

**File:** `content/main.js:14-19`

```js
14:    const features = [
15:      ngpp.features.copyCurl, ngpp.features.copyHeaderReq,
16:      ngpp.features.copyHeaderResp, ngpp.features.copyResponse,
17:    ].filter(Boolean);
```

**Why it is a problem.** If a feature file fails to load — a typo in the manifest `js` array, a
syntax error, or (as I observed live) a stale extension load whose manifest predates a feature file
— the feature simply **vanishes with no warning at all**. This is the failure mode that produces a
half-working extension with a silent console. (In the live Chrome profile I inspected, the injected
`ngpp` namespace contained only `features.copyResponse`; `copy-curl` and the two header features
were absent and nothing complained.)

**Concrete fix.**

```js
const WANTED = ['copyCurl', 'copyHeaderReq', 'copyHeaderResp', 'copyResponse'];
const features = WANTED.map((k) => ngpp.features[k]).filter(Boolean);
const missing = WANTED.filter((k) => !ngpp.features[k]);
if (missing.length) console.warn('[ngrok-inspect-plus] features failed to load:', missing.join(', '));
```

### I5 — **Low** — `make check` does not syntax-check `background/*.js`

**File:** `Makefile:31`

```
31: 	@for f in content/*.js content/features/*.js theme/apply-dark.js theme/apply-dark-auto.js popup/popup.js tests/*.js tests/*.mjs; do \
```

`AGENTS.md` says `make check` will *"syntax-check every JS file"*, but `background/service-worker.js`
and `background/settings.js` are omitted — a syntax error there would pass `make check` and only
surface at runtime (or in the mocked SW test). Node 24 (the installed version) auto-detects ESM, so
the files can be checked directly — verified: `node --check background/service-worker.js` → exit 0.

**Concrete fix.** Add `background/*.js` to the loop (and leave the AGENTS.md wording as-is, since it
will then be true).

### I6 — **Low** — `settings.js` (and its `merge`) is duplicated between `content/` and `background/`

**Files:** `content/settings.js:8-27` vs `background/settings.js:4-23`. AGENTS.md acknowledges this
("keep in sync with `content/settings.js`") but nothing enforces it. A shared file is not possible
without a build step (content scripts cannot be ESM; the SW cannot be a classic script), so the
pragmatic mitigation is a test.

**Concrete fix.** Add a test that parses both files' `DEFAULTS` and asserts deep equality (and
ideally that `merge` behaves identically), so drift fails `make test`:

```js
// tests/settings-sync.test.mjs (sketch)
const content = readFileSync('content/settings.js', 'utf8');
const background = readFileSync('background/settings.js', 'utf8');
const grab = (src) => JSON.parse(src.match(/const DEFAULTS = (\{[\s\S]*?\n\});/)[1].replace(/(\w+):/g, '"$1":').replace(/,(\s*[}\]])/g, '$1'));
test('content and background DEFAULTS are in sync', () => assert.deepEqual(grab(content), grab(background)));
```

(Extracting the literal from the classic script via `node:vm` with a stubbed `chrome`/`module` is
cleaner than a regex and matches the pattern already used in `tests/selectors.test.mjs`.)

### I7 — **Low** — `.ngpp-hdr-copy` is not themed and sits near the 3:1 non-text threshold in dark mode

**File:** `content/ngpp.css:37` hard-codes `color: #337ab7` (correct in light mode, matching the
Replay button). On the dark surface `--ngpp-surface #1b1f26` that is ≈ **3.6:1** — it clears the
WCAG 1.4.11 non-text minimum of 3:1, but it is the lowest-contrast element in the palette and it is
not a token. **Fix:**

```css
html.ngpp-dark .ngpp-hdr-copy { color: #6cb6ff; }
html.ngpp-dark .ngpp-hdr-copy:hover { color: #9fd3ee; }
```

### I8 — **Low** — Redundant second `currentState()` computation on click

`content/features/copy-response.js:107` recomputes `currentState()` (including the potentially
expensive paths from I1) even though `syncState()` computed it moments earlier in the same pass.
Cheap to avoid by having `copyBody()` accept the already-computed state, or by caching it as
described in I1.

---

## 3. Nits

| # | Item |
|---|---|
| N1 | Dead selectors never referenced: `connectionStatus`, `listRowSelected`, `reqPane0`, `reqRawPlaceholder`, `respRawPlaceholder`, `respSummaryBody` (`content/selectors.js:13,17,25,28,36,38`). (`app`/`navbar`/`listRow`/`panel`/`toolbarSlot` *are* used, dynamically, by `assertDashboardShape`.) |
| N2 | `AGENTS.md` calls the observer "debounced"; `content/observer.js:19-23` is `requestAnimationFrame`-coalesced (no trailing delay). Terminology only. |
| N3 | `content/features/copy-curl.js:51` sets `byteLength = req.body.length` (code units) for the text path — the same chars-vs-bytes conflation as B1, though currently only consumed by the binary/unavailable warnings. |
| N4 | The historical plan (`docs/plans/ngrok-dashboard-features-2026-10-18.md:1307,1338`) still sketches the old `:4040`-pinned matches and the shorter description; `manifest.json` is correct, but the stale sketch can mislead a reader. |
| N5 | `background/service-worker.js:47-52` calls `broadcastTheme()` on **any** `settings` change, including curl/responseBody edits that cannot affect the theme. |
| N6 | The popup's checkbox groups use `<h2>` headings but no `fieldset`/`legend` (`popup/popup.html:21-32`). Low-value a11y polish. |
| N7 | `content/features/copy-response.js:24` locates the Summary body via `/^\s*[\d,]+\s+bytes/` on `#response-pane-0 h6` — verified for the shapes seen, but form-encoded / empty / non-ASCII bodies are untested (plan A12). |
| N8 | The live Chrome profile contained **leftover debug injections in the main world** (`window.ngpp` exposing only `copyResponse`; a `resp-toolbar` labelled "binary response body — not copied" from a monkeypatched reader). Future live verification should reload the extension / clear injected scripts first — see §7. |

---

## 4. Test coverage gaps (with proposed cases)

`make test` covers the three pure modules (`curl.js`, `response-body.js`) plus `isDashboard()`,
the manifest match-pattern invariants, and the SW registration decision. Everything DOM-facing and
the most complex state machine are **untested**.

**Untested real code paths:**

| Module | Untested surface |
|---|---|
| `content/raw-message.js` | `parseHexDump` (the byte-exact correctness net for binary / non-UTF-8 bodies) and `createMessageReader` — **highest-value gap**. |
| `content/features/copy-response.js` | `currentState()` state machine (empty / not-captured / binary / truncated / available), `readSummaryBody`, `splitBodyBytes`, `copyBody`. |
| `content/features/copy-curl.js` | `splitBodyBytes`, `readUnavailableRequest`, `onClick` (text/bytes/unavailable dispatch). |
| `content/features/copy-header.js` | `ensure()` idempotency, `aria-label` staleness heal, click-time value read. |
| `content/selectors.js` | `assertDashboardShape`, `dom.headerRows` (duplicate preservation), `dom.cellValue` (button stripping), `declaredCharset`, `contentLength`. |
| `content/observer.js` | rAF coalescing, per-feature error isolation, idempotent dispatch. |
| `content/theme.js` | `apply()` for dark/light/auto, OS-scheme change, `ngpp:theme` message. |
| `content/settings.js` | `merge` deep-merge, `get` caching, `set` patch semantics, `onChanged` refresh. |
| `content/toast.js`, `content/clipboard.js` | show/hide, `legacyCopy` fallback. |
| `popup/popup.js` | `render`/`wire`, dotted-id path get/patch. |
| `tests/manifest.test.mjs` | Only match patterns are asserted — not `permissions`, `minimum_chrome_version`, absence of `web_accessible_resources`, icon entries, description length, or manifest↔package version equality. |
| `tests/curl.test.js` | No case for `includeCompressed: true` (the `--compressed` + dropped `Accept-Encoding` branch, `content/curl.js:118-128`). |

**Proposed concrete tests.**

1. `tests/raw-message.test.mjs` — `parseHexDump` round-trips a known dump (including
   `00 01 02 ff fe 80`), ignores the ASCII column, handles the final space-padded line; with a
   stubbed `document`, `createMessageReader` returns `text` / `bytes` / `unavailable` for the three
   DOM shapes.
2. `tests/copy-response-state.test.mjs` — extract `currentState()`'s pure arithmetic (byte length +
   `Content-Length` compare) and assert that a **non-ASCII** body with a matching `Content-Length`
   is **not** reported truncated. *This test fails against the current code and pins B1.*
3. `tests/curl.test.js` — add `includeCompressed: true` with an `Accept-Encoding` header: assert the
   header is dropped and `--compressed` is emitted; and a `bodyKind: 'empty'` + `body` present case.
4. `tests/selectors.test.mjs` — add `dom.headerRows` (duplicate names → two entries) and
   `dom.cellValue` (injected `[data-ngpp]` node stripped) using a minimal stubbed DOM; add an
   `assertDashboardShape` case for the "shell present, nothing selected" state asserting **no**
   warning (pins B2).
5. `tests/observer.test.mjs` — with a fake rAF and a stubbed feature that throws, assert other
   features still run and `ensure` is called once per frame.
6. `tests/settings-sync.test.mjs` — assert `content/settings.js` and `background/settings.js`
   `DEFAULTS` are deep-equal (pins I6).
7. `tests/manifest.test.mjs` — assert `permissions` is exactly `['storage','scripting']`, that
   `web_accessible_resources` is absent, that `minimum_chrome_version` is present, that every
   `icons` path exists on disk, that `description.length <= 132`, and that `version` equals
   `package.json`'s.

---

## 5. Security review

| Area | Verdict |
|---|---|
| Remote code / CSP | **Clean.** No `eval`, `new Function`, remote scripts, or `chrome.runtime.getURL()` of executable assets. Content scripts use only `chrome.storage` and `chrome.runtime` (verified by grep). |
| `innerHTML` / HTML injection | **Safe.** The only `innerHTML` is `btn.innerHTML = COPY_ICON_SVG` (`content/features/copy-header.js:31`) with a constant, author-controlled string. All user-derived data goes through `textContent`. |
| `web_accessible_resources` | **Correctly absent.** Inline SVG avoids exposing extension internals to the page. |
| Clipboard | **Correct.** `navigator.clipboard.writeText()` on a user gesture; no MV3 permission exists or is needed; `execCommand` fallback for a blurred document. |
| Host-permission breadth | **Documented trade-off, accepted.** `http://localhost/*` + `http://127.0.0.1/*` grant the extension access to *every* local web app, and CSS (`theme/dark.css`, `content/ngpp.css`) is injected into all of them regardless of `isDashboard()`. Mitigations are sound: `dark.css` is inert without `html.ngpp-dark`; `ngpp.css` selectors are namespaced (`#request-pane-*`, `[data-ngpp]`, `.ngpp-*`); `main.js` bails before doing anything on non-dashboard pages. Residual, inherent risk: any app served on `localhost:4040` is darkened by the unconditional pre-paint script when `themeMode` is `dark`/`auto`+dark-OS (`theme/apply-dark*.js` cannot gate on `isDashboard()`). Low, and explicitly reasoned about in AGENTS.md. |
| Selector injection | No dynamic selector construction from untrusted input. |

---

## 6. Consistency with the documented design (doc ↔ code)

**Claims verified TRUE:**

- **Stateless service worker.** No module-level mutable state; all three listeners are registered
  synchronously at top level, so they survive SW termination; every wake-up re-reads
  `chrome.storage` (`background/service-worker.js`, `background/settings.js`). ✔
- **No `web_accessible_resources`; no explicit port** in `host_permissions` / `content_scripts`
  (only the deliberately pinned pre-paint registration). ✔
- **Every `ensure()` idempotent**, guarded by `data-ngpp`. ✔ (all four features)
- **Copy handlers read the live DOM at click time** (no payload captured in a closure). ✔
- **`theme/dark.css` never uses `@layer`**; `!important` only where Bootstrap itself uses it
  (`.muted`). ✔
- **`prefers-reduced-motion`** handled for the toast and header-copy transitions. ✔
- **Icons** present at 16/32/48/128 and genuinely those dimensions; **description** 94 chars (< 132);
  **version** `0.1.0` matches `package.json`. ✔
- **Response-body copy** copies ngrok's Summary rendering by default — matches
  `.okf/concepts/architecture.md` and `.okf/log.md`. (It deviates from the historical plan's
  "exact bytes by default", Q9/§6.5, but AGENTS.md and the OKF bundle are consistent with the
  code, so this is **not** a doc↔code drift — only the plan is stale.) ✔

**Doc ↔ code drift found:**

1. `AGENTS.md` — *"`make check` … syntax-check every JS file"* → the Makefile loop omits
   `background/*.js` (I5).
2. `AGENTS.md` — *"`selectors.js` is the single source of truth for every DOM selector … Add
   selectors there, not inline"* → `content/features/copy-response.js:23` inlines
   `'#response-pane-0 h6'` (I2).
3. `AGENTS.md` — *"re-asserts injected UI on a debounced `MutationObserver`"* → it is
   rAF-coalesced, not debounced (N2).

---

## 7. Live dashboard inspection (read-only, supplementary)

The ngrok agent dashboard was already listening on `127.0.0.1:4040` (ngrok PID 14180) and a tab was
open at `http://localhost:4040/inspect/http`. I inspected it read-only via the Chrome DevTools MCP;
I did **not** start or stop any tunnel and did not mutate the dashboard. Confirmed against ngrok
3.39.11:

- `#request-pane-1` contains exactly **one** `table._params_*` with **17** rows — i.e. no
  query/form-param table shares the pane, so the per-header copy feature and `ngpp.dom.headerRows`
  will not pick up non-header rows. (This resolves a concern that would otherwise have been a bug.)
- `#response-pane-1` renders **duplicate headers as separate rows**
  (`X-Ngrok-Rehydrate-Enriched-Error-Arg` × 3) — matching `ngpp.dom.headerRows`' documented
  behaviour.
- `#replay.parentElement` is `div._container_1bug4_1` containing `[div#replay.btn-group, form]` —
  the copy-as-cURL injection target in `copy-curl.ensure()` is correct.
- The response inspector class is `_inspector_q3zmt_1`, matched by `[class*="_inspector_"]`; both
  Raw panes are populated while inactive (request 802 chars, response 39 694 chars).

**Caveat / environment hygiene.** The page's main world already contained a **leftover manual debug
injection** of a subset of the extension (`window.ngpp` exposing only `features.copyResponse`, no
`observer`, no `theme`, and no `ngpp.css` rules), with a `resp-toolbar` labelled
`binary response body — not copied` produced by a monkeypatched reader (consistent with the
`.okf/log.md` 2026-10-20 note about injecting the scripts with a `chrome` stub). This is **not** the
extension, and I did not draw any conclusion about extension behaviour from it. Anyone doing live
verification should reload the extension and clear injected scripts first, or the main world will
give false readings.

---

## 8. Suggested OKF updates (not applied — `.okf/` untouched)

If the maintainer wants the knowledge bundle to record this review, the following would be
appropriate (do not write these automatically):

- **`.okf/log.md`, new `## 2026-10-20` entry (append to the existing day):**
  > - **Front-end validation review** (`docs/plans/frontend-validation-2026-10-20.md`). Found: one
  >   High bug — response-body truncation detection compares UTF-16 code units to `Content-Length`
  >   bytes, producing a false "truncated" state for any non-ASCII body (`copy-response.js`);
  >   `assertDashboardShape()` misreports the normal "nothing selected / empty list" state as a DOM
  >   change and warns repeatedly; a theme-registration race in the SW can double-register and throw.
  >   Improvements: short-circuit `contentLength`/`declaredCharset`, register the inline
  >   `#response-pane-0 h6` selector, de-duplicate `splitBodyBytes`, warn on missing features,
  >   add `background/*.js` to `make check`. No Critical/security defects. `make check` and
  >   `make test` (35 pass) green.
- **`concepts/architecture.md`:** add a line to *Testing* noting that `raw-message.js`
  (`parseHexDump`/`createMessageReader`) and the `copy-response` state machine are currently
  untested, and that `assertDashboardShape`'s hard gate must not require the detail-panel selectors
  (assumption A4).
- **`concepts/dark-theme.md`:** no change required.

---

## 9. Appendix — raw command output

```
$ make check
manifest.json OK
package.json OK
===EXIT: 0===
```

```
$ make test
✔ sh quotes POSIX-ly, including embedded single quotes
✔ parseRawRequest handles CRLF, duplicate headers and a body
✔ parseRawRequest preserves body CRLF bytes (no normalisation)
✔ parseRawRequest tolerates LF-only line endings
✔ parseRawRequest returns null on a non-request line
✔ toCurl: method always explicit, URL quoted, drops Host/Content-Length, strips forwarded
✔ toCurl: keeps duplicates in wire order; empty value -> Name;
✔ toCurl: unavailable body -> leading comment + headers only
✔ toCurl: binary body -> omitted with a comment, never raw bytes
✔ toCurl: single-line mode joins with spaces
✔ toCurl: URL scheme comes from the request (X-Forwarded-Proto), not a setting
✔ toCurl: falls back to https when X-Forwarded-Proto is absent
✔ toCurl: an absolute-form target keeps its own scheme
✔ host_permissions cover every loopback port (no pinned :4040)
✔ every content-script block matches every loopback port
✔ splitRawResponse separates head and body on CRLFCRLF
✔ splitRawResponse: no separator -> whole thing is head, body empty
✔ splitRawResponse preserves body CRLF bytes
✔ decodeBytes honours a declared non-UTF-8 charset (iso-8859-1)
✔ decodeBytes falls back to utf-8 when the label is unknown
✔ decodeBytes reports failure for genuine binary
✔ classifyBody: text path is trusted as-is
✔ classifyBody: hex bytes that decode -> text; that do not -> binary
✔ classifyBody: unavailable stays unavailable
✔ classifyBody: binary carries the raw bytes for the caller to ignore
✔ isDashboard: true for the agent shell (<body id="ngrok">)
✔ isDashboard: true from the shell meta alone (author=ngrok)
✔ isDashboard: false on an unrelated localhost app
✔ isDashboard: false before <body> exists
✔ themeMode "dark" registers apply-dark.js at document_start
✔ themeMode "auto" registers apply-dark-auto.js
✔ themeMode "light" registers nothing (dark.css stays inert)
✔ an existing registration is unregistered before re-registering (idempotent)
✔ settings default to auto when storage is empty
✔ live theme broadcasts reach the dashboard on ANY loopback port
ℹ tests 35
ℹ pass 35
ℹ fail 0
===EXIT: 0===
```

```
$ node -e '<B1 repro>'
body JS .length            = 4
declared (Content-Length)  = 5
currentState would report truncated? -> true
```
