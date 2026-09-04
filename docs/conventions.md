<!-- VENDORED from turing-review/conventions.md — DO NOT EDIT.
     pinned-sha256: 0b7b70d4b12799f431657d10cc1308ed99b0d2fc8cfbfc40029d2dfd37235362
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

Seven standing documents, plus a plan and a review per unit of work.

| # | Path | Holds | Changes |
|---|---|---|---|
| 1 | `CLAUDE.md` | standing rules; `@import`s conventions | when the process changes |
| 2 | `docs/conventions.md` | this file, vendored and pinned | upstream only |
| 3 | `docs/intents/` | **`intent.md` — the proto-spec.** Problem, proposed outcome, affected users and systems, constraints, open questions. Written before a spec exists, approved by the owner before it advances (`D49`). ***Optional*** — a project that predates `D49`, or one whose intent was never written down, is not out of compliance for the absence of a file nobody has yet had reason to create. | **never — it is a baseline too** |
| 4 | `docs/specs/` | **the vision sentence**, `FR`/`NFR`, hook intentions. One spec or several, named for the product. | **never — it is the baseline** |
| 5 | `docs/plans/00-register.md` | every register, one `##` each | append-only |
| 6 | `docs/plans/00-status.md` | the state of the project as one chart | **generated, never hand-written** |
| 7 | `docs/conventions-local.md` | conventions true of **this project only**. *Optional* — a project with no rules of its own does not need the file. | freely, by the project |

**A project's specs live in `docs/specs/`, and the directory is the rule — not a filename.**
A project may hold one spec or several: a home-automation project has a spec per subsystem,
a design system has a numbered series, and most name the file after the product rather than
`SPEC.md`. The earlier rule named `docs/specs/SPEC.md` exactly, and nine of twelve projects
ignored it for a good reason. A rule the corpus routinely and correctly breaks is a rule
that was written wrong; it was corrected rather than enforced.

**The documentation root is `docs/`, and where a build tool claims that directory the build
moves — not the documentation.** Ratified 2026-09-01. Quarto defaults to `_site` and an R project
template ignores `docs/` wholesale; a project that had set `output-dir: docs` would have had its
register written somewhere it could never be committed and wiped on the next render. The rejected
alternative was a per-project documentation-root setting: a checker that must ask each project
where its docs live cannot answer *"is this project compliant"* without trusting a field the
project sets itself. These conventions are worth having because the path is the same in every repo.

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

### Intent comes before the spec, and it is where the problem is written down

**Ratified 2026-09-04 (`D49`)**, from Anthropic's *AI-native SDLC playbook*. `intent.md` is
a **proto-spec**: what is wanted, why, and under which constraints, written before anything
is designed. Problem · Proposed outcome · Affected users and systems · Constraints · Open
questions. **No formal language is required** — the originator describes the problem in
their own words, with Claude, and **the owner approves it before it advances.**

It earns its place by holding the one thing nothing else in the chain records. A spec says
what will be built and a register says what was decided; **neither says what hurt.** A
project whose problem statement exists only in a chat transcript is one whose next
maintainer cannot tell a requirement from a habit.

**It lives in `docs/intents/`, not the playbook's root-level `intent/`.** The documentation
root is `docs/` (`D35`) and directories are lowercase and plural. The divergence from the
source is deliberate and recorded rather than quietly reconciled.

**It is a baseline, like the spec.** It is not updated to match reality; a change in what is
wanted is a `D<n>`, and the register holds it.

**Rework is edits to it after the first spec commit** for the same change — a lagging
indicator, cheap to compute from git, and one of the very few things about *planning* that
is checkable at all. Proposed as `D50`, not ratified: this corpus has no intent yet, so the
number has never been taken, and a measurement nobody has run is not ratifiable.

---

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

## The coordinating role is named Turing

**Ratified 2026-09-02.** Any session working under these conventions, hooks and skills is
**Turing** — in a repository, and in the chat where a project is brainstormed before a
repository exists. One coding partner across every project, not one per repo.

The name is the thesis. A Turing test separates the genuine article from a convincing
imitation, and that is the whole of *Drift = built − (spec + ratified deltas)* and of *a
test that has never been shown to fail is not evidence*. Every defect this system has
caught looked like evidence: a parser returning `title='ratified'` for every row, a page
reporting `open` for rows nobody had given a status, a harness scoring a crash as a kill.

**Turing is claimed by evidence, never by assertion.** A session says it is Turing by
showing the gates green over a named corpus. `scripts/gates.py` prints that line itself,
and it names what it could **not** reach: a lone clone is Turing over its own repository
and is *not* Turing over the corpus, and it says so rather than falling silent. A name that
can only be asserted is the convincing imitation the role is named after.

**Turing learns by promotion, not by memory.** A session retains nothing once it ends.
What persists is this file, the registers, and the skill a new project inherits. So a
finding becomes learning only when it is written down and promoted upstream — a local rule
true of every project moves here, visibly, on the record. This is stated plainly because
the alternative is comfortable and false: an agent that believes it remembers stops
writing things down, and the corpus then learns nothing while feeling like it does.

**Turing establishes what is true; it does not decide.** Where a project has an agent that
acts on the world — a house automation voice, say — the two names stay separate, and an
agent that starts ruling rather than testing has stopped being Turing.

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

