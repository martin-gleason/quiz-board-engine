# Theme & display contract — v1.6

**Status:** NORMATIVE for F3/F4/F5/F6/F7/F8/F9/F10. Derived from frozen spec §4.3, §4.4, §6.4, §8.

> ## ⚠ AMENDED 2026-08-17 (v1.6) — ONE NEW TOKEN, ONE ATTRIBUTE DOCUMENTED, ONE CORRECTED SHAPE, AND **ONE RULE CHANGE YOU MUST READ IF YOU EVER SET `--cell-shadow: none`**.
>
> Additive and corrective: nothing was renamed and nothing was removed from the DOM. A v1.5 theme
> still renders correctly. One item below is a **defect fix that changes how a revealed cell looks**
> in themes that did not work around it, so it is flagged loudly rather than folded in quietly.
>
> **1. `--cell-shadow` IS NEVER COMPOSED INTO A SHADOW LIST ANY MORE — and `none` is now safe.**
> `default.css` used to draw the revealed cue as
> `box-shadow: inset 0 0 0 4px var(--cell-revealed-accent), var(--cell-shadow)`. `none` is a legal
> whole box-shadow value but is **not** a legal *item inside a list*, so a theme that switched its
> resting shadow off made that entire declaration invalid at computed-value time — and an invalid
> declaration computes to `unset`, i.e. `none`. Such a theme lost the drop shadow it meant to lose
> **and the 4px accent ring it never asked to lose**. The shipped `civic` dark scheme was affected:
> hidden → revealed collapsed to a 1.13:1 fill difference, and under `prefers-reduced-motion` an
> opened cell had no static cue at all (§8 requires one). `chalkboard` and `marquee` had each
> independently discovered the hazard and restated the property to work around it.
>
> **The composition is what was wrong, not the themes.** No CSS mechanism can make an arbitrary
> theme value safe inside a list: a `var()` fallback fires only for an *unset* custom property, and
> invalidity cannot be caught. So the ring is now declared **alone**:
> `.qbe-cell[data-state="revealed"] { box-shadow: inset 0 0 0 4px var(--cell-revealed-accent); }`
>
> **What changed visually:** a revealed cell no longer inherits the theme's resting drop shadow, in
> `default`, `midnight` and `civic` light. The ring — the accessibility-bearing cue — is now
> unconditional in every theme. **What you should do:** nothing, unless you want a lit/raised
> revealed panel, in which case restate the whole property with your own layers, exactly as
> `marquee` does. `--cell-shadow: none` is now a supported thing to write, and `chalkboard`'s
> work-around rule has been deleted because it no longer says anything the base layer does not.
>
> **2. New in §4: `--team-active-bg`** (default `rgba(255, 212, 94, 0.14)`). The active team row's
> inner tint, the second of its two cues beside `--team-active-outline`. It was hardcoded next to
> the tokenised outline, and **all four** override sheets carried the same one-declaration rule to
> change it — the exact evidence pattern §6's reporting duty exists to catch, and the same bar
> `--cell-answered-border` cleared in v1.2. Tokenising it deleted four whole rules. Keep it an alpha
> tint: it sits over whatever `--score-bg` you set.
>
> **3. `data-delta` is now documented in §3.** It was already being written by the renderer onto the
> score bar's `.qbe-btn` controls and was missing from §3's table, so the "closed attribute set" was
> not actually closed. It carries the award AMOUNT — identity/plumbing, not state. Do not style on
> it; `.qbe-btn:not([data-delta])` looks safe and is not.
>
> **4. §2 corrected in two places, both of which were already false in v1.5.**
> `.qbe-setup` does **not** take `[hidden]` — the setup screens are removed from the DOM by
> `destroy()`, unlike `.qbe-detail` and `input.qbe-file`, which really do set it. A hide rule written
> against the published shape was dead on arrival, and `default.css` carried one; both are gone.
> And `.qbe-setup[data-screen="teams"]` is **not** "absent once play starts": the toolbar's Teams…
> button reopens it over a fully drawn board, where it is appended to the stage — so `.qbe-toolbar`
> is the last **non-overlay** child of the stage, not unconditionally the last child. Do not build a
> `.qbe-stage > :last-child` selector.
>
> **5. Behaviour, not styling, but it affects what is on screen behind your overlay:** while a setup
> screen is up, every other child of the stage is set `inert`. It is removed from the tab order and
> the accessibility tree, not hidden, so your scrim still governs what is *seen*.

