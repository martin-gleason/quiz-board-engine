# Quiz Board Engine — Specification v1.0

**Status:** FROZEN — 2026-08-16. Per convention, this spec is immutable. All changes are documented in `docs/plans/`, never edited here.
**Working title:** Quiz Board Engine (rename freely; nothing in the contract depends on the name).

---

## 1. Purpose

A zero-cost, zero-build, static web app that turns plain JSON files into playable quiz board games — classic Jeopardy, trivia bingo, Family Feud-style ranked reveals — rendered through a Reveal.js front end. Anyone can clone the repo, enable GitHub Pages, and edit JSON in the browser to publish their own game.

**The shared primitive:** every game type is a pattern of cells with a value underneath (Jeopardy: point value over a question/answer; bingo: a mark; Feud: survey percentages). The renderer draws cells; a game-type config tells it which built-in behaviors apply.

## 2. Hard constraints

1. **Zero cost.** GitHub Pages hosting only. No servers, no paid services, no GitHub Actions.
2. **Zero build.** No compile step, no bundler, no SCSS. Vanilla ES modules loaded directly by `index.html`; JSON fetched at runtime.
3. **Zero CDN.** Reveal.js and all assets are vendored into the repo (`/vendor/`). The app makes no external network requests at runtime — offline-capable and supply-chain-safe.
4. **JSON only.** All data files (content, game types, themes manifest, state) are JSON — the only format the browser parses natively. Comments are `"_note"` fields, ignored and stripped by the validator.
5. **Cross-browser.** Consistent behavior in Chrome, Safari, and Firefox.

## 3. Repository layout

```
/index.html
/js/            loader.js, validator.js, renderer.js, state.js, errors.js
/vendor/        reveal.js dist files (pinned copy)
/games/         content files (demo.json, ...)
/gametypes/     jeopardy.json, bingo.json, feud.json
/themes/        default.css, midnight.css, themes.json (manifest)
/docs/specs/    frozen specs (this file)
/docs/plans/    build plans and change documentation
```

## 4. File contracts

### 4.1 Content file (`/games/*.json`)

```json
{
  "schemaVersion": 1,
  "title": "OCS Policy Review",
  "gameType": "jeopardy",
  "theme": "midnight",
  "animation": "flip",
  "board": {
    "columns": [
      {
        "label": "Case Law",
        "valueLadder": [100, 200, 300, 400],
        "cells": [
          {
            "prompt": "This 1967 case gave juveniles due process rights.",
            "answer": "What is In re Gault?",
            "value": 500,
            "flags": { "randomizable": true, "lockValue": false, "preMarked": false }
          }
        ]
      }
    ]
  }
}
```

| Field | Rules |
|---|---|
| `schemaVersion` | Integer. Renderer refuses versions it does not implement — no best-effort parsing. |
| `gameType` | Must match the `id` of a file in `/gametypes/`. |
| `theme`, `animation` | Names resolved against the themes manifest and the built-in animation set. Unknown name = validation error. |
| `valueLadder` | Optional per-column point ladder, applied to cells by position. |
| `cells[].value` | Optional per-cell override; wins over the ladder. |
| `flags.randomizable` | Cell is *eligible* for bonus selection. The app picks winners; content never pre-marks them. |
| `flags.lockValue` | Cell's value must never be altered by randomization or any future mechanic. |
| `flags.preMarked` | Cell starts in its terminal state (bingo free space). |

Grid size is emergent: the columns and cells you declare are the board. No fixed dimensions.

### 4.2 Game-type config (`/gametypes/*.json`) — declarative only

```json
{
  "schemaVersion": 1,
  "id": "jeopardy",
  "layout": "grid",
  "cellLifecycle": ["hidden", "revealed", "answered"],
  "scoring": { "model": "accumulate", "allowNegative": true },
  "winCondition": "highest-score",
  "bonus": { "count": 1, "multiplier": 2 },
  "gridConstraints": { "uniformRows": false },
  "requiredCellFields": ["prompt", "answer", "value"]
}
```

Every field is an enum, boolean, or number selecting behavior the renderer already implements. Configs **select** behaviors; they never define them.

| Field | Allowed values (v1) |
|---|---|
| `layout` | `"grid"`, `"ranked-list"` |
| `cellLifecycle` | Ordered subset of `["hidden", "revealed", "answered", "marked"]` |
| `scoring.model` | `"accumulate"`, `"none"` |
| `winCondition` | `"highest-score"`, `"pattern-complete"`, `"none"` |
| `patterns` | (when `pattern-complete`) subset of `["row", "column", "diagonal", "full-card"]` |
| `bonus.count` | Integer ≥ 0. Bonus economy lives here, not in content. |
| `gridConstraints.uniformRows` | Boolean. Bingo requires `true`; validation fails ragged bingo boards. |
| `requiredCellFields` | Drawn only from the validator-owned whitelist: `prompt`, `answer`, `value`. A config cannot demand fields outside it. |

**Shipped v1 configs:** `jeopardy` (grid, ladder economy, negative scoring allowed), `bingo` (uniform grid, mark lifecycle, pattern-complete), `feud` (ranked-list — see §10 scope note).

### 4.3 Themes manifest (`/themes/themes.json`)

```json
{ "schemaVersion": 1, "themes": { "default": "default.css", "midnight": "midnight.css" } }
```

Only CSS files listed in the manifest ever load. Themes are plain CSS overriding documented custom properties (`--board-bg`, `--cell-bg`, `--cell-text`, `--accent`, ...). The token list is documented in the README. **Adding a theme means trusting its author** — the README says so explicitly.

