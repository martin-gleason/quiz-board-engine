# Handoff — Quiz Board Engine theming

**To:** Claude Design
**From:** Marty (maintainer) · prepared 2026-08-17 · revised 2026-08-17 · **contract v1.6**
**Deliverable requested:** visual direction plus one or more drop-in CSS themes.

> ## ⚠ CONTRACT v1.6 — A BUG IN OUR BASE LAYER COST YOU A RING. READ ITEM 1.
>
> Additive and corrective. Nothing renamed, nothing removed. A v1.5 theme still renders — but if
> yours sets `--cell-shadow: none`, it has been silently losing the revealed cell's accent ring, and
> that is our fault, not yours.
>
> **1. `--cell-shadow` was being composed into a shadow LIST, and `none` broke the whole list.**
> `default.css` drew the revealed cue as
> `box-shadow: inset 0 0 0 4px var(--cell-revealed-accent), var(--cell-shadow)`. `none` is a legal
> whole box-shadow value but is **not** a legal item *inside* a list, so setting it made that entire
> declaration invalid at computed-value time — and an invalid declaration computes to `unset`, which
> for `box-shadow` is `none`. The theme lost the resting shadow it meant to lose **and the 4px accent
> ring it never asked to lose**. Our own `civic` dark scheme was hit: hidden → revealed came down to
> a 1.13:1 fill difference, and with `prefers-reduced-motion` on there was no static cue at all.
> Two of your themes had already found the hazard the hard way and worked around it by restating the
> property; that is why they were unaffected.
>
> **We fixed the composition, not the themes.** There is no CSS mechanism that makes an arbitrary
> value safe inside a list — a `var()` fallback fires only when the property is *unset*, and
> invalidity cannot be caught — so the ring is now declared on its own:
>
> ```css
> .qbe-cell[data-state="revealed"] { box-shadow: inset 0 0 0 4px var(--cell-revealed-accent); }
> ```
>
> **What this changes for you.** `--cell-shadow: none` is now a supported, safe thing to write, and
> the ring is unconditional in every theme. The trade is that a revealed cell no longer inherits your
> resting drop shadow — if you want a lit or raised open panel, restate `box-shadow` yourself with
> your own layers (our `marquee` theme does exactly that and is the model). Everywhere else,
> `--cell-shadow` is substituted as a whole value, where `none` has always been fine.
>
> **2. New token: `--team-active-bg`** (default `rgba(255, 212, 94, 0.14)`). The inner tint on the
> active team's row, the partner to `--team-active-outline`. It should have been a token from the
> start: **all four** of the shipped override sheets carried the identical one-declaration rule to
> restate it, which is precisely the evidence §6 asks us to act on. Tokenising it deleted four whole
> rules. Keep it an alpha tint — it sits over whatever `--score-bg` you choose.
>
> **3. `data-delta` is now in the attribute table.** The renderer has always written it on the score
> bar's `+`/`−` buttons; it was missing from the published set, so the "closed" list was not closed.
> It carries the award AMOUNT. Treat it like `data-team`: identity/plumbing, never a styling hook.
>
> **4. Two corrections to the DOM shape below, both of which were wrong in v1.5.**
> `.qbe-setup` never carries `[hidden]` — the setup screens are removed from the DOM outright, unlike
> `.qbe-detail` and `input.qbe-file`, which really do use `[hidden]`. If you wrote
> `.qbe-setup[hidden] { display: none }`, it has never matched anything; delete it.
> And the `"teams"` screen is **not** gone once play starts: the toolbar's Teams… button reopens it
> over a fully drawn board. It is appended to the stage at that point, so `.qbe-toolbar` is the last
> **non-overlay** child, not unconditionally the last child — please do not target
> `.qbe-stage > :last-child`.
>
> **5. One behaviour note.** While a setup screen is up, every other child of the stage is marked
> `inert`: removed from the tab order and the accessibility tree so a keyboard host cannot reach the
> board through your scrim. It is not hidden, so your scrim still decides what is *seen*.

