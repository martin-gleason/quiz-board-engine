<!-- VENDORED from code-process-review/conventions.md — DO NOT EDIT.
     pinned-sha256: a0934ff5a4fac45f7b06afa0b1f2b79a7a3a169b3b1e952180e9ee14c9cd3374
     Project-local rules belong in docs/conventions-local.md (D24).
     Fix upstream, then re-vendor: python3 scripts/vendor.py <project> -->

# Conventions — baseline

**This file is the source of truth.** A project vendors a pinned copy to
`docs/conventions.md` and `@import`s the local copy, so the project stays viable in a
standalone clone. Changes are made here and flow outward; a project never edits its
pinned copy in place.

Three axes. Do not conflate them — they blur the moment they are not pinned.

---

## Axis 1 — Structural. The only IDs that appear in git.

- **Milestone** — the release container. **Named, never numbered:** `MVP`, `v1.1`, `v2.0`.
  Realized as a GitHub milestone, so it is visible without opening a repository.
- **Feature** `F<N>` — a deliverable unit of **user value**.
- **Chore** `C<N>` — an operational unit that produces **no user-visible change**: repo
  setup, credentials, documentation, process, tooling, corrections. Chores are the
  parallel track. (Industry calls this an *Enabler*.)
- **Task** `F<N>-T<M>` / `C<N>-T<M>` — an implementation step. **Optional**: a feature
  that is one thing stays `F3`. Every task names an **owner**: `human` or `agent`.
- **Retrofit** `F<N>b`, `F<N>c` — a second pass on an **already-shipped** feature. The
  letter is allocated when the retrofit is opened. **It is an identifier, not an index:
  gaps are legal, permanent, and never closed by renumbering.** IDs are cited by name in
  plans, reviews, tests and source comments; a tidy sequence bought with a broken citation
  is a bad trade.

### Feature or chore? Ask what it delivers, never who does it

**The test is one question: would a user of the app notice?** If yes it is a feature; if
no it is a chore. Ownership is a *property* of the unit, not the thing that classifies it.

This is written down because it was got wrong. `C6` was first opened as `F7a` — an
agent-authored documentation and tooling correction, filed as a feature because the agent
does it and because chores were then defined as *"an operational task the human performs."*
That definition left agent work that is not a feature with nowhere to go, so it went
somewhere wrong. Chores now cover it, and the owner is stated on the unit.

Two corollaries, because both were live at the time:

- **A retrofit is a second pass on something already shipped.** `F7a` was not: `F7` had
  not been built. A correction to an unbuilt feature's *plan* is a chore, not a retrofit.
- **A correction spanning several features belongs to none of them.** `C6` fixed
  documentation across `F1`–`F6`. Numbering it after any one of them would have implied
  an ownership it does not have.

---

## Axis 2 — Registers. Cited by name, never in git.

**A register ID MUST NOT appear in a commit message, a branch name, or a PR title.**
The task that *builds* or *closes* a register item carries the `F`/`C` ID. This is one
rule so that every register invented later inherits it without a new argument.

| ID | Register | Holds |
|---|---|---|
| `D<N>` | **Decisions** | Every proposed and ratified change to the spec. ADR-style. |
| `RR<N>` | **Risks** | Risk register: risk, likelihood, impact, mitigation, owner. |
| `O<N>` | **Owner items** | Outstanding items only the owner can close. |
| `H<N>` | **Hooks** | Enforcement mechanisms, traced *spec invariant → mechanism → owning task*. |
| `M<N>` | **Mutations** | Named ways to break the code, each paired with the test that must catch it. |
| `FR<N>` / `NFR<N>` | **Requirements** | Functional and non-functional. **Stated in `SPEC.md`** — they are the baseline. |

`D` · `RR` · `O` · `H` · `M` live in **`docs/plans/00-register.md`**, one `##` per
register, so a single read gives the state of the project.

**Every row carries a status.** A register row without one is invalid, not "probably open."
Status absent means the reader must go looking, and what they find is a document written when
the item was opened — which says what was true then, in the present tense, forever.

**A live relationship belongs in the register, never in prose.** "Blocks `F7`" written in a
chore's header was true the day it was written and stayed on the page after the blocker
cleared. Dependencies are a field that can be checked; a sentence is a claim that cannot.