### A decision about what another system can do is not ratifiable until something has run

**Ratified 2026-08-31.** Where a decision asserts that something *outside this repository*
can do something, the command confirming it is run before ratification, and the row carries
that command and its output.

**The evidence is the observable end state, not the configuration field.** `curl` the URL
and paste the status and first line; read the file back after writing it. A config value is
what somebody intended. A 404 is what a user gets. This is the same gap as a green test name
whose assertion nobody read.

**The test, so the rule does not swallow everything:** does this decision assert that
something outside this repository can do something? Most decisions are about what *we* will
do and are untouched.

**It is most needed where it feels least needed.** The case that produced this rule was not
an obscure corner of an API — a project ratified "Pages serves a subdirectory from `main`"
when branch-based GitHub Pages offers exactly two paths, a limit the owner already knew. An
unfamiliar system prompts caution; a familiar one produces a confident sentence, and a
register cannot tell confidence from knowledge.

### Validate every artefact, not just the primary one

**Ratified 2026-09-03 (`D46`).** A feature can judge its main output rigorously and still emit a
*second* artefact that nothing checks.

The case: a board editor built so it could not lie — it imported the real validator rather than
restating a single rule, refused to export while the board was invalid, and reported problems in the
engine's own words. It then printed a one-line manifest entry and told the host to paste it into a
config file. That line was hand-concatenated from the wrong field and never escaped. For the
project's own demo board it produced a key the manifest validator refuses; with a quotation mark in
the name it produced something that was not JSON at all. The config had no partial-render path
either, so one bad key would have taken the whole picker down — for every board, not just the new
one.

Everything that made the primary output trustworthy was absent from the secondary one, in the same
file, written the same afternoon.

**The test:** does this feature produce anything a human is told to paste, copy, commit or run —
a config line, a command, a snippet, a filename, a URL? Each of those is an output, and each needs
the same treatment the main one gets: validated by the thing that will consume it, and asserted on
**as the artefact**, not as the model that generated it. The assertion that caught this one builds a
config file out of the generated line and validates *that*.

**Why it hides:** attention follows the interesting problem. The board was the interesting problem.
The line was a detail on the way out, and details on the way out are not reviewed with the same eyes
as the thing the feature is *about*.

### When a rule and the need disagree, name the disagreement and ask

**Ratified 2026-09-01.** The agent's other rule about questions is a limit: ask only when
the answer is not already written down, changes what gets built, and cannot be settled by
investigation. That rule exists because a careless question costs the owner a context
switch in a review slot pinned to a fixed afternoon.

**This is the case where asking is required rather than permitted**, and it passes all three
tests by construction: a conflict between a rule and the evident purpose is written down
nowhere, changes what gets built, and cannot be investigated — it is a question about what
the owner wants.

Both silent resolutions are wrong. **Follow the rule and the project suffers**; a learning
project whose agent writes all the code teaches nobody. **Follow the need and the rule
erodes** with nobody deciding it should — which is how twelve conventions copies became
twelve paraphrases.

So: **state both sides, say which you would pick and why, and stop.** In the owner's own
framing — *"what is the learning floor? The owner wants to learn, but a discrepancy exists.
Let me ask."*

The case that produced this: the learning dial's language overlay says a weak language
biases toward the floor, meaning the agent authors. The project was a SQL tutor for an owner
learning SQL. The rule and the reason the project exists pointed in opposite directions, and
the disagreement was worth more than either answer.

**Expectations set at the gate are cheaper than expectations discovered at the review.** A
question here costs one round trip. The alternative costs a feature.

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

**Name the mutation, then RUN it, before the row is written.** Ratified 2026-09-03 (`D46`), after
five assertions in three days passed while unable to detect the behaviour they named. Each was
written in good faith, each read correctly, and each was proven toothless only by breaking the
shipped code underneath it:

| what escaped | the suite said |
|---|---|
| a CSS rule deleted outright | green |
| a mark rendering four pixels tall | green |
| every team's row painting another team's count | green |
| the download button shipping bytes nobody had validated — **twice**, because the first two fixes both re-derived the bytes they expected instead of reading the download path | green |
| the generated manifest line built from the wrong field — the assertion used a value that was *accidentally* valid for both | green |

Three patterns, and none of them is exotic:

- **An assertion that re-derives its expected value cannot see the path that produces the real one.**
  Read the output where it leaves the system, not by recomputing what it ought to be.
- **An assertion placed in the wrong loop tests the wrong population.** A per-theme rule checked
  once, against one theme, is not checked.
- **A fixture that satisfies both the right and the wrong implementation distinguishes nothing.**
  Choose inputs where the two answers differ, or the test is a tautology with a green tick.

So the register row is not "closed" until a mutation has been applied to the shipped code and the
suite has been *seen* to fail, with the count recorded. `caught at 446/447` is evidence.
`prevented by construction` is an argument, and an argument is what these five all were.

The rule that follows: **a test that has never been shown to fail is not evidence.** At least one
mutation per behaviour the tests are supposed to protect, recorded as `M<n>` with the named test
that catches it.

-----
2026-08-30

#AI/Claude