> ## ⚠ CONTRACT v1.5 — ONE NEW ELEMENT ON THE BINGO BOARD. SMALL, BUT IT IS YOURS TO STYLE.
>
> Additive: nothing renamed, nothing removed, no existing token changed. A v1.4 theme still renders
> correctly everywhere — except that on a **bingo** board one new element will be wearing the base
> layer's clothes.
>
> **Bingo can now be won.** When a row, a column, a diagonal or the full card is completely marked,
> the app announces it — visibly to the room and through the live region to a screen reader.
>
> **New DOM:**
>
> ```
> aside.qbe-wins[hidden]        only on a game type that can be won by a pattern (bingo today)
>   .qbe-win[data-pattern]      one chip per completed pattern, in completion order
> ```
>
> It sits between the board and the toolbar, in the stage's normal column flow, and is `hidden`
> until the first pattern completes. `data-pattern` is `row` | `column` | `diagonal` | `full-card`,
> so a full card can look different from a row if you want it to.
>
> **New tokens: `--win-bg`, `--win-text`.** They default to `var(--accent)` and
> `var(--accent-contrast)`, so if you set the accent pair you already have a styled rail. Set them
> when your accent reads badly as a filled chip on your board ground.
>
> **The one hard rule: do not position the rail over the board.** A win is an announcement, not a
> modal. The host adjudicates and the room keeps playing for second and third place, so the rail
> must never cover a cell someone still has to reach. Chips, a strip, a ribbon along the bottom —
> all fine. An overlay, a banner across the middle, or anything `position: fixed` — not fine.
>
> It reuses `--cell-radius`, `--font-display` and `--column-label-size`, which is why it is two
> tokens rather than five.

> ## ⚠ CONTRACT v1.4 — IF YOU WRITE KEYFRAMES, ONE SELECTOR CHANGE IS REQUIRED.
>
> Small and additive — no token changed, no element was renamed — but it changes how you must write
> a cell animation, so please read it before you touch motion.
>
> **New attribute: `data-animate="true"` on `.qbe-cell`.** It means *this cell just moved on this
> screen*. The renderer sets it only when a state actually changes at runtime; a cell that was
> *built* in a spent state never gets it.
>
> **Why we needed it.** Sessions are saved and resumed, and a bingo card's free squares start
> already marked. Both cases build cells straight into `answered`/`marked`, so a selector keyed on
> `data-state` alone matched on the first painted frame: resuming a played-out 12×12 board started
> 288 animations at once, and a bingo card played its free-square mark animation at load. Motion
> was announcing "a page opened" instead of "something happened".
>
> **What you do:** add `[data-animate="true"]` next to the `[data-state=…]` in every cell animation
> selector.
>
> ```css
> .qbe-stage[data-animation="flip"] .qbe-cell[data-animate="true"][data-state="revealed"] { … }
> ```
>
> Overlay animations (`.qbe-detail`, `.qbe-detail-answer`) need no gate — the overlay is `hidden`
> at build time and can only be opened by a click. `themes/default.css` §9 already ships this way;
> the other four themes define no keyframes and were untouched.

> ## ⚠ CONTRACT v1.3 — NEW DOM, AND IT AFFECTS YOUR WORK. READ THIS BEFORE YOU DESIGN.
>
> The previous two revisions were "here are some tokens you asked for". This one is different:
> **the app grew screens and controls that v1.2 gave you no way to style.** A theme written against
> v1.2 still renders correctly, but parts of the screen will be wearing the base layer's clothes.
>
> Sessions, teams, scoring and export/import shipped (features F6, F7, F10). Concretely, the host
> now has: **award/deduct buttons inside each team on the score bar**, a **team-name button** that
> marks whose turn it is, an **always-present toolbar** (Teams… / Export / Import) at the bottom of
> the stage, and a **pre-game overlay** used twice — once to create the teams at the start of a
> session, once to offer "resume or discard?" when the browser already has a saved game.
>
> **The additions, all in §3 below:**
> 1. `.qbe-team` gains `data-team="<index>"`. `.qbe-team-name` is now a **`<button>`** carrying
>    `aria-pressed` (it marks the active team), and a new `.qbe-team-controls` holds the buttons.
> 2. **`button.qbe-btn[data-action]` — one class for every control in the product**, varied by
>    attribute exactly the way a cell varies by `data-state`. This is the single most important new
>    thing to style: it appears on the score bar, the toolbar, and both pre-game screens. Style
>    `.qbe-btn` once, then narrow with `[data-action="score-up"]` only where you need to.
> 3. `footer.qbe-toolbar` — last child of the stage. Present even for bingo, which has no score bar.
> 4. `.qbe-setup[hidden][data-screen="teams"|"resume"]` — the pre-game overlay, with its own panel,
>    title, note, body and actions, plus `.qbe-field` / `.qbe-field-input` (a team name box) and
>    `.qbe-session` / `.qbe-session-title` / `.qbe-session-meta` (a saved-session row). It reuses the
>    **overlay** tokens (`--detail-bg`, `--detail-text`, `--detail-scrim`) rather than getting a
>    parallel set, because it is the same kind of surface and is never on screen at the same time.
> 5. `.qbe-live` — an ARIA live region on `<body>`. **Not a design surface: leave it hidden.** It is
>    how a screen-reader host hears a score change they are not focused on.
>
> **One new token: `--btn-border`**, a full border shorthand for `.qbe-btn` (default
> `2px solid var(--accent-contrast)`). It exists because the button's *boundary* needs 3:1 against
> whatever is behind it, and the same `--accent` fill sits on two grounds: in `default.css` it
> measures 5.36:1 on `--board-bg` (fine on the fill alone) but 2.83:1 on `--score-bg` (not fine).
> If your accent lands the other way round, this is the one place to fix it.
>
> **What to check first in your existing themes:** `.qbe-btn` against your palette, on BOTH the
> score bar ground and the board ground. Everything else inherits sensibly.