**Every register is sorted by ID, and every ID appears exactly once.** Topic order is
what a reader wants; numeric order is what a *writer* needs — allocating the next number
must not require scanning forty unsorted rows. It was got wrong three times in one file
that way. Re-sorting for reading is the generated status page's job, not the source's. `FR`/`NFR` are the exception:
they live in `SPEC.md`, because they *are* the baseline the register is measured against.

### Decisions are immutable once ratified

**Status:** `proposed` · `ratified` · `rejected` · `superseded`.

A ratified decision is **never edited or deleted** — it is superseded by a later entry
that links back. A rejected decision stays in the register, struck through, so it is not
re-proposed. This is the ADR pattern; the acronym is not borrowed but the lifecycle is.

**Parked and rejected work are status values, not documents.** A ratified decision
carrying a future milestone *is* the parked backlog. There is no `parked.md` and no
`rejected.md`, because a second document is a second intake path.

**One intake path.** Anything that changes scope enters as a `D<N>`. An item with no
number has not been decided, however clearly it was said aloud.

---

## Axis 3 — Lifecycle and authorization. Metadata, never containers.

- **Gate** — the boundary crossed only with the owner's explicit yes. **An event, not a
  place.** Every feature is a gate; every milestone boundary is a gate. A gate is never
  a thing work is filed *in*, because a word that is both an event and a location slides
  toward location. This is why `Phase` was retired.
- **Checkpoint** — a **demonstrable increment inside a feature**, between task groups.
  The test for whether something is a task: *can I name the checkpoint that proves it
  works?* If the answer is "not until the next three land," it is a layer, not a task.
- **Priority** `P0` `P1` `P2` — a **field** on an item, in the standard industry sense
  (P0 blocks the milestone). Priority earns its keep on defects, chores and owner items,
  which arrive unordered. An ordered feature list is already a priority; do not state it twice.
- **Status** — a field. Not an ID, not a directory.

---

## Decomposition

Four to six tasks per feature is the observed working size. Decompose in two parts:

1. **Foundational group** — the unavoidable shared plumbing, **labeled as delivering
   nothing user-visible.** Honest, and it stops the group growing.
2. **Vertical slices** — each one a checkpoint you can hold in your hand.

Layer-only decomposition is efficient for a single agent building a whole feature at
once, and it is worth zero if the work stops halfway. Where a project has a hard stop,
that risk is real and the hybrid is not optional.

---

## Merge

- **PR** — one feature branch, one or more Tasks, merged to `main` by **rebase-and-merge**.
  No squash, no merge commits — every commit stays for audit.
- **Branch:** `F<N>/<slug>` (e.g. `F2/timer-engine`).
- **Commit:** `<type>(<id>): <description>` — `feat(F2-T1): persist timer state across background`.
  Types: `feat`, `fix`, `test`, `chore`, `docs`, `refactor`, `ci`.
- The **ID in the scope is structural**, always. Never a register ID.

---

## Documents

Six standing documents, plus a plan and a review per unit of work.

| # | Path | Holds | Changes |
|---|---|---|---|
| 1 | `CLAUDE.md` | standing rules; `@import`s conventions | when the process changes |
| 2 | `docs/conventions.md` | this file, vendored and pinned | upstream only |
| 3 | `docs/specs/` | **the vision sentence**, `FR`/`NFR`, hook intentions. One spec or several, named for the product. | **never — it is the baseline** |
| 4 | `docs/plans/00-register.md` | every register, one `##` each | append-only |
| 5 | `docs/plans/00-status.md` | the state of the project as one chart | **generated, never hand-written** |
| 6 | `docs/conventions-local.md` | conventions true of **this project only**. *Optional* — a project with no rules of its own does not need the file. | freely, by the project |

**A project's specs live in `docs/specs/`, and the directory is the rule — not a filename.**
A project may hold one spec or several: a home-automation project has a spec per subsystem,
a design system has a numbered series, and most name the file after the product rather than
`SPEC.md`. The earlier rule named `docs/specs/SPEC.md` exactly, and nine of twelve projects
ignored it for a good reason. A rule the corpus routinely and correctly breaks is a rule
that was written wrong; it was corrected rather than enforced.

**The vendored copy is never edited — that is what makes it checkable.** A project's own
rules go in `docs/conventions-local.md`, which `CLAUDE.md` `@import`s alongside the pinned
copy. The split is not bureaucracy: the pin is a content hash, so a copy edited even once
becomes indistinguishable from a stale one, and those need opposite fixes. Keeping the
inherited file untouched is what lets a check answer *current, stale, or divergent* at all.

