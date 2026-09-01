# PR review log

One entry per merged PR. Committed directly to `main` right after the merge, so the
log never waits on the next branch.

---

## PR #1 — F11, F12: startup game and theme pickers

Merged 2026-09-01 by rebase, 15 commits. Branch `F11/startup-pickers`, kept after merge.

The feature half is `F11`/`F12`: a startup picker that reads `games/games.json` to learn
which boards exist (a static site has no directory listing, so an unlisted board cannot be
reached), plus a theme override persisted as `qbe.theme`. Every picker choice still goes
through `loader.resolveGameParam`, so the same-origin rule binds a click exactly as it binds
a `?game=` value.

The larger half is process, not product: the baseline conventions were vendored and pinned by
content hash, the register was reconstructed from the project's own documents, and the status
page stopped reading git. Those are `C1` commits and they are why this PR is 15 commits rather
than three.

**Verification.** Suite run in Chrome at `http://localhost:8000/tests/` on 2026-09-01:
**369 of 370 assertions pass**, including all 16 feud/ranked-list assertions.

The single failure is environmental, not a regression:

```
shell :: games/demo.json: default.css is loaded as the base layer under themes/midnight.css
       :: stylesheets: reset.css, reveal.css, default.css, (inline), marquee.css
```

`qbe.theme = marquee` was left in this browser profile's `localStorage` by the F12 override.
The suite's `withEmptyShelf` clears `qbe.session.*` and nothing else, so the boot under test
picks up a real host's saved theme and the assertion looking for `midnight.css` fails. The
same suite reported 370/370 at `59e2651` on a clean profile. **The defect is in the suite's
isolation, not in the app** — a test that passes or fails according to who last used the
browser is not evidence either way. Filed as `RR4`.

**What the run also surfaced**, outside the diff and not fixed here: a revealed `ranked-list`
row shows only its point value on the board face, never its answer text — `faceValue`
returns the bare value and `.qbe-cell-text` is emitted only for valueless cells. The overlay
shows the answer and then closes, leaving the board six blanks and a number. Filed as `RR5`;
the fix edits theme-contract §2 and so wants a delta.

**Process note.** CLAUDE.md prescribes the subject `docs(quiz-board-engine): add PR #N
review-log entry` for this file. That fails `H3` — the baseline requires a structural ID in
the scope, always — so this entry is committed under a chore ID instead. The CLAUDE.md line
needs correcting by the maintainer.