> **Contract version: v1.2 (superseded by the v1.3 note above).** The renderer is built and five themes now ship, so everything below
> describes DOM that actually ships rather than DOM that is planned.
>
> **What changed since v1.1 — five new tokens, and they came from your findings.** Three of the
> five things the civic/chalkboard/marquee rationale listed under "what the tokens couldn't
> express" were adopted verbatim and are now tokens: `--cell-answered-border`,
> `--cell-revealed-accent` (plus a narrower `--cell-revealed-value-color`), and
> `--detail-close-color` / `--detail-close-border`. All five are folded into §4 below. Everything
> is additive — no token was renamed or removed, and each new one defaults to exactly what
> `default.css` produced before, so a theme written against v1.1 still renders identically.
>
> **One finding was declined:** column-label typography (`text-transform` / the label rule) stays a
> class override. The evidence is in §4. Reporting it was still the right call — see §6.4.
>
> v1.1's additions, still current: the `.qbe-cell-text` element, the `--cell-text-size` token, and
> the written rule that `themes/default.css` is always loaded underneath your theme (§3, §4, §8).

---

## 0. Read this part first — how we're working together

**Marty is doing some of this work himself, in hand-written CSS and vanilla JavaScript.**
He is not looking for a finished thing to accept or reject. Treat this as a collaboration with a
developer who will be editing your output directly, and:

- **Give him CSS he can read and change.** Plain, commented, hand-editable. Group rules by the
  thing they style, in the order the tokens are listed here.
- **Explain the choices, not just the values.** "Answered cells drop to 40% lightness so a spent
  cell reads as spent from the back of a room" is useful. A bare hex value is not — he will need
  to derive the next one himself.
- **Do not restructure, abstract, or "improve" the token names or the DOM.** They are pinned by a
  frozen spec (details in §2). If a token you need is missing, say so and explain what it would
  do — it may require a renderer change, which is a separate decision.
- **No preprocessors, no build step, no frameworks, no CSS-in-JS.** This project has a hard
  zero-build constraint. One `.css` file per theme, loaded directly by the browser.
- **No JavaScript in the deliverable.** Themes are CSS only. If a visual idea needs JS, describe
  it separately and Marty will decide whether to write it himself.

If you want to propose something outside these bounds, propose it in prose and let him rule on it.
Don't ship it.

---

## 1. What the product is

A zero-cost, zero-build, offline-capable static web app that turns plain JSON files into playable
quiz board games — classic Jeopardy, trivia bingo, and Family Feud-style ranked reveals. Anyone
can fork the repo, enable GitHub Pages, and edit JSON in the browser to publish their own game.
It renders through a vendored copy of Reveal.js. Licensed AGPL-3.0-or-later.

**The one thing to hold in your head while designing:** this is projected in a room and operated
by one person under mild pressure. A teacher, a trainer, a conference host. They are standing up,
the room is watching, and they are clicking cells live. Players read the board from ten to thirty
feet away, often through a mediocre projector with washed-out contrast, sometimes on a screen
share compressed to mush.

