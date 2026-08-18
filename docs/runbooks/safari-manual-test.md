# Runbook — Safari manual test pass

**Chore C11. Human-executed. There is no Safari MCP, so this pass cannot be automated.**

Spec §9 requires consistent behavior in Chrome, Safari, and Firefox, and names the Safari
verification as a tracked human chore. Chrome and Firefox are automated (see `tests/README.md`);
Safari is this document.

Run this before any release, and after any change to `errors.js`, `loader.js`, `validator.js`, or
the vendored reveal.js version.

## Setup

```sh
cd /path/to/quiz-board-engine
python3 -m http.server 8000
```

Open Safari. **Do not open the files directly** — `file://` blocks ES modules and `fetch`, and
you will see a broken page that is not a real failure (plan Q10).

### Empty the cache first. Every time. This is not optional.

**Safari → Develop → Empty Caches** (⌥⌘E), *before* you load anything.

Skipping this produces a **false bug report**, and it has already produced one — F11's picker was
reported as "does not work in Safari" when Safari was running the previous build's `js/app.js`
against the current build's JSON.

The mechanism, so you can recognise it again:

- `python3 -m http.server` sends **no `Cache-Control` and no `ETag`** — only `Last-Modified`. With
  no explicit freshness the browser invents one (heuristic caching), and Safari's guess is far
  stickier than Chrome's.
- Our JSON is cache-busted at the fetch (`?v=<timestamp>`, plan Q14) but **`js/*.js` is not**: the
  shell imports `./js/app.js` by a constant path, and adding a query to an ES-module import is a
  build step, which the zero-build constraint forbids.
- So the mismatch is *asymmetric and silent*: fresh data, stale code. The board loads, nothing
  errors, and a feature added since the last visit is simply absent.

**Note the two menu items are different.** Settings → Privacy → *Manage Website Data* removes
`localStorage` (which Part 3 needs) and does **not** touch the HTTP cache. Develop → *Empty Caches*
is the one that reloads your code. Part 3 needs both, at different moments.

⌘R is not enough, and ⌥⌘R (hard reload) is not reliably enough for module subresources.

**This is a local-server artifact, not a production one.** GitHub Pages sends `ETag` and
`Cache-Control: max-age=600`, so a returning host revalidates. Do not "fix" it with a cache-busting
hack in the shell — the fix would be a build step, and the constraint that forbids it is load-bearing.

**Confirming a stale cache without any devtools:** watch the server's own log. A correct cold load
requests `js/app.js` and then `games/games.json`. A stale one requests neither and goes straight to
`games/demo.json`.

Enable the Web Inspector once, so you can check the console:
Safari → Settings → Advanced → "Show features for web developers".

Record the Safari version you tested: ______________  Date: ______________

---

## Part 1 — Test matrix

Open **http://localhost:8000/tests/**

- [ ] The summary banner reads **PASS** with the same total as Chrome and Firefox (370/370 as of
      2026-08-18, after F11/F12). **Keep this number current** — a stale baseline turns the
      check below into a rubber stamp. **Any difference in the count is a cross-browser defect**, even if both
      "pass" — the suites must be identical, per spec §2.5.
- [ ] The tab title reads `PASS n/n — Quiz Board Engine tests`.
- [ ] Web Inspector → Console shows **no errors or warnings other than the one expected line
      below**.

      The suite drives the *real* app through its *real* failure path, and `app.js` deliberately
      mirrors every validation failure to the console (`failScreen` in `js/app.js`) so a helper on the laptop
      can read what the projector is showing. A clean run therefore prints **exactly one** error,
      in every browser:

      ```
      import:malformed-state.json — teams[0].score: expected a whole number, found the text "400" [wrong-type]
      ```

      That line is a **pass signal**, not a defect: it is the negative-path import test in
      `tests/runner.js` proving a hand-corrupted export lands on the error screen instead of
      half-restoring onto a live board. Verified identical in Chrome and Firefox on 2026-08-18 —
      one message per run, same text, same source. Its *absence* would be the defect. Any
      **other** console output fails this check.
- [ ] Scroll to any failing-fixture error screen. The caret line (`^`) is **exactly** under the
      character it refers to. Safari's default monospace metrics differ from Chrome's, so this is
      the single most likely place for a Safari-only visual defect.
