# Three themes for the Quiz Board Engine — rationale & contrast report

Drop-in files for `/themes/`: `civic.css`, `chalkboard.css`, `marquee.css`.
All three are override sheets on `default.css` (per contract §4/§7) — no layout,
no keyframes, no `!important`, no external requests, no web fonts. Register in
`themes/themes.json` as `"civic": "civic.css"` etc. Every ratio below is
computed from sRGB relative luminance; each is also inline next to its value in
the CSS.

## civic — light + dark via `prefers-color-scheme`

Warm stone ground, deep forest-sage cells, mono numerals; the palette is the
Civic Data Design System semantic set. Amber appears on exactly one thing on
the board (the bonus outline) because that system treats amber as scarce
emphasis — scarcity is what makes the bonus cell read as an invitation.
Numerals and column labels are set in the platform mono stack: in this language
mono means "data", and mono digits are tabular for free. Labels are kickers
(uppercase, tracked, sage rule) rather than filled tabs.

**Answered = sinks into the stationery.** Light: fill drops from 8.44:1 against
the ground to 1.17:1, shadow removed, dashed 3:1 rim, warm hatch, struck value.
Dark: same move mirrored — the panel drops *below* the ground (1.06:1), a
switched-off surface. Lightness + texture + shape; hue never carries it.

Key ratios (light): board-fg/bg 14.10 · cell text/bg 8.44 · cell bg/ground 8.44
· value 7.52 · hover text 6.66 · revealed 15.37 · answered text 5.43 · answered
rim 3.64/3.12 · marked 5.01 · bonus outline 3.79 · label 6.34 · answer 9.20 ·
score 14.10 · team outline 6.33 · focus ring vs ground 5.01.
Dark: fg 13.54 · cell text 12.14 · rim 4.17 (load-bearing — the fill is 1.17:1
by design) · value 5.20 · answered text 5.47 · answered rim 4.17/4.44 · marked
ink 5.80 · bonus 6.11 · revealed value 6.18 · answer 6.45 · team 7.25 · focus 5.80.

**Extending it:** stay on the DS ramps (`#3f4c2d → #4c5c36 → #5c7040` light
action; `#8aa163 → #9cb377` dark). Any new fill must keep its paired ink from
the same system (dark ink on light sage, bone on deep sage) — never white on
mid-green.

## chalkboard — committed dark (one look, deliberately)

Slate-green board, chalk-ruled cells, no shadows anywhere — chalk sits *on* a
board, it doesn't float. The 2px chalk rule (7.23:1 vs ground) is the
load-bearing token: the fill is only 1.18:1 above the board, the rule is the
object. Display face is the platform chalk hand (Chalkboard SE / Segoe Print /
Comic Sans / cursive), values in yellow chalk; body text stays on the system
sans so prompts read effortlessly. A "light chalkboard" is a whiteboard — a
different theme — so no dark-scheme variant, stated per handoff §5.8.

**Answered = erased**: writing dims (8.69 → 4.83) and is struck; a chalk-dust
smudge (two soft radial gradients) replaces default's hatch; the crisp rule
degrades to a faint dashed one (4.30:1 vs ground — findable, clearly not
fresh). Revealed inverts to a pale chalk slab (10.17:1 text), the brightest
object on the board. The bingo mark is a hand-drawn open circle.

Key ratios: fg 10.28 · cell text 8.69 · rule 7.23/6.11 · value 8.11 · hover
6.96 · revealed 10.17, ring 5.48, value 5.48 (default's accent value would be
1.03 on the slab — overridden) · answered text 4.83, rim 4.30/3.99 · marked
6.58, glyph 6.14 · bonus (dashed yellow) 8.11 · accent-contrast 9.60 · score
11.95, team 11.16 · detail answer 5.48 · Close on scrim 13.74 · focus 9.60.

## marquee — committed dark

The 1970s studio stage: deep indigo house, royal-blue cells in gilt frames
(solid gold rule + inner gold keyline + warm glow), platform didone numerals
(Didot / Bodoni MT / Georgia) in gold — display sizes only; thin didone strokes
never set body text. Where midnight is the control room, marquee is the stage.

**Answered = lights out**: the panel drops below the ground, the glow is
removed, an unlit-bulb dot grid appears, the gilt frame decays to a thin cool
rule (3.08:1 — still findable), value struck. **Bonus = chase lights**: a
dotted gold outline, the bulb metaphor made literal. Revealed lights up
incandescent ivory; its value and ring take stage crimson (gold on ivory is
1.56 — overridden, contrast maths not taste). Marked is a velvet crimson square
with a gold star stamp.

Key ratios: fg 14.84 · cell text 10.88 · gilt frame 8.22/5.77 · value 7.44 ·
hover 8.26 · revealed 15.23, value/ring 8.58 · answered text 6.19, rim
3.08/3.26 · marked 9.87, glyph 6.81 · bonus 7.44 · accent-contrast 9.77 ·
label 15.71 · score 15.71, team 11.24 · detail 13.23, answer 9.46 · Close on
scrim 16.25 · focus 10.61.