A local rule that turns out to be true of every project gets **promoted upstream** — a
visible move, on the record, rather than the same paragraph appearing in twelve files.

Per unit: `docs/plans/F<N>.md` written at the gate · `docs/reviews/F<N>.md` after.
A chore gets a file only when it has tasks and a verification step; a one-line chore
lives in the register.

**Documents are separated by lifecycle, not by topic.** Things that change at the same
rate, for the same reason, by the same hand, belong in the same file.

### The spec is a baseline, and it carries one sentence

`SPEC.md` opens with **one sentence naming what the project is for**, and it is the only
thing in this system a script cannot check. Spec drift is mechanizable:

> **Drift = (what is built) − (spec + ratified deltas)**

Every behavior traces to a spec requirement or to a numbered ratified decision. Anything
tracing to neither is drift **by definition**, not by judgement — forward (every `FR` has
a test) and backward (every test cites an `FR` or a `D`). Vision drift is checkable only
by a human re-reading that one sentence at a gate, which is why it has to stay one sentence.

### Directory names are lowercase, and plural unless the word has no plural

Added 2026-08-27, after `docs/Verbiage/` reached `main` as the only capitalised directory
in the repository.

**macOS is why nobody saw it.** The folder was made lowercase, git recorded it capitalised,
and a case-insensitive filesystem never disagreed — so it passed a review that could not
have caught it. A Linux or CI checkout treats `docs/Verbiage` and `docs/verbiage` as two
different paths, which costs an afternoon exactly once.

**Plural, because these are categories of artifact:** `plans/`, `reviews/`, `chores/`,
`specs/`, `handoffs/`, `learnings/`. **Two singulars are allowed**, both because the word
has no plural to use: `archive/` is a literal noun, `verbiage/` is a mass noun.

---

## Working loop

Three effort modes. **All three are set by the owner. The agent cannot turn any of them on** —
a rule that tells an agent to "run ultrareview" is broken on contact.

| Mode | How it is set | What it does |
|---|---|---|
| **Ultrathink** | the owner types `ultrathink` in the prompt | deeper reasoning, that turn only. No other phrasing triggers it. |
| **ultracode** | `/effort ultracode`, `--effort ultracode`, or the owner types `ultracode` | xhigh reasoning **plus multi-agent orchestration**. A setting, not a phase. |
| **ultrareview** | the owner runs `/code-review ultra` | multi-agent cloud review with independent verification. **Billed, $5–25 a run.** Claude does not start one on its own. |

The loop, with who acts:

1. **Plan — Ultrathink.** Re-read the spec *and the register*, batch clarifying questions,
   paraphrase back, write `docs/plans/F<N>.md`. **Wait for the yes.** *(owner sets the mode)*
2. **Build — ultracode, multiple agents.** Fan out across independent components; one agent per
   component, each owning its own files. **Every agent proves its own work by breaking it first**
   and reports failure honestly rather than claiming success. *(owner sets the mode)*
3. **Adversarial review — mandatory.** In-session, the agent runs the review itself as a
   workflow. `ultrareview` is the owner's escalation and only the owner can fire it.
4. **Verify with evidence.** A command returns pass and the output is in the PR.
5. **Commit → PR → logged review.** Rebase-and-merge.

**Fan-out does not change ownership.** Several agents building one task is still `owner: agent`;
the dial counts who holds the pen, not how many hands. A `human`-owned task is never fanned out.

**A project may narrow this with a ratified delta**, and one already does: a security-critical
service restricts ultracode to its security-load-bearing surfaces and uses standard mode for CRUD,
"so rigor rises without drowning the review track." That is a cost decision the owner is entitled
to make. Narrowing needs a `D<n>`; drifting does not count.

### The six review dimensions

Named, because an undefined dimension collapses into whatever the reviewer already wanted to say.

| Dimension | Asks |
|---|---|
| **Correctness** | wrong output, crash, data loss, a case the code does not handle |
| **Security** | injection, authz, secrets in the tree, PII, the project's own data invariants |
| **Performance** | more work than the task requires — algorithmic cost, redundant I/O, unbounded growth, leaks |
| **Code quality** | reuse, simplification, altitude: is there an existing thing this should have used; is this the simplest shape; is the abstraction at the right level |
| **Contract compliance** | does the code contradict a ratified `D<n>`, an `FR`, or the spec |
| **Process compliance** | does the work obey this document — plan before code, evidence not assertion, IDs in the right tier |

