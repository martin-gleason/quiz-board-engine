<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Quiz Board Engine

A projector-ready quiz board — Jeopardy-style grids, bingo cards, and survey-style
boards — that runs as a static site. Point it at a JSON file and it draws a board you can
play in front of a room.

There is no server, no build step, no account, and no network request at runtime. You can
run it from a folder on your laptop or publish it on GitHub Pages for free.

---

## Quick start

The app must be served over HTTP. Opening `index.html` by double-clicking it will **not**
work — browsers block ES modules and `fetch` on `file://` URLs, and there is no way around
that from inside the page.

```sh
cd quiz-board-engine
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. You will get a startup screen: pick a board, pick a
look, press Start.

To publish, push the repo to GitHub and turn on Pages (deploy from `main`, root). No
Actions, no workflow file, nothing to configure.

---

## Choosing a board

Three demo boards ship with the repo — a Jeopardy-style grid, a trivia bingo card, and a
survey board. The startup screen lists whatever is registered in `games/games.json`.

You can also link straight to a board and skip the picker:

```
http://localhost:8000/?game=games/demo-bingo.json
```

That is the form to bookmark, or to mail to whoever is running the room next week.

### What `?game=` accepts

The parameter names a file **in this repo**, and nothing else. It must:

- be a relative path under `games/` — `games/history.json`, or just `history.json`
- end in `.json` (exactly; `.JSON` and `x.json.txt` are refused)

Everything else is refused with an explanation: absolute URLs, protocol-relative `//host`
paths, anything with a `:` in it (`javascript:`, `data:`, `file:`), leading `/`, `..` or
`.` path segments, backslashes, `?` or `#`, percent-escapes that survive one decode, and
control characters.

This is not configurable, and deliberately so. A quiz board is a thing people paste links
to. `?game=` can never be talked into loading a file from somewhere else, so a link
wearing your domain cannot make your board show someone else's content.

An **absent** `?game=` opens the picker. An **empty** one (`?game=`) is an error rather
than a silent fallback — it means somebody tried to name a file and the name got lost, and
quietly loading the demo instead would hide the broken link behind a working board.

---

## Adding your own board

Drop a `.json` file in `games/` and add one line to `games/games.json`:

```json
{
  "schemaVersion": 1,
  "games": {
    "Tudor History": "tudors.json",
    "Trivia Bingo": "demo-bingo.json"
  }
}
```

Keys are what the picker shows, so write them for a human. Values are **bare filenames**
resolved under `games/` — never paths, never URLs.

A content file looks like this:

```json
{
  "schemaVersion": 1,
  "title": "Tudor History",
  "gameType": "jeopardy",
  "theme": "midnight",
  "animation": "flip",
  "board": {
    "columns": [
      {
        "label": "Henry VIII",
        "valueLadder": [100, 200, 300, 400, 500],
        "cells": [
          { "prompt": "He was the first of Henry's six wives.", "answer": "Who is Catherine of Aragon?" }
        ]
      }
    ]
  }
}
```

`gameType` selects a file from `gametypes/` — `jeopardy`, `bingo`, or `feud` — which
decides the scoring model, the win condition, whether rows must be uniform, and which
fields each cell must carry:

| Game type | Each cell needs | Notes |
|---|---|---|
| `jeopardy` | `prompt`, `answer`, and a point value | Columns may be different lengths. One cell is secretly worth double. |
| `bingo` | `prompt` | No point values at all — the win is a completed pattern, not a total. Rows **must** be uniform; a ragged bingo card is a validation failure. |
| `feud` | `answer`, and a point value | The column label is the survey question; each cell is one ranked answer. Strikes and steals are the host's job, not the app's. |

"A point value" means either an entry in the column's `valueLadder` at that cell's
position, or a `"value"` on the cell itself — you do not write both unless you want the
cell to differ from its ladder. A bingo card having no `valueLadder` anywhere is correct,
not an omission.