That makes legibility at distance the primary aesthetic constraint, not a checkbox after the
fact. Fine hairlines, low-contrast greys, thin weights, and small type all fail in this room. So
does anything that makes it hard for the host to see, at a glance, which cells are still in play.

**Existing look for reference:** there is none worth inheriting. The board renderer is being
built now, and the shipped themes (`default`, `midnight`, plus `civic`, `chalkboard` and `marquee`
from the first round of this collaboration) are reference implementations, not a style to extend. You have real latitude on direction. The error screen has
its own self-contained styling and is deliberately outside the theme layer — don't design for it.

---

## 2. The hard technical boundaries

These come from a frozen specification and are not negotiable in this handoff.

| Constraint | What it means for you |
|---|---|
| **Zero build** | Plain CSS. No Sass, Less, PostCSS, Tailwind, or any compile step. Native CSS custom properties and nesting-free selectors. |
| **Zero CDN / offline-capable** | **No `@import`. No `url()` to another host. No Google Fonts, no font CDN.** The app makes zero external network requests by design — one remote font breaks both the offline guarantee and the supply-chain guarantee. Use system font stacks. A data-URI font is technically allowed but weigh the page-weight cost and mention it if you use one. |
| **One file per theme** | A theme is a single `.css` file in `/themes/`, registered by name in a JSON manifest. No partials. |
| **CSS only** | No JS, no markup, no images from elsewhere. Inline SVG in a `background-image: url("data:image/svg+xml,...")` is fine and is the intended way to do a bingo mark or texture. |
| **Cross-browser** | Chrome, Firefox, and Safari must look the same. Nothing behind a flag. Check Safari support specifically — it is the usual laggard, and `@container`/`:has()` support there is newer than you may assume. |
| **Token names are fixed** | `--board-bg`, `--cell-bg`, `--cell-text`, and `--accent` are named verbatim in the frozen spec. Don't rename them or wrap them. |
| **No `!important` arms race** | The renderer sets no inline styles except one custom property for column count. You should not need `!important`; if you do, something is wrong and worth reporting. |

---

## 3. The DOM you are styling

Class names are prefixed `qbe-`. **Cell state is a `data-state` attribute, not a class** — one
source of truth, so `[data-state="answered"]` is your selector.

```
.reveal                                  Reveal.js root — do not restyle its internals
  .slides
    section.qbe-stage[data-animation]      the whole game
      header.qbe-scorebar                  omitted when the game type has no scoring
        .qbe-team[data-active][data-team]
          button.qbe-team-name             a BUTTON — pressing it marks the active team
          .qbe-team-score
          .qbe-team-controls
            button.qbe-btn[data-action]    "score-down", "score-up" — labelled "−200" / "+200"
      main.qbe-board[data-layout]          --qbe-column-count is set inline
        .qbe-column
          h2.qbe-column-label              omitted when the column has no label
          button.qbe-cell[data-state][data-cell][data-bonus][data-locked]
            .qbe-cell-value                the point value; ABSENT when the cell has none
            .qbe-cell-text                 face text; present ONLY when there is no value
            .qbe-cell-mark                 mark surface for bingo; usually empty
      .qbe-detail[hidden][data-phase]      opened-cell overlay
        .qbe-detail-prompt
        .qbe-detail-answer[hidden]
        .qbe-detail-actions
          button.qbe-detail-next
          button.qbe-detail-close
      aside.qbe-wins[hidden]               NEW in v1.5 — only when the game type can be won by a
                                           pattern (bingo); hidden until the first win
        .qbe-win[data-pattern]             one chip per completed pattern
      footer.qbe-toolbar                   ALWAYS present, scoring or not; last NON-OVERLAY child of
                                           the stage (a setup overlay can be appended after it)
        button.qbe-btn[data-action]        "teams" (only when there is a score bar), "export", "import"
        input.qbe-file[hidden]             the import file picker; never visible
      .qbe-setup[data-screen]              overlay: "teams" or "resume". REMOVED when dismissed,
                                           never [hidden] (v1.6). "resume" is pre-game only;
                                           "teams" reopens over a drawn board from the toolbar
        .qbe-setup-panel
          h2.qbe-setup-title
          p.qbe-setup-note                 omitted when there is nothing to explain
          .qbe-setup-body
            label.qbe-field                data-screen="teams" — one per team box
              input.qbe-field-input
            .qbe-session[data-session]     data-screen="resume" — one per saved session
              .qbe-session-title
              .qbe-session-meta            date and team count
              button.qbe-btn[data-action]  "resume" (only if it matches this game), "discard"
          .qbe-setup-actions
            button.qbe-btn[data-action]    "add-team"/"start"/"cancel", or "new"

.qbe-live                                ARIA live region on <body>, OUTSIDE .reveal. Leave it hidden
```

