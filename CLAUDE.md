# CLAUDE.md — Quiz Board Engine

Standing rules for every session in this repo. Not the work itself.

| Artifact | Role | Lives |
|---|---|---|
| **CLAUDE.md** (this file) | How to work here | repo root |
| **Spec** | The intention — frozen contract | `docs/specs/quiz-board-engine-spec-v1.md` |
| **Plan** | The build — decisions, deltas, phases, hooks | `docs/plans/v1.0-build-plan.md` |

**The spec is FROZEN and immutable.** Never edit it. Propose changes as Deltas (`D<N>`) in
the plan; the maintainer ratifies before a delta is real.

@docs/conventions.md

**Sourcing:** hybrid — `docs/conventions.md` is a pinned local copy, imported locally so a
standalone clone still works.

---

## The five hard constraints (from spec §2 — these are the project)

1. **Zero cost.** GitHub Pages only. No servers, no paid services, no GitHub Actions.
2. **Zero build.** No compiler, bundler, transpiler, SCSS, or `package.json` dependency
   graph. Vanilla ES modules loaded directly by `index.html`. If a change needs a build
   step, the change is wrong.
3. **Zero CDN.** Every runtime asset is vendored under `/vendor/`. The app makes **no
   external network requests at runtime.** Adding a `<script src="https://...">` is a
   build-stopping defect.
4. **JSON only.** All data files are JSON. Comments are `"_note"` fields, stripped by the
   validator.
5. **Cross-browser.** Chrome, Safari, and Firefox behave identically. Never branch on
   user-agent; never parse a browser's own error strings (see the plan, Q6).

## Named invariants — violating one is a build-stopping defect

- **No `innerHTML`, anywhere in `js/`.** Also no `outerHTML`, `insertAdjacentHTML`,
  `document.write`, `eval`, or `new Function`. All content reaches the DOM via
  `createElement` / `textContent`. This binds our code; vendored reveal.js is exempt as a
  pinned, unmodified dependency.
- **Reveal's markdown plugin is never loaded** — it is not even present in the repo.
- **`?game=` is same-origin only.** Relative paths under `/games/`, must end `.json`, no
  absolute URLs, no protocol-relative `//`, no `..`, no encoded traversal.
- **Themes load only via `/themes/themes.json`.** A theme name outside the manifest is a
  validation error.
- **No partial render, ever.** Validation fails → error screen. There is no best-effort path.
- **Imported state is untrusted input** and is validated like any other input.
- **Configs are data.** No logic, no markup, no URLs — enums selecting built-in behavior.

## Module boundaries — keep these honest

`loader` fetches · `validator` judges · `errors` explains · `renderer` draws ·
`state` remembers · `schemas` declares. No module reaches across those lines.

`errors.js` is **heavily commented** per spec §7 — the *why* of each message class
explained where the code lives. That is a requirement, not a nicety.

---

## Authorization model

**Non-negotiable.**

1. Specs are context, not work orders.
2. Work begins only when the maintainer gives explicit instruction in the current session.
3. Passing tests within a feature loop authorizes completing **that loop** — nothing more.
4. Moving to the next feature or crossing a phase gate requires explicit authorization.

## The working loop

**explore → plan → code → verify → commit**

1. **Spec review + planning — Ultrathink.** Batch clarifying questions before generating.
2. **Implementation — ultracode**, unless the planning prompt says otherwise.
3. **Adversarial review — mandatory, on top of ultracode.** Fire
   `.claude/agents/adversarial-reviewer.md`:
   - at the end of every feature, before it is called done;
   - at session start/restart — review what shipped *and* re-read the outstanding feature
     list. Never resume blind.
4. **Verification.** No feature is done on assertion. Run `/tests/index.html` in Chrome
   **and** Firefox and show what it returned. Sweep `js/` for the forbidden DOM APIs.
5. **Commit.** Conventional commit, ID in scope. Open the PR. Log the review.

**Local run:** the app needs an HTTP origin — `file://` blocks module and JSON fetches.
`python3 -m http.server 8000`, then `http://localhost:8000/`.

## Learning dial: 10%

The agent authors; the maintainer reviews every PR and hand-authors the occasional small
piece. **Every agent PR body carries a short "why" teaching note** — the reasoning behind
the approach, not a changelog. No 🎓-tagged features at this level.

## PR review log

`docs/pr-review-log.md` — one entry per merged PR, committed directly to `main` right after
merge (`docs(quiz-board-engine): add PR #N review-log entry`). Leave maintainer bypass on in
branch protection so that direct log commit is possible. Before merging a PR, check the log
has an entry for the last-merged one; if it's missing, **surface politely, do not block.**
Format is open — do not template it.

## Global rules

- **Accessibility: WCAG 2.1 AA.** Cells are real `<button>` elements — get keyboard and
  screen-reader support from the platform, not from bespoke ARIA. Theme contrast is checked,
  and the board must be legible at projector contrast from the back of a room.
- **`prefers-reduced-motion` is honored** by every animation.
- **Module system: native ES modules** (`<script type="module">`). No CommonJS, no `require`.
- **License: AGPL-3.0-or-later.** Every source file carries an SPDX header.
- **Repo: public** — no identifiable or regulated data lives here, ever. Demo content is
  fictional or public-domain.
- **Vendoring is a reviewed act.** Bump versions in their own commit, record the SHA-256 in
  `vendor/README.md`, re-run the full matrix.

## Keeping this file healthy

Lean beats complete. If a rule keeps getting ignored, this file is too long — prune.
Sometimes-relevant knowledge belongs in a skill, not here. Treat it like code: review it
when things go wrong, and test a change by watching whether behavior actually shifts.

-----
2026-08-16

#AI/Claude
