---
type: architecture
title: "Project Status"
description: "ngrok-inspect-plus is an implemented Chrome MV3 extension improving the ngrok dashboard at localhost:4040."
status: active
verified:
  - by: "okf-init"
    at: "2026-10-18"
sources:
  - uri: "file://AGENTS.md"
    credibility: high
  - uri: "user://project-brief"
    credibility: high
stale_after: "2027-04-18"
---

# Project Status

## Purpose

`ngrok-inspect-plus` is a **Google Chrome extension** that improves the usability of the ngrok
dashboard served at `http://localhost:4040`. It targets that local dashboard UI; it is not
a general-purpose extension and does not call ngrok's cloud API.

## Current state

**Implemented, v0.1.0.** Four features: dark mode (see `concepts/dark-theme.md`), copy-as-cURL,
per-header copy (request + response, always visible), and response-body copy (single action that
copies ngrok's Summary rendering). No bundler, no runtime dependencies — plain ES2022 files loaded
unpacked. The repo **is** a git repository (initialised 2026-10-18).

## Layout

| Path | Purpose |
|---|---|
| `content/` | Classic content scripts, shared via `globalThis.ngpp` (see `concepts/architecture.md`). |
| `background/` | MV3 service worker (ESM, stateless) + its settings copy. |
| `theme/` | `dark.css` + the two 1-line bootstrap scripts (see `concepts/dark-theme.md`). |
| `popup/` | Settings popup. |
| `tests/` | `node --test` unit tests for the pure logic + the SW registration logic. |
| `tools/` | `fixture-server.py` — controlled response bodies for edge-case testing. |
| `docs/plans/` | Implementation plans and review/validation reports. Plans never go under `.opencode/`. |
| `.okf/` | This knowledge bundle. |

## Constraints for Agents

- The Chrome DevTools MCP is available for inspecting the dashboard at
  `http://localhost:4040` and debugging the extension.
- Never leave the ngrok tunnel running — it exposes the served directory publicly.
- Bodies ≥ ~100 KiB are not captured by ngrok; the degraded path is headers-only by design.