**Every control is a real `<button>`.** The only inputs are a team name (`.qbe-field-input`) and the
permanently-hidden import picker (`.qbe-file`).

**The award buttons carry an amount, not a glyph** — they read `+200` / `−200` (a real U+2212 minus,
so it has the same weight as the plus), the number is the cell in play *including* the bonus
multiplier, and they are `disabled` until a cell has been opened. Size for four characters, and make
`disabled` legible as "not yet" rather than as "broken".

**`.qbe-scorebar` can legitimately be empty** — a host may start with no teams and add them later.
`default.css` hides it with `:empty`; don't undo that.

**Every cell is a real `<button>`.** Focus behavior and screen-reader semantics come from the
platform. You may restyle `:focus-visible`; you may not remove it.

**`.qbe-cell-value` and `.qbe-cell-text` are mutually exclusive.** A cell shows a point value (a
Jeopardy cell, a Feud row) *or* face text (a bingo square) — never both. A Jeopardy cell's prompt
is the *question* and is never printed on the face; it appears only in `.qbe-detail`. So a bingo
card is 25 cells of text with no numbers anywhere, and you need to style both cases.

**`.qbe-stage`'s `display` is not yours.** Reveal.js writes it as an inline style, so a `display`
rule you put on that element is inert — it cannot win against an inline style. You can freely
style its `flex-direction`, `gap`, `padding`, and all its children; just don't try to turn the
stage itself into a grid. (`.qbe-board` *is* yours, and is where the grid lives.)

### State attributes

| Attribute | Values | Where | Notes |
|---|---|---|---|
| `data-state` | `hidden` `revealed` `answered` `marked` | `.qbe-cell` | The core visual states |
| `data-bonus` | `true` / absent | `.qbe-cell` | A randomly chosen bonus cell. **Visible to the room** — style it as an invitation, not a spoiler |
| `data-locked` | `true` / absent | `.qbe-cell` | Point value can't be altered. Usually needs no visual treatment |
| `data-animate` | `true` / absent | `.qbe-cell` | **New in v1.4.** This cell moved at runtime. Gate every cell animation on it; never use it for appearance |
| `data-layout` | `grid` `ranked-list` | `.qbe-board` | Jeopardy/bingo vs. Feud |
| `data-animation` | `flip` `zoom` `fade` | `.qbe-stage` | Chosen per game file |
| `data-phase` | `prompt` `answer` | `.qbe-detail` | Overlay shows question, then answer |
| `data-active` | `true` / absent | `.qbe-team` | Whose turn, as marked by the host. A marker, not a turn lock — and the one state that is deliberately NOT saved |
| `data-screen` | `teams` `resume` | `.qbe-setup` | Which pre-game screen is up |
| `data-action` | closed set, see §3 | `.qbe-btn` | Which control this is |
| `data-pattern` | `row` `column` `diagonal` `full-card` | `.qbe-win` | **New in v1.5.** Which line was just completed |
| `data-team` / `data-session` | a zero-based index | `.qbe-team` / `.qbe-session` | Identity, not state — don't style on it |
| `data-delta` | a signed integer, e.g. `400` / `-400` | `.qbe-btn` in the score bar | **Documented in v1.6** (always emitted). The award amount — identity/plumbing, not state; don't style on it |
| `data-reduced-motion` | `true` / absent | `<html>` | Set when the OS asks for reduced motion |

**Don't depend on** `:nth-child` positions of cells (columns are legitimately ragged in Jeopardy),
whitespace text nodes, or anything inside `.reveal` not listed above.

### Board sizes you must survive

Grid size is emergent from the JSON — there are no fixed dimensions. Validated limits are **1 to
12 columns** and **1 to 12 cells per column**, and columns may be different lengths.

Design for both ends. A 3×3 board and a 12×12 board must both work: 144 cells still need legible
point values, and 9 cells must not look like a broken layout with three enormous tiles. Use
`clamp()` on type sizes and let the grid do the work. `--qbe-column-count` is available as a
custom property on `.qbe-board` if you need it for arithmetic.

