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