One gotcha worth knowing before it bites you: a column that *has* a `valueLadder` but has
more cells than ladder entries is a validation failure, not a zero. A board that looks
complete and scores wrong is exactly what the error screen exists to prevent.

`animation` is one of `flip`, `zoom`, or `fade`. Anything else fails validation — these
select behaviour the app already implements rather than describing it, which is why the
list is closed.

**Comments.** JSON has none, so any object may carry a `"_note"` field at any depth. The
validator strips them before the board is drawn, so write as much as you like — the demo
files use them heavily.

### Limits

Checked at load, with a message naming the file and the exact path when one is exceeded.

| Limit | Value |
|---|---|
| Content file size | 1 MB |
| Columns | 12 |
| Cells per column | 12 |
| `prompt` length | 2,000 characters |
| `answer` length | 2,000 characters |
| Labels — column labels, game title, team names | 80 characters |
| Teams | 12 |
| Saved sessions kept | 10 (oldest pruned silently) |

---

## Fixing JSON errors

Hand-edited JSON breaks, and browsers are famously unhelpful about where. This app does
not use the browser's message. It re-reads the file itself and reports the line, the
column, the surrounding text, and a caret under the character you need to look at — the
same report in Chrome, Safari, and Firefox.

**Nothing is ever drawn from a file that failed to load.** There is no partial board and
no placeholder text: you get the error screen or you get a complete board, so you never
have to wonder whether what is on the projector is all of it.

The faults it names, and what each one actually means:

| What you see | What it means |
|---|---|
| **Extra comma** | `{"a": 1,}` — JSON forbids a comma after the last item. Most languages allow it. The caret goes on the **comma**, not on the brace the browser would blame. |
| **Unclosed `{` or `[`** | Usually a deleted block that took its closing brace with it. The caret goes on the opener that never closed — or, when it is the outermost one, at the end of the file where the closer has to be typed. |
| **Missing closing quote** | A string that swallowed the rest of the line. The caret goes on the **opening** quote, because that is the one to look at. |
| **Single quotes** | `'text'` is JavaScript and Python. JSON has only `"text"`. |
| **Unquoted property name** | `{title: "x"}` is JavaScript. JSON needs `{"title": "x"}`. |
| **Missing comma / missing colon** | Two fields with nothing between them (usually a pasted line), or a colon deleted or mistyped. |
| **Content after the end** | A duplicated paste or a stray `}`. The document ended earlier than you think it did. |
| **Empty file** | Saved with nothing in it. |
| **Byte-order mark** | An invisible `U+FEFF` that Notepad and some editors prepend. Your file looks flawless and will not parse. This is why the check exists. |
| **Bad escape** | `"C:\path"` — a lone backslash. JSON needs `"C:\\path"`. |
| **Control character** | A literal tab or newline typed inside a string. |
| **Invalid number** | `01`, `1.`, `+1`, `.5`, `1e`. |
| **Other languages' words** | `True`, `NULL`, `None`, `NaN`, `undefined`. JSON has `true`, `false`, `null`. |

Once the file parses, a second pass checks it against the rules above — required fields,
limits, uniform rows where the game type demands them — and reports those the same way,
naming the path (`board.columns[2].cells[4].prompt`) rather than a character offset.

### Edits on GitHub Pages take a few minutes

Pages caches at its edge, so a fresh push can take a couple of minutes to appear. The app
cache-busts every JSON fetch to keep that window as short as possible, but it cannot do
anything about the CDN itself. If you just pushed and the board looks unchanged, wait and
reload before you go looking for a bug.

Running locally with `python3 -m http.server`, the opposite trap applies: that server
sends no cache headers at all, so browsers invent their own freshness and can serve you
stale **code** while fetching fresh **data**. Safari is the stickiest about it. If a
change you just made is simply absent, empty the browser cache before believing it.

---

## Themes

A theme is a plain CSS file in `themes/` that overrides documented custom properties.
Five ship with the repo: `default`, `midnight`, `civic`, `chalkboard`, and `marquee`.

