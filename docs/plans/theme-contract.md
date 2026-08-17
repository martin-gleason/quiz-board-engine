# Theme & display contract — v1

**Status:** NORMATIVE for F3/F4/F5. Derived from frozen spec §4.3, §6.4, §8.
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
        .qbe-team[data-active]             one per team
          .qbe-team-name
          .qbe-team-score
      main.qbe-board[data-layout]          --qbe-column-count set as an inline custom property
        .qbe-column
          h2.qbe-column-label              omitted when the column has no label
          button.qbe-cell[data-state][data-cell][data-bonus][data-locked]
            .qbe-cell-value                the point value, or empty for bingo
            .qbe-cell-mark                 the mark surface (bingo); always present, usually empty
      .qbe-detail[hidden][data-phase]      the opened-cell overlay
        .qbe-detail-prompt
        .qbe-detail-answer[hidden]
        .qbe-detail-actions
          button.qbe-detail-next
          button.qbe-detail-close
```

**Guarantees a theme may rely on:**

- Every cell is a real `<button>`. Keyboard focus, `:focus-visible`, and screen-reader semantics
  come from the platform (plan Q12). A theme must not remove the focus ring without replacing it.
- Cell state lives in `data-state`, never in a class. One attribute, one source of truth.
- `.qbe-board` always exists, even for `ranked-list`; layout differences are expressed by
  `data-layout`, not by different element names.
- Text content is never empty-but-meaningful: if a value is absent, the element is absent.

**Not guaranteed** — do not depend on it: element order beyond what is shown, whitespace text
nodes, `:nth-child` positions of cells (columns are ragged in jeopardy), or anything inside
`.reveal` that this table does not name.

## 3. State attributes

| Attribute | Values | On |
|---|---|---|
| `data-state` | `hidden` `revealed` `answered` `marked` | `.qbe-cell` |
| `data-bonus` | `true` (absent otherwise) | `.qbe-cell` — a randomization winner (spec §8) |
| `data-locked` | `true` (absent otherwise) | `.qbe-cell` — `flags.lockValue` |
| `data-layout` | `grid` `ranked-list` | `.qbe-board` |
| `data-animation` | `flip` `zoom` `fade` | `.qbe-stage` |
| `data-phase` | `prompt` `answer` | `.qbe-detail` |
| `data-active` | `true` (absent otherwise) | `.qbe-team` |
| `data-reduced-motion` | `true` (absent otherwise) | `<html>` |

`data-bonus` is set only after randomization runs, and only for value-altering bonuses on cells
that are not `data-locked` (spec §8). A theme should style it as an *invitation*, not a spoiler —
it is visible to the room.

## 4. Token reference

Every token has a default in `themes/default.css`. A theme may override any subset; unset tokens
fall back. **A theme that sets only colors is a valid theme.**

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
| `--cell-shadow` | resting shadow |
| `--cell-hover-bg` | hover/focus background |
| `--cell-revealed-bg` / `--cell-revealed-text` | `data-state="revealed"` |
| `--cell-answered-bg` / `--cell-answered-text` | `data-state="answered"` — spent, must read as spent |
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
| `--column-label-bg` / `--column-label-text` / `--column-label-size` | column header |

### Detail overlay

| Token | Role |
|---|---|
| `--detail-bg` / `--detail-text` | overlay surface |
| `--detail-scrim` | backdrop behind the overlay |
| `--prompt-size` | prompt text size — **the back-of-the-room number**; see §5 |
| `--answer-color` | answer text, after reveal |

### Score bar

| Token | Role |
|---|---|
| `--score-bg` / `--score-text` | bar surface |
| `--team-active-outline` | outline for `data-active="true"` |

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

## 6. What a theme cannot do, by design

No JavaScript. No markup. No URLs to other origins. No new tokens the renderer reads — a token a
theme invents is inert unless the renderer already consumes it. Themes **select and restyle**; they
never define behavior. This mirrors spec §4.2's rule for game-type configs, for the same reason:
data that can act is data that can be weaponized.

Spec §4.3 is blunt about the residual risk: **adding a theme means trusting its author.** CSS can
still be hostile in ways CSS review catches and code cannot — hiding content, misleading states,
absurd sizes. Themes ship reviewed, not merely validated.

## 7. Loading

`themes/themes.json` maps a name to a **bare filename** resolved under `/themes/`. The schema pins
values to `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.css$` — no paths, no URLs, no traversal. Only manifest
entries ever load (spec §6.4). An unknown `theme` in a content file is a validation error with a
real message, never a silent fallback to default.

## 8. Animations (F5)

Three shipped: `flip`, `zoom`, `fade`, selected by the content file's `animation` field and
exposed as `data-animation` on `.qbe-stage`. They live in the theme layer as CSS transitions and
keyframes keyed off `data-state` changes, so a theme can restyle them via `--anim-duration` and
`--anim-easing` without touching JS.

`prefers-reduced-motion: reduce` collapses every animation to an instant state change. Not
shortened — removed. The state change must still be perceivable.

-----
2026-08-17
