# Store listing — submission content

**Date:** 2026-10-20
**Applies to:** `ngrok-inspect-plus` v0.1.0 (MV3)
**Source review:** `docs/plans/cws-best-practices-review-2026-10-20.md` (P0 items)
**Guidelines:** [Chrome Web Store Best Practices](https://developer.chrome.com/docs/webstore/best-practices) ·
[Listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements) ·
[Supplying images](https://developer.chrome.com/docs/webstore/images)

Copy-paste-ready text for the Chrome Web Store dashboard, plus the image and test-instruction
checklists. Nothing here changes extension code.

---

## 1. Item name

```
ngrok-inspect-plus
```

Must stay identical to `manifest.json:3`. The name contains a third-party brand, so the
**description must carry a non-affiliation disclaimer** (see §3) — see review P1-2.

---

## 2. Summary (short description)

```
Dark mode, copy-as-cURL, per-header copy and response-body copy for the local ngrok dashboard.
```

Identical to `manifest.json:5` (98 chars, within the 132-char limit enforced by
`tests/manifest.test.mjs`).

---

## 3. Detailed description

```
Improve the local ngrok agent dashboard with four small, focused conveniences.

• Dark mode — a dark theme for the dashboard, following your system preference or pinned
  on/off from the toolbar popup.
• Copy as cURL — turn any captured request into a ready-to-paste cURL command, with the URL
  scheme taken from the request itself.
• Per-header copy — a one-click copy button on every request and response header that copies
  the value only.
• Copy response body — copy the response body (or response headers) that ngrok shows in its
  Summary view.

Everything happens locally. The extension runs only on the ngrok dashboard served on loopback
(http://localhost:<port> / http://127.0.0.1:<port>, default :4040). It makes no network
requests, collects no data, and sends nothing anywhere — the only thing it stores is your own
preferences (theme, formatting), kept in Chrome sync storage.

Not affiliated with, or endorsed by, ngrok. "ngrok" is used only to describe what this
extension works with.
```

---

## 4. Category

```
Developer Tools
```

Rationale: the guideline defines **Developer Tools** as covering debugging, inspection, and
"API testing" tooling. This extension augments a developer tunneling tool's request inspector.
**Do not** file under Accessibility — dark mode is one of four features, not the purpose
(review §8.2).

---

## 5. Privacy tab answers

The dashboard's Privacy tab must match the code. Current code collects and transmits nothing.

| Field | Answer |
|---|---|
| Single purpose | Enhance the local ngrok agent dashboard (`http://localhost:<port>`) with dark mode and copy-as-cURL / copy-header / copy-body actions. |
| Data collection | **This extension does not collect or transmit any user data.** |
| Remote code | **No.** All code is included in the package. |
| `storage` permission justification | Persist the user's display and formatting preferences. |
| `scripting` permission justification | Register the pre-paint dark-mode bootstrap that removes the light→dark flash. |
| Host permission justification (`http://localhost/*`, `http://127.0.0.1/*`) | The extension only operates on the locally served ngrok dashboard; the dashboard port is user-configurable (`--web-addr`), so no explicit port is pinned. |
| Data-use certifications | No selling/transferring of data; no use for creditworthiness or lending; not directed at children. |
| Privacy policy URL | Publish `docs/specs/privacy-policy.md` and link it here. |

**Nuance to state accurately:** the extension *reads* dashboard content that can contain secrets
(`Authorization` headers, cookies, tokens) and writes it to the clipboard **only on an explicit
user click**. It is never stored or transmitted. This is a local user action, not collection —
but the Privacy tab wording must not contradict it.

---

## 6. Test instructions (for reviewers)

```
No setup is required. The extension only activates on the ngrok agent dashboard.

1. Install ngrok and run any local server, e.g.:
     python3 -m http.server 8080
     ngrok http 8080
2. Open the dashboard at http://localhost:4040 and generate a request
   (open http://localhost:8080 in another tab, or refresh the dashboard).
3. In the dashboard, select the request and verify:
   - the theme follows the system preference; the toolbar popup pins light/dark;
   - "Copy as cURL" copies a working cURL command;
   - the copy icon on any request/response header copies the value only;
   - "Copy response body" copies the body shown in the Summary view.
```

---

## 7. Image checklist

Uploaded to the dashboard; versioning them in the repo (e.g. under `store/`) keeps the listing
reproducible.

| Asset | Requirement | Status |
|---|---|---|
| Extension icon | 128×128 | **Done** — `icons/128.png` (also 16/32/48, verified pixel-exact) |
| Screenshots | 1–5 required · 1280×800 or 640×400 | **Missing** — highest-impact onboarding asset |
| Small promo tile | 440×280 | **Missing** |
| Marquee promo tile | 1400×560 (recommended) | **Missing** |

Suggested screenshot set (1280×800):
1. Dashboard in dark mode with a request selected.
2. "Copy as cURL" button + the resulting command.
3. Per-header copy icon on a response header, with the confirmation toast.
4. The toolbar popup showing the theme toggle.

---

## 8. Follow-ups (P1/P2 from the review)

- Add a Puppeteer end-to-end test + a manual test matrix (bfcache back/forward, popup toggle, FOUC).
- Record the bfcache check (DevTools → Application → Back/forward cache on
  `http://localhost:4040/inspect/http`) in `docs/`.
- Optionally add `homepage_url` and `author` to `manifest.json`.
