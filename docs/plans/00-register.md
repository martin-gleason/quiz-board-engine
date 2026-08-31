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

## Risks (RR)

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

*(none found in this project's documents)*

-----

#AI/Claude
