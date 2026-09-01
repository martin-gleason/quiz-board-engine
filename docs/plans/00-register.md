# Register — reveal-game-show

**Reconstructed from this project's own documents, not authored.** Every row
names the file and line it came from. A row nobody can trace back is a claim,
and a claim written down reads exactly like a recorded fact.

A `Status` of `unknown` means the source said nothing about status. It is a
question for the owner, not a guess.

---

## Decisions (D)

ADR-style: numbered, dated, **immutable once ratified**. A decision is never edited —
it is superseded by a later entry that links back. A rejected decision stays, struck
through, so it is not re-proposed.

**One intake path.** Anything that changes scope enters as a `D<n>`. An item with no
number has not been decided, however clearly it was said aloud.

| ID | Status | Milestone | Decision | Source |
|---|---|---|---|---|
| D1 | ratified | — | Add /tests/ (runner + fixtures) to the §3 repo layout | `docs/plans/v1.0-build-plan.md:146` |
| D2 | ratified | — | Add /docs/runbooks/ | `docs/plans/v1.0-build-plan.md:147` |
| D3 | ratified | — | /vendor/ gains a per-dependency subdirectory (/vendor/reveal.js/) plus a provenance README.md | `docs/plans/v1.0-build-plan.md:148` |
| D4 | ratified | — | Pin reveal.js to 5.2.1, ESM build, four dist/ files only | `docs/plans/v1.0-build-plan.md:149` |
| D5 | ratified | — | Add js/schemas.js to the §3 file list | `docs/plans/v1.0-build-plan.md:150` |
| D6 | ratified | — | State gains "appVersion" alongside schemaVersion | `docs/plans/v1.0-build-plan.md:151` |
| D7 | ratified | — | Document that the app requires an HTTP origin, not file:// | `docs/plans/v1.0-build-plan.md:152` |
| D8 | ratified | — | Add js/app.js (composition root) to the §3 file list | `docs/plans/v1.0-build-plan.md:154` |
| D9 | ratified | — | Add tools/firefox-run-tests.py | `docs/plans/v1.0-build-plan.md:159` |
| D10 | ratified | — | Add docs/plans/theme-contract.md (normative DOM + token contract) and docs/handoffs/ for external collaboration | `docs/plans/v1.0-build-plan.md:155` |
| D11 | ratified | — | Theming is a shared work surface: the maintainer authors CSS/vanilla JS directly, and an external collaborator (Claude Design) contributes t | `docs/plans/v1.0-build-plan.md:156` |
| D12 | ratified | — | Add /games/games.json (game manifest) and a startup game picker; extend §10's v1 feature list with F11 | `docs/plans/v1.0-build-plan.md:157` |
| D13 | ratified | — | A startup theme picker whose choice may override the content file's theme, stored as a device preference outside session state; extend §10's | `docs/plans/v1.0-build-plan.md:158` |
| D14 | ratified | — | **A cell never prints its QUESTION on the face; it may print its ANSWER.** Narrows theme-contract §2's rule that `.qbe-cell-text` and `.qbe-cell-value` are mutually exclusive. A **revealed** `ranked-list` row prints its `answer` AND its points — the one cell carrying both children; a hidden row prints neither. Rejected alternative: a new `.qbe-cell-answer` element, which adds a class no shipped theme styles, where `.qbe-cell-text` is already styled in `default.css` and the ranked-row layout was already `flex-direction: row; justify-content: space-between` — a two-child layout waiting for a second child. Closes `RR5`. **Ratified 2026-09-01 by the maintainer**, on the evidence of the board: a Family Feud round in which the revealed answers do not stay on the screen is not the game. | `docs/plans/theme-contract.md` §2 |
| D15 | ratified | — | **Strikes are modelled in the engine; the steal stays host-mediated.** Spec §10 `F9` scopes feud to a reveal board and says strikes/steals are host-mediated and not modelled, so this contradicts the frozen spec and needs ratification. Scope, settled with the maintainer: the engine owns the strike count and its display, **per column** so a round resets clean; the host still owns who is stealing, whether the steal succeeded, and awarding the pot on the existing `+`/`−` buttons. Rejected: a full steal flow with a round pot, a controlling team and automatic awarding — a wrong state transition mid-show is visible to the room and hard to undo, and the show is in a week. **Ratified 2026-09-01 by the maintainer**, who also fixed `X` as the strike key — widening plan Q12's deliberately small keyboard budget, which is part of this decision rather than an implementation detail. Plan: `docs/plans/F9c.md`. | `docs/plans/F9c.md` |
| D16 | ratified | — | **theme-contract §2 gains `.qbe-strikes` and `.qbe-team-strikes`, §4 their tokens.** Follows from `D15`: strikes need a surface. Two elements rather than one because the maintainer chose both placements — a large centre overlay for the room and per-team marks in the score bar for the host. Absent, never empty, when the game type declares no `strikes` block, matching how `scoring.model: "none"` suppresses the score bar entirely. **Ratified 2026-09-01 by the maintainer.** | `docs/plans/F9c.md` |
| D17 | ratified | — | **A ranked board shows ONE round at a time.** Ratified 2026-09-01 by the maintainer, folded into `F9c` rather than deferred. Today every column renders stacked and every round's question is on screen at once, which spoils the questions and does not resemble the game. The obvious workaround — one file per round — is **disqualifying, not merely clunky**: sessions key on `gameHash` (`js/state.js:90`), so a second file is a second session and team names and scores reset between rounds. So multi-round with a running score requires one file with several columns, which forces this decision. It is also a **prerequisite for `D15`**: strikes are per column, and with every round on screen there is no answer to which round's strikes the centre overlay shows — the board has no notion of a current round today. Scope: draw the active column, persist `currentRound` so a mid-show reload returns to the right round, and a key to advance. Expected to be a `data-` attribute on `.qbe-column` (§3) rather than a new element, so a smaller contract change than `D16`. | `docs/plans/F9c.md` |

