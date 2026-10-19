---
type: architecture
title: "Dark Theme"
description: "How theme/dark.css overrides the ngrok dashboard, and how to verify it without missing state-dependent styles."
status: active
verified:
  - by: "okf-update"
    at: "2026-10-19"
sources:
  - uri: "file://theme/dark.css"
    credibility: high
  - uri: "file://AGENTS.md"
    credibility: high
stale_after: "2027-04-18"
---

# Dark Theme

## Mechanism

`theme/dark.css` is **always injected** at `document_start` but is **inert** without the
`html.ngpp-dark` class. The class is applied synchronously before first paint by a 1-line
bootstrap script (`theme/apply-dark.js` / `theme/apply-dark-auto.js`) that the service worker
registers dynamically — the persisted `themeMode` *is* the registration state, so there is no
async read and no FOUC. Live toggling is just a class flip (see `concepts/architecture.md`).

That pre-paint registration is pinned to the **default `:4040` origin only**, because the script
is an unconditional `classList.add('ngpp-dark')` and matching all loopback ports would darken
every unrelated localhost app. A dashboard on a **custom port** is therefore themed later, by
`content/theme.js` at `document_idle` (which also re-applies the class as a catch-up) — it may
flash light→dark on load. `dark.css` being inert elsewhere is what makes the broad match safe.

## Cascade strategy

- Scope **every** rule under `html.ngpp-dark` → specificity `(0,1,1)`, which beats Bootstrap's
  single-class rules `(0,1,0)` **without `!important`**.
- **Never use `@layer`** — unlayered page CSS would win.
- Reserve `!important` for rules Bootstrap itself marks `!important` (e.g. `.muted`).
- Hashed CSS-module classes are matched by **attribute-prefix** (`[class*="_params_"]`), since
  they change per ngrok release.

## The hard part: state-dependent styles

Resting-state rules are not enough. Every one of these was a real, user-reported bug:

| Case | Rule that won | Specificity |
|---|---|---|
| Tab hover | Bootstrap `.nav > li > a:hover { background:#eee }` | (0,2,1) |
| Request-list row hover | page module `._inspectSelector_… ._roundTripSelect_… tr:hover:not(._selected_…) { background:#ddd }` | **(0,4,1)** |
| Empty dashboard | Bootstrap `.well { background:#f5f5f5 }` | (0,1,0) |
| Filter box | light background lives on the wrapper `_inputGroup_`, not the inner `<input>` | — |
| Dropdown active item | page module `._active_…` | — |

The row-hover case needs **≥ 5 classes** to beat it: the winning selector reuses the same module
prefixes, `html.ngpp-dark [class*='_inspectSelector_'] [class*='_roundTripSelect_'] tr:hover:not([class*='_selected_'])`.

Hover (`--ngpp-surface-2`) and selected (`--ngpp-selected`) must stay visually distinct.

## Palette tokens

Defined once under `html.ngpp-dark`: `--ngpp-bg #14171c`, `--ngpp-surface #1b1f26`,
`--ngpp-surface-2 #232833`, `--ngpp-nav #0d1014`, `--ngpp-line #2f3642`, `--ngpp-fg #dfe3ea`,
`--ngpp-fg-muted #98a1b0`, `--ngpp-code-bg #0f1216`, `--ngpp-selected #2b3a4d`,
`--ngpp-info-bg #17262f`, `--ngpp-info-fg #9fd3ee`.

## Verification method (do this, not "look at it")

The extension cannot be auto-loaded here (see `AGENTS.md`), but the CSS can be verified in any
Chrome against the live dashboard:

1. Inject `theme/dark.css` and add `html.ngpp-dark` (no extension needed).
2. Scan every `#app *` element for a **light computed background** at rest.
3. Force `:hover` on the tabs and a request-list row via CDP `CSS.forcePseudoState` and re-scan —
   a resting scan **cannot** see hover styles.
4. Exercise **state-dependent UI** — at minimum clear the request list for the empty state.

Only `span.icon-bar` (the navbar hamburger) should ever remain light.
