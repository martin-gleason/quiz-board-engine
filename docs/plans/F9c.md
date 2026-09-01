# F9c — strikes on the board

**Status:** in progress. `F9c-T0` is built and green; `T1`–`T5` outstanding.
**Branch:** `working-strikes`
**Retrofit on:** `F9` (feud), shipped. Second pass on a shipped feature, so a retrofit letter —
`F9b` was the answer-on-the-face fix; this is `F9c`.

**Three ratified deltas (all 2026-09-01):**

- **`D15`** — spec §10 `F9` says *"strikes/steals are host-mediated, not modeled"*. Modelling
  strikes contradicts the frozen spec. The spec is not edited; `D15` records the change. Ratifying
  it also fixed **`X` as the strike key**, widening plan Q12's deliberately small keyboard budget.
- **`D16`** — theme-contract §2 gains two elements and §4 gains their tokens.
- **`D17`** — **a ranked board shows one round at a time.** Added after planning, see §2.

---

## 1. What is being built, and what is deliberately not

Settled with the maintainer before planning:

| | Decision |
|---|---|
| **Steal** | **Not modelled.** The engine owns the strike count and its display. Who is stealing, whether the steal succeeded, and awarding the pot stay host-mediated, on the existing `+`/`−` team buttons. |
| **Scope** | **Per round**, i.e. per column. Moving to Round 2 starts clean. |
| **Placement** | **Both** — a large centre overlay for the room, and per-team marks in the score bar for the host. |

**What stays host-mediated, written down so it is not re-litigated at review:** there is no round
pot, no controlling team, no steal state machine, no automatic award. A third strike changes what
is on screen and nothing else. This is the small version on purpose — a wrong state transition
mid-show is visible to the whole room and hard to undo, and the show is in a week.

## 2. Why `D17` had to be folded in

**The plan as first written had a hole.** Strikes are per column, but the board has no notion of a
current round — every column renders stacked, all questions visible. So *which round's strikes does
the centre overlay show?* There is no answer. Per-column strikes have no coherent display until an
active round exists, which makes `D17` a prerequisite for `D15` rather than a companion to it.

**And the obvious escape does not exist.** One file per round looks like a zero-cost workaround and
is disqualifying: sessions key on `gameHash` (`js/state.js:90`), so a second file is a second
session and **team names and scores reset between rounds**. The engine already says so on its own
resume screen — *"saved from a different game file, so it cannot be resumed here."* Multi-round with
a running score therefore requires one file with several columns, which forces the decision.

`currentRound` is **session state, not view state**: a mid-show reload must come back to Round 3,
and that is exactly the failure a host discovers on stage (`M13`).

## 3. The one design tension, and how it is resolved

The two answers pull against each other: **strikes are per column** (round-scoped), but **per-team
marks** imply team-scoped strikes. Resolved as:

> **Strikes belong to the round. The score bar draws the round's strikes beside the team the host
> has marked active.**

This is why it works rather than being a fudge: `activeTeam` already exists (`js/app.js:310`,
`renderer.js:1207`) and is **transient view state, deliberately not in the session** — "whose turn
the host has marked, for the room". So the session gains exactly one new field, `strikes`, keyed by
column, and the per-team rendering is a display decision on top of it. No `(column, team)` matrix,
no strike ownership to keep in sync across import, and nothing new to persist.

**Consequence to accept:** if the host never marks an active team, the score bar shows no per-team
marks and the centre overlay carries the whole story. That is the right failure — the overlay is
the one the room reads.

## 4. State and config shape

**Game-type config** (`gametypes/feud.json`) gains one optional block. Configs are data selecting
built-in behaviour (CLAUDE.md), and a count is data:

```json
"strikes": { "count": 3 }
```

Absent — as in `jeopardy.json` and `bingo.json` — means **no strike surface at all**, the same way
`scoring.model: "none"` means no score bar. Not `"count": 0`; absent.

**Session state** (`js/state.js`, validated by `js/schemas.js`) gains one optional field:

```json
"strikes": { "0": 2 }
```

Keys are **column indices as strings**, matching the existing `cellStates` key discipline. Values
are integers `0..count`. Imported state is untrusted input (CLAUDE.md), so this is validated like
everything else: key pattern, integer range, and a contract check that the column exists on the
board and that the count does not exceed the game type's own `strikes.count`.

## 5. Tasks