## Risks (RR)

| RR1 | [ci-absent] **Ratified 2026-08-31.** The owner: *"that is a huge error."* No CI. Every check in this project runs only where somebody remembers to run it. | ratified | — | — | Evidence: `ls .github/workflows` → (no workflows) | agent |
| RR2 | [generated-orphan] **Ratified 2026-08-31.** A generated file with nothing regenerating it. It will go stale and be believed, because it does not look stale. | ratified | — | — | Evidence: `grep -l GENERATED docs/**/*.md; ls .github/workflows .githooks` → docs/plans/00-status.md | agent |
| RR3 | [tests-collect-zero] **Ratified 2026-08-31.** Tests exist and the runner collects none of them. A suite that reports green having run nothing is worse than no suite. | ratified | — | — | Evidence: `python3 -m pytest --collect-only -q` → no tests collected in 0.01s | agent |
| RR4 | [test-isolation-theme] The shell suite boots the real app and inherits the browser's real `localStorage`. `withEmptyShelf` clears `qbe.session.*` and nothing else, so the F12 theme override `qbe.theme` survives into the boot under test: with `qbe.theme = marquee` set, the assertion that `themes/midnight.css` loads under `default.css` fails. A test whose result depends on who last used the browser is not evidence in either direction. | ratified | — | — | Extend the shelf helper to save/restore `qbe.theme` alongside the session keys | agent | Evidence: 369/370 in a profile with `qbe.theme = marquee`; 370/370 at `59e2651` on a clean profile |
| RR5 | [feud-face-no-answer] A revealed `ranked-list` row shows only its point value on the board face, never its answer text. `faceValue` (`js/renderer.js:265`) returns `String(cell.value)`, and `.qbe-cell-text` (`js/renderer.js:357`) is emitted only for a cell with no `value` — the bingo shape. A feud cell has `value` and `answer` and no `prompt`, so its answer has no path to the face. The overlay shows it once and closes, leaving the board six blanks and a number, while the accessible name already says "answer shown". | ratified | — | — | Fixed on `F9b/ranked-row-answer`: `faceText()` in `js/renderer.js`, one rule in `themes/default.css`, six assertions and four mutations (`M1`–`M3`, `M5`, `M6`). The theme-contract §2 amendment it depends on is `D14`, ratified 2026-09-01. | agent | Evidence: board face `"38"`, aria `"…answer 1 of 6, 38 points, answer shown"` |
| RR6 | [firefox-runner-contention] `tools/firefox-run-tests.py` deletes and recreates a fixed profile path and binds a fixed Marionette port, so a still-running headless Firefox from an earlier run makes the next one report FALSE geometry failures rather than a harness error — observed as `.qbe-board` resolving 3 grid tracks instead of 5 and a cell measuring 0x0. It reads exactly like a real cross-browser layout regression. Same tree, same commit, after `pkill`: 377/377. | ratified | — | — | Use a unique profile dir and an ephemeral port per run, or refuse to start when the port is already bound | agent | Evidence: 375/377 with a stray instance; 377/377 on the same tree once cleared |

| ID | Risk | Status | Likelihood | Impact | Mitigation | Owner | Source |
|---|---|---|---|---|---|---|---|