### 4.4 State (`localStorage` + export file)

```json
{
  "schemaVersion": 1,
  "gameHash": "sha-256-of-content-file",
  "gameTitle": "OCS Policy Review",
  "createdAt": "2026-08-16T20:00:00Z",
  "updatedAt": "2026-08-16T20:41:00Z",
  "teams": [ { "name": "Team A", "score": 400 } ],
  "cellStates": { "0:2": "answered" },
  "bonusCells": ["2:3"]
}
```

- **Teams are created in-app at session start** and live only in state. Content files are teams-agnostic — one file serves any group.
- Sessions keyed by content-file hash; a resume screen lists recent sessions by title and date with resume/discard. Retention is deliberately modest: keep the last 10 sessions, prune oldest silently. State longevity is a non-goal for v1.
- **Export/Import buttons** round-trip state as a downloadable JSON file. This is both the escape hatch (cleared cache, changed device) and the v2.0 seam — cloud sync later is the same state object over a different transport.
- Imported state is untrusted input: validated against the state schema like everything else.

## 5. Validation pipeline

Two stages, fail-safe. **No partial render, ever.**

1. **Structural.** Content, game-type, themes manifest, and any imported state are each checked against the embedded schema for their `schemaVersion`. A fetch failure (missing game-type file, 404) is a validation failure. Unknown keys — including `"_note"` — are stripped; the renderer only ever receives a cleaned object.
2. **Contract.** Content is cross-checked against its game-type: `requiredCellFields` present on every cell, `gridConstraints` satisfied, referenced theme and animation exist.

**Resource limits (validated, documented in README):** content file ≤ 1 MB; ≤ 12 columns; ≤ 12 cells per column; `prompt`/`answer` ≤ 2,000 chars; labels ≤ 80 chars.

Any failure routes to the error screen (§7). Success routes to render.

## 6. Security posture

1. **Configs are data.** No logic, no markup, no URLs. Enums select built-in behaviors.
2. **No `innerHTML`, anywhere.** All content reaches the DOM via `createElement`/`textContent`. Reveal handles slide mechanics only; its markdown plugin is never loaded. This rule is a named invariant in code review.
3. **`?game=` param is same-origin only.** Relative paths under `/games/`, must end `.json`, no absolute URLs, no `..`. Hostile links wearing your domain die at the loader.
4. **Themes load only via the manifest** (§4.3).
5. **Vendored dependencies only** — no CDN scripts (§2.3).
6. **Imported state is validated** like any other input (§4.4).

## 7. Error reporting — first-class feature

Ruling from spec review: JSON error messages are frequently useless to the person staring at the file. This app treats the error screen as part of the product.

Every error must state:

- **Which file** failed.
- **Where** — for syntax errors, line and column *plus a snippet of surrounding lines with a caret marking the position*; for schema errors, the JSON path (`board.columns[2].cells[1].value`).
- **What was expected vs. what was found.**
- **A plain-language hint** — e.g. "there is probably an extra comma just before this position" for the trailing-comma class of errors.

Requirements:

- `errors.js` is heavily commented — the *why* of each message class explained in code.
- The README carries a "Fixing JSON errors" section mirroring the hints, plus the note that GitHub Pages edits take a few minutes to propagate (with cache-busting on fetches to minimize it).
- **This feature has a mandatory test matrix (§9) and is not done until it passes extensively.**

## 8. Randomization

- At session start, the app selects `bonus.count` cells uniformly at random from cells flagged `randomizable: true` (and never `lockValue: true` for value-altering bonuses).
- Selections are stored in state: resuming keeps them; a new session reshuffles.
- Animations respect `prefers-reduced-motion`.

## 9. Testing requirements

- **Cross-browser:** automated walkthroughs via the Chrome MCP and Firefox MCP (load demo, play cells, score, refresh-resume, export/import). Safari verified manually (no MCP) — a human chore, tracked as such.
- **Error-screen matrix (mandatory, extensive):** trailing comma; missing bracket/quote; wrong type; missing required field; unknown `gameType`; missing game-type file (404); future `schemaVersion`; ragged grid under bingo; oversized file; over-limit strings; unknown theme/animation; malformed imported state. Each case must produce the correct file/location/hint output.
- **Security checks:** `?game=` rejection cases (absolute URL, `..`, non-`.json`); confirmation no code path uses `innerHTML`.

## 10. v1 scope

**Features (agent build track):**

- **F1** Loader + validator (all schemas, limits, cleaned-object output)
- **F2** Error screen + `errors.js` (§7)
- **F3** Grid renderer + Reveal integration (jeopardy plays end-to-end)
- **F4** Theming (manifest, tokens, 2 shipped themes)
- **F5** Animations (`flip`, `zoom`, `fade`)
- **F6** Session state, teams, scoring UI
- **F7** Bonus randomization
- **F8** Bingo game type
- **F9** Feud game type — *scoped:* ranked-answer reveal board with point values; strikes/steals are host-mediated, not modeled
- **F10** State export/import

**Chores (human track):** repo + Pages setup; Safari manual test pass; demo content authoring.

**Out of scope for v1 (the v2.0 seam):**

- Cloud state sync (Google Drive, Dropbox as default targets)
- A score panel that could carry fuller Feud rules (strikes, steals)
- User-defined animations/behaviors beyond the shipped set
- Multi-device or multiplayer state

## 11. Spec authority

Per house convention: this spec is the contract. The build agent may *propose* deltas during planning; the maintainer ratifies before they are real. Proposed changes and all implementation detail live in `docs/plans/`.

-----
2026-08-16
#AI/Claude