> ## ⚠ AMENDED 2026-08-17 (v1.5) — ONE NEW ELEMENT PAIR, ONE NEW ATTRIBUTE, TWO NEW TOKENS.
>
> Additive: nothing was renamed, nothing was removed, and no existing token changed. A v1.4 theme
> still renders correctly — but on a **bingo** board it now leaves one element unstyled, so this is
> flagged rather than folded in quietly.
>
> **New in §2: `aside.qbe-wins[hidden]` with `.qbe-win[data-pattern]` children.** F8 shipped
> pattern-complete win detection (spec §4.2). When a row, column, diagonal or full card completes,
> the renderer appends one `.qbe-win` to the rail and speaks the same phrase through the existing
> `.qbe-live` region. The rail is present **only** when the game type's `winCondition` is
> `"pattern-complete"` — bingo today — exactly as `.qbe-scorebar` is present only when there is
> scoring. It is `hidden` until the first pattern completes.
>
> **New in §3: `data-pattern` on `.qbe-win`** — `row` `column` `diagonal` `full-card`. It says which
> kind of line was completed, so a theme can style a full card differently from a row.
>
> **New in §4: `--win-bg`, `--win-text`.** Both default to the accent pair, so a theme that already
> set `--accent` / `--accent-contrast` has a styled rail for free.
>
> **What a v1.4 theme should do:** nothing, unless its accent reads badly as a filled chip on the
> board ground, in which case set the two tokens. Do not position the rail over the board: a win is
> an announcement, not a modal — play continues for second and third place (plan Q4), so the rail
> stays in the stage's column flow and must never cover a cell.

> ## ⚠ AMENDED 2026-08-17 (v1.4) — ONE NEW ATTRIBUTE, AND EVERY ANIMATION SELECTOR NEEDS IT.
>
> Additive: nothing was renamed or removed, and no token changed. But a theme that ships its own
> keyframes **must** adopt it, so it is flagged rather than folded in quietly.
>
> **New in §3: `data-animate="true"` on `.qbe-cell`.** It means *this cell just moved*, as opposed
> to *this cell was built already spent*. The renderer writes it only in `updateBoard`, i.e. only
> on a runtime state transition; the initial build never writes it.
>
> **Why.** `data-state` alone cannot tell those two apart, and a resumed board is full of cells that
> are `answered` from the first painted frame. Measured on a maxed 12×12 board resumed with all 144
> cells answered and `animation: "flip"`: 288 animations (`qbe-flip-card` + `qbe-flip-face`) started
> on the frame the board appeared. A bingo card hit the same thing without any session at all — its
> `preMarked` free squares are built in the terminal state and played their mark animation at load.
> The animation is supposed to mark the *event* of a reveal, not the fact that a page was opened.
>
> **What a v1.3 theme must do:** add `[data-animate="true"]` to every cell-level animation selector,
> alongside the `[data-state=…]` it already has. See §8. Overlay animations need no gate —
> `.qbe-detail` is hidden at build time and can only be unhidden by a click. Deferring
> `data-animation` on the stage to a later frame is NOT an equivalent fix: applying `animation-name`
> later just starts the animations later.

> ## ⚠ AMENDED 2026-08-17 (v1.3) — THE BIGGEST CHANGE SINCE v1. READ §2 AND §4 IN FULL.
>
> **A theme written against v1.2 still renders correctly, but it now leaves parts of the screen
> unstyled** — that is the difference between this amendment and the previous two, and it is why
> this one is flagged rather than folded in quietly. F6 (session state, teams, scoring UI), F7
> (bonus randomization) and F10 (export/import) shipped, and they put controls on the screen that
> v1.2 gave a theme no way to reach.
>
> **Why it could not be done inside the published DOM.** The v1.2 score bar was a *readout*:
> `.qbe-team` / `.qbe-team-name` / `.qbe-team-score` can display a score, but they gave the host no
> way to change one, no way to mark whose turn it is, and there was nowhere at all to hang F10's
> Export and Import. Spec §4.4 also requires teams to be *created in-app at session start* and a
> *resume screen listing recent sessions with resume/discard* — two whole screens with no published
> element between them. So the DOM grew. Nothing was renamed and nothing was removed.
>
> **New in §2:**
> 1. **`.qbe-team` gains `data-team="<index>"` and two children.** `.qbe-team-name` is now a
>    `<button>` (pressing it marks the active team; it carries `aria-pressed`), and a new
>    `.qbe-team-controls` holds the award/deduct buttons.
> 2. **`button.qbe-btn[data-action]`** — ONE button class for every piece of host chrome, varied by
>    attribute the way cells vary by `data-state`. Style it once and the score controls, the
>    toolbar, the setup screen and the resume screen all follow.
> 3. **`footer.qbe-toolbar`** — last child of the stage, ALWAYS present, including for a game type
>    with no scoring. It carries Teams… / Export / Import plus a hidden `input.qbe-file`. It is its
>    own element rather than part of the score bar precisely because bingo has no score bar and
>    still must be able to export.
> 4. **`.qbe-setup[hidden][data-screen]`** — the pre-game overlay, used for team setup and for the
>    resume list, with `.qbe-setup-panel`, `.qbe-setup-title`, `.qbe-setup-note`, `.qbe-setup-body`,
>    `.qbe-setup-actions`, plus `.qbe-field` / `.qbe-field-input` (team setup) and `.qbe-session` /
>    `.qbe-session-title` / `.qbe-session-meta` (resume).
> 5. **`.qbe-live`** — an ARIA live region on `<body>`, outside the stage. It is not a design
>    surface. See §5.9.
>
> **New in §4:** exactly one token, **`--btn-border`**. The evidence is in §4 under Chrome; the
> short version is that the same `--accent` fill sits on two different grounds (the board and the
> score bar) and passes the 3:1 boundary rule on one of them.
>
> **What a v1.2 theme should do:** nothing is broken, but check `.qbe-btn` against your palette
> first — it is the element that now appears on every screen.

