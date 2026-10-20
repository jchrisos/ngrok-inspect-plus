# Manual test matrix — ngrok-inspect-plus

**Date:** 2026-10-20 · **Applies to:** v0.1.0 (MV3)
**Why this exists:** the [Chrome Web Store Best Practices](https://developer.chrome.com/docs/webstore/best-practices)
guideline asks for end-to-end tests **and** "thorough manual testing across different browser
versions, OSs, and network conditions". `make e2e` covers the automatable part; this matrix covers
the rest. See `docs/plans/cws-best-practices-review-2026-10-20.md` (P1-1).

## What is already automated — do not re-test by hand

| Suite | Command | Covers |
|---|---|---|
| Unit | `make test` (52 tests) | curl generation, response-body decoding/truncation, the copy-response state machine, the SW theme-registration decisions, the `isDashboard()` gate, manifest invariants, settings drift. |
| End-to-end | `make e2e` (26 checks) | Real Chrome against a synthetic dashboard shell: injection of all four features, the `isDashboard()` gate, idempotency across an observer pass, exact clipboard payloads, confirmation toasts, dark mode via emulated `prefers-color-scheme`, and a **bfcache** check. |

`make e2e` auto-detects whether Chrome honoured `--load-extension`. In **inject** mode (see
`AGENTS.md`) it injects the manifest's content scripts directly, so manifest-based registration is
*not* exercised — run `make e2e` with `--strict` in CI to require the full path.

The cases below are the ones the automated suites cannot reach: the **real** ngrok agent DOM, FOUC
timing, ngrok's own capture limits, and the popup/SW lifecycle.

## Environments

| Axis | Minimum / variants |
|---|---|
| Chrome | `minimum_chrome_version` is **120**; test at 120 and at current stable. |
| OS | macOS (primary), plus Windows and Linux at least once per release. |
| Network | Loopback only — the extension makes no network requests, so "network conditions" reduce to: **offline** (must behave identically) and **slow** (irrelevant). Verify offline once per release. |
| Dashboard port | default `:4040` **and** a custom `--web-addr localhost:4041`. |

Setup (three terminals, see `AGENTS.md`): `make fixtures` → `make tunnel` → `make traffic`, then
open `http://localhost:4040/inspect/http`. **Kill the tunnel when done** (`make stop`) — it exposes
the served directory publicly.

## A. Load, FOUC, and the SW lifecycle

| # | Steps | Expected |
|---|---|---|
| A1 | Reload the extension, then open `http://localhost:4040` with the OS in dark mode. | No light→dark flash: `html.ngpp-dark` is applied **before first paint** (the pre-paint script is registered for `:4040`). |
| A2 | Run the agent on a custom port (`ngrok http 8080 --web-addr localhost:4041`), dark mode, hard-reload. | The dashboard is themed, applied at `document_idle` by `content/theme.js`. A brief flash is **expected and accepted** here (see the SW note in `AGENTS.md`). |
| A3 | With the `:4041` dashboard open, toggle the theme in the popup. | The change reaches the custom-port tab (the broadcast uses all-loopback match patterns). |
| A4 | Load an **unrelated** app on `localhost` (e.g. `python3 -m http.server 8099`), dark mode on. | Only the `:4040` pre-paint script could darken it; on any other port the app is **untouched** and the console is silent. |
| A5 | `chrome://serviceworker-internals` → stop the extension's SW, then toggle the theme in the popup. | The SW restarts, re-reads `chrome.storage.sync`, and still registers/broadcasts correctly (it is stateless). |
| A6 | Rapidly toggle the theme 10× in the popup. | No "Duplicate script ID" unhandled rejection in the SW console (reconciles are serialised). |

## B. Dark mode

| # | Steps | Expected |
|---|---|---|
| B1 | Set the popup to **auto** and flip the OS appearance while the dashboard is open. | The dashboard follows live, without a reload. |
| B2 | Force the popup to **dark**, then to **light**, with the OS in the opposite scheme. | The popup wins. |
| B3 | Hover every interactive surface with `:hover` **forced** in DevTools (`CSS.forcePseudoState`), on Bootstrap nav items and on `_roundTripSelect_… tr:hover:not(._selected_…)`. | Hover uses `--ngpp-surface-2` and is visually distinct from selected (`--ngpp-selected`); no light-on-dark or dark-on-dark text. |
| B4 | Select a request, then move the mouse over the list. | Selected and hovered states remain distinguishable. |

## C. Copy as cURL

| # | Steps | Expected |
|---|---|---|
| C1 | Select a `POST` with a JSON body → **Copy as cURL** → paste. | `curl -X POST '<https URL from X-Forwarded-Proto + Host>'` with one `-H` per header (continuation lines) and `--data-raw '<body>'`. |
| C2 | Popup → `multiline` off. Repeat C1. | A single-line command. |
| C3 | Popup → `stripForwardedHeaders` off. Repeat C1. | `X-Forwarded-For/-Host/-Proto/-Port` and `X-Real-Ip` now appear as `-H` flags. |
| C4 | Popup → `includeCompressed` on. Repeat C1. | `--compressed` is appended and `Accept-Encoding` is dropped. |
| C5 | `GET /empty` (204). | No body flag at all (not `--data-raw ''`). |
| C6 | `POST /blob.bin` with binary bytes. | Body **omitted**, preceded by `# ngrok-inspect-plus: body omitted: N bytes, non-UTF-8`. Never raw bytes, never base64. |
| C7 | A request whose body ngrok did not capture (≥ ~100 KiB). | `# ngrok-inspect-plus: body not captured by ngrok …` + headers-only command; the toast mentions the warning. |
| C8 | A request with no `X-Forwarded-Proto`. | The URL falls back to `https://<Host><target>`. |
| C9 | A request with no `Host` header. | The URL falls back to the page origin. |
| C10 | A request with an absolute-form target (`GET http://x/y`). | The absolute target is kept verbatim. |
| C11 | A header with an **empty** value. | Emitted as `-H 'Name;'`. |
| C12 | Reload the extension and repeat C1. | The button is present exactly once (no duplicates after re-injection). |

## D. Per-header copy (request **and** response)

| # | Steps | Expected |
|---|---|---|
| D1 | Click the copy icon on a request header. | The clipboard holds the **value only** (`application/json`), not `Content-Type: application/json`. Toast: `Copied header <Name> value.` |
| D2 | Click the copy icon on a response header. | Value only. Toast: `Copied response header <Name> value.` |
| D3 | Select a **different** request in the list, then click the same header position. | The correct (new) header name/value is copied — payloads are read from the live DOM, never captured in a closure. |
| D4 | Check the accessible name of each icon (DevTools a11y pane). | `Copy header <Name>` / `Copy response header <Name>`, refreshed on every selection change. |
| D5 | Duplicate header names (e.g. two `Set-Cookie`). | Each row gets its own button; each copies its own value. |

## E. Copy response body

| # | Steps | Expected |
|---|---|---|
| E1 | Select a request with a JSON response → **Copy body**. | The clipboard holds ngrok's **Summary** rendering. Toast: `Copied response body (N chars)`. |
| E2 | `GET /empty` (204). | Button `aria-disabled=true`, `title="no response body"`; clicking shows `no response body` and copies nothing. |
| E3 | `GET /truncated` (lying `Content-Length`). | Toast: `Copied response body — copied N of M bytes (truncated by ngrok)`; button `title="body appears truncated by ngrok"`. |
| E4 | `GET /latin1` (non-UTF-8 declared charset). | Decoded with the declared charset, **not** reported as truncated (byte-accurate length). |
| E5 | `GET /blob.bin` (binary). | Nothing is copied; toast `binary response body — not copied`. |
| E6 | `GET /huge.txt` (≥ ~100 KiB, never captured). | `aria-disabled=true`, `title="response body not captured by ngrok"`. |
| E7 | Popup → `normaliseNewlines` on, with a CRLF body. | `\r\n` becomes `\n` in the clipboard. |
| E8 | Confirm no payload is ever echoed. | Toasts announce size/reason only, never body content. |

## F. Back/forward cache

Automated in `make e2e`; re-run by hand on the **real** dashboard once per release:

1. Open `http://localhost:4040/inspect/http` with the extension loaded and a request selected.
2. Navigate to another page, then press **Back**.
3. DevTools → **Application → Back/forward cache** → *Test back/forward cache*.

**Expected:** the navigation is restored from the cache, `notRestoredReasons` is empty, and the
injected UI (copy-as-cURL, header icons, Copy body) is still present without a reload.
Recorded evidence: `docs/plans/bfcache-verification-2026-10-20.md`.

## G. Accessibility and UX

| # | Steps | Expected |
|---|---|---|
| G1 | `Tab` through the dashboard. | Injected buttons are reachable, in DOM order, with a visible `:focus-visible` outline. |
| G2 | Click any copy button with a screen reader running. | The `role="status"` `aria-live="polite"` toast is announced; it disappears after 2.4 s without stealing focus. |
| G3 | Enable **Reduce Motion** in the OS. | Toast and icon transitions are disabled; nothing else changes. |
| G4 | Zoom to 200%. | The header copy icon does not overlap the value (space is reserved), and header names stay on one line with horizontal scroll. |
| G5 | Open the popup with the dashboard in a background tab. | Settings load; toggling applies to the dashboard tab. |

## H. Cross-browser / OS smoke (once per release)

| # | Steps | Expected |
|---|---|---|
| H1 | Repeat A1, C1, D1, E1 on Windows and Linux, current stable Chrome. | Identical behaviour (only `multiline` is user-visible OS-specific, and it is a setting). |
| H2 | Repeat A1 with Chrome **120** (the `minimum_chrome_version`). | Identical behaviour. |
| H3 | Disconnect the network entirely, reload the dashboard. | Identical behaviour — the extension makes no network requests. |

## Validating the bfcache check itself

The automated check is only trustworthy if it can fail. To confirm it has teeth:

1. Temporarily add `<script>addEventListener('unload', () => {});</script>` to
   `tests/e2e/dashboard-shell.html`.
2. Run `make e2e`. **Expected:** the bfcache check fails with `type=back_forward` and a non-empty
   `reasons` array.
3. Revert the fixture. **Expected:** the check passes with `type=navigate reasons=null`.

This was performed on 2026-10-20 (Chrome 155.0.8059.85) and behaved as described — see
`docs/plans/bfcache-verification-2026-10-20.md`.

## Recording a run

```
Date:
Chrome / OS:
Dashboard port:
Cases run:            # e.g. A1-A6, C1-C12
Failures:
Notes:
```
