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

Enable the Web Inspector once, so you can check the console:
Safari → Settings → Advanced → "Show features for web developers".

Record the Safari version you tested: ______________  Date: ______________

---

## Part 1 — Test matrix

Open **http://localhost:8000/tests/**

- [ ] The summary banner reads **PASS** with the same total as Chrome and Firefox (87/87 as of
      2026-08-17). **Any difference in the count is a cross-browser defect**, even if both
      "pass" — the suites must be identical, per spec §2.5.
- [ ] The tab title reads `PASS n/n — Quiz Board Engine tests`.
- [ ] Web Inspector → Console shows **no errors or warnings**.
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

**Not yet applicable — the renderer lands in F3.** Once it does, this section mirrors the
Chrome/Firefox MCP script exactly:

- [ ] Open http://localhost:8000/ — the demo jeopardy board renders, 5 columns × 5 cells.
- [ ] Create two teams at session start.
- [ ] Play three cells: hidden → revealed → answered. The animation runs.
- [ ] Award points to one team, deduct from the other. Scores update.
- [ ] Reload the page. The resume screen offers the session; resuming restores cell states,
      scores, and bonus cells.
- [ ] Export state. A `.json` file downloads.
- [ ] Clear website data (Safari → Settings → Privacy → Manage Website Data → remove localhost),
      reload, import the file. Board and scores are identical to before.
- [ ] System Settings → Accessibility → Display → **Reduce motion** on. Reload. Cells change
      state with **no animation**.
- [ ] Tab through the board. Focus is visible on each cell and follows reading order.
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
