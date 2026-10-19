---
type: runbook
title: "Local Testing"
description: "How to stand up the ngrok dashboard with real tunnel data to exercise the extension."
status: active
verified:
  - by: "user"
    at: "2026-10-18"
sources:
  - uri: "user://project-brief"
    credibility: high
  - uri: "file://AGENTS.md"
    credibility: high
stale_after: "2027-04-18"
---

# Local Testing

To test the extension against a populated ngrok dashboard:

1. Serve content locally: `python3 -m http.server 8080` (serves the current directory).
2. Start the tunnel: `ngrok http 8080 --subdomain test-extension`.
3. Open the dashboard at `http://localhost:4040` — this is the UI the extension modifies.

## Gotchas

- Installed ngrok is **3.39.11**. `--subdomain` is deprecated in favour of `--domain`.
- The account region is `sa`, so `test-extension` resolves to
  **`https://test-extension.sa.ngrok.io`** (verified working).
- Do **not** use `test`: it fails with `This domain is reserved for another account`.
- The ngrok authtoken is already configured at
  `~/Library/Application Support/ngrok/ngrok.yml`; no extra auth setup is needed.