## What the tokens couldn't express (fair findings, per handoff §6.4)

1. **Answered border colour isn't a token.** `default.css` hardcodes its spent
   rim; all three themes (and midnight) override the class. A
   `--cell-answered-border` shorthand would make colour-only themes complete.
2. **The revealed ring + revealed value are welded to `--accent`.** Every dark-
   or warm-revealed theme has to override both rules because the accent that
   works on the ground fails on the revealed panel. A `--cell-revealed-accent`
   would close it.
3. **The Close button label inverts with the ground** (midnight found this
   first; chalkboard and marquee hit it too). A `--detail-close-color` token
   would end the recurring class override.
4. **Column-label typography** (case, tracking, rule) is the most-overridden
   class across all five themes — `--column-label-transform` /
   `--column-label-border` might be worth it, or accept that labels are
   legitimately per-theme territory.
5. **No data-URI font was needed** — the platform stacks earned their keep in
   all three directions. If chalkboard ever feels too platform-dependent, a
   subsetted chalk face at ~25–35KB is the one candidate worth the weight.

## Preview harness

`Gameboard Themes.dc.html` renders the real contract DOM (states, bonus,
locked, detail overlay, all three game types) against the real CSS files, with
a theme/game/animation switcher. It is a design tool, not a deliverable — the
CSS files stand alone in the repo.

---

## Maintainer response to the findings — theme contract v1.2 (2026-08-17)

*Appended by the engine side; the prose above is the collaborator's and is unedited.*

Findings 1, 2 and 3 were **adopted**. The deciding evidence was not the argument but the
repetition: all four override themes — `midnight`, `civic`, `chalkboard`, `marquee` — were
writing the same three class overrides, and each one had written its own paragraph explaining
why it had to. When every theme must override the same rule, the token set is missing something.

Five tokens were added to `themes/default.css`, all additive, each defaulted so that `default`
and `midnight` are pixel-identical before and after:

| Token | Default | Finding |
|---|---|---|
| `--cell-answered-border` | `2px dashed #6f675a` | 1 — the spent rim |
| `--cell-revealed-accent` | `var(--accent)` | 2 — the revealed ring *and* value |
| `--cell-revealed-value-color` | `var(--cell-revealed-accent)` | 2 — the value alone |
| `--detail-close-color` | `var(--board-bg)` | 3 — the Close label |
| `--detail-close-border` | `2px solid var(--board-bg)` | 3 — the same button's rule |

Finding 2 became **two** tokens rather than one, because the four themes split on it: `chalkboard`
and `marquee` needed the ring and the value to move together, while `midnight` and `civic`-dark
deliberately kept the accent ring and re-coloured only the number. One token would have forced
two of the four back into a class override.

Finding 4 was **declined**, on evidence gathered from all five `.qbe-column-label` overrides
rather than on the count alone. They are not the same override in different clothes:

- **Case.** `midnight`, `civic` and `marquee` set `uppercase`; `chalkboard` explicitly refuses
  it — "uppercase would fight the handwriting face" — and stays mixed-case. A shared token would
  be doing opposite work in the same set.
- **The rule.** `midnight` and `civic` draw a 2px *bottom* rule and flatten the radius to make a
  kicker; `chalkboard` draws a dashed bottom rule; `marquee` keeps the filled tab and draws a
  full 1px box around all four sides. `--column-label-border` as a single shorthand cannot say
  *which edge*, and the split is 3–1 on the answer.
- **Everything else.** Tracking runs 0.07 / 0.08 / 0.09em and none; weight runs 400 / 600 / 700;
  every one of the four also changes padding.

So the two proposed tokens would have deleted **zero** class overrides — all four themes would
still be overriding `.qbe-column-label` for the padding, radius, tracking and weight they also
change. That is the bar: a token earns its place by removing a rule, not by moving one
declaration out of one. **Column labels are legitimately per-theme territory**, and this is now
written into the contract (§4, Typography) so the question does not get re-opened by accident.

Finding 5 needs no action — the platform stacks stand.

**What the refactor deleted.** `midnight` 8 → 5 class overrides; `civic` 5 → 4 plus two of its
three dark-block rules; `chalkboard` 6 → 4; `marquee` 6 → 4. Every surviving override now carries
a one-line note saying why it cannot become a token. Two of them are the same reason: `box-shadow`
is a single property, so the revealed panel's shadow *list* has to be rewritten whole and cannot
be composed from tokens. Only its colour was tokenised.

**One defect found while doing this, and left alone deliberately.** `default.css` writes the
revealed ring as `box-shadow: inset 0 0 0 4px <accent>, var(--cell-shadow)`. A theme that sets
`--cell-shadow: none` produces `..., none`, which is not a legal box-shadow list — the whole
declaration is invalid at computed-value time and the ring disappears. `chalkboard` is immune
because it rewrites the property outright (which is why that override survives the refactor);
`civic`'s **dark** scheme is not, and is currently missing its revealed ring. Fixing it would
change that theme's appearance, which is out of scope for a refactor whose contract was
pixel-identity, so it is reported here for the maintainer rather than silently changed.
