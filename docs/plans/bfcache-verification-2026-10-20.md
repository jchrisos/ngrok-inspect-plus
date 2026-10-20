# bfcache verification — ngrok-inspect-plus

**Date:** 2026-10-20 · **Target:** v0.1.0 (MV3) · **Environment:** macOS (darwin), Chrome
155.0.8059.85, Node v24.18.0

**Why this exists:** the [Chrome Web Store Best Practices](https://developer.chrome.com/docs/webstore/best-practices)
guideline singles out back/forward cache invalidation as a common, serious performance pitfall for
extensions ("Given extensions can run on every page, it's essential you make sure [to] avoid code
that prevents that caching"). The review recorded this as **Met** by static analysis
(`docs/plans/cws-best-practices-review-2026-10-20.md` §6.2). This note upgrades that verdict from
*static* to *verified*, and records that the verification itself is not vacuous.

## 1. Static evidence — the invalidation causes are absent

The guideline names two causes: `unload` handlers and WebSocket/WebRTC connections in content
scripts. Neither exists anywhere in the extension:

```bash
grep -rniE "unload|beforeunload|pagehide|WebSocket|RTCPeerConnection|EventSource|sendBeacon|XMLHttpRequest" \
  background content popup theme tools *.json Makefile
# -> no matches
```

The DOM watcher is a `MutationObserver` whose callback only schedules a
`requestAnimationFrame` (`content/observer.js:19-23,35`) — not an invalidation cause. The other
listeners are a `matchMedia('(prefers-color-scheme: dark)').change` listener
(`content/theme.js:25`), a `chrome.runtime.onMessage` listener (`content/theme.js:20`), and
delegated document-level `click` listeners — all bfcache-safe.

## 2. Automated evidence — `make e2e` check

`tests/e2e/run.mjs` navigates dashboard → other page → **back**, then reads
`performance.getEntriesByType('navigation')[0].notRestoredReasons`.

Result on a clean fixture:

```
✓ bfcache: back/forward navigation is not blocked by the extension
    url=/dashboard-shell.html type=navigate reasons=null
• bfcache: the back navigation was served from the cache (no new navigation entry)
    type=navigate
✓ bfcache: injected UI survives the restore (no re-injection needed)
```

`type=navigate` with `reasons=null` means the back navigation was served from the bfcache and
**no new navigation entry was created** — a blocked navigation instead reports
`type=back_forward` with a populated `reasons` array. The injected UI was still present after the
restore, confirming the cached DOM is reused intact.

## 3. The check has teeth — verified by inducing a failure

A passing check is worthless if it cannot fail. The same run was repeated with a single
`unload` handler temporarily added to the fixture
(`<script>addEventListener('unload', () => {});</script>`):

```
✗ bfcache: back/forward navigation is not blocked by the extension
    url=/dashboard-shell.html type=back_forward reasons=[{"reason":"masked", …}]
• bfcache: the page was re-loaded rather than restored — check the reasons above
    type=back_forward
```

The check correctly flipped to **fail**, and the navigation type changed from `navigate` to
`back_forward`. The fixture was then reverted (`git diff` clean) and the check passed again. The
same procedure is documented in `docs/specs/manual-test-matrix.md` for future runs.

**Caveat:** the reason string is reported as `masked` because Chrome withholds cross-origin
invalidation details here. That does not weaken the check — it asserts on the *presence* of
reasons and on the navigation type, not on their text.

## 4. Residual gap — the real agent dashboard

The automated run uses a synthetic shell (`tests/e2e/dashboard-shell.html`), not the live ngrok
agent. Two reasons: `--load-extension` is ignored by Chrome 155 in this environment (`AGENTS.md`),
and the real dashboard requires an active tunnel. The real-dashboard confirmation is therefore a
**manual** step, recorded in the matrix (§F): DevTools → *Application → Back/forward cache* →
*Test back/forward cache* on `http://localhost:4040/inspect/http`. It has not been run against a
live tunnel as part of this change.

## Verdict

The bfcache verdict in the CWS review is **upheld**: the extension contains none of the guideline's
invalidation causes, an automated check confirms a back navigation is served from the cache, and
that check is demonstrably able to detect a regression.