*(none found in this project's documents)*

## Owner items (O)

Outstanding items only the owner can close.

| ID | Item | P | Status | Source |
|---|---|---|---|---|

*(none found in this project's documents)*

## Chores (C)

`conventions.md`: *a chore gets a file only when it has tasks and a verification
step; a one-line chore lives in the register.* This is that register. A chore with
its own plan file is listed here too, with a link, so one read gives all of them —
the absence of that read is how a chore killed by a ratified delta stayed open for
days on the owner's track.

| ID | Chore | P | Status | Owner | Plan | Source | TD |
|---|---|---|---|---|---|---|---|
| C1 | git init, main branch, identity configured | — | done | — | — | `docs/plans/v1.0-build-plan.md:256` |
| C2 | Directory scaffold per §3 + D1/D2 | — | done | — | — | `docs/plans/v1.0-build-plan.md:257` |
| C3 | AGPL-3.0 LICENSE at repo root | — | done | — | — | `docs/plans/v1.0-build-plan.md:258` |
| C4 | Vendor reveal.js 5.2.1 with provenance + hashes (vendor/README.md) | — | done | — | — | `docs/plans/v1.0-build-plan.md:259` |
| C5 | .gitignore | — | done | — | — | `docs/plans/v1.0-build-plan.md:260` |
| C6 | CLAUDE.md — project rules, the named invariants, work vocabulary | — | done — CLAUDE.md exists | — | — | `docs/plans/v1.0-build-plan.md:261` |
| C7 | Create public GitHub repo quiz-board-engine, push main | — | done — repo is public and pushed | — | — | `docs/plans/v1.0-build-plan.md:262` |
| C8 | Enable GitHub Pages (deploy from main, root) | — | done — GitHub Pages status: built | — | — | `docs/plans/v1.0-build-plan.md:263` |
| C9 | README — tokens, limits, ?game=, "Fixing JSON errors", local-server note, theme-trust warning | — | done | — | — | `docs/plans/v1.0-build-plan.md:264` |
| C10 | Safari manual test runbook | — | done | — | — | `docs/plans/v1.0-build-plan.md:265` |
| C11 | Safari manual test pass — human, maintainer-executed | — | open | — | — | `docs/plans/v1.0-build-plan.md:266` | td:6hPqwQfrR8QJW5fw |
| C12 | Demo content authoring (games/demo.json + one per game type) | — | done — 4 game json files present | — | — | `docs/plans/v1.0-build-plan.md:267` |
| C13 | docs/runbooks/learning-track.md — the ongoing 10% study plan | — | done | — | — | `docs/plans/v1.0-build-plan.md:268` |
| C14 | docs/runbooks/v1.0-maintainer-pass.md — the maintainer's four-hour list to v1.0 | — | done | — | — | `docs/plans/v1.0-build-plan.md:269` |
| C15 | Add CI — build, the Safari gate, and whatever the suite becomes | P0 | open | Marty | — | closes `RR1` |
| C16 | Regenerate `docs/plans/00-status.md` from this repo, or stop generating it here | P1 | open | Marty | — | closes `RR2` |
| C17 | Make the test suite collect — it currently reports green having run nothing | P0 | open | Marty | — | closes `RR3` |
| C18 | Track the v2.0 draft spec in git — `docs/specs/quiz-board-engine-spec-v2-draft-r2.md`. Draft, not frozen: v1 remains the contract until the §8 red-team gate resolves. | P2 | done | agent | — | — |
| C19 | `docs/pr-review-log.md` — one entry per merged PR, committed to `main` after the merge. Opened with the PR #1 entry. | P2 | done | agent | — | — |

## Gates (G)

A gate is an **event**, not a place — but the event has to be recorded somewhere or it
exists only in the conversation where it happened. It is not inferable from the
filesystem: the first attempt flagged six features as awaiting a gate and all six were
already built.

| ID | Gate | Status | Plan written | Crossed | What the owner said | Source |
|---|---|---|---|---|---|---|

*(none found in this project's documents)*

## Hooks (H)

Deterministic enforcement. Prose is advisory; hooks are not. An `H<n>` is a plan-local
label and **never appears in a commit, branch, or PR title**.

| ID | Hook | Surface | Protects | Status | Source |
|---|---|---|---|---|---|

*(none found in this project's documents)*

## Mutations (M)

Named ways to break the code, each paired with the test that must catch it.
A test is not evidence until a mutation proves it can fail.

| ID | File | Mutation | Caught by | Status | Source |
|---|---|---|---|---|---|
| M1 | `js/renderer.js` | `faceText` returns `null` for a revealed ranked row — the answer never reaches the board face. This is the shipped defect, reproduced deliberately. | `a revealed ranked row keeps its ANSWER on the board face, not just in the overlay` (and the ordering assertion, incidentally) | closed — caught, 371/373 | `RR5`, `D14` |
| M2 | `js/renderer.js` | `buildCell` appends `.qbe-cell-value` before `.qbe-cell-text` — points at the left of the row, answer at the right. | `a ranked row BUILT revealed orders answer before points` + the §2 contract checker, on a RESUMED board | closed — **survived at first**, 373/373 green; a row is built hidden and gains both children on reveal, so nothing exercised `buildCell`'s order. Two assertions and a second `assertContract` call were added on the resume path, and M2 then failed 375/377. | `D14` |
| M2b | `js/renderer.js` | `updateBoard` inserts the value at `firstChild` instead of after the text — same swap, on the reveal path rather than the build path. | `a revealed ranked row emits the answer BEFORE the points (left, then right)` | closed — caught, 372/373 | `D14` |
| M3 | `js/renderer.js` | `faceText` drops its `initialState` guard — every hidden row prints its answer, giving the whole board away before a single reveal. | `a hidden ranked row prints no answer either, so nothing is given away` | closed — caught, 376/377, reporting the leaked answer by name ("Their phone") | `D14` |
| M5 | `themes/default.css` | Delete `.qbe-board[data-layout="ranked-list"] .qbe-cell-value { margin-inline-start: auto }` — the rule that pins the points to the end of the row. | `a revealed ranked row pins its points to the right edge of the row` (shell suite, measured inside the booted iframe where theme CSS is actually loaded) | closed — **survived the first fix**, 377/377 green, found by adversarial review rather than by the suite: every render assertion draws into `harnessStage()`, which carries no stylesheet, so nothing could see a layout. With the new shell assertion M5 fails 377/378, reporting the points 423px from the right edge instead of 29px. | `D14` |
| M6 | `js/renderer.js` | `faceText` guards `cell.answer === undefined` instead of truthiness, so a valid `"answer": ""` puts an EMPTY `.qbe-cell-text` on the face. | `a revealed ranked row with an EMPTY answer omits .qbe-cell-text entirely` + the §2 contract checker on the same board | closed — caught, 379/381. Found by adversarial review; the suite had no fixture with an empty required string anywhere, and the §2 checker counts cell children without reading them. | `D14` |
| M7 | `js/state.js` | `addStrike` does not cap at the game type's `strikes.count` — a fourth strike is recordable. | a cap assertion, not merely a display one | open — planned for `F9c-T5` | `D15` |
| M8 | `js/state.js` | Strikes key off the board rather than the column, so Round 2 inherits Round 1's strikes. | a multi-round assertion on a two-column ranked board | open — planned for `F9c-T5` | `D15` |
| M9 | `js/schemas.js` | An imported `"strikes": {"0": 99}` is accepted unvalidated and renders 99 marks. | the untrusted-input assertion — it must reach the error screen, never a board | open — planned for `F9c-T5` | `D15` |
| M10 | `js/renderer.js` | `.qbe-strikes` renders for a game type that declares no `strikes` block. | a jeopardy/bingo assertion that the element is ABSENT, not empty | open — planned for `F9c-T5` | `D16` |
| M11 | `js/renderer.js` | The centre overlay draws marks with no accessible name, so the count is invisible to a screen reader. | an aria assertion — `F9b` shipped a face whose name claimed "answer shown" while nothing was shown | open — planned for `F9c-T5` | `D16` |
| M12 | `themes/*.css` | The marks are styled only in `default.css`, so a themed board shows nothing. | the per-theme geometry suite, which boots every registered theme | open — planned for `F9c-T5`; exists because `M5` proved the render suite cannot see a layout at all | `D16` |
| M13 | `js/state.js` | `currentRound` is held in view state instead of the session, so a mid-show reload returns to Round 1 with the scores intact — the failure a host would notice only on stage. | `a board rebuilt from a session opens on the round it was left on` | closed — caught, 390/391 | `D17` |
| M14 | `js/renderer.js` | Non-active rounds are hidden with CSS alone, so their cells stay in the accessibility tree and reachable by `Tab` — a keyboard host can open a cell in a round the room cannot see. | six assertions, including the pre-existing no-inline-style invariant | closed — caught, 385/391; the CSS-only hide was also caught independently by `renderer.js sets no inline style but the --qbe-column-count property` | `D17` |


-----

#AI/Claude
