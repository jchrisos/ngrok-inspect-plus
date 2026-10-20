---
type: decision
title: "Chrome Web Store Publishing"
description: "ngrok-inspect-plus is compliant with the Chrome Web Store Best Practices guideline; remaining work is submission-side (listing images, Privacy tab, privacy policy)."
status: active
verified:
  - by: "front-architect"
    at: "2026-10-20"
  - by: "okf-update"
    at: "2026-10-20"
sources:
  - uri: "https://developer.chrome.com/docs/webstore/best-practices"
    credibility: high
  - uri: "file://docs/plans/cws-best-practices-review-2026-10-20.md"
    credibility: high
  - uri: "file://docs/specs/store-listing-2026-10-20.md"
    credibility: high
stale_after: "2027-04-20"
---

# Chrome Web Store Publishing

## Decision

Ship `ngrok-inspect-plus` to the Chrome Web Store as an MV3 extension whose **publishing posture
is "no data collected"**: no network I/O, no analytics, no remote code. The store listing is
written to say exactly that.

## Status

A section-by-section review against the official guideline
([Chrome Web Store Best Practices](https://developer.chrome.com/docs/webstore/best-practices))
found the extension **compliant in every area checkable from the repository**. The remaining work
is submission completeness, which lives in the CWS dashboard, not in code. See
`docs/plans/cws-best-practices-review-2026-10-20.md`.

| Guideline area | Verdict |
|---|---|
| Compliance / single purpose | Met (one narrow purpose; brand-disclaimer note) |
| Manifest V3 | Met — no remote code, no `web_accessible_resources` (see `concepts/manifest-v3.md`) |
| Security | Met — one `innerHTML` (a constant); page-derived data always via `textContent`; never re-injected |
| Privacy | Met in code — zero collection; Privacy tab wording still required |
| Performance — bfcache | Met — zero `unload`/`beforeunload`/WebSocket usage; DOM watch is `MutationObserver` + rAF |
| Performance — e2e testing | **Partial** — 52 unit tests, no Puppeteer e2e |
| `document_start` cost | Met — CSS-only block; pre-paint JS is 1–3 lines |
| User experience | Partial — no first-run affordance; sign-in N/A |
| Store listing assets | **Gap** — icons valid; tile/marquee/screenshots absent |

## Consequences

- **bfcache-safety is a design constraint, not an accident.** Do not introduce `unload` /
  `beforeunload` handlers, WebSockets, or WebRTC in content scripts; that would invalidate the
  back/forward cache and regress the guideline's most concrete performance requirement. Keep the
  observer a `MutationObserver` + rAF (`content/observer.js`).
- **No HTML-injection sinks for page data.** Only one `innerHTML` exists, and it writes a
  constant. Keep it that way: read dashboard text with `textContent`, write with `textContent`.
- **The Privacy tab must track the code.** The listing claims zero collection. Any future feature
  that stores or transmits dashboard content would require both a code change *and* an updated
  Privacy tab + privacy policy.
- **Category is Developer Tools**, not Accessibility (dark mode is one of four features, not the
  purpose).
- **Broad host permissions are a known, justified trade-off** (`http://localhost/*`,
  `http://127.0.0.1/*`, no port) — the justification fields must explain the user-configurable
  dashboard port.

## Submission content

Ready-to-paste listing text, Privacy-tab answers, permission justifications, test instructions, and
the image checklist are in `docs/specs/store-listing-2026-10-20.md`. The publishable privacy policy
is `docs/specs/privacy-policy.md`.

## Open items (not code)

- **P0:** Privacy tab + privacy policy URL; 1–5 screenshots (1280×800 / 640×400); 440×280 tile;
  detailed description.
- **P1:** Puppeteer e2e + manual test matrix; "not affiliated with ngrok" disclaimer; permission
  justifications; record the bfcache verification.
- **P2:** `homepage_url` / `author` in `manifest.json`.