---

## 4. Token reference — the full contract

Set any subset. **A theme that changes only colors is a completely valid theme.** Full detail with
roles is in `docs/plans/theme-contract.md`, included alongside this handoff.

**How the fallback actually works — this matters for how you write your file.** `index.html` links
`themes/default.css` first, always, and then links the selected theme on top of it. So
`default.css` is not merely a set of defaults you replace: it is the **structural layer** — the
grid, the cell box, the overlay, focus styling, and all three animations — and your theme is an
**override sheet stacked over it**, never a replacement for it.

Practically: you do not need to restate layout, and you should not. Set tokens, override the
handful of classes you actually want to change, and inherit the rest. `midnight.css` deliberately
overrides only a subset to demonstrate this; read it before you start.

**Surface:** `--board-bg`◆ `--board-fg` `--board-gap` `--board-pad`

**Cells:** `--cell-bg`◆ `--cell-text`◆ `--cell-border` `--cell-radius` `--cell-shadow` (whole-value only — `none` is safe here, v1.6)
`--cell-hover-bg` `--cell-revealed-bg` `--cell-revealed-text` `--cell-revealed-accent`
`--cell-revealed-value-color` `--cell-answered-bg` `--cell-answered-text`
`--cell-answered-border` `--cell-marked-bg` `--cell-marked-text` `--cell-mark-glyph-color`
`--cell-bonus-outline` `--cell-min-height`

(New in v1.2. `--cell-answered-border` is a full border shorthand for the spent rim — it is its own
token because the answered fill deliberately sits near the ground's luminance, so that rim is the
only thing keeping the button findable, and its contrast has to be measured against a different
background than the resting rim was. `--cell-revealed-accent` colours the revealed panel's 4px
inset ring *and*, by default, the point value on it; it defaults to `var(--accent)`, and you set it
when the accent that passes against `--board-bg` fails on the revealed panel — which is common,
because that panel is usually the lightest surface in the theme. `--cell-revealed-value-color`
defaults to `var(--cell-revealed-accent)` and narrows the change to the number alone, for the case
where the ring is fine as it is.)

**Type:** `--font-body` `--font-display` `--value-size` `--value-color` `--cell-text-size`
`--column-label-bg` `--column-label-text` `--column-label-size`

(`--cell-text-size` sizes `.qbe-cell-text` — a bingo term, not three digits, so it wants a lower
cap than `--value-size`.)

**Column-label typography is deliberately not tokenised**, and that is a decision rather than an
oversight. Case, tracking, rule and weight stay yours to override on `.qbe-column-label`. The
proposal was tested against all five shipped themes and declined: three set the label uppercase and
one refuses to (uppercase fights a handwriting face); three turn it into a kicker with a bottom
rule while one keeps the filled tab inside a full box; tracking runs 0.07–0.09em and weight
400–700. A transform/border token pair would have deleted **zero** class overrides — every theme
would still be overriding the rule for the padding, radius, tracking and weight it also changes.
That is the bar a candidate token has to clear here: it earns its place by removing a rule, not by
moving one declaration out of one.

**Detail overlay:** `--detail-bg` `--detail-text` `--detail-scrim` `--prompt-size` `--answer-color`
`--detail-close-color` `--detail-close-border`

(New in v1.2. The Close button is the outline variant and its label sits on `--detail-scrim`, not
on `--detail-bg`. The default expresses it as `var(--board-bg)`, which is correct on a light-ground
theme and invisible on a dark one — the relationship inverts with the ground, which is exactly why
it needed a token.)

**Score bar:** `--score-bg` `--score-text` `--team-active-outline` `--team-active-bg`

(`--team-active-bg` is new in v1.6 — the inner tint on the active row. It defaults to
`rgba(255, 212, 94, 0.14)`; keep it an alpha tint so it works over any `--score-bg`.)

**Win rail (new in v1.5):** `--win-bg` `--win-text`

(The rail also reuses `--cell-radius`, `--font-display` and `--column-label-size`. Both new tokens
default to the accent pair, which is already measured against itself.)

**Chrome buttons (new in v1.3):** `--btn-border`

(`.qbe-btn` otherwise reuses `--accent`, `--accent-contrast`, `--cell-radius` and `--font-body`, so a
theme that set those already has styled buttons. `--btn-border` is the one thing that could not be
reused — see the v1.3 note at the top for the measurement.)

