# Runbook — the learning track

**Chore C13. Yours, ongoing.**
**Dial: 10%** — the agent authors, you review every PR and hand-author the occasional small piece.

This runbook has **no code in it**, deliberately. Code you read is code you recognize later; code
you write is code you know. Everything below tells you *what* to do and *where to read* — the
writing is the part that has to be yours.

Each item names the concept, the exercise, and the MDN page. Work them in order or by appetite;
they're independent.

---

## How to use this

**The review loop is the floor, and it is not optional.** Before anything else: for every PR the
agent opens, read the whole diff and write a line in `docs/pr-review-log.md`. If you can't say
what a hunk does, that's the next thing to learn — note it and come back here.

**The exercise pattern.** Every item follows the same shape:

1. Read the MDN page first. Skim the whole thing, then read the examples slowly.
2. Open the file named in "Where to look" and find the thing you just read about, in context.
3. Do the exercise on a branch (`learn/<topic>`), on your own, without asking for a snippet.
4. When it works, or when you're properly stuck, ask me to review it — not to write it.

**Getting stuck is the point.** Ask for a *hint about the concept*, not the line. "Why does my
event handler not fire on the new cell?" gets you an explanation of delegation. "Write the
handler" gets you nothing you'll retain.

**Run before you read.** `python3 -m http.server 8000` from the repo root, then
`http://localhost:8000/`. Click things while you read the file that draws them.

---

## Track A — CSS: the theme layer

**This is your best entry point.** You already chose to own theming, the tokens are documented,
and a mistake here breaks a colour rather than the app. Everything in this track is
self-contained: no module system, no async, no state.

### A1 · Custom properties (CSS variables) and the cascade

**Concept.** Custom properties are variables that live in the cascade — they inherit down the
tree and can be overridden per-selector. This is the whole mechanism behind our theme system:
`default.css` defines every token, and a theme redefines a subset. Once you feel why a token set
on `:root` is visible inside a cell, the theme contract stops being magic.

**Where to look.** `themes/default.css` (the `:root` block at the top), then `themes/midnight.css`
— which deliberately overrides only a subset so you can see the fallback working.

**Exercise.** Author a new theme file. Set only colour tokens — no layout, no classes. Register it
in `themes/themes.json`, point a game file's `theme` field at it, and load the board. Then
deliberately omit a token you set before and watch which value takes over, and from where.

