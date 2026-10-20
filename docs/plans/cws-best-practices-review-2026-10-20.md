# ngrok-inspect-plus — Chrome Web Store Best Practices Review

**Date:** 2026-10-20
**Reviewer:** front-architect (read-only; no source files modified)
**Guideline:** [Chrome Web Store Best Practices](https://developer.chrome.com/docs/webstore/best-practices)
**Target:** `/Users/julio/Projects/ngrok-inspect-plus` @ `a92f288` (v0.1.0, MV3, no build step)

**Method:** section-by-section read of the guideline; static review of every JS/CSS/JSON/HTML file;
`grep` sweeps for the guideline's named risk patterns; `sips`/`file` for icon dimensions;
`npm test` to confirm the current test baseline (52 pass / 0 fail). Claims about the Chrome Web
Store dashboard (listing text, Privacy tab, category) are **out-of-repo** and marked
*not verifiable from repo*.

---

## 1. Summary table

| # | Guideline section | Status | Key evidence |
|---|---|---|---|
| 1 | Compliance (program policies, single purpose) | **Met** — one review-risk note | Single, narrow purpose (`manifest.json:3-5`); no ads/analytics/network; name contains a third-party brand → disclaimer advised |
| 2 | Manifest Version 3 | **Met** | `manifest_version: 3` (`manifest.json:2`); no remote code; no `web_accessible_resources` (`tests/manifest.test.mjs:28-30`) |
| 3 | Security | **Met** | No `eval`/`new Function`/remote scripts; one `innerHTML` with a constant (`content/features/copy-header.js:31`); page-derived data never re-injected |
| 4 | Privacy | **Met in code** — submission action required | Zero data collection/transmission; only `chrome.storage.sync` settings (`content/settings.js:1-18`); Privacy tab *not verifiable from repo* |
| 5a | Perf — Performance tooling / e2e testing | **Partial** | 52 unit tests pass; **no** Puppeteer/Playwright e2e |
| 5b | Perf — bfcache invalidation | **Met** | `grep` for `unload`/`beforeunload`/`pagehide`/`WebSocket`/`WebRTC`/`EventSource`/`sendBeacon` → **0 hits**; observer is `MutationObserver` + rAF (`content/observer.js:19-23,35`) |
| 5c | Perf — `document_start` cost | **Met** | `document_start` block is CSS-only (`manifest.json:26-28`); pre-paint JS is 1–3 lines (`theme/apply-dark.js:1`, `theme/apply-dark-auto.js:1-3`) |
| 6 | User experience | **Partial** | Transient, non-blocking toasts (`content/toast.js:23`); no in-extension onboarding; sign-in **N/A** |
| 7 | Store listing (images + category) | **Gap** | Icons 16/32/48/128 present and dimension-correct; **tile, marquee, screenshots absent**; category *not verifiable from repo* |

---

## 2. Compliance

**Status: Met.** One review-risk note (branding).

- **Single purpose:** the extension has one narrow purpose — improve the local ngrok agent
  dashboard (`manifest.json:3-5`, `AGENTS.md:5-8`). The four features (dark mode, copy-as-cURL,
  per-header copy, response-body copy) all serve that single surface. No second, unrelated purpose.
- **No policy-violating behavior found:** the guideline's program-policy risk areas for this
  extension class are ads, analytics, remote code, and data exfiltration. All are absent:
  no network calls at all (`grep` for `fetch(`/`XMLHttpRequest`/`importScripts` → 0 hits outside
  comments/tests), no analytics SDK, no remote code, no `chrome.runtime.getURL()` of executable
  assets.
- **Broad host permissions (documented trade-off, not a violation):**
  `host_permissions: ["http://localhost/*", "http://127.0.0.1/*"]` (`manifest.json:10`) grants
  access to *every* local web app, and both stylesheets are injected into all of them
  (`manifest.json:26`, `manifest.json:31`). Mitigations are sound and were already reasoned about:
  `theme/dark.css` is inert without `html.ngpp-dark` (`theme/dark.css:1-9`), `content/ngpp.css`
  selectors are namespaced (`content/ngpp.css:18-19,25-30`), and `main.js` bails on non-dashboard
  pages (`content/main.js:8`, `content/selectors.js:48-53`). This is accepted and expected for a
  localhost dev tool, but see P1-3 (permission-justification field).

**Review-risk note — third-party brand in the name.** The item name is `ngrok-inspect-plus`
(`manifest.json:3`) and the description names ngrok (`manifest.json:5`). Google's program policies
prohibit implying affiliation/endorsement by a third party. This is a common, usually-tolerated
pattern for third-party dev-tool enhancers, but a listing disclaimer ("not affiliated with, or
endorsed by, ngrok") is cheap insurance. See **P1-2**.

---

## 3. Manifest Version 3

**Status: Met.** No MV3 anti-patterns found.

- `manifest_version: 3` (`manifest.json:2`); `minimum_chrome_version: 120` (`manifest.json:6`).
- **Background is an MV3 service worker** (`manifest.json:12-15`), ESM (`type: module`), stateless:
  listeners registered at top level, every wake-up re-reads storage
  (`background/service-worker.js:1-6,57-69`).
- **No remote code / no `eval`.** `grep` for `eval(`, `new Function`, `document.write`,
  `insertAdjacentHTML`, `outerHTML` → 0 hits. The single `innerHTML` is a constant
  (`content/features/copy-header.js:31`, constant defined `:8-11`).
- **No `web_accessible_resources`** — correct. Icons are inline SVG `data:`/inline strings, so
  nothing needs to be exposed to the page; this is asserted by a test
  (`tests/manifest.test.mjs:28-30`) and documented (`content/features/copy-header.js:6-7`).
- **Dynamic content-script registration is used idiomatically** — `chrome.scripting.registerContentScripts`
  with `runAt: 'document_start'` (`background/service-worker.js:31-33`), and the `scripting`
  permission is genuinely required for it (`manifest.json:8`).
- **No explicit `content_security_policy` key** → the default MV3 CSP applies (no inline script, no
  remote script). That is the secure default; nothing to add.
- **No `declarative_net_request`, no `externally_connectable`, no `declarative_*` leftovers**
  (grep of `manifest.json` → none). Nothing non-functional declared.

---

## 4. Security

**Status: Met.**

| Area | Verdict | Evidence |
|---|---|---|
| HTTPS / secure transport | **N/A — no transport.** The extension makes **zero** network requests; nothing leaves the machine. It runs on loopback (`http://localhost`), which is a secure context. | grep: no `fetch`/XHR/WebSocket; `content/clipboard.js:1-2` |
| Remote code / CSP | **Clean.** No `eval`, `new Function`, remote scripts, or fetched-then-executed content. | grep: 0 hits |
| `innerHTML` / HTML injection | **Safe.** The only `innerHTML` is `btn.innerHTML = COPY_ICON_SVG` (`content/features/copy-header.js:31`), a constant author-controlled string (`:8-11`). | — |
| Page-controlled data → DOM | **Safe.** ngrok DOM text is read into clipboard payloads but **never** re-injected as HTML. Reads use `textContent` (`content/selectors.js:94-98`, `content/raw-message.js:31,35`); writes use `textContent` (`content/toast.js:19`, `content/features/copy-curl.js:23`, `content/features/copy-response.js:71-72`) or `setAttribute` for a label built from page text (`content/features/copy-header.js:36-37`) — `setAttribute` does not parse HTML. |
| XSS via dashboard data | **Not reachable.** A malicious ngrok request (e.g. `X-Foo: <img onerror=...>`) can end up inside a copied cURL string or a toast message, but the toast path is `textContent` (`content/toast.js:19`) and the clipboard path is `navigator.clipboard.writeText` — neither parses HTML. |
| Deceptive installation tactics | **Not present.** No bundled installers, no fake CTAs, no popup/UI that misrepresents function. | — |
| Clipboard | **Correct.** `navigator.clipboard.writeText()` on a user gesture, `execCommand` fallback for a blurred document (`content/clipboard.js:7-33`). No MV3 clipboard permission exists or is needed. | `AGENTS.md:133-135` |
| Selector injection | **Not present.** No dynamic selector is built from untrusted input; all selectors are static (`content/selectors.js:10-40`). | — |

**Residual note (inherent, accepted):** any unrelated app served on `localhost:4040` is darkened by
the unconditional pre-paint script when the theme is `dark`/`auto`+dark-OS
(`theme/apply-dark.js:1`, `background/service-worker.js:10-14`). This cannot be gated on
`isDashboard()` because it must run before the DOM exists. Low impact; already documented.

---

## 5. Privacy

**Status: Met in code. Submission action required (see P0-1).**

- **The extension collects no user data.** There is no network I/O, no analytics, no telemetry, no
  remote logging. Nothing is transmitted anywhere, by design (`AGENTS.md:10-13`, grep confirms).
- **The only persisted state is local settings**, under a single `settings` key in
  `chrome.storage.sync` (`content/settings.js:1-6,34,49`). This is the user's own preference data
  (theme mode, cURL formatting flags). It is stored/synced by Chrome itself; the developer never
  receives it. No PII, no identifiers, no browsing history.
- **Sensitive data is read but not collected.** The extension reads request/response content from
  the local dashboard — which *can* contain secrets (e.g. `Authorization` headers, cookies, tokens,
  PII in bodies) — and writes it to the clipboard **only on an explicit user click**
  (`content/features/copy-curl.js:28-89`, `content/features/copy-header.js:44-57`,
  `content/features/copy-response.js:135-139`). It is never stored or transmitted. This is a
  local, user-initiated action, not "collection" — but it is the one nuance that must be described
  accurately in the Privacy tab.

**Privacy tab answers (recommended wording — *the tab itself is not verifiable from repo*):**

- *Data collection:* "This extension does not collect or transmit any user data."
- *Single purpose:* "Enhance the local ngrok agent dashboard (`http://localhost:<port>`) with dark
  mode and copy-as-cURL / copy-header / copy-body actions."
- *Permission justifications:* `storage` → persist the user's display/formatting preferences;
  `scripting` → register the pre-paint dark-mode bootstrap; host permissions
  (`http://localhost/*`, `http://127.0.0.1/*`) → the extension only operates on the locally-served
  ngrok dashboard, whose port is user-configurable.
- *Remote code:* "No. All code is included in the package."
- *Certifications:* no selling/transferring of data, no use for creditworthiness/lending, not
  targeted at children.

**Privacy policy:** with no data collection, a privacy-policy URL is not strictly mandated by the
data-use certification, but the extension *does* touch potentially sensitive request content. A
short, plain-language privacy policy (one paragraph: "reads dashboard content locally on user
action; nothing is transmitted") is strongly recommended so the listing and the Privacy tab agree.
See **P0-1**.

---

## 6. Performance and functionality

### 6.1 Performance tooling / testing

**Status: Partial.**

- **Present:** 52 unit tests, all passing (`npm test`; `tests/`), covering the pure logic
  (`tests/curl.test.js`, `tests/response-body.test.js`), manifest invariants
  (`tests/manifest.test.mjs`), service-worker registration decisions against a mocked `chrome`
  (`tests/service-worker.test.mjs`), the dashboard-detection gate in a `vm` sandbox
  (`tests/selectors.test.mjs`), the copy-response state machine (`tests/copy-response-state.test.mjs`),
  and settings drift (`tests/settings-sync.test.mjs`). This is a strong unit baseline for a
  no-build extension.
- **Gap — no end-to-end test.** The guideline explicitly recommends e2e tests with a library like
  Puppeteer to verify the extension "from start to finish". There is none (`grep` for
  `puppeteer|playwright|e2e|cypress` → 0 hits in code). The repo acknowledges the blocker:
  Chrome 155 here ignores `--load-extension`, so a live browser run is not automatable in this
  environment (`AGENTS.md:125-129`). The FOUC timing and the popup toggle remain manual
  (`.okf/log.md:154`). See **P1-1**.
- **Gap — no documented cross-browser/OS/network manual test matrix.** The guideline also asks for
  thorough manual testing across browser versions, OSs, and network conditions. `AGENTS.md:72-102`
  documents a solid local-testing procedure for one platform; a short matrix would close this.

### 6.2 Back/forward cache (bfcache) invalidation

**Status: Met.** This is the guideline's most concrete performance requirement, and the extension
is clean:

- **`grep` sweep result: 0 hits** for `unload`, `beforeunload`, `pagehide`, `WebSocket`,
  `WebRTC`, `RTCPeerConnection`, `EventSource`, `sendBeacon` across all `.js`/`.mjs`/`.html`.
- The DOM watcher is a `MutationObserver` (childList/subtree/characterData) whose callback only
  schedules a `requestAnimationFrame` (`content/observer.js:19-23,35`) — **no unload handler, no
  socket, no `pagehide`** — so it cannot invalidate bfcache.
- Other listeners are bfcache-safe: a `matchMedia('(prefers-color-scheme: dark)').change` listener
  (`content/theme.js:25`), a `chrome.runtime.onMessage` listener (`content/theme.js:20`), and
  document-level delegated `click` listeners (`content/features/*.js`) — none of these are
  bfcache-invalidating causes.
- **Verification suggestion:** the guideline points at DevTools → Application → Back/forward cache.
  Add a one-line note in `docs/` (or a test checklist) recording that
  `http://localhost:4040/inspect/http` survives a back/forward navigation with the extension loaded,
  so the claim is checked rather than assumed.

### 6.3 `document_start` cost

**Status: Met.**

- The `document_start` content-script block is **CSS only** — no JS, so it cannot block parsing
  (`manifest.json:23-29`).
- The only `document_start` JS is the dynamically registered pre-paint bootstrap
  (`background/service-worker.js:20,31-33`): `theme/apply-dark.js` is a single
  `classList.add` (`theme/apply-dark.js:1`) and `theme/apply-dark-auto.js` is a 3-line
  `matchMedia` guard (`theme/apply-dark-auto.js:1-3`). No synchronous XHR, no `document.write`,
  no network → negligible main-thread cost, and it is deliberately scoped to the default `:4040`
  origin to avoid touching unrelated local apps (`background/service-worker.js:10-14`).
- The observer's re-assertion pass runs on rAF, coalesced (`content/observer.js:19-23`); the
  dashboard's ~1 Hz poll is the driver, and each pass is guarded by `data-ngpp` idempotency
  (`content/observer.js:12`, `content/features/*.js`).
- No heavy dependencies and no bundled assets: there are **no runtime npm dependencies**
  (`package.json:1-9`), so there is no bundle-bloat or parse-cost concern.

---

## 7. User experience

**Status: Partial.**

- **Onboarding:** the guideline says onboarding begins at the store listing (screenshots + video).
  In-extension there is **no first-run guidance** — the extension is zero-config and works on load,
  which is acceptable, but nothing tells a new user the popup exists or what the toolbar buttons do.
  The listing assets (P0-2) are the primary onboarding lever here.
- **Persistent UI:** the injected UI is unobtrusive — two toolbar buttons
  (`content/features/copy-curl.js:19-25`, `content/features/copy-response.js:62-76`) and a small
  always-visible per-header copy icon (`content/ngpp.css:30-43`). No side panel, no modal, no
  layout-shifting overlay (the icon's space is reserved, `content/ngpp.css:25-29`). Feedback is a
  transient, `aria-live="polite"` toast auto-dismissed after 2.4 s (`content/toast.js:11-12,23`),
  with `prefers-reduced-motion` respected (`content/ngpp.css:81-86`). This matches the guideline's
  "avoid distracting users".
- **Accessibility of the injected UI (supports the UX/a11y bar):** real `<button>` elements with
  `type="button"` and `aria-label` (`content/features/copy-header.js:26-37`,
  `content/features/copy-curl.js:19-24`), `aria-disabled` instead of `disabled` so the control stays
  focusable (`content/features/copy-response.js:88-95`), and visible `:focus-visible` outlines
  (`content/ngpp.css:48-52`).
- **Sign in with Google:** **N/A** — there is no login, account, or backend.

---

## 8. Store listing

**Status: Gap** (listing assets); icons **Met**.

### 8.1 Images

- **Icon — present and valid.** All four sizes exist and are genuinely the declared dimensions
  (verified with `sips`/`file`): `icons/16.png` 16×16, `icons/32.png` 32×32, `icons/48.png` 48×48,
  `icons/128.png` 128×128, all 8-bit RGBA PNG. The 128×128 meets the store's icon requirement, and
  a test asserts every declared icon exists on disk (`tests/manifest.test.mjs:36-40`).
- **Required listing images — absent from the repo:**
  - **Small promo tile** (440×280) — missing.
  - **Marquee promo tile** (1400×560, optional but recommended) — missing.
  - **Screenshots** (1280×800 or 640×400; 1–5 required) — missing. These are the single most
    impactful onboarding asset per the guideline.
  `find` for `*screenshot*|*tile*|*marquee*|*promo*` → 0 hits.
  These are uploaded to the CWS dashboard, so they are strictly *listing-side*; but versioning them
  in the repo (e.g. `store/`) keeps the listing reproducible. See **P0-2**.

### 8.2 Category

**Recommendation: Developer Tools.**

- The guideline defines **Developer Tools** as "extensions that help web developers perform tasks
  like debugging, performance analysis, code linting, and tools that enhance the browser's Dev
  Tools … **API testing**". ngrok is a developer tunneling tool, and this extension augments the
  ngrok agent's request inspector — the copy-as-cURL and header/body-copy features are squarely
  "API testing / inspection" workflows. This is the honest primary purpose and gives the best
  discovery match (users of ngrok are developers).
- **Accessibility** is a weaker fit. The guideline does list "dark mode extensions" under
  Accessibility, and dark mode *is* one of the four features — but it is not the extension's
  purpose, and categorising under Accessibility would misrepresent a dashboard-utility extension,
  reduce discoverability among its actual audience, and could invite a "category mismatch" review
  question. Do **not** pick Accessibility.
- **Tools** (the catch-all) is a valid fallback if Developer Tools is rejected, but Developer Tools
  is the correct primary.

### 8.3 Out-of-repo (not verifiable from this repository)

Marked as *not verifiable*, **not** as gaps:

- Store listing name, summary, detailed description, and any video.
- The Privacy tab answers and privacy-policy URL (§5 recommends the wording).
- The chosen category (dashboard-side; §8.2 recommends Developer Tools).
- Distribution/visibility settings, regions, and test instructions.
- Whether the store's single-purpose statement matches `manifest.json:3-5`.

---

## 9. Prioritized action list

Legend — **P0** = must be done to publish / pass review · **P1** = recommended to reduce review risk
or materially improve quality · **P2** = nice-to-have polish.

### P0 — required for the submission

1. **Complete the Privacy tab accurately, and publish a minimal privacy policy.**
   Nothing is collected or transmitted, so no privacy-policy URL is strictly mandated — but the
   extension reads potentially sensitive request/response content locally, so state the nuance
   explicitly (wording in §5). *Not a code change; dashboard-side.*
2. **Produce the required listing images:** 1–5 screenshots (1280×800 or 640×400), the 440×280
   small promo tile, and (recommended) the 1400×560 marquee. Icons are already correct
   (`icons/16,32,48,128.png`). *No repo change required to publish; consider versioning them under
   `store/`.*
3. **Write the store description to match `manifest.json:3-5` and the single-purpose statement** —
   the listing must explicitly communicate what the extension does (guideline §Store listing).
   *Dashboard-side.*

### P1 — recommended

1. **Add an end-to-end test (Puppeteer) and a documented manual test matrix.** The guideline
   recommends e2e explicitly; the repo has 52 unit tests but no e2e (`AGENTS.md:125-129` documents
   that `--load-extension` is ignored in *this* environment, so run the e2e in CI or on a machine
   where it works). At minimum, add a short checklist covering back/forward navigation (bfcache),
   the popup toggle, and FOUC timing — the items currently marked "manual" in `.okf/log.md:154`.
2. **Add a "not affiliated with ngrok" disclaimer to the listing** to mitigate the third-party
   brand in the item name (`manifest.json:3`). Consider whether the name could read as an official
   ngrok add-on.
3. **Fill in the permission-justification fields** for `storage`, `scripting`, and the
   `http://localhost/*` / `http://127.0.0.1/*` host permissions (`manifest.json:8-10`), using the
   wording in §5. Broad-ish host permissions are the most likely source of a reviewer question.
4. **Record the bfcache verification** (DevTools → Application → Back/forward cache on
   `http://localhost:4040/inspect/http`) in `docs/` so the "Met" verdict in §6.2 is evidence-backed
   rather than static-analysis-only.

### P2 — polish

1. **Add `homepage_url` and `author` to `manifest.json`** so the store listing and the installed
   extension surface a canonical project/support link. Currently absent.
2. **Consider a one-line first-run affordance** (e.g. a one-time toast pointing at the popup) — the
   extension is zero-config, so this is optional (§7).
3. **Add a `README.md` / `CHANGELOG.md`** for the public repo, if the store listing links to it.

---

## 10. Verdict

The extension is **compliant with the Chrome Web Store Best Practices guideline in every area that
is checkable from the repository**. The MV3 implementation is clean (no remote code, no
`web_accessible_resources`, no MV3 anti-patterns), the security posture is sound (single constant
`innerHTML`, all page-derived data via `textContent`, no network I/O), and it is **bfcache-safe**
(zero `unload`/WebSocket usage). The only substantive gaps are (a) **submission completeness** —
listing images and Privacy tab wording, which are dashboard-side and cannot be verified from the
repo, and (b) **no end-to-end test**, a guideline recommendation rather than a review blocker.