**Accent / focus / motion:** `--accent`◆ `--accent-contrast` `--focus-ring` `--anim-duration`
`--anim-easing`

◆ = named verbatim in the frozen spec; the name cannot change.

---

## 5. Non-negotiable design requirements

Not preferences. A theme violating one gets sent back.

1. **WCAG 2.1 AA contrast.** 4.5:1 for body text, 3:1 for large text (point values and the prompt
   qualify). Give us the computed ratios for your palette — don't estimate. This is a projected
   game read across a room; contrast is function.
2. **`answered` must read as spent at a glance, from the back of the room, without relying on hue
   alone.** The host needs to see what's left in play. Shift lightness or opacity, not just color.
   Roughly 8% of men have a color vision deficiency, so a red/green spent-cue fails a real slice
   of any audience.
3. **`--prompt-size` must stay legible at distance.** It's the most-read text in the product.
   Don't shrink it for elegance.
4. **Never remove focus visibility.** Restyle `--focus-ring`; don't delete it.
5. **Honor `prefers-reduced-motion`.** Shipped animations already guard themselves. If you add
   motion, guard it too — and note that reduced-motion means *removed*, not merely faster. The
   state change must still be perceivable without the animation. **And gate every cell animation on
   `[data-animate="true"]`** (v1.4) so a resumed board doesn't replay itself on load.
6. **No layout traps.** Don't `position: fixed` the board, `overflow: hidden` the stage, or
   `display: none` anything structural. A hidden cell desynchronizes the board from the saved
   state file, and a host can't recover a cell they can't see.
7. **Wide content scrolls in its own box**, never the page body.
8. **Never unhide `.qbe-live`.** It's the live region the app announces score changes into — the only
   feedback a screen-reader host gets when a number they aren't focused on changes. `default.css`
   hides it with a clipped 1px box on purpose: `display: none` would remove it from the
   accessibility tree and the announcement would stop happening at all.
9. **Keep `.qbe-btn` hittable.** It is operated by someone standing up, mid-sentence, in front of a
   room — roughly a 44px target, minimum.
10. **Light and dark both handled.** Either commit to one look deliberately and say so, or provide
   a `prefers-color-scheme` variant. Don't leave it accidental.

---

## 6. What we'd like back

1. **One or two complete themes** as single `.css` files, ready to drop into `/themes/`.
   Distinct directions are more useful than variations on one idea. Suggested but not required:
   something warm and paper-like for classroom use, and something high-contrast and saturated for
   a conference stage.
2. **A short rationale per theme** — the palette logic, the type choices, and how you got the
   `answered` state to read as spent. Written so Marty can extend it himself without guessing.
3. **The computed contrast ratios** for every text-on-background pair you use.
4. **Anything you wanted and couldn't express** with the tokens available — this is genuinely
   useful, and a missing token is a fair finding rather than a complaint. Say what it would do and
   we'll decide whether the renderer should expose it.

Naming: pick real names. `default`, `midnight`, `civic`, `chalkboard` and `marquee` are taken.

---

## 7. Bundle with this handoff

- `docs/plans/theme-contract.md` — **v1.5**, the normative contract; longer and more precise than
  §3–§4 here, and the authority if anything disagrees
- `themes/default.css` — the base layer: every token defaulted, plus all the structure and the
  three animations. Read this one first; it is written to teach the system
- `themes/midnight.css` — an override sheet that changes only a subset, to show how little a theme
  has to restate. Refactored onto v1.2: it is down from eight class overrides to five
- `themes/civic.css`, `themes/chalkboard.css`, `themes/marquee.css` — your three, refactored onto
  the v1.2 tokens with the now-redundant overrides deleted. Same computed colours; the diff is
  worth reading as the concrete answer to your findings
- `themes/theme-rationale.md` — your rationale, with an appended section recording which findings
  were adopted and which was declined
- `games/demo.json` — a real 5×5 Jeopardy board, for representative content lengths
- `games/demo-bingo.json` — a bingo card, so you can see the `.qbe-cell-text` case with no numbers

To see it running: clone the repo, `python3 -m http.server 8000` from the root, open
`http://localhost:8000/`. It needs an HTTP origin — `file://` blocks ES modules and JSON fetches,
which looks like a broken app but isn't.

Repo: https://github.com/martin-gleason/quiz-board-engine