**`F9c-T0` — one round at a time (`D17`). DONE.** *(owner: agent)*
Draw the active column and hide the rest; persist `currentRound`; a key to advance. Hiding must
remove the inactive rounds from focus and the accessibility tree, not merely from sight — the same
class of defect `openCell` already solves with `inert`, and the reason `M14` exists. Checkpoint MET: a
three-round board opens on Round 1, no off-round cell can take focus, a session carrying
`currentRound: 2` rebuilds on Round 3, and a stored `currentRound: 7` on a three-column board
reaches the error screen with a located message rather than drawing a blank board. Chrome
391/391, Firefox 391/391; `M13` and `M14` both shown failing.

**`F9c-T1` — schema and state. Foundational: delivers nothing user-visible.** *(owner: agent)*
`strikes` in the game-type schema and the state schema, the two cross-checks, and `newSession` /
`adopt` / `exportPayload` carrying the field. Checkpoint: a hand-written state file with
`"strikes": {"0": 2}` round-trips through export and import, and one with `{"0": 9}` or
`{"99": 1}` lands on the error screen with a located message.

**`F9c-T2` — the mutators.** *(owner: agent)*
`addStrike(column)`, `clearStrikes(column)`, capped at the configured count. Checkpoint: driving
them from the console moves the persisted session and survives a reload.

**`F9c-T3` — the two surfaces.** *(owner: agent)*
`.qbe-strikes` (centre overlay) and `.qbe-team-strikes` (score bar), theme-contract §2/§4 amended
under `D16`, `themes/default.css` styling both, and `prefers-reduced-motion` honoured on whatever
the third strike does. Checkpoint: a real board at projector size shows two marks, then three, and
they are legible from the back of a room.

**`F9c-T4` — host controls.** *(owner: agent)*
A visible control plus a key binding for adding and clearing a strike, and for advancing the round.
**Settled at the gate: `X` is the strike key**, widening plan Q12's budget from `Escape` /
`Space` / `Enter`. That widening is part of `D15`, not an implementation detail. Checkpoint: a full
round driven by keyboard alone.

**`F9c-T5` — tests and mutations.** *(owner: agent)*
Assertions in `tests/runner.js` plus the mutations below. Checkpoint: Chrome and Firefox both green,
every mutation shown failing.

## 6. Mutations planned before the code

Written here first, because the two blind spots `F9b` found were both *"the assertion existed and
watched the wrong thing"*, and both were found by review rather than by the suite.

| | Mutation | Must be caught by |
|---|---|---|
| `M7` | `addStrike` does not cap at `count` — a fourth strike is recordable | a cap assertion, not just a display one |
| `M8` | strikes key off the board instead of the column, so Round 2 inherits Round 1's strikes | a multi-round assertion on a board with two columns |
| `M9` | the strike count survives import without validation — `{"0": 99}` renders 99 marks | the untrusted-input assertion; must reach the error screen, never a board |
| `M10` | `.qbe-strikes` renders when the game type declares no `strikes` block | a jeopardy/bingo assertion that the element is *absent*, not empty |
| `M11` | the centre overlay is drawn but has no accessible name, so the count is invisible to a screen reader | an `aria` assertion — `F9b` shipped a face whose name claimed "answer shown" while nothing was shown |
| `M12` | the strike marks are styled only in `default.css`, so a themed board shows nothing | the per-theme geometry suite, which boots every registered theme |
| `M13` | `currentRound` lives in view state, so a mid-show reload returns to Round 1 | a resume assertion on a board parked on Round 3 |
| `M14` | inactive rounds are hidden with CSS alone, so `Tab` still reaches their cells | a focus assertion — a keyboard host must not open a cell the room cannot see |

**`M12` exists because of `M5`:** the render suite draws into `harnessStage()`, which carries no
stylesheet, so it structurally cannot see a layout. Anything visual is asserted in the booted
iframe or it is not asserted at all.

## 7. Risks

- **Scope grew at the gate.** `D17` was not in the first draft of this plan; it was found by the
  maintainer asking why multi-round boards are unintuitive. The week now carries two deltas' worth
  of work, and `D17` is the one that must land — strikes without it have nowhere coherent to draw.
- **Five themes, two new elements.** `M12` covers it, but the work is five files, not one.
- **A week, with content authoring competing for the same time.** If this slips, the fallback is
  exactly today's behaviour — strikes on paper — so it degrades safely.

## 8. Explicitly out of scope

Round pot · controlling team · steal state machine · automatic awarding · strike history or undo
beyond `clearStrikes` · fast money.