**Read:**
- [Using CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascading_variables/Using_CSS_custom_properties)
- [`var()`](https://developer.mozilla.org/en-US/docs/Web/CSS/var) — note the fallback argument
- [Cascade, specificity, and inheritance](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics/Handling_conflicts)

### A2 · Attribute selectors and styling by state

**Concept.** Our cells carry their state in a `data-state` attribute rather than a class, so you
style them by matching the attribute. Understanding attribute selectors is what lets you restyle
`answered` or `revealed` without touching a line of JavaScript.

**Where to look.** Any `[data-state="answered"]` rule in `themes/default.css`. Compare with how
the donated `chalkboard.css` handles the same state.

**Exercise.** In your theme from A1, make `answered` read as spent using **lightness and texture
only** — no hue change at all. Then check it in greyscale (macOS: System Settings → Accessibility
→ Display → Color Filters → Grayscale). If you can't tell spent from unplayed in greyscale, it
fails the requirement in the theme contract, and you'll have learned exactly why that rule exists.

**Read:**
- [Attribute selectors](https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors)
- [`data-*` attributes](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/data-*)
- [`:focus-visible`](https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible) — you must never remove it

### A3 · Grid, and type that survives 1 to 12 columns

**Concept.** The board is a CSS grid whose column count comes from the JSON, so your CSS can't
assume a size. `clamp()` lets a font size scale with the viewport while staying inside a floor and
a ceiling — the reason a 12-column board stays legible without a media query per size.

**Where to look.** The `.qbe-board` and `.qbe-cell-value` rules in `themes/default.css`, and the
`--qbe-column-count` custom property the renderer sets.

**Exercise.** Load a 3-column game and a 12-column game in your theme. Find the smallest rendered
point value (DevTools → Computed → `font-size`). Adjust your clamp bounds until both look
deliberate. Write down the two numbers you landed on and why.

**Read:**
- [CSS grid layout basics](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Basic_concepts_of_grid_layout)
- [`clamp()`](https://developer.mozilla.org/en-US/docs/Web/CSS/clamp)
- [`minmax()`](https://developer.mozilla.org/en-US/docs/Web/CSS/minmax) and [`repeat()`](https://developer.mozilla.org/en-US/docs/Web/CSS/repeat)

### A4 · Motion, and turning it off

**Concept.** Transitions and keyframe animations are different tools; ours use both. The
accessibility requirement is that `prefers-reduced-motion` *removes* motion rather than shortening
it — some people get genuinely unwell from vestibular triggers, so "faster" is not a fix.

**Where to look.** The `@keyframes` blocks and the `prefers-reduced-motion` block near the bottom
of `themes/default.css`.

**Exercise.** Add a fourth visual treatment to your theme using only `transform` and `opacity`,
then guard it for reduced motion. Turn reduced motion on in System Settings → Accessibility →
Display and confirm the state still changes visibly with no movement. Then try animating `width`
instead and watch the difference in DevTools' Performance panel — that's why the rule exists.

**Read:**
- [Using CSS transitions](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_transitions/Using_CSS_transitions)
- [Using CSS animations](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animations/Using_CSS_animations)
- [`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
- [CSS triggers: what forces layout](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate)

### A5 · Contrast, computed rather than guessed

**Concept.** WCAG contrast is a ratio between relative luminances, from 1:1 to 21:1. AA wants
4.5:1 for body text and 3:1 for large text. It's arithmetic, not opinion — which is why the theme
contract asks for computed numbers rather than "looks fine".

**Where to look.** The contrast comments beside colours in `themes/civic.css`, and the ratio table
in `themes/theme-rationale.md`.

**Exercise.** Take every text-on-background pair in your theme and compute the ratio (DevTools'
colour picker shows it, or use the WebAIM contrast checker). Write each number into a comment
beside the colour, the way the donated themes do. Any pair under the threshold: fix the colour,
not the comment.

**Read:**
- [Understanding WCAG colour contrast](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Perceivable/Color_contrast)
- [`<color>` values](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value)
- [`color-mix()`](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix) — useful for deriving a spent state from a base

---

## Track B — JavaScript: the concepts this codebase is built from

Read these in order. Each one explains a decision you'll otherwise have to take on faith when
reviewing a PR.

### B1 · ES modules — import, export, and why there's no build step

**Concept.** The browser loads our JavaScript natively as modules. No bundler, no `package.json`.
Two consequences you'll meet immediately: specifiers must be real paths ending in `.js`, and
`file://` won't work at all — which is why every doc here starts with "run a local server".

**Where to look.** The `import` lines at the top of `js/app.js` (which imports everything) and
`js/schemas.js` (which imports nothing). `docs/plans/module-contracts.md` §2 draws the whole
allowed graph.

**Exercise.** Draw the import graph on paper from the files alone, then check it against §2. Then
answer from the code: why can't `renderer.js` import `state.js`? What would break if it did?

**Read:**
- [JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [`import`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import) · [`export`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/export)

### B2 · Building DOM safely — and why `innerHTML` is banned here

**Concept.** `innerHTML` parses a string as HTML, so any text in it becomes markup. Since our
content comes from JSON files anyone can edit and host, that's an injection hole. `createElement`
plus `textContent` cannot produce an element from text, which is why it's the named invariant.

**Where to look.** `js/renderer.js` — every DOM node in the project is built there or in
`js/errors.js`, and both do it the same way.

**Exercise.** In DevTools on the running board, find a cell and read its structure in the
Elements panel against `docs/plans/theme-contract.md` §2. Then, in the console, set some
element's `textContent` to a string containing an HTML tag and watch it stay text. That one
experiment is the whole argument for the rule.

**Read:**
- [`document.createElement()`](https://developer.mozilla.org/en-US/docs/Web/API/Document/createElement)
- [`Node.textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent) — read the security note comparing it to `innerHTML`
- [`Element.innerHTML`](https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML) — read its security considerations section
- [`DocumentFragment`](https://developer.mozilla.org/en-US/docs/Web/API/DocumentFragment) — why we build 144 cells offscreen and attach once

### B3 · Events, delegation, and why there's one listener not 144

**Concept.** Events bubble from the element you clicked up through its ancestors. So one listener
on the board can serve every cell by asking which cell the event came from. With 144 cells that's
one listener instead of 144, and it keeps working when cells change.

**Where to look.** The single `addEventListener` on the board in `js/renderer.js`, and the
`closest()` call that identifies which cell was hit.

**Exercise.** In the console, count the cells, then reason about why one listener suffices. Then
predict what happens if you click the *span* inside a cell rather than the button — and check.

**Read:**
- [Introduction to events](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Events)
- [Event bubbling and capture](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Event_bubbling)
- [`Element.closest()`](https://developer.mozilla.org/en-US/docs/Web/API/Element/closest)
- [`EventTarget.addEventListener()`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)

### B4 · Async — promises, `await`, and why the app can't just "load the file"

**Concept.** Fetching a file takes time, so it returns a promise: a value that will exist later.
`await` lets you write the waiting as if it were sequential. Every load path in this app is async,
and so is the SHA-256 hashing in the state layer.

**Where to look.** `js/loader.js` (fetch) and the boot sequence in `js/app.js`.

**Exercise.** Trace, on paper, the order of everything from page load to a drawn board: what is
fetched, what is awaited, what must finish before the board can appear. Then check it against
`app.js` and note anything that surprised you.

**Read:**
- [How to use promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises)
- [`async`/`await`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function)
- [Using the Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
- [`Promise.all()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) — how we fetch the game type and manifest at once

### B5 · State, storage, and JSON round trips

**Concept.** `localStorage` holds strings, keyed per origin, and it's synchronous — a write blocks
the page. So state is serialized to JSON on the way in and parsed on the way out. "Per origin"
matters more than it sounds: on `github.io`, every project page shares one origin.

**Where to look.** `js/state.js` and the state schema in `js/schemas.js`.

**Exercise.** Play a few cells, then read the stored value in DevTools → Application → Local
Storage. Find your cell states in the raw JSON and match them to the board. Then reload and watch
them come back. Then ask yourself what happens if you edit that string by hand — and go read what
the code does about it.

**Read:**
- [`Window.localStorage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [`JSON.stringify()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify) · [`JSON.parse()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse)
- [Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [`crypto.getRandomValues()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues) — why the bonus picker doesn't use `Math.random()`

---

## Track C — Git and PR review

You're already doing this; these are the pages to have open when a diff confuses you.

**Exercise.** For the next PR, before reading my description: check out the branch, run the test
page, and write down what you think changed. Then read the description and compare. That gap is
the most useful signal you have about what to learn next.

**Read:**
- [Git basics](https://git-scm.com/book/en/v2/Git-Basics-Recording-Changes-to-the-Repository) (Pro Git, free)
- [About pull request reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)
- [Conventional Commits](https://www.conventionalcommits.org/) — the commit format in `docs/conventions.md`

---

## Suggested order

1. **A1 → A2** — author a theme, style a state. Self-contained, visible, low risk.
2. **B2** — the `innerHTML` rule. It's the invariant you'll see cited in every review.
3. **A5** — contrast. Turns an aesthetic judgement into arithmetic you can check.
4. **B1 → B3** — modules and events. After these, most of `renderer.js` reads plainly.
5. **A3, A4** — grid and motion, once you have a theme worth refining.
6. **B4 → B5** — async and state. The hardest, and worth saving until the rest is comfortable.

## When you want a feature instead

Say so and I'll tag one 🎓: I write the surrounding scaffolding and the tests, you write the
implementation, and I review rather than author. The dial says I author by default — 🎓 flips it
per feature. Good candidates right now are a fourth theme (pure A-track) or the export filename
format (small, self-contained, touches B5).