> **AMENDED 2026-08-17 (v1.2) — five new tokens in §4. Re-read §4 if you built against v1.1.**
> Additive only: nothing published in v1 or v1.1 was renamed or removed, and every new token
> defaults to the exact value `themes/default.css` already produced, so a theme written against
> v1.1 renders identically. The evidence was that all four override themes — midnight, civic,
> chalkboard, marquee — were writing the SAME three class overrides, which is the signal §6
> describes for "the token set is short something".
> 1. **`--cell-answered-border`** — the spent rim, as a full shorthand. `default.css` hardcoded it,
>    so every theme had to restate `.qbe-cell[data-state="answered"]` by hand.
> 2. **`--cell-revealed-accent`** and **`--cell-revealed-value-color`** — the revealed panel's ring
>    and value were welded to `--accent`. They sit on a different ground than the accent was
>    measured against, and it routinely fails there (marquee measured its gold at 1.56:1 on ivory;
>    chalkboard's chalk yellow at 1.03:1 on its slab). Two tokens, not one, because two themes
>    wanted the value changed and the ring left alone.
> 3. **`--detail-close-color`** and **`--detail-close-border`** — the Close label sits on the scrim,
>    so the correct colour inverts with the ground. Every dark-ground theme hit it.
>
> **DECLINED:** `--column-label-transform` / `--column-label-border` (rationale finding 4). Column
> labels are per-theme territory; see §4's note under Typography for the evidence.

> **AMENDED 2026-08-17 — re-read §2, §4 and §7 if you built against v1.**
> Three changes came out of the Phase 2 adversarial review. All three are ADDITIVE — nothing
> published in v1 was renamed or removed — but a theme written against v1 should be re-checked:
> 1. **New element `.qbe-cell-text`** (§2): the face text of a cell that has no point value, i.e.
>    every bingo square. Without it a bingo card was 25 blank rectangles.
> 2. **New token `--cell-text-size`** (§4) for that element.
> 3. **`themes/default.css` is stated to be the always-loaded base layer** (§4, §7), and
>    **`.qbe-stage`'s `display` is stated to be owned by the renderer** (§2). Both were true in
>    practice and unwritten, and both silences caused real defects: the shell was not loading the
>    base layer at all, and the renderer was pinning the stage to `display:block`, which no theme
>    rule could outrank.

**Audience:** the renderer implementation, theme authors, and anyone reviewing either.

A theme is **one plain CSS file** listed in `themes/themes.json`. It sets custom properties and
may restyle documented class names. It gets no JavaScript, no markup, and no network.

This document is the whole surface. If the renderer emits DOM this file does not describe, that
is a renderer defect. If a theme depends on structure this file does not promise, the theme is
depending on an accident.

---

## 1. Why the tokens are not prefixed

Spec §4.3 names `--board-bg`, `--cell-bg`, `--cell-text`, and `--accent` verbatim. The spec is
frozen, so those four names are fixed and the rest of the set matches their style: unprefixed,
lowercase, hyphenated, named for role rather than appearance. `--cell-bg`, never `--dark-blue`.

Class names **are** prefixed `qbe-`, because they share a document with vendored reveal.js and an
unprefixed `.cell` would be a collision waiting to happen.

## 2. DOM contract

Emitted by `renderer.js` via `createElement`/`textContent` only. Indentation shows nesting.

```
.reveal                                    (reveal.js root — do not restyle internals)
  .slides
    section.qbe-stage                      one slide; the whole game lives here
      header.qbe-scorebar                  present only when scoring.model !== "none"
        .qbe-team[data-active][data-team]  one per team; data-team is its zero-based index
          button.qbe-team-name             a BUTTON: pressing it marks the active team (aria-pressed)
          .qbe-team-score
          .qbe-team-controls
            button.qbe-btn[data-action]    "score-down" then "score-up"; labelled with the amount
      main.qbe-board[data-layout]          --qbe-column-count set as an inline custom property
        .qbe-column
          h2.qbe-column-label              omitted when the column has no label
          button.qbe-cell[data-state][data-cell][data-bonus][data-locked]
            .qbe-cell-text                 face text; a bingo term, or a REVEALED feud answer
            .qbe-cell-value                the point value; absent when the cell has none
            .qbe-cell-mark                 the mark surface (bingo); always present, usually empty
      .qbe-detail[hidden][data-phase]      the opened-cell overlay
        .qbe-detail-prompt
        .qbe-detail-answer[hidden]
        .qbe-detail-actions
          button.qbe-detail-next
          button.qbe-detail-close
      aside.qbe-wins[hidden]               present only when winCondition === "pattern-complete";
                                          hidden until the first pattern completes (v1.5)
        .qbe-win[data-pattern]             one per completed pattern, in completion order
      footer.qbe-toolbar                   ALWAYS present, scoring or not; last NON-OVERLAY child
                                          of the stage (a setup overlay may be appended after it)
        button.qbe-btn[data-action]        "teams", "export", "import" — "teams" is ABSENT when the
                                          game type has no scoring (nowhere to show a team)
        input.qbe-file[hidden]             the file picker Import opens; never visible
      .qbe-setup[data-screen]              overlay: "teams" or "resume". REMOVED when dismissed,
                                          never [hidden] (v1.6). "resume" is pre-game only, but
                                          "teams" reopens over a drawn board from the toolbar
        .qbe-setup-panel
          h2.qbe-setup-title
          p.qbe-setup-note                 omitted when there is nothing to explain
          .qbe-setup-body
            label.qbe-field                data-screen="teams": one per team box
              input.qbe-field-input
            .qbe-session[data-session]     data-screen="resume": one per saved session
              .qbe-session-title
              .qbe-session-meta            date and team count
              button.qbe-btn[data-action]  "resume" (only when the session matches this game), "discard"
          .qbe-setup-actions
            button.qbe-btn[data-action]    "add-team"/"start"/"cancel", or "new"

.qbe-live                                  ARIA live region on <body>, OUTSIDE .reveal — see §5.9

#qbe-startup                               THE STARTUP PICKER (F11/F12), OUTSIDE .reveal — see below
  .qbe-setup[data-screen="startup"]        the same setup shell as above, same panel/title/note/body
    .qbe-setup-panel
      h2.qbe-setup-title
      p.qbe-setup-note
      .qbe-setup-body
        fieldset.qbe-startup-games         the board choice; a real radio GROUP
          legend.qbe-startup-legend
          .qbe-startup-choice              one per game in /games/games.json
            input.qbe-startup-radio        type="radio", name="qbe-game"; data-file is the filename
            label.qbe-startup-label
        .qbe-startup-theme                 the look choice
          label.qbe-startup-label
          select.qbe-startup-select        first option is "use this game's theme", value ""
      .qbe-setup-actions
        button.qbe-btn[data-action]        "begin"
```

**The startup screen is the one screen drawn OUTSIDE `.reveal`**, and a theme author needs to know
why before styling it. Spec §5 promises that reveal is not initialised until a bundle validates; at
the moment this screen is up no game has been chosen, so there is no bundle to validate. It
therefore mounts in `#qbe-startup` in the shell, as a sibling of `.reveal` and `#qbe-error`.

Two consequences for a theme:

1. **It is drawn before any theme is selected**, so it is styled by `themes/default.css` alone. A
   theme may restyle it — the classes above are contract like any others — but must not *depend* on
   being loaded in time to do so. Anything essential to reading this screen has to survive the base
   layer.
2. **It reuses `.qbe-setup*` wholesale.** Only the seven `.qbe-startup-*` classes are new. A theme
   that already styles the resume and team screens gets this one mostly for free, which is the
   intent — three pre-game screens that look like each other.

**Guarantees a theme may rely on:**

- Every cell is a real `<button>`. Keyboard focus, `:focus-visible`, and screen-reader semantics
  come from the platform (plan Q12). A theme must not remove the focus ring without replacing it.
- Cell state lives in `data-state`, never in a class. One attribute, one source of truth.
- `.qbe-board` always exists, even for `ranked-list`; layout differences are expressed by
  `data-layout`, not by different element names.
- Text content is never empty-but-meaningful: if a value is absent, the element is absent.
- **A `.qbe-column` is a CATEGORY on a grid board and a ROUND on a ranked list** (`D17`). Same
  element, same class, different meaning — which is why the renderer, not the theme, decides
  visibility. Every column carries `data-round="<index>"` on every layout. On `ranked-list` the
  board additionally carries `data-round-active` and `data-round-count`, and **every column except
  the active one is `hidden` and `inert`**, set by the renderer.
- **Do not un-hide a round from CSS.** `[hidden] { display: block }` is legal CSS and would put the
  inactive rounds back on screen — but they stay `inert`, so their cells would be visible and
  unclickable, and the room would be looking at the answers to a round nobody can play. Style
  `[data-round]` freely; leave visibility alone.
- **A cell never prints its QUESTION on the face; it may print its ANSWER.** A jeopardy cell's
  `prompt` is the question and appears only in `.qbe-detail`. A bingo square's `prompt` is its
  term, not a question, so it is on the card from the first paint. A **revealed** feud row prints
  its `answer` in `.qbe-cell-text` AND its points in `.qbe-cell-value` — the one cell that
  carries both children. A hidden feud row prints neither, so the reveal is not spoiled.
- **Amended by `D14`** (2026-09-01). The rule here used to read *"`.qbe-cell-text` and
  `.qbe-cell-value` are mutually exclusive… never both"*, and a revealed feud row therefore
  printed the number `38` and no answer at all, with its accessible name announcing "answer
  shown". Themes need no change: `.qbe-board[data-layout="ranked-list"] .qbe-cell` was already
  `flex-direction: row; justify-content: space-between`, a two-child layout waiting for a
  second child. **DOM order is load-bearing on a ranked list**: text first (left), value second
  (right).
- **`.qbe-stage`'s `display` belongs to the renderer, not to a theme.** reveal.js writes it as an
  inline style from `REVEAL_CONFIG.display` (`flex`), so a theme's `display` on that element is
  inert. Style the stage's `flex-direction`, `gap`, `padding` and children freely; do not expect to
  change it into a grid.

- **Every control is a real `<button>`**, including the score controls, the toolbar and both
  pre-game screens. The only non-button controls are `input.qbe-field-input` (a team name) and
  `input.qbe-file` (the import picker, permanently `hidden` and opened by a button beside it).
- **`.qbe-btn` is one class with an attribute variant**, deliberately mirroring `data-state` on a
  cell: one rule styles every button in the product, and `[data-action="score-up"]` narrows it when
  a particular button needs more. The `data-action` values are a closed set — `score-up`,
  `score-down`, `teams`, `export`, `import`, `add-team`, `start`, `cancel`, `resume`, `discard`,
  `new`, `begin` — so a selector against one of them cannot silently stop matching. `begin` is the
  startup picker's Start button and is deliberately NOT `start`: the team-setup screen already owns
  that name, and two screens answering to one action is how a selector ends up matching the wrong
  button.
- **The award buttons carry an amount, not a glyph.** They read `+200` / `−200` (U+2212, not a
  hyphen), and the number is the cell currently in play *including* the F7 bonus multiplier. Before
  any cell has been opened they are `disabled`. Size the button for four characters, not one.
- **`.qbe-scorebar` can legitimately be empty** — a host may start with no teams and add them from
  the toolbar later. `default.css` hides it with `:empty`; do not undo that.

**Not guaranteed** — do not depend on it: element order beyond what is shown, whitespace text
nodes, `:nth-child` positions of cells (columns are ragged in jeopardy), or anything inside
`.reveal` that this table does not name.

## 3. State attributes

| Attribute | Values | On |
|---|---|---|
| `data-state` | `hidden` `revealed` `answered` `marked` | `.qbe-cell` |
| `data-bonus` | `true` (absent otherwise) | `.qbe-cell` — a randomization winner (spec §8) |
| `data-locked` | `true` (absent otherwise) | `.qbe-cell` — `flags.lockValue` |
| `data-animate` | `true` (absent otherwise) | `.qbe-cell` — this cell moved at runtime (§8) |
| `data-layout` | `grid` `ranked-list` | `.qbe-board` |
| `data-animation` | `flip` `zoom` `fade` | `.qbe-stage` |
| `data-phase` | `prompt` `answer` | `.qbe-detail` |
| `data-active` | `true` (absent otherwise) | `.qbe-team` — the team the host marked, for the room |
| `data-reduced-motion` | `true` (absent otherwise) | `<html>` |
| `data-screen` | `teams` `resume` | `.qbe-setup` |
| `data-action` | the closed set in §2 | `.qbe-btn` |
| `data-pattern` | `row` `column` `diagonal` `full-card` | `.qbe-win` — which line completed (v1.5) |
| `data-team` | a zero-based index | `.qbe-team` — identity, not state; do not style on it |
| `data-session` | a zero-based index | `.qbe-session` — identity, not state; do not style on it |
| `data-delta` | a signed integer, e.g. `400` / `-400` | `.qbe-btn` in the score bar — the award amount (v1.6); identity/plumbing, not state; do not style on it |

`data-active` is a **marker, not a turn lock** (plan Q4: one projected screen, one operator, no
notion of whose click is allowed). It is also the one state attribute that is NOT persisted: spec
§4.4's state shape has no field for it, so it resets on reload, by design.

`data-bonus` is set only after randomization runs, and only for value-altering bonuses on cells
that are not `data-locked` (spec §8). A theme should style it as an *invitation*, not a spoiler —
it is visible to the room.

`data-animate` (v1.4) is **not a state** — it is the marker that a state change happened *on this
screen*, and it is the only thing that distinguishes a cell the host just revealed from a cell that
was built `answered` by a resumed session or built terminal by `preMarked`. It appears only from
`updateBoard`, never from the initial build, and once set it stays set for the life of the page. Use
it to gate motion; never use it to carry appearance, because a cell looks the same whether it was
revealed a moment ago or restored from a session.

## 4. Token reference

Every token has a default in `themes/default.css`. A theme may override any subset; unset tokens
fall back. **A theme that sets only colors is a valid theme.**

**How the fallback actually arrives** (added in v1.1, because the promise above is only true if it is
written down): `index.html` links `themes/default.css` as a static `<link id="qbe-theme-base">`
*before* the `<link id="qbe-theme">` slot the renderer fills with the selected theme. So
`default.css` is ALWAYS loaded — it is the token fallback layer *and* the structural layer (grid,
cell, overlay, focus, the three animations) — and every other theme is an override sheet stacked on
top of it, never a replacement for it. See §7.

### Surface

| Token | Role |
|---|---|
| `--board-bg` | page/stage background (**spec-named**) |
| `--board-fg` | default text color on the board |
| `--board-gap` | gutter between cells and columns |
| `--board-pad` | padding inside the stage |

### Cells

| Token | Role |
|---|---|
| `--cell-bg` | resting cell background (**spec-named**) |
| `--cell-text` | resting cell text (**spec-named**) |
| `--cell-border` | full border shorthand |
| `--cell-radius` | corner radius |
| `--cell-shadow` | resting shadow. Substituted only as a WHOLE `box-shadow` value, never as one item in a list (v1.6), so `none` is legal and safe here |
| `--cell-hover-bg` | hover/focus background |
| `--cell-revealed-bg` / `--cell-revealed-text` | `data-state="revealed"` |
| `--cell-revealed-accent` | the revealed panel's 4px inset ring **and**, by default, its point value. Defaults to `var(--accent)`. Set this when the accent that passes against `--board-bg` fails against the revealed panel — which is common, because the revealed panel is usually the lightest surface in the theme |
| `--cell-revealed-value-color` | the revealed panel's point value alone. Defaults to `var(--cell-revealed-accent)`. Use it when the ring is fine and only the number needs re-measuring |
| `--cell-answered-bg` / `--cell-answered-text` | `data-state="answered"` — spent, must read as spent |
| `--cell-answered-border` | full border shorthand for the spent rim. Separate from `--cell-border` because the answered fill deliberately sits near the ground's luminance, so this rim is the only thing keeping the button findable (§5.7) — and its contrast has to be re-measured against a different background than the resting rim was |
| `--cell-marked-bg` / `--cell-marked-text` | `data-state="marked"` (bingo) |
| `--cell-mark-glyph-color` | color of the bingo mark |
| `--cell-bonus-outline` | outline for `data-bonus="true"` |
| `--cell-min-height` | floor on cell height; keeps a 12×12 board from collapsing |

### Typography

| Token | Role |
|---|---|
| `--font-body` | body/UI stack. **System or data-URI fonts only** — see §6 |
| `--font-display` | values and column labels |
| `--value-size` | point-value font size (use `clamp()`; boards vary 1–12 columns) |
| `--value-color` | point-value color |
| `--cell-text-size` | `.qbe-cell-text` font size — a whole term, not 3 digits, so cap it lower than `--value-size` |
| `--column-label-bg` / `--column-label-text` / `--column-label-size` | column header |

**Column-label typography is deliberately NOT tokenised** (case, tracking, rule, weight). It was
proposed in v1.2 review and declined on the evidence: all five themes do override
`.qbe-column-label`, but not for the same reasons and not to the same ends — three set it uppercase
and one (chalkboard) explicitly refuses to, because uppercase fights its handwriting face; three
turn the label into a kicker with a bottom rule and `border-radius: 0` while marquee keeps the
filled tab and draws a full 1px box around it; tracking runs 0.07/0.08/0.09em and weight 400/600/700.
A `column-label-transform` / `column-label-border` pair would have deleted **zero** class
overrides — every theme would still be overriding the rule for the padding, radius, tracking and
weight it also changes. That is the test a candidate token has to pass: it earns its place by
removing a rule, not by moving one declaration out of it.

### Detail overlay

| Token | Role |
|---|---|
| `--detail-bg` / `--detail-text` | overlay surface |
| `--detail-scrim` | backdrop behind the overlay |
| `--prompt-size` | prompt text size — **the back-of-the-room number**; see §5 |
| `--answer-color` | answer text, after reveal |
| `--detail-close-color` | the Close button's label. Defaults to `var(--board-bg)`, which is right on a light-ground theme and wrong on a dark one: the label sits on `--detail-scrim`, not on `--detail-bg`, so the correct colour inverts with the ground |
| `--detail-close-border` | full border shorthand for the same button. Defaults to `2px solid var(--board-bg)` |

### Score bar

| Token | Role |
|---|---|
| `--score-bg` / `--score-text` | bar surface |
| `--team-active-outline` | outline for `data-active="true"` |
| `--team-active-bg` | **New in v1.6.** Inner tint for the same row, the second of its two cues. Defaults to `rgba(255, 212, 94, 0.14)`. Keep it an alpha tint — it sits over whatever `--score-bg` you set |

### Win rail (new in v1.5)

| Token | Role |
|---|---|
| `--win-bg` | fill of a `.qbe-win` chip. Defaults to `var(--accent)` |
| `--win-text` | its label. Defaults to `var(--accent-contrast)`, which is already measured against the accent |

The rail reuses `--cell-radius`, `--font-display` and `--column-label-size`, so a theme that styled
its labels has a styled rail already. Two tokens rather than five for the reason §4 gives
throughout: a token earns its place by removing rules, and the fill/label pair is the only part a
different palette has to re-measure.

### Chrome buttons (new in v1.3)

| Token | Role |
|---|---|
| `--btn-border` | full border shorthand for `.qbe-btn`. Defaults to `2px solid var(--accent-contrast)` |

`.qbe-btn` otherwise reuses `--accent` (fill), `--accent-contrast` (label), `--cell-radius` and
`--font-body`, so a theme that set those already has styled buttons for free. `--btn-border` is the
one thing that could not be reused, and the reason is measurable rather than aesthetic: the button's
**boundary** needs 3:1 against whatever is behind it, and the same accent fill sits on two different
grounds — in `default.css` it measures 5.36:1 against `--board-bg` (the toolbar and the setup panel:
passes on the fill alone) but only 2.83:1 against `--score-bg` (the score bar: fails). One rim colour
in a token resolves both, and a palette whose accent lands the other way round re-measures it in one
place instead of in four rules. That is the same bar every other token here had to clear: it earns
its place by removing rules, not by moving a declaration out of one.

The setup and resume screens reuse the overlay tokens (`--detail-bg`, `--detail-text`,
`--detail-scrim`) on purpose — they are the same kind of surface, they are never on screen at the
same time as `.qbe-detail`, and giving them a parallel token set would have doubled the palette a
theme author has to measure for no visual gain.

### Accent, focus, motion

| Token | Role |
|---|---|
| `--accent` | primary accent (**spec-named**) |
| `--accent-contrast` | text color guaranteed legible **on** `--accent` |
| `--focus-ring` | `outline` shorthand for `:focus-visible` |
| `--anim-duration` | one duration for all animations. Set to `0s` to disable |
| `--anim-easing` | shared easing |

## 5. Non-negotiables for a theme

These are not style preferences. A theme violating one will be rejected in review.

1. **WCAG 2.1 AA contrast** — 4.5:1 for body text, 3:1 for large text (the point values and
   prompt qualify as large). This is a projected game read from across a room; contrast is
   function, not polish.
2. **`--prompt-size` stays legible at distance.** The prompt is the single most-read text in the
   product. Do not shrink it for elegance.
3. **`answered` must read as spent** at a glance, from the back of the room, without relying on
   color alone — a host mid-game needs to see what is left. Change lightness or opacity, not just
   hue. Roughly 8% of men have a color vision deficiency; a red/green "spent" cue fails them.
4. **Never remove focus visibility.** Replace `--focus-ring`, don't delete it.
5. **Honor `prefers-reduced-motion`.** The renderer sets `data-reduced-motion="true"` on `<html>`
   and the shipped animations already check the media query. A theme adding its own motion must
   guard it too (spec §8).
6. **No external network requests.** No `@import`, no `url()` pointing at another host, no
   web-font CDN. Spec §2.3 makes the app offline-capable and supply-chain-safe, and a single
   remote font would break both. System font stacks or a data-URI font — and mind the file size.
7. **No layout traps.** Do not `position: fixed` the board, set `overflow: hidden` on the stage,
   or `display: none` anything structural. Hiding a cell desynchronizes the board from the state
   file, and a host cannot recover a cell they cannot see.
8. **Wide content scrolls in its own box**, never the page body.
9. **Never unhide `.qbe-live`.** It is the ARIA live region the renderer announces score changes
   into — the only feedback a screen-reader host gets when a number they are not focused on changes.
   `default.css` hides it with a 1px clipped box rather than `display: none`, because
   `display: none` takes it out of the accessibility tree and the announcement stops happening
   entirely. Restyling it visible would paint duplicate score text across a projected board.
10. **Keep the host controls hittable.** `.qbe-btn` is operated by someone standing up, mid-sentence,
    in front of a room. Do not shrink it below roughly a 44px target, and do not reduce the
    `disabled` state to a colour change alone (the award buttons are disabled until a cell is
    opened, and that has to be legible as "not yet", not as "broken").

## 6. What a theme cannot do, by design

No JavaScript. No markup. No URLs to other origins. No new tokens the renderer reads — a token a
theme invents is inert unless the renderer already consumes it. Themes **select and restyle**; they
never define behavior. This mirrors spec §4.2's rule for game-type configs, for the same reason:
data that can act is data that can be weaponized.

Spec §4.3 is blunt about the residual risk: **adding a theme means trusting its author.** CSS can
still be hostile in ways CSS review catches and code cannot — hiding content, misleading states,
absurd sizes. Themes ship reviewed, not merely validated.

## 7. Loading

Two `<link>` elements, in this order:

1. `<link id="qbe-theme-base" rel="stylesheet" href="themes/default.css">` — static in `index.html`.
   The base layer, always present, never selected by data. Not a manifest lookup: an author-written
   constant in the shell, exactly like the vendored reveal stylesheets.
2. `<link id="qbe-theme">` — created by `renderer.mountTheme()` after the validator has resolved the
   content file's theme NAME against the manifest. This is the selected theme, and it overrides (1).

`themes/themes.json` maps a name to a **bare filename** resolved under `/themes/`. The schema pins
values to `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.css$` — no paths, no URLs, no traversal. Only manifest
entries ever load (spec §6.4). An unknown `theme` in a content file is a validation error with a
real message, never a silent fallback to default.

## 8. Animations (F5)

Three shipped: `flip`, `zoom`, `fade`, selected by the content file's `animation` field and
exposed as `data-animation` on `.qbe-stage`. They live in the theme layer as CSS transitions and
keyframes keyed off `data-state` changes, so a theme can restyle them via `--anim-duration` and
`--anim-easing` without touching JS.

**Every cell-level animation selector must also require `[data-animate="true"]`** (v1.4), e.g.

```css
.qbe-stage[data-animation="flip"] .qbe-cell[data-animate="true"][data-state="revealed"] { … }
```

`data-state` alone matches a resumed or `preMarked` board on its first painted frame, which starts
the whole board's reveal animation at load — 288 running animations on a maxed 12×12 board, measured.
The renderer writes `data-animate` only on a runtime transition, so the gate costs a theme one
attribute selector and buys the promise that motion means *something just happened*. Overlay and
`.qbe-detail-answer` animations need no gate: the overlay is `hidden` at build time.

`prefers-reduced-motion: reduce` collapses every animation to an instant state change. Not
shortened — removed. The state change must still be perceivable.

-----
2026-08-17 (v1.6)