A board picks its own with `"theme": "midnight"`, and whoever is running the room can
override that from the startup screen — the same board looks different on a washed-out
projector in daylight than on a good panel at night. That choice is remembered on the
device it was made on. It is deliberately **not** part of a saved session, so changing it
can never affect a game in progress, and it does not travel with an exported session.

The most-used tokens:

| Token | What it colours |
|---|---|
| `--board-bg` | the board surface |
| `--cell-bg` / `--cell-text` | an unopened cell |
| `--cell-revealed-bg` / `--cell-revealed-text` | a cell that is open |
| `--cell-answered-bg` / `--cell-answered-text` | a cell that has been played |
| `--value-color` | the point value on a cell |
| `--column-label-bg` / `--column-label-text` | the header row |
| `--detail-bg` / `--detail-text` | the prompt overlay |
| `--score-bg` / `--score-text` | the score bar |
| `--accent` / `--accent-contrast` | focus rings, the revealed-cell ring, buttons |
| `--font-body` / `--font-display` | typography |
| `--anim-duration` / `--anim-easing` | motion |

The complete list, the DOM structure a theme may rely on, and the rules a theme must
respect live in **[`docs/plans/theme-contract.md`](docs/plans/theme-contract.md)** — read
that before writing one. Two things it will tell you that are worth knowing up front: a
token the base layer does not define is inert, and every animation must honour
`prefers-reduced-motion`.

### Adding a theme means trusting its author

Only CSS files listed in `themes/themes.json` are ever loaded, so a theme cannot appear by
being dropped in the folder. But **CSS is not a safe format for untrusted content.** A
stylesheet you add to that manifest can restyle any part of the app, hide or fake
interface elements, and read the shape of the page. Treat a donated theme the way you
would treat any other code you are about to run: read it, or trust whoever wrote it.

The test suite checks every registered theme for the mechanical failures — it must fetch,
carry its licence header, make no external request, invent no token, and target no class
the renderer does not emit. That is a check for mistakes, not for intent.

---

## Accessibility

Every cell is a real `<button>`, so keyboard navigation, focus, and screen-reader
semantics come from the platform rather than from bespoke ARIA. Themes are contrast-checked
against WCAG 2.1 AA, and the board is sized to stay legible from the back of a room.
`prefers-reduced-motion` is honoured by every animation.

---

## Running the tests

Serve the repo and open <http://localhost:8000/tests/>. The page reports one row per
assertion and renders the real error screen under every failing fixture, so you can read
what a person would actually see. See [`tests/README.md`](tests/README.md) for what each
suite covers and how to add a fixture.

Firefox can be driven headlessly:

```sh
python3 tools/firefox-run-tests.py http://localhost:8000/tests/
```

Safari has no automation here; it is a manual pass, scripted in
[`docs/runbooks/safari-manual-test.md`](docs/runbooks/safari-manual-test.md).

---

## How it is built, and why that matters to you

Five constraints shape everything above, and they are worth stating because they are what
you are getting:

1. **Zero cost.** GitHub Pages and nothing else.
2. **Zero build.** Vanilla ES modules loaded straight by `index.html`. What is in the repo
   is what runs — no compile step, no `node_modules`, nothing to reinstall in two years.
3. **Zero CDN.** Every asset is vendored under `vendor/`. The app makes **no external
   network request at runtime**, which is also why it works on a classroom machine with no
   internet.
4. **JSON only.** All data is JSON. Comments are `"_note"` fields.
5. **Cross-browser.** Chrome, Safari, and Firefox behave identically. Nothing branches on
   user-agent.

Presentation is [reveal.js](https://revealjs.com/) 5.2.1, vendored and pinned. Its
markdown plugin is not present in the repo and is never loaded.

---

## Licence

AGPL-3.0-or-later. See [`LICENSE`](LICENSE). Vendored dependencies keep their own licences,
recorded with version, source, and SHA-256 in [`vendor/README.md`](vendor/README.md).