- [ ] Long-line snippets scroll horizontally inside their own box; the **page body does not
      scroll sideways**.

If the count differs, note which assertion names differ:

```
_________________________________________________________________
```

---

## Part 2 — Error screen legibility

Still on the test page, read three error screens as if you had never seen JSON.

- [ ] `trailing-comma.json` — the hint names the extra comma and tells you to delete it.
- [ ] `unknown-theme.json` — the message names the theme you asked for and where themes are
      declared.
- [ ] `missing-gametype-file.json` — the message distinguishes "this file is missing" from
      "this file is malformed", and mentions the HTTP-origin requirement.
- [ ] Text contrast is comfortable at arm's length. Try both Light and Dark appearance
      (System Settings → Appearance) — the page is theme-aware and both must be legible.

---

## Part 3 — Gameplay walkthrough

**Applicable since F3/F6 shipped (2026-08-17); rewritten for the startup picker 2026-08-18.**
This section mirrors the Chrome/Firefox walkthrough exactly, and together with Part 1 it is what
demonstrates **Gate 4b** — a host who has never seen a URL parameter can open the site, choose a
board, choose a theme, and play.

**Opening `/` no longer draws a board.** Since F11 it draws the picker. If you see a jeopardy grid
straight away, you are on a cached build — go back and empty the cache.

### The picker (F11/F12 — never yet seen in Safari)

- [ ] Open http://localhost:8000/ — the **startup screen** appears, listing three boards by name:
      General Knowledge, Trivia Bingo, Ranked Answers.
- [ ] Arrow keys move between the three radio buttons, and the focused one is visibly focused.
      There is **no** focus ring drawn around the "Choose a board" heading itself.
- [ ] Choose **Trivia Bingo**, leave the look as "Use this game's theme", press Start. A 5×5 bingo
      card renders with FREE SPACE already marked.
- [ ] Go back to http://localhost:8000/ and choose **General Knowledge** with the look set to
      **chalkboard**. The board comes up wearing chalkboard, *not* the midnight theme the file asks
      for.
- [ ] Reload. The picker preselects **chalkboard** — the choice is remembered per device.
- [ ] Open `http://localhost:8000/?game=games/demo.json` directly. It boots **straight to the
      board, past the picker**, and it is still wearing chalkboard (the device preference applies
      to a deep link too).

### Gameplay

- [ ] Create two teams at session start.
- [ ] Play three cells: hidden → revealed → answered, walking the overlay with its own button
      ("Reveal the answer", then "Mark it answered"). The animation runs. Closing with the **X**
      instead leaves the cell unplayed — that is correct, not a bug.
- [ ] Award points to one team, deduct from the other. Scores update, and the ± buttons carry the
      **amount** for the cell in play.
- [ ] Open the cell outlined in the accent colour with a corner wedge — the bonus cell. Its ±
      buttons read **double** its face value. (The bonus is deliberately visible before it is
      played: it should invite, not spoil.)
- [ ] Reload the page. The resume screen offers the session; resuming restores cell states,
      scores, and bonus cells.
- [ ] Export state. A `.json` file downloads.
- [ ] Clear website data (Safari → Settings → Privacy → Manage Website Data → remove localhost),
      reload, import the file. Board and scores are identical to before. **Note this also clears
      the theme preference**, so the picker goes back to "Use this game's theme" — expected.

### Accessibility and the deep-link guard

- [ ] System Settings → Accessibility → Display → **Reduce motion** on. Reload. Cells change
      state with **no animation** — removed, not merely faster.
- [ ] Tab through the board. Focus is visible on each cell and follows reading order.
- [ ] On **Ranked Answers**, turn VoiceOver on (⌘F5) and move through the six rows. Each row must
      announce a **different** name — "answer 1 of 6", "answer 2 of 6", and so on. Six identical
      announcements is a defect; it was one, and it is what this check exists to catch.
- [ ] `?game=` rejection spot-check: open
      `http://localhost:8000/?game=https://example.com/x.json` and confirm the error screen
      appears and **no external request is made** (Web Inspector → Network shows none).

---

## Result

- [ ] **PASS** — everything above checked, no Safari-only defects.
- [ ] **FAIL** — file findings below, then open an issue per finding.

```
Findings:
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
```

Tested by: ______________