**Performance means efficiency, not fault tolerance.** A prior project used "performance" for
edge cases and fault isolation; those are **correctness**. **Code quality is not style.**
Formatting is the linter's job and stays out of review; quality is about structure and reuse.

### How the review is structured

Every rule below is here because a run of this review produced the number beside it — 53 agents,
42 raw findings, 32 confirmed, 23 distinct defect sites.

- **Every finding carries an executable trigger from real repo inputs.** Of ten findings killed by
  refutation, **ten conceded the mechanism was real** and died on the trigger being unreachable.
  Not one was killed for misreading the code. Reachability is the only thing refutation actually
  tests, so it is the thing the finding must state.
- **Run the code. Do not review by reading alone.** The reviewers that ran things produced zero
  mechanically-false claims.
- **Dedup before refutation, not after.** 32 survivors collapsed to 23 distinct sites; six sites
  were found by two or three lenses each, and **nine of forty-two refutation agents re-litigated a
  claim another agent was settling at the same moment** — 21% of the budget.
- **Refute everything or nothing. Never triage by severity.** Criticals survived 5 of 5, majors
  71%, minors 77%. Minors survived at a *higher* rate than majors.
- **Severity is a pinned enum:** `critical` · `major` · `minor`. Parallel agents given no shared
  definition will invent one each.
- **The refuter attacks the observation, not the reporter's framing.** One true finding was refuted
  when worded as a defect and confirmed when worded as a failing hook — same evidence, opposite
  verdicts, decided by phrasing.
- **A completeness critic runs last, on the confirmed list, with a budget to run things.** One
  agent against forty-seven found the class every lens structurally could not.
- **The critic's own findings go through refutation too**, or the run says plainly that they are
  unverified. An unguarded final step is where a headline conclusion escapes the discipline applied
  to everything else.
- **Do not rank lenses by how many findings came back.** Four of five lenses returned exactly eight.
  The count is anchored to the model, not to the defect density.

Spec authority stays with the owner. The agent proposes deltas; the owner ratifies.
**The agent never edits the contract it is held to.**

### Write the plan before you write the code, and wait

**Reaffirmed 2026-08-27 by the owner, after the agent had been quietly skipping it.** The
adversarial reviewer caught it on `F4c`: the plan was committed **one second after** the
code it gates. It was true of most of that day's work too.

**What the rule is for.** A plan written afterwards is a justification. It cannot do the
one job the gate exists for — giving the owner a moment to say *"don't build that"*, or
*"build the smaller version"*, while saying so is still cheap. Every plan written after
the code passed that moment silently.

**Defect fixes proceed without a gate**, and that is not a loophole: the distinction is
whether the app is failing to do what the contract already says.

**Everything else waits for a yes.** A new screen, a new setting, a new path through the
engine — anything owing a delta. The cost is a round trip, which is precisely the thing
being bought.

### Read the plan before you write it

**A file existing at the path you are about to write is the normal case, not the exception.**
`docs/plans/F7.md` was destroyed by a shell redirect onto a path nobody had opened,
losing 153 lines and decisions that were never reproduced.

The mechanism matters: **the file-writing tool refuses to overwrite a file that has not
been read this session. Shell redirection has no such guard.** The protection existed and
was walked around by using a different tool for the same job. Read the target first — the
answer may already be in it, ratified, months ago.

### A claim recorded before it is verified says so in the sentence that records it

A prediction was written in the same confident register as the rest of a document, read
back the next morning as established, and built on — three artifacts and two pull requests
before anybody checked. **Writing something down does not test it; it promotes it.**

### Assertions are not evidence

A feature is done when a command returns pass and the output is in the PR. A test earns trust
only when a **mutation** (`M<n>`) proves it can fail.

**A suite with no mutations is a false-assurance instrument, and saying so is not theoretical.**
Fifteen checks were written for a register parser and all fifteen passed — while the parser was
returning `title='ratified'` for every decision row and marking an open item closed. They passed
because every assertion hand-built its own object and the only two that touched the parser asked
"is the list non-empty" and "does every item have a title", both of which the bug satisfies. A
thirty-two-finding review said the parser was broken; **not one asked why the suite disagreed.**

The rule that follows: **a test that has never been shown to fail is not evidence.** At least one
mutation per behaviour the tests are supposed to protect, recorded as `M<n>` with the named test
that catches it.

-----
2026-08-30

#AI/Claude
