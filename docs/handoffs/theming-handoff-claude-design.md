# Handoff — Quiz Board Engine theming

**To:** Claude Design
**From:** Marty (maintainer) · prepared 2026-08-17
**Deliverable requested:** visual direction plus one or more drop-in CSS themes.

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
built now, and the two shipped themes (`default`, `midnight`) are baseline reference
implementations, not a style to extend. You have real latitude on direction. The error screen has
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
        .qbe-team[data-active]
          .qbe-team-name
          .qbe-team-score
      main.qbe-board[data-layout]          --qbe-column-count is set inline
        .qbe-column
          h2.qbe-column-label              omitted when the column has no label
          button.qbe-cell[data-state][data-cell][data-bonus][data-locked]
            .qbe-cell-value                point value; empty for bingo
            .qbe-cell-mark                 mark surface for bingo; usually empty
      .qbe-detail[hidden][data-phase]      opened-cell overlay
        .qbe-detail-prompt
        .qbe-detail-answer[hidden]
        .qbe-detail-actions
          button.qbe-detail-next
          button.qbe-detail-close
```

**Every cell is a real `<button>`.** Focus behavior and screen-reader semantics come from the
platform. You may restyle `:focus-visible`; you may not remove it.

### State attributes

| Attribute | Values | Where | Notes |
|---|---|---|---|
| `data-state` | `hidden` `revealed` `answered` `marked` | `.qbe-cell` | The core visual states |
| `data-bonus` | `true` / absent | `.qbe-cell` | A randomly chosen bonus cell. **Visible to the room** — style it as an invitation, not a spoiler |
| `data-locked` | `true` / absent | `.qbe-cell` | Point value can't be altered. Usually needs no visual treatment |
| `data-layout` | `grid` `ranked-list` | `.qbe-board` | Jeopardy/bingo vs. Feud |
| `data-animation` | `flip` `zoom` `fade` | `.qbe-stage` | Chosen per game file |
| `data-phase` | `prompt` `answer` | `.qbe-detail` | Overlay shows question, then answer |
| `data-active` | `true` / absent | `.qbe-team` | Whose turn, as marked by the host |
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

Set any subset. Unset tokens fall back to `default.css`. **A theme that changes only colors is a
completely valid theme.** Full detail with roles is in `docs/plans/theme-contract.md`, included
alongside this handoff.

**Surface:** `--board-bg`◆ `--board-fg` `--board-gap` `--board-pad`

**Cells:** `--cell-bg`◆ `--cell-text`◆ `--cell-border` `--cell-radius` `--cell-shadow`
`--cell-hover-bg` `--cell-revealed-bg` `--cell-revealed-text` `--cell-answered-bg`
`--cell-answered-text` `--cell-marked-bg` `--cell-marked-text` `--cell-mark-glyph-color`
`--cell-bonus-outline` `--cell-min-height`

**Type:** `--font-body` `--font-display` `--value-size` `--value-color` `--column-label-bg`
`--column-label-text` `--column-label-size`

**Detail overlay:** `--detail-bg` `--detail-text` `--detail-scrim` `--prompt-size` `--answer-color`

**Score bar:** `--score-bg` `--score-text` `--team-active-outline`

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
   state change must still be perceivable without the animation.
6. **No layout traps.** Don't `position: fixed` the board, `overflow: hidden` the stage, or
   `display: none` anything structural. A hidden cell desynchronizes the board from the saved
   state file, and a host can't recover a cell they can't see.
7. **Wide content scrolls in its own box**, never the page body.
8. **Light and dark both handled.** Either commit to one look deliberately and say so, or provide
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

Naming: pick real names. `default` and `midnight` are taken.

---

## 7. Bundle with this handoff

- `docs/plans/theme-contract.md` — the normative contract, longer and more precise than §3–§4 here
- `themes/default.css` — the baseline reference implementation with every token defaulted
- `themes/midnight.css` — a second implementation, to show the intended amount of variation
- `games/demo.json` — a real 5×5 Jeopardy board, if you want representative content lengths

To see it running: clone the repo, `python3 -m http.server 8000` from the root, open
`http://localhost:8000/`. It needs an HTTP origin — `file://` blocks ES modules and JSON fetches,
which looks like a broken app but isn't.

Repo: https://github.com/martin-gleason/quiz-board-engine
