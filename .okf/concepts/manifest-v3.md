---
type: decision
title: "Manifest V3"
description: "ngrok-inspect-plus targets Chrome Manifest V3, implying a service worker and no remotely hosted code."
status: active
verified:
  - by: "user"
    at: "2026-10-18"
  - by: "okf-update"
    at: "2026-10-19"
sources:
  - uri: "user://project-brief"
    credibility: high
stale_after: "2027-04-18"
---

# Manifest V3

## Decision

`ngrok-inspect-plus` is built as a **Chrome Manifest V3** extension (`manifest_version: 3`).

## Rationale

MV3 is the current Chrome extension platform; MV2 is deprecated. No alternative was
considered.

## Consequences

- Background logic runs in an **event-driven service worker**, not a persistent background
  page. It can be terminated at any time, so no long-lived in-memory state may be assumed;
  use `chrome.storage` for anything that must survive.
- **No remotely hosted code** — all JavaScript must ship inside the bundle. No CDN scripts,
  no `eval` of fetched content.
- The entrypoint is `manifest.json`. Permissions are `storage` + `scripting`; `host_permissions`
  cover **all** loopback ports (`http://localhost/*`, `http://127.0.0.1/*` — deliberately **no
  explicit port**, so the extension follows the dashboard wherever the agent serves it).
