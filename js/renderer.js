// SPDX-License-Identifier: AGPL-3.0-or-later
//
// renderer.js — Quiz Board Engine
//
// ROLE (CLAUDE.md module boundaries): `renderer` DRAWS. It is handed a frozen CleanedBundle
// (module-contracts §6.3) plus a session-shaped object, and it produces DOM. It fetches nothing,
// validates nothing, remembers nothing, and — critically — never imports `state` or `loader`
// (module-contracts §2). Every state change it wants leaves through a handler callback; every
// state change it must display arrives as an argument. That is what lets the board be driven from
// a hand-built session object in /tests/index.html, and it is what kills the "who re-renders?" bug
// class before it can be born.
//
// Imports: `schemas` and the vendored reveal ESM build. Nothing else, ever.
//
// ---------------------------------------------------------------------------------------------
// THE DOM IS A PUBLISHED CONTRACT
// ---------------------------------------------------------------------------------------------
// docs/plans/theme-contract.md §2 is NORMATIVE and has already been handed to an external design
// collaborator (delta D11). Class names, nesting and data-* attributes are therefore frozen: DOM
// this file emits that the contract does not describe is a defect in this file, not a feature.
// Where the contract was silent it was reported upward rather than papered over: the one such gap
// found in Phase 2 — a valueless cell having nowhere to print its own text — was closed by AMENDING
// the contract (`.qbe-cell-text`, `--cell-text-size`), never by emitting undocumented DOM. See
// `buildCell`.
//
// ---------------------------------------------------------------------------------------------
// NO innerHTML, ANYWHERE (CLAUDE.md named invariant)
// ---------------------------------------------------------------------------------------------
// Every string this module puts on screen came out of a JSON file somebody else wrote. All of it
// reaches the DOM through `createElement` + `textContent`, and the one attribute that carries
// user text (`aria-label`) is set through `setAttribute`, which does not parse markup. There is
// no template string anywhere in this file that ends up in the document.
//
// ---------------------------------------------------------------------------------------------
// WHY THE LIFECYCLE IS NEVER HARDCODED
// ---------------------------------------------------------------------------------------------
// `hidden -> revealed -> answered` is jeopardy's lifecycle, not the engine's. Bingo declares
// `[hidden, marked]`; feud declares `[hidden, revealed]`. Spec §4.2 makes `cellLifecycle` an
// ordered subset chosen by the game-type config, so this file advances through whatever array it
// is given and asks the array — never a literal — what "next" and "terminal" mean. Hardcoding
// jeopardy's three states would make F8 (bingo) a rewrite of this file instead of a JSON file.

import Reveal from '../vendor/reveal.js/reveal.esm.js';
import { PATTERNS, LIMITS } from './schemas.js';

// =============================================================================================
// SECTION 1 — reveal.js integration
// =============================================================================================

/**
 * Reveal configuration for a single projected host screen (plan Q4).
 *
 * WHY SO MUCH IS OFF: reveal.js is a presentation framework and we are using ~5% of it — one
 * slide that happens to contain a game board. Every navigation affordance it ships is a way for
 * the board to disappear mid-game in front of a room:
 *
 *   keyboard:false            plan Q12. Its arrow/space bindings would fight the board's own —
 *                             Space on a focused cell button must press the button, not advance a
 *                             slide. This one is a named invariant, not a preference, so
 *                             `initReveal` re-applies it after any caller overrides.
 *   controls/progress:false   Chrome for a deck we cannot navigate. Also visual noise on a
 *                             projector.
 *   touch/overview:false      A stray swipe or an accidental `Esc`-overview on a touch display
 *                             would blank the board.
 *   hash / respondToHashChanges:false
 *                             The address bar carries `?game=`; letting reveal write `#/0` there
 *                             invites a reload that loses it.
 *   transition:'none'         Our animations are the theme layer's (F5, keyed off `data-state`).
 *                             A slide transition on a one-slide deck is pure cost.
 *   disableLayout:true        THE IMPORTANT ONE. Reveal normally scales a fixed 960x700 canvas to
 *                             fit the window. A 12x12 board scaled down that way is unreadable
 *                             from the back of a room, which is the one thing the board must be.
 *                             With layout disabled, sizing belongs to the theme's CSS, where a
 *                             `clamp()` can respond to the real viewport.
 */
export const REVEAL_CONFIG = Object.freeze({
  keyboard: false,
  controls: false,
  progress: false,
  slideNumber: false,
  hash: false,
  respondToHashChanges: false,
  history: false,
  center: false,
  touch: false,
  overview: false,
  fragments: false,
  help: false,
  pause: false,
  autoSlide: 0,
  loop: false,
  transition: 'none',
  backgroundTransition: 'none',
  disableLayout: true,
  //   display:'flex'          NOT 'block'. Reveal writes this value as an INLINE style on the slide
  //                           it is showing (`slide.style.display = config.display`), and an inline
  //                           declaration outranks every theme rule that is not `!important`. With
  //                           'block' the theme's `section.qbe-stage { display: flex }` never
  //                           applied, so the board's `flex: 1 1 auto` had nothing to grow inside:
  //                           measured at 1200x964 the stage was 964px tall and the board 287px,
  //                           with cells at the 44px minimum instead of 170px. The stage's `display`
  //                           is therefore OWNED BY THIS CONFIG, not by the theme layer
  //                           (theme-contract §2 records that).
  display: 'flex',
});

/**
 * Initialise reveal.js over an existing `.reveal` element.
 *
 * @param {HTMLElement} [revealMount] defaults to the document's `.reveal`
 * @param {object}      [overrides]   extra reveal options; `keyboard` is always forced false
 * @returns {Promise<object>} the reveal deck API
 *
 * Uses the CONSTRUCTOR form (`new Reveal(el, cfg)`) rather than the `Reveal.initialize()`
 * singleton, because the singleton hunts for `.reveal` with its own `querySelector` and we would
 * rather hand it the element we mean — the test runner can then drive a board inside a fixture
 * container without racing the app's own deck.
 */
export async function initReveal(revealMount, overrides) {
  const el = revealMount || document.querySelector('.reveal');
  if (!el) throw new Error('initReveal(): no .reveal element to initialise');
  const config = Object.assign({}, REVEAL_CONFIG, overrides || {}, { keyboard: false });
  const deck = new Reveal(el, config);
  await deck.initialize();
  return deck;
}

// =============================================================================================
// SECTION 2 — theme <link> and motion preference
// =============================================================================================

const THEME_LINK_ID = 'qbe-theme';
const THEMES_DIR = 'themes/';

/**
 * Point the single theme `<link>` at `themes/<themeFile>`.
 *
 * @param {string} themeFile a BARE filename — `bundle.resolved.themeFile` and nothing else
 *
 * THE SECURITY BOUNDARY (spec §6.4, theme-contract §7). Only files named as VALUES in
 * `themes/themes.json` ever load. The renderer is deliberately incapable of resolving a theme
 * NAME: it takes the already-resolved manifest value, so there is no code path here that could be
 * pointed at a content-file string. The pattern re-test below is defence in depth — the schema
 * already pinned the manifest value to `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.css$` — and it THROWS
 * rather than degrading, because reaching it means our own wiring handed this function the wrong
 * string, and a silent skip would hide that forever.
 *
 * NOT CACHE-BUSTED, deliberately (plan Q14). JSON is cache-busted because a teacher edits it
 * minutes before class; a theme changes about twice a year, and churning it costs a repaint on
 * every single load.
 *
 * The href is RELATIVE. A root-absolute `/themes/…` breaks the moment the app is served from a
 * GitHub Pages *project* subpath (`/quiz-board-engine/`), which is exactly how it ships (plan Q3).
 */
export function mountTheme(themeFile, doc = document) {
  if (typeof themeFile !== 'string' || !PATTERNS.themeFile.test(themeFile)) {
    throw new TypeError('mountTheme(): expected a bare manifest CSS filename, got ' + String(themeFile));
  }
  let link = doc.getElementById(THEME_LINK_ID);
  if (!link) {
    link = doc.createElement('link');
    link.id = THEME_LINK_ID;
    link.rel = 'stylesheet';
    (doc.head || doc.documentElement).appendChild(link);
  }
  link.setAttribute('href', THEMES_DIR + themeFile);
}

/**
 * True when the operating system asks for reduced motion.
 *
 * Spec §8 and theme-contract §8: reduced motion REMOVES animation, it does not shorten it. This
 * function is the single place the query is asked, so JS-side gating and the CSS-side
 * `data-reduced-motion` attribute can never disagree.
 */
export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// =============================================================================================
// SECTION 3 — lifecycle vocabulary
// =============================================================================================

/**
 * The state a cell moves to next, or `null` when it is already terminal.
 *
 * NOTHING OUTSIDE THIS FILE IMPORTS IT TODAY, and the export is kept for a future caller rather
 * than for a real one. The JSDoc used to name "the test runner and F6's state layer" as its
 * consumers; neither is true, and the second cannot become true — module-contracts §2 forbids
 * `state -> renderer`, so a reader hunting that caller was hunting something the architecture rules
 * out. `state.js` therefore carries its OWN copy of this derivation, on purpose. And app.js does not
 * call it either: `advance()` hands the next state to `onCellAdvance` as its second argument
 * precisely so the derivation happens once, here.
 */
export function nextLifecycleState(lifecycle, current) {
  const i = lifecycle.indexOf(current);
  if (i === -1) return lifecycle.length > 0 ? lifecycle[0] : null;
  return i + 1 < lifecycle.length ? lifecycle[i + 1] : null;
}

/**
 * The state a cell is in right now, given the session (which may say nothing about it).
 *
 * Precedence, and why:
 *   1. `session.cellStates[key]`, but only if it is a state THIS game type declares. A session
 *      saved against a different game type must not smuggle `answered` onto a bingo card.
 *   2. `flags.preMarked` -> the TERMINAL state. Spec §4.1: the bingo free space starts done.
 *   3. the initial state.
 *
 * Exported for a future caller, not a current one: nothing outside this file imports it. `state.js`
 * has a line-for-line twin (`state.cellStateFor`) because module-contracts §2 forbids it importing
 * the renderer, and the suite asserts the two agree on every cell of every shipped board rather
 * than trusting that they still do.
 */
export function cellStateFor(bundle, session, cellKey) {
  const { cellLifecycle } = bundle.gametype;
  const stored = session && session.cellStates ? session.cellStates[cellKey] : undefined;
  if (typeof stored === 'string' && cellLifecycle.indexOf(stored) !== -1) return stored;
  if (bundle.resolved.preMarkedKeys.indexOf(cellKey) !== -1) return bundle.resolved.terminalState;
  return bundle.resolved.initialState;
}

// Copy keyed on the four canonical lifecycle states (spec §4.2). This is UI prose for a closed
// enum, not lifecycle logic: nothing here assumes which of the four a game type uses, or how many.
const STATE_PHRASE = Object.freeze({
  hidden: 'not played yet',
  revealed: 'answer shown',
  answered: 'already played',
  marked: 'marked',
});

// The label on `.qbe-detail-next`, keyed on the state the click will move the cell INTO. Same
// closed enum; a game type that uses only two of the four simply never shows the other labels.
const ADVANCE_LABEL = Object.freeze({
  hidden: 'Start',
  revealed: 'Reveal the answer',
  answered: 'Mark it answered',
  marked: 'Mark this square',
});

// =============================================================================================
// SECTION 4 — the board
// =============================================================================================

const CELL_SELECTOR = '.qbe-cell';

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/**
 * The point value as it should appear on the cell face, or `null` for no `.qbe-cell-value` at all.
 *
 * theme-contract §2 guarantees "if a value is absent, the element is absent", so a cell with no
 * value gets no element rather than an empty one — a theme can then style `.qbe-cell-value`
 * without defending against a blank box.
 *
 * RANKED-LIST (plan Q11): the value IS the reveal payload. A feud row that printed "38" while
 * still `hidden` would spoil the answer it is hiding, so the element only appears once the row has
 * left its initial state.
 */
function faceValue(cell, bundle, state) {
  if (cell.value === undefined) return null;
  if (bundle.gametype.layout === 'ranked-list' && state === bundle.resolved.initialState) return null;
  return String(cell.value);
}

/**
 * The cell's face TEXT, or null when it has none. The companion to `faceValue`.
 *
 * Two cells print text on the face, for opposite reasons:
 *
 *   bingo        a valueless square, whose `prompt` IS its term. Not state-dependent — the term is
 *                what the host calls out and the room matches against, so it is on the card from
 *                the first paint.
 *   ranked-list  a REVEALED feud row, whose `answer` is the thing the board exists to show. State-
 *                dependent, and that is the whole point: a hidden row prints nothing, so the
 *                reveal is not spoiled.
 *
 * WHY THIS EXISTS AT ALL. The contract used to make `.qbe-cell-text` and `.qbe-cell-value`
 * mutually exclusive, and this function's absence was that rule expressed as code: a feud row has
 * a `value`, so it got no text element, and its answer lived in the overlay only. The overlay
 * closes. What was left on the board was six blank rows and the number 38 — while the row's own
 * accessible name said "answer shown". A sighted room could not read a board a screen-reader user
 * could, which is the bingo defect of v1.1 exactly, mirrored.
 *
 * The mutual-exclusion rule is therefore narrowed rather than dropped: a jeopardy cell still never
 * prints its prompt on the face, because that is the QUESTION. What a revealed feud row prints is
 * the ANSWER, which is a different thing wearing the same shape. See `D14`.
 */
function faceText(cell, bundle, state) {
  if (cell.value === undefined) return cell.prompt ? String(cell.prompt) : null;
  if (bundle.gametype.layout !== 'ranked-list') return null;
  if (state === bundle.resolved.initialState) return null;
  // TRUTHINESS, not `=== undefined`, and for the same reason as the bingo branch above:
  // `schemas.js` puts no `minLength` on a string and `validator.js` checks only for the field's
  // presence, so `"answer": ""` is a VALID content file. Guarding undefined alone put an empty
  // `.qbe-cell-text` on the face, against §2's "text content is never empty-but-meaningful: if a
  // value is absent, the element is absent". The contract checker counts elements and never reads
  // their text, so it could not have caught it. Found by adversarial review, not by the suite.
  return cell.answer ? String(cell.answer) : null;
}

/**
 * The cell's accessible name: value AND state, always (CLAUDE.md accessibility rule).
 *
 * The visible face carries a bare number; "200" read aloud, on its own, tells a screen-reader user
 * neither which category it belongs to nor whether it is still in play. So the name is composed:
 * column label, then the value (or the fact that the value is still hidden), then the state.
 *
 * The prompt joins the name ONLY when the cell has no value. That is the bingo-shaped cell, whose
 * face text is its term, and it is on the card in `.qbe-cell-text` too — see `buildCell`. The name
 * and the face therefore say the same thing, which is the point. For a jeopardy cell the prompt
 * is deliberately withheld: it is the question, and the name of a not-yet-played cell must not
 * read it out.
 */
function accessibleName(cell, column, bundle, state, position) {
  const parts = [];
  if (column.label) parts.push(column.label);
  // THE RANKED-LIST ROW NEEDS ITS POSITION, and it is the only layout that does. Everywhere else
  // the composed name is already unique: a jeopardy cell carries its own value, a bingo square its
  // own term. A feud row has neither — every row in the column shares the survey question, and
  // every unplayed row reports "points hidden", so all six announced as one identical sentence and
  // a screen-reader user had no way to tell which row they had landed on. Found by walking the
  // board with the keyboard (Phase 5), not by a test, which is why one now exists.
  //
  // The position is the DRAWN one, not `cell.row`: `drawOrder` sorts this layout by descending
  // value, so the authored index and the projected index are different numbers, and the useful one
  // is what the room can see. It leaks nothing — the ordering is already visible.
  if (position && bundle.gametype.layout === 'ranked-list') {
    parts.push('answer ' + position.index + ' of ' + position.total);
  }
  if (cell.value !== undefined) {
    parts.push(faceValue(cell, bundle, state) === null ? 'points hidden' : cell.value + ' points');
  }
  if (cell.value === undefined && cell.prompt) parts.push(cell.prompt);
  parts.push(STATE_PHRASE[state] || state);
  return parts.join(', ');
}

/**
 * Build one cell button.
 *
 * theme-contract §2, exactly:
 *   button.qbe-cell[data-state][data-cell][data-bonus][data-locked]
 *     .qbe-cell-text         the face text: a bingo term, or a revealed feud answer; else absent
 *     .qbe-cell-value        the point value (absent when there is none)
 *     .qbe-cell-mark         the mark surface; always present, usually empty
 *
 * `type="button"` matters: inside a form-less document it changes nothing, but a stray ancestor
 * `<form>` would otherwise make every cell a submit button and reload the page mid-game.
 *
 * CONTRACT GAP, NOW CLOSED (A4 Phase 2, usability finding 4 — theme-contract §2 amended, and the
 * amendment is published to the design collaborator). The contract used to give a cell exactly two
 * children, a value and a mark surface, neither of which is a text slot. That made a bingo card 25
 * blank rectangles: a bingo square has no `value`, so it drew no `.qbe-cell-value`, and its term
 * ("Halley's Comet") existed only in the accessible name — a board a screen-reader user could play
 * and a sighted room could not. So the contract gained a THIRD child:
 *
 *     .qbe-cell-text        the face text, when the cell has any
 *
 * Overloading `.qbe-cell-value` was rejected then and still is: it would hand the designer's
 * `--value-size` clamp a 25-character string. A jeopardy cell still never prints its prompt on the
 * face — that is the QUESTION, and printing it would give the board away.
 *
 * WIDENED BY `D14`. The rule was first written as "present only when the cell has no `value`",
 * which made value and text mutually exclusive and left a revealed feud row printing its points
 * and nothing else — see `faceText` for what that cost. The narrower rule that survives is about
 * questions, not about values: a cell may print its ANSWER on the face and never its QUESTION.
 * A feud row is now the one cell that carries both children.
 */
function buildCell(doc, cell, column, bundle, session, state, position) {
  const button = el(doc, 'button', 'qbe-cell');
  button.type = 'button';
  button.setAttribute('data-cell', cell.key);
  button.setAttribute('data-state', state);
  if (cell.flags.lockValue) button.setAttribute('data-locked', 'true');
  // data-bonus is set only after randomization has run (F7). Until then no cell carries it, which
  // is precisely what theme-contract §3 asks for: absent, not `false`.
  if (session && Array.isArray(session.bonusCells) && session.bonusCells.indexOf(cell.key) !== -1) {
    button.setAttribute('data-bonus', 'true');
  }
  button.setAttribute('aria-label', accessibleName(cell, column, bundle, state, position));

  // ORDER IS LOAD-BEARING on a ranked list and nowhere else. `default.css` lays a feud row out as
  // `flex-direction: row; justify-content: space-between`, so the first child sits at the left edge
  // and the last at the right: answer, then points. On a grid board the cell is a column and only
  // one of the two elements exists anyway, so text-before-value costs nothing there.
  const text = faceText(cell, bundle, state);
  let textEl = null;
  if (text !== null) {
    textEl = el(doc, 'span', 'qbe-cell-text', text);
    button.appendChild(textEl);
  }

  const face = faceValue(cell, bundle, state);
  let valueEl = null;
  if (face !== null) {
    valueEl = el(doc, 'span', 'qbe-cell-value', face);
    button.appendChild(valueEl);
  }

  // Always present, usually empty (theme-contract §2). It is a styling surface, not text: a theme
  // draws the bingo mark on it with a pseudo-element keyed off `data-state`, so it must exist
  // before there is anything to mark.
  const mark = el(doc, 'span', 'qbe-cell-mark');
  mark.setAttribute('aria-hidden', 'true');
  button.appendChild(mark);

  return { button, valueEl, textEl, cell, column, position };
}

/**
 * Does this layout show one round at a time? (`D17`)
 *
 * `ranked-list` only. A jeopardy grid's columns are CATEGORIES — six of them side by side ARE the
 * board, and hiding five would destroy the game. A ranked list's columns are ROUNDS, shown one at
 * a time the way the show does it. Same DOM, same classes, different meaning for `columns`, which
 * is why this is a function with a name rather than an inline layout comparison: the next reader
 * needs to know the distinction is about semantics, not about styling.
 */
function roundsAreExclusive(bundle) {
  return bundle.gametype.layout === 'ranked-list';
}

/**
 * Put one round on screen (`D17`). No-op on a layout that shows every column.
 *
 * WHY `hidden` AND `inert`, RATHER THAN CSS. A theme could hide a column with `display: none` and
 * the room would see the right thing — but the cells would still be in the accessibility tree and
 * still reachable with `Tab`. A keyboard or screen-reader host would walk straight into Round 3
 * and be able to open a cell the room cannot see, which is `M14` and is the same defect class
 * `openCell` already solves with `inert` when the overlay is up.
 *
 * `hidden` removes the column for everybody; `inert` is belt-and-braces for engines that honour a
 * theme's `display: block` override of `[hidden]`, which is legal CSS and would otherwise put the
 * cells back in the focus order with nothing announcing them. On an engine without `inert` this is
 * an inert property assignment in the other sense — no throw, no effect — and `hidden` still
 * carries it. Feature support, never a user-agent test (CLAUDE.md constraint 5).
 */
export function setRound(view, index) {
  if (!roundsAreExclusive(view.bundle)) return view.currentRound;
  const last = Math.max(0, view.columnEls.length - 1);
  const next = Number.isInteger(index) ? Math.min(Math.max(index, 0), last) : 0;

  view.currentRound = next;
  view.root.setAttribute('data-round-active', String(next));
  view.root.setAttribute('data-round-count', String(view.columnEls.length));

  for (let i = 0; i < view.columnEls.length; i++) {
    const columnEl = view.columnEls[i];
    const shown = i === next;
    columnEl.hidden = !shown;
    columnEl.inert = !shown;
  }
  return next;
}

/**
 * Cells in the order they are DRAWN.
 *
 * `grid` draws document order — the author's columns are the board (spec §4.1).
 * `ranked-list` draws one column sorted by DESCENDING value (plan Q11). The index tiebreak keeps
 * the sort stable across engines: `Array.prototype.sort` stability is specified today, but two
 * answers on the same score must land in document order rather than in whatever order the engine
 * happens to produce.
 */
function drawOrder(cells, layout) {
  if (layout !== 'ranked-list') return cells;
  return cells
    .map((cell, i) => ({ cell, i }))
    .sort((a, b) => {
      const av = typeof a.cell.value === 'number' ? a.cell.value : -Infinity;
      const bv = typeof b.cell.value === 'number' ? b.cell.value : -Infinity;
      return bv - av || a.i - b.i;
    })
    .map((entry) => entry.cell);
}

/** The detail overlay, built once with the board and reused for every cell. */
function buildDetail(doc) {
  const root = el(doc, 'div', 'qbe-detail');
  root.hidden = true;
  root.setAttribute('data-phase', 'prompt');
  // role="dialog" WITHOUT aria-modal, on purpose. The overlay is named by its prompt, so moving
  // focus into it announces the question — but we do not trap focus (CLAUDE.md accessibility rule:
  // never trap a keyboard user), and claiming `aria-modal` while Tab can still leave would be a
  // lie to assistive technology.
  root.setAttribute('role', 'dialog');

  const prompt = el(doc, 'p', 'qbe-detail-prompt');
  prompt.id = 'qbe-detail-prompt';
  root.setAttribute('aria-labelledby', prompt.id);

  const answer = el(doc, 'p', 'qbe-detail-answer');
  answer.id = 'qbe-detail-answer';
  answer.hidden = true;
  // The answer element exists (hidden) from board build, so making it visible and filling it is an
  // update to a live region rather than an insertion — which is the difference between a screen
  // reader reading the answer out and saying nothing at all.
  answer.setAttribute('aria-live', 'polite');

  const actions = el(doc, 'div', 'qbe-detail-actions');
  const next = el(doc, 'button', 'qbe-detail-next');
  next.type = 'button';
  const close = el(doc, 'button', 'qbe-detail-close', 'Close');
  close.type = 'button';
  actions.appendChild(next);
  actions.appendChild(close);

  root.appendChild(prompt);
  root.appendChild(answer);
  root.appendChild(actions);

  return { root, prompt, answer, next, close };
}

/**
 * Draw the whole board.
 *
 * @param {{bundle:object, session?:object, mount:HTMLElement, handlers?:object}} args
 *        `mount` is the `section.qbe-stage` slide. `handlers` is optional and every key in it is
 *        optional: a missing handler makes that affordance inert, never throws (module-contracts §8).
 * @returns {{root:HTMLElement, cells:Map<string,HTMLButtonElement>, …}} BoardView
 *
 * ONE LAYOUT PASS, NOT 144 (A4 performance lens). Everything is assembled inside a
 * DocumentFragment, which has no layout of its own, and attached in a single `appendChild`. A 12x12
 * board therefore costs the browser one reflow instead of one per cell.
 *
 * ONE DELEGATED LISTENER, NOT 144 (A4 performance lens). Clicks are caught on `.qbe-board` and
 * routed by `closest('.qbe-cell')`. 144 cells cost one listener and no teardown bookkeeping.
 */
export function renderBoard({ bundle, session, mount, handlers }) {
  const doc = mount.ownerDocument || document;
  const h = handlers || {};
  const { layout } = bundle.gametype;

  // `data-animation` belongs on the stage (theme-contract §3), so the animation a content file
  // chose is a CSS selector rather than a JS branch (F5).
  mount.setAttribute('data-animation', bundle.resolved.animation);

  const board = el(doc, 'main', 'qbe-board');
  board.setAttribute('data-layout', layout);
  // THE ONLY INLINE STYLE IN THIS FILE. A custom property, not a declaration: the theme decides
  // what to do with the count (`grid-template-columns: repeat(var(--qbe-column-count), 1fr)` in
  // practice). It has to be inline because the number is per-board data, and a stylesheet cannot
  // know it — but it stays a value the theme consumes, never a layout the renderer imposes.
  board.style.setProperty('--qbe-column-count', String(bundle.resolved.columnCount));

  const fragment = doc.createDocumentFragment();
  const cells = new Map();
  const records = new Map();
  const renderedStates = new Map();
  const columnEls = [];

  for (const column of bundle.content.board.columns) {
    const columnEl = el(doc, 'div', 'qbe-column');
    // `D17`. Every column carries its index, on every layout. A grid board never hides one, but the
    // attribute is cheap and it is what a theme selects on to style "the round you are on".
    columnEl.setAttribute('data-round', String(columnEls.length));
    columnEls.push(columnEl);
    // Omitted when the column has no label (theme-contract §2: absent, never empty).
    if (column.label) columnEl.appendChild(el(doc, 'h2', 'qbe-column-label', column.label));

    const drawn = drawOrder(column.cells, layout);
    for (let i = 0; i < drawn.length; i++) {
      const cell = drawn[i];
      const state = cellStateFor(bundle, session, cell.key);
      const record = buildCell(doc, cell, column, bundle, session, state,
        { index: i + 1, total: drawn.length });
      columnEl.appendChild(record.button);
      cells.set(cell.key, record.button);
      records.set(cell.key, record);
      renderedStates.set(cell.key, state);
    }
    fragment.appendChild(columnEl);
  }
  board.appendChild(fragment);

  const detail = buildDetail(doc);

  mount.appendChild(board);
  mount.appendChild(detail.root);

  // `cells` and `records` cover the same key set on purpose, and which is which matters when you are
  // editing `updateBoard`: `cells` (key -> button) is the PUBLISHED surface, the `BoardView` of
  // module-contracts §8, and is a projection of `records` — `cells.get(k) === records.get(k).button`,
  // always. `records` is the internal one the diff loop uses, because it also carries the cell's
  // authored data, its column, and the live `.qbe-cell-value` node. `renderedStates` (key -> the
  // lifecycle state currently on screen) is what makes the diff a diff.
  const view = {
    root: board,
    stage: mount,
    cells,
    records,
    renderedStates,
    columnEls,
    detail,
    bundle,
    handlers: h,
    open: null, // { key, returnFocusTo } while the overlay is up
    escapeListener: null,
    currentRound: 0,
  };

  // `D17`. A ranked board shows ONE round; a grid board shows all of its columns and always has.
  // Applied here, at first paint, from the SESSION — so a resumed game comes back on the round it
  // was left on rather than on Round 1 (`M13`).
  setRound(view, roundsAreExclusive(bundle) && session && Number.isInteger(session.currentRound)
    ? session.currentRound : 0);

  board.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest(CELL_SELECTOR) : null;
    if (!target || !board.contains(target)) return;
    const key = target.getAttribute('data-cell');
    if (!key || !records.has(key)) return;
    openCell(view, key);
  });

  detail.next.addEventListener('click', () => advance(view));
  detail.close.addEventListener('click', () => closeCell(view));

  return view;
}

/**
 * Re-draw only what changed.
 *
 * Called by `app.js` on every state notification (module-contracts §10 step 8). It diffs by cell
 * key and touches only the nodes whose state actually moved: a 144-cell board where one cell was
 * just answered costs one attribute write, one label write, and at most one element insertion.
 * It never rebuilds the board — rebuilding would destroy focus, which is how a keyboard host loses
 * their place mid-game.
 */
export function updateBoard(view, { bundle, session }) {
  const b = bundle || view.bundle;
  view.bundle = b;
  const doc = view.root.ownerDocument || document;

  for (const [key, record] of view.records) {
    const state = cellStateFor(b, session, key);
    const bonus = !!(session && Array.isArray(session.bonusCells) && session.bonusCells.indexOf(key) !== -1);
    const wasBonus = record.button.getAttribute('data-bonus') === 'true';

    if (view.renderedStates.get(key) === state && bonus === wasBonus) continue;
    view.renderedStates.set(key, state);

    record.button.setAttribute('data-state', state);
    // `data-animate` is the marker that separates "this cell just moved" from "this cell was
    // BUILT in that state". theme-contract §3/§8: the reveal animations are gated on it, and
    // only this line ever sets it — `buildCell` deliberately does not. Without the gate, resuming
    // a played-out 12x12 board replayed 144 flips plus 144 face fades on the first painted frame,
    // and a bingo card's `preMarked` free squares played their mark animation at load. The
    // animation marks the EVENT of a reveal, not the fact that a page was opened.
    record.button.setAttribute('data-animate', 'true');
    record.button.setAttribute('aria-label',
      accessibleName(record.cell, record.column, b, state, record.position));
    if (bonus) record.button.setAttribute('data-bonus', 'true');
    else record.button.removeAttribute('data-bonus');

    // The ranked-list value appears at reveal time and would have to disappear again if a session
    // reset the row, so the element is added and removed rather than emptied — theme-contract §2
    // promises an absent element rather than an empty one.
    // The ranked-list ANSWER arrives on the same beat as its points and leaves on the same beat
    // too, so it is maintained exactly like the value below — added and removed rather than
    // emptied, because theme-contract §2 promises an absent element rather than an empty one.
    // A bingo term is state-independent and `faceText` returns it in every state, so this branch
    // never fires on a bingo card: the element built at first paint is simply left alone.
    const text = faceText(record.cell, b, state);
    if (text === null && record.textEl) {
      record.textEl.remove();
      record.textEl = null;
    } else if (text !== null && !record.textEl) {
      record.textEl = el(doc, 'span', 'qbe-cell-text', text);
      // First child: answer at the left edge of the row, points at the right (see `buildCell`).
      record.button.insertBefore(record.textEl, record.button.firstChild);
    } else if (text !== null) {
      record.textEl.textContent = text;
    }

    const face = faceValue(record.cell, b, state);
    if (face === null && record.valueEl) {
      record.valueEl.remove();
      record.valueEl = null;
    } else if (face !== null && !record.valueEl) {
      record.valueEl = el(doc, 'span', 'qbe-cell-value', face);
      // After the text element when there is one, so the row reads answer-then-points.
      record.button.insertBefore(record.valueEl,
        record.textEl ? record.textEl.nextSibling : record.button.firstChild);
    } else if (face !== null) {
      record.valueEl.textContent = face;
    }
  }
}

// =============================================================================================
// SECTION 5 — the detail overlay: open, advance, close
// =============================================================================================
//
// THE PHASE MACHINE, and why it is shaped like this.
//
// Plan Q12 says Space/Enter "advances hidden -> revealed -> answered on the open cell". So a phase
// change and a lifecycle advance are the SAME EVENT, not two mechanisms that have to be kept in
// step: pressing the next button moves the cell one place along whatever `cellLifecycle` the game
// type declared, and the overlay closes when the cell can go no further.
//
//   jeopardy  [hidden, revealed, answered]
//     open   -> data-phase="prompt", cell still `hidden`, the prompt on screen
//     next   -> cell becomes `revealed`, data-phase="answer", the answer appears
//     next   -> cell becomes `answered` (terminal) -> overlay closes
//
//   bingo     [hidden, marked]           (no `answer` field: bingo requires only `prompt`)
//     open   -> data-phase="prompt"
//     next   -> cell becomes `marked` (terminal) -> overlay closes
//
//   feud      [hidden, revealed]         (no `prompt`: the question is the column label)
//     open   -> data-phase="prompt", the column label on screen
//     next   -> cell becomes `revealed` (terminal), and because the cell HAS an answer the overlay
//               stays up one more beat to show it with its points
//     next   -> nowhere left to go -> overlay closes
//
// Nothing above is written down in this file as a special case. The three behaviours fall out of
// the lifecycle array, the presence of an `answer`, and the phase.

/** Open a cell's detail overlay. Focus moves in; the originating cell is remembered. */
export function openCell(view, cellKey) {
  const record = view.records.get(cellKey);
  if (!record) return;
  // ALREADY OPEN MEANS ALREADY OPEN. Reaching here with the overlay up used to re-target it and
  // leak a second document `keydown` listener, because the assignment below overwrote
  // `view.escapeListener` and only the last one was ever removed: four opens and one close left
  // three listeners on the document, each calling preventDefault and each firing onCellClose on
  // every later Escape. It is reachable, not hypothetical — the overlay does not trap focus
  // (see `buildDetail`), so a keyboard host can Tab back onto a cell behind the scrim and press
  // Enter. The scrim blocks the mouse; this blocks everything else, and the board is made inert
  // below so the cell cannot take focus in the first place.
  if (view.open) return;
  const { detail } = view;
  const bundle = view.bundle;
  const state = view.renderedStates.get(cellKey) || cellStateFor(bundle, undefined, cellKey);

  view.open = { key: cellKey, returnFocusTo: record.button };

  // The prompt is the cell's own `prompt` when it has one, and the column label otherwise — which
  // is the feud case, where the survey question IS the column label (plan Q11).
  detail.prompt.textContent = record.cell.prompt || record.column.label || '';

  // WHICH PHASE A REOPENED CELL OPENS IN. A cell that has already left its initial state has had its
  // answer shown, so reopening it must not hide the answer again: it used to reset to
  // data-phase="prompt", which meant a host who closed the overlay mid-question could only get the
  // answer back by spending the cell — the button read "Mark it answered" and acted as "show the
  // answer". So the phase is derived from the cell's LIFECYCLE STATE rather than reset, and the
  // button label follows the same state, which is what makes "Done" mean done.
  const hasAnswer = record.cell.answer !== undefined;
  const started = state !== bundle.resolved.initialState;
  if (started && hasAnswer) {
    detail.answer.textContent = answerText(record.cell, bundle);
    detail.answer.hidden = false;
    detail.root.setAttribute('data-phase', 'answer');
  } else {
    detail.answer.textContent = '';
    detail.answer.hidden = true;
    detail.root.setAttribute('data-phase', 'prompt');
  }
  detail.root.hidden = false;
  setNextLabel(view, state);

  // The board is inert while the overlay is up. The scrim already stops clicks reaching a cell, but
  // it does not stop FOCUS: with 25 cells still tabbable behind a 0.9-alpha scrim, Shift+Tab landed
  // on a cell whose focus ring was invisible (WCAG 2.4.7) and Enter there swapped the projected
  // question. `inert` removes the whole board from focus and hit-testing for the duration without
  // trapping the keyboard user inside the dialog, which CLAUDE.md forbids — Tab still reaches the
  // browser chrome. Cleared in `closeCell` BEFORE focus is restored, or the cell could not take it.
  // On an engine old enough not to implement `inert` this is an inert property assignment in the
  // other sense — no throw, no effect — and the early return above still prevents the leak. Feature
  // support, never a user-agent test (CLAUDE.md constraint 5).
  //
  // F6 WIDENED THIS from `view.root` (the board) to every stage child except the overlay itself.
  // The board is no longer the only focusable thing behind the scrim: the score bar's award buttons
  // and the toolbar's Export/Import are stage children too, and Shift+Tab from the dialog reached
  // them — a host could award points to the wrong team, invisibly, through a 0.78-alpha scrim.
  setStageInert(view, true);

  if (view.handlers.onCellActivate) view.handlers.onCellActivate(cellKey);

  // Escape closes (plan Q12). Registered on the document only WHILE the overlay is open, and
  // removed on close: a listener that outlives the overlay would swallow Escape for the rest of the
  // session, and one attached to the overlay itself would stop working the moment a keyboard user
  // tabbed out of it — which they are entitled to do, since this is not a focus trap.
  view.escapeListener = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCell(view);
    }
  };
  (detail.root.ownerDocument || document).addEventListener('keydown', view.escapeListener);

  // Focus a real button rather than the overlay: the platform then gives us Space/Enter to advance
  // for free (Q12's "Space/Enter advances"), with no key handling of our own to get wrong, and the
  // dialog's accessible name — the prompt — is announced on entry.
  try {
    detail.next.focus();
  } catch (_e) {
    /* a detached mount cannot take focus; the overlay is still correct */
  }
}

/**
 * Make everything on the stage except the open overlay inert, or live again.
 *
 * Falls back to the board alone when the view has no stage handle (a fixture that rendered a board
 * into a bare container), so this can never be the reason an overlay leaves the board focusable.
 */
function setStageInert(view, on) {
  const stage = view.stage;
  if (!stage || typeof stage.children === 'undefined') {
    view.root.inert = on;
    return;
  }
  inertSiblings(stage, view.detail.root, on);
}

/**
 * `inert` every child of `mount` except `except`, or clear it again.
 *
 * Shared by the question overlay and the two setup screens, because they have the same problem: a
 * scrim stops the POINTER but not the keyboard. Behind the mid-game "Edit the teams" screen sit the
 * board, the score bar and the toolbar, and Tab walked straight into them — measured 13 tabs from
 * the first input to a `.qbe-cell` whose own centre hit-tested as `.qbe-setup`, where Space opens a
 * question on the projector from underneath a modal. A mouse host cannot do that, which makes the
 * keyboard path strictly worse (WCAG 2.4.3).
 *
 * `inert` and NOT a focus trap: CLAUDE.md forbids confining a keyboard user, and inert only removes
 * the background from the tab order and the accessibility tree — Tab still cycles out to the browser
 * chrome. On an engine without `inert` this is a plain property assignment: no throw, no effect.
 * Feature support, never a user-agent test (CLAUDE.md constraint 5).
 */
function inertSiblings(mount, except, on) {
  if (!mount || typeof mount.children === 'undefined') return;
  for (const child of mount.children) {
    if (child === except) continue;
    child.inert = on;
  }
}

function setNextLabel(view, state) {
  const next = nextLifecycleState(view.bundle.gametype.cellLifecycle, state);
  view.detail.next.textContent = next ? ADVANCE_LABEL[next] || 'Next' : 'Done';
}

/**
 * One activation of `.qbe-detail-next`: advance the cell one lifecycle step, then either show the
 * answer or close.
 *
 * The state change LEAVES through `handlers.onCellAdvance` — the renderer does not own game truth
 * (module-contracts §2 forbids it importing `state`). It also does not optimistically repaint the
 * cell: whoever owns the session calls `updateBoard`, so there is exactly one path from a state
 * change to pixels. A renderer that painted first and reported second would drift from the saved
 * session the first time a write failed.
 */
function advance(view) {
  if (!view.open) return;
  const key = view.open.key;
  const record = view.records.get(key);
  const lifecycle = view.bundle.gametype.cellLifecycle;
  const state = view.renderedStates.get(key);
  const next = nextLifecycleState(lifecycle, state);

  // NOWHERE LEFT TO GO MEANS CLOSE, and it is checked before the phase branch below. It used to be
  // checked after, so a terminal cell fell into the answer branch: the button read "Done", and the
  // first click on it re-projected an answer the room had already been given instead of closing.
  if (!next) {
    closeCell(view);
    return;
  }

  if (view.handlers.onCellAdvance) {
    // Second argument is additive to module-contracts §8's `onCellAdvance(cellKey)`: the caller
    // needs the state to record, and recomputing it there is the same derivation twice.
    view.handlers.onCellAdvance(key, next);
  }

  const phase = view.detail.root.getAttribute('data-phase');
  const hasAnswer = record && record.cell.answer !== undefined;

  if (phase === 'prompt' && hasAnswer) {
    view.detail.root.setAttribute('data-phase', 'answer');
    view.detail.answer.textContent = answerText(record.cell, view.bundle);
    view.detail.answer.hidden = false;
    setNextLabel(view, view.renderedStates.get(key));
    return;
  }
  closeCell(view);
}

/**
 * The answer line.
 *
 * The points are appended only for `ranked-list`, where the value is the thing being revealed
 * (plan Q11) and the row shows nothing until this moment. On a jeopardy board the value has been
 * printed on the cell face since the board was drawn, so repeating it here would be noise.
 * theme-contract §2 gives the overlay no element of its own for a value, so it travels as part of
 * the answer's text rather than as invented DOM.
 */
function answerText(cell, bundle) {
  const answer = String(cell.answer);
  if (bundle.gametype.layout === 'ranked-list' && cell.value !== undefined) {
    return answer + ' — ' + cell.value + ' points';
  }
  return answer;
}

/**
 * Close the overlay and return focus to the cell it came from.
 *
 * Focus restoration is not a nicety: without it a keyboard or screen-reader host is dumped at the
 * top of the document after every single cell and has to tab back across the board. The cell's
 * `aria-label` already carries its NEW state by the time focus lands on it, so the state change is
 * announced by the platform with no live region involved.
 */
export function closeCell(view) {
  const { detail } = view;
  detail.root.hidden = true;
  detail.root.setAttribute('data-phase', 'prompt');
  detail.answer.hidden = true;
  detail.answer.textContent = '';

  if (view.escapeListener) {
    (detail.root.ownerDocument || document).removeEventListener('keydown', view.escapeListener);
    view.escapeListener = null;
  }

  // Before the focus restore below, not after: a cell inside an inert subtree cannot take focus.
  setStageInert(view, false);

  const open = view.open;
  view.open = null;
  if (view.handlers.onCellClose) view.handlers.onCellClose();
  if (open && open.returnFocusTo) {
    try {
      open.returnFocusTo.focus();
    } catch (_e) {
      /* the cell left the document; nothing to restore focus to */
    }
  }
}

// =============================================================================================
// SECTION 6 — announcements (F6)
// =============================================================================================
//
// `announce()` was removed in Phase 2 rather than kept warm, because nothing called it: a cell's
// state change is announced by the PLATFORM, since `closeCell` returns focus to a button whose
// `aria-label` already carries the new state, and a live region repeating it would talk over that.
//
// F6 is the feature that needs it back, and for one reason the platform cannot cover: a score
// change alters text the host is NOT focused on. The award button keeps focus and keeps its own
// name ("Award 200 points to Blue Team"); the number that changed is in a sibling element that no
// screen reader has any reason to read. Without this region, a blind or low-vision host gets
// silence on the only feedback the action produces.

let liveRegion = null;

/**
 * Speak `text` to assistive technology. Silent for sighted users.
 *
 * The region is created on demand and lives on `<body>`, OUTSIDE the stage — it is not part of the
 * board and must not become a stage child that a theme's `flex` rules try to lay out. It is hidden
 * by `.qbe-live` in `themes/default.css` (the always-loaded base layer, theme-contract §7) rather
 * than by an inline style here: the renderer imposes no visual decision of its own, because a single
 * inline declaration outranks every theme rule and would be both unoverridable and undiscoverable
 * from the contract. The hiding technique is a 1px clipped box rather than `display:none`, which
 * would take the element out of the accessibility tree and make it announce nothing at all —
 * theme-contract §5 now names "never unhide `.qbe-live`" as a non-negotiable for the same reason a
 * theme may not delete the focus ring.
 */
export function announce(text, doc = document) {
  if (typeof text !== 'string' || text === '') return;
  if (!liveRegion || !liveRegion.isConnected) {
    liveRegion = doc.createElement('div');
    liveRegion.className = 'qbe-live';
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    (doc.body || doc.documentElement).appendChild(liveRegion);
  }
  liveRegion.textContent = text;
}

// =============================================================================================
// SECTION 6b — the win rail (F8, spec §4.2 `winCondition: "pattern-complete"`)
// =============================================================================================
//
// A WIN IS AN ANNOUNCEMENT, NOT A MODAL. Plan Q4 puts one host in front of one projected screen and
// makes them the adjudicator; a real bingo room keeps playing for second and third place. So a
// completed pattern is added to a rail that stays on screen and blocks nothing — no scrim, no focus
// move, no dismissal to click, and nothing anywhere that ends the game. The board stays live.
//
// TWO CHANNELS, ONE EVENT. The rail is what the ROOM sees; `announce()` is what a screen reader
// hears. They are deliberately separate elements: making the rail itself a live region would speak
// it and then leave it unreadable in reading order (a live region announces changes, not history),
// and it would double up with the `.qbe-live` region the score bar already uses. The rail is
// therefore a plain, permanently readable list, and the live region carries the event.
//
// theme-contract v1.5 publishes `aside.qbe-wins` and `.qbe-win[data-pattern]`. That amendment is
// additive and is mirrored into docs/handoffs/theming-handoff-claude-design.md (delta D11).

// UI prose for the closed pattern set of spec §4.2, keyed the same way STATE_PHRASE is keyed on the
// lifecycle enum. `index` is zero-based board geometry; the room counts from one.
const WIN_PHRASE = Object.freeze({
  row: (i) => 'Row ' + (i + 1),
  column: (i) => 'Column ' + (i + 1),
  // Named by direction rather than by "first"/"second": on a projected board the host is looking at
  // the line, and "diagonal 2" tells them nothing about which one just completed.
  diagonal: (i) => (i === 0 ? 'Diagonal, top left to bottom right' : 'Diagonal, top right to bottom left'),
  'full-card': () => 'Full card',
});

/** "Row 3" — the line's own name, with no lead-in. */
function winName(win) {
  const describe = WIN_PHRASE[win.pattern];
  return describe ? describe(win.index) : win.pattern;
}

/** "Pattern complete: Row 3". Game-type neutral on purpose — "BINGO!" is one game type's word. */
function winPhrase(win) {
  return 'Pattern complete: ' + winName(win);
}

/**
 * Create the win rail. Empty and `hidden` until something is won.
 *
 * @param {{mount:HTMLElement}} args  `mount` is the stage.
 * @returns {{root:HTMLElement, items:Map<string,HTMLElement>, seeded:boolean, destroy:Function}}
 *
 * Called only for a game type whose `winCondition` is `pattern-complete` (theme-contract §2), for
 * the same reason the score bar is drawn only when there is scoring: an element that can never
 * receive content is one more thing for a theme to position and for a host to wonder about.
 */
export function renderWinRail({ mount }) {
  const doc = mount.ownerDocument || document;
  const root = el(doc, 'aside', 'qbe-wins');
  root.hidden = true;
  // A name, so the list is findable by a screen-reader user reading the page rather than only
  // hearing the live-region announcement as it happens.
  root.setAttribute('aria-label', 'Completed patterns');
  mount.appendChild(root);
  return { root, items: new Map(), seeded: false, destroy: () => root.remove() };
}

/**
 * Reconcile the rail with the wins that are true right now.
 *
 * @param {object} view  from `renderWinRail`
 * @param {Array<{id:string, pattern:string, index:number}>} wins  `state.completedPatterns(...)`
 *
 * EXACTLY ONCE PER PATTERN INSTANCE, and this is where that promise is kept. `wins` is a complete
 * statement of what is currently complete — the detector is pure and re-reports every win on every
 * repaint — so this function diffs it against what is already on the rail, keyed by `win.id`.
 * Marking the last square of a row that also completes a diagonal paints two items in one call;
 * marking any cell afterwards paints none, because both ids are already there.
 *
 * THE FIRST CALL IS SILENT, and that is what makes a resume quiet. A restored session arrives with
 * its wins already true: they are painted, because the room should be able to see what has already
 * been won, but nothing is spoken, because the room already saw them happen. Same technique as the
 * score bar's `paintedScores` seeding. Anything that appears AFTER that first paint is a real event
 * and is announced.
 *
 * Wins can also DISAPPEAR — an imported session (F10) replaces `cellStates` wholesale and may hold
 * fewer marks than the board on screen. A stale "Full card" left glowing over a half-played board
 * would be a lie, so the reconcile removes as well as adds.
 */
export function updateWins(view, wins) {
  if (!view) return;
  const list = Array.isArray(wins) ? wins : [];
  const doc = view.root.ownerDocument || document;
  const live = new Set(list.map((win) => win.id));

  for (const [id, node] of view.items) {
    if (live.has(id)) continue;
    node.remove();
    view.items.delete(id);
  }

  // ONE UTTERANCE PER MOVE, not one per win. `announce` writes `liveRegion.textContent`, and a
  // polite live region reports the value it finds when the task ends — so N synchronous writes are
  // spoken ONCE, as the last of them. Announcing inside this loop therefore lost every win but the
  // last: marking the final square of a 5x5 completes Row 5, Column 5, the main diagonal and the
  // full card, and a screen-reader host heard only "Pattern complete: Full card" while four chips
  // appeared. The rail is the room's channel and it already shows all four; the live region is the
  // only channel a host who cannot see the rail has, so it has to carry the whole event.
  const added = [];
  for (const win of list) {
    if (view.items.has(win.id)) continue;
    const item = el(doc, 'div', 'qbe-win', winPhrase(win));
    item.setAttribute('data-pattern', win.pattern);
    view.root.appendChild(item);
    view.items.set(win.id, item);
    added.push(winName(win));
  }
  // Listed in the order the builders report them (rows, then columns, then diagonals, then the full
  // card), which is the order the chips appear in — so what is heard and what is seen agree.
  if (view.seeded && added.length > 0) announce('Pattern complete: ' + added.join(', '));

  // `hidden` rather than an empty rail: theme-contract §2's "absent, never empty-but-meaningful",
  // applied to a container a theme would otherwise have to style around for a whole game of bingo.
  view.root.hidden = view.items.size === 0;
  view.seeded = true;
}

// =============================================================================================
// SECTION 7 — chrome: the score bar, the toolbar, team setup, the resume screen (F6/F7/F10)
// =============================================================================================
//
// THE CONTRACT WAS AMENDED FOR THIS, NOT BYPASSED. theme-contract §2 described a score bar of three
// elements — `.qbe-team`, `.qbe-team-name`, `.qbe-team-score` — which is a READOUT and not a
// control: it can display a score but gives the host no way to change one, no way to say whose turn
// it is, and no way to create the teams in the first place. It also had nowhere at all to hang F10's
// Export/Import. So the contract went to **v1.3** with the additions below, and the handoff to the
// design collaborator was revised in the same breath (delta D11: a silent divergence corrupts
// someone else's work). Everything here is published; nothing here is invented DOM.
//
// The additions, in one place, so a reader can check this file against the document:
//   .qbe-team gains data-team="<index>" and two children — a `<button>` name and .qbe-team-controls
//   button.qbe-btn[data-action]      ONE button class for every piece of chrome, varied by attribute
//   footer.qbe-toolbar               always present, even when the game type has no scoring
//   .qbe-setup[hidden][data-screen]  the pre-game overlay: team setup and the resume list
//
// WHY THE HOST CONTROLS ARE NOT A SEPARATE "HOST PANEL": plan Q4 is a single projected screen with
// no player view. Everything on it is visible to the room, so the controls sit with the thing they
// control — the +/− buttons live inside the team they score, which is also what makes their
// accessible names unambiguous without any extra ARIA.

const BTN_CLASS = 'qbe-btn';

/** One chrome button. Real `<button>`, real text, and an accessible name that is never a glyph. */
function chromeButton(doc, action, text, ariaLabel) {
  const b = el(doc, 'button', BTN_CLASS, text);
  b.type = 'button';
  b.setAttribute('data-action', action);
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
  return b;
}

// U+2212 MINUS SIGN, not a hyphen. On a projector at 30 feet a hyphen next to a 3-digit number is
// a speck; the minus sign is drawn at the same width and weight as the plus.
const MINUS = '−';

/**
 * Draw the score bar.
 *
 * @param {{bundle:object, session:object, mount:HTMLElement, handlers?:object}} args
 * @returns {PanelView}
 *
 * `mount` is the stage. The bar is inserted as the stage's FIRST child, because theme-contract §2
 * puts it above the board and a theme's `flex-direction: column` on the stage turns document order
 * into visual order.
 *
 * CALLED ONLY WHEN `scoring.model !== 'none'` (theme-contract §2). Bingo has no scores, so it gets
 * no bar at all rather than an empty one — which is why no "no teams yet" empty state is drawn here.
 *
 * Handlers: `onScoreAdjust(teamIndex, delta)` and `onTeamActivate(teamIndex)`. Both optional; a
 * missing one makes that control inert rather than throwing (module-contracts §8).
 */
export function renderScorePanel({ bundle, session, mount, handlers }) {
  const doc = mount.ownerDocument || document;
  const view = {
    root: el(doc, 'header', 'qbe-scorebar'),
    stage: mount,
    bundle,
    handlers: handlers || {},
    rows: [],
    award: 0,
    activeTeam: null,
    // What is currently PAINTED, so `updateScorePanel` can tell a real change from a repaint and
    // announce only the former. Same idea as the board's `renderedStates`.
    paintedScores: [],
  };

  // One delegated listener for the whole bar — 12 teams cost three listeners, not 36.
  view.root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target || !view.root.contains(target)) return;
    const teamEl = target.closest('.qbe-team');
    if (!teamEl) return;
    const index = Number(teamEl.getAttribute('data-team'));
    if (!Number.isInteger(index)) return;

    if (target.classList.contains('qbe-team-name')) {
      if (view.handlers.onTeamActivate) view.handlers.onTeamActivate(index);
      return;
    }
    const delta = Number(target.getAttribute('data-delta'));
    if (Number.isFinite(delta) && delta !== 0 && view.handlers.onScoreAdjust) {
      view.handlers.onScoreAdjust(index, delta);
    }
  });

  buildTeamRows(view, session);
  mount.insertBefore(view.root, mount.firstChild);
  return view;
}

/** Build (or rebuild) one row per team. Called on first paint and whenever the team COUNT changes. */
function buildTeamRows(view, session) {
  const doc = view.root.ownerDocument || document;
  const teams = (session && Array.isArray(session.teams) ? session.teams : []).slice(0, LIMITS.maxTeams);

  view.root.textContent = '';
  view.rows = [];
  view.paintedScores = [];

  const fragment = doc.createDocumentFragment();
  for (let i = 0; i < teams.length; i++) {
    const row = el(doc, 'div', 'qbe-team');
    row.setAttribute('data-team', String(i));

    // THE NAME IS THE BUTTON (contract v1.3). Marking whose turn it is needs a control, and a
    // separate "make active" button beside a static name would be a second thing to aim at on a
    // projector for no gain. `aria-pressed` makes it a toggle rather than an action, which is what
    // it is: the state it announces is the state the room can see in `data-active`.
    const name = el(doc, 'button', 'qbe-team-name', teams[i].name);
    name.type = 'button';
    name.setAttribute('aria-pressed', 'false');

    const score = el(doc, 'span', 'qbe-team-score', String(teams[i].score));

    const controls = el(doc, 'div', 'qbe-team-controls');
    const minus = chromeButton(doc, 'score-down', MINUS + '0');
    const plus = chromeButton(doc, 'score-up', '+0');
    controls.appendChild(minus);
    controls.appendChild(plus);

    row.appendChild(name);
    row.appendChild(score);
    row.appendChild(controls);
    fragment.appendChild(row);

    view.rows.push({ row, name, score, minus, plus });
    view.paintedScores.push(null);
  }
  view.root.appendChild(fragment);
  paintTeamRows(view, teams);
}

/**
 * Repaint the rows against `teams`, the current award, and the active team.
 *
 * WHY THE BUTTONS CARRY AN AMOUNT rather than a fixed step: the host is awarding *this cell*, and a
 * generic "+100" would be wrong on every board whose ladder is not 100 — and silently wrong on a
 * bonus cell, where F7's multiplier is the entire point of the feature. `app.js` computes the award
 * with `state.cellAward` (which applies the multiplier and refuses to apply it to a `lockValue`
 * cell) and passes it in; this file only draws the number it is given.
 *
 * Before any cell has been opened there is nothing to award, so both buttons are `disabled` with a
 * name that says why. A disabled button is honest; a button that silently adds zero is not.
 */
function paintTeamRows(view, teams) {
  const award = Number.isFinite(view.award) ? Math.round(view.award) : 0;
  for (let i = 0; i < view.rows.length; i++) {
    const team = teams[i];
    if (!team) continue;
    const r = view.rows[i];
    const active = view.activeTeam === i;

    if (r.name.textContent !== team.name) r.name.textContent = team.name;
    r.name.setAttribute('aria-pressed', active ? 'true' : 'false');
    r.name.setAttribute('aria-label', team.name + ', ' + team.score + ' points');

    r.score.textContent = String(team.score);
    if (active) r.row.setAttribute('data-active', 'true');
    else r.row.removeAttribute('data-active');

    r.plus.textContent = '+' + award;
    r.plus.setAttribute('data-delta', String(award));
    r.plus.disabled = award <= 0;
    r.plus.setAttribute(
      'aria-label',
      award > 0
        ? 'Award ' + award + ' points to ' + team.name
        : 'Award points to ' + team.name + ' — open a cell first',
    );

    r.minus.textContent = MINUS + award;
    r.minus.setAttribute('data-delta', String(-award));
    r.minus.disabled = award <= 0;
    r.minus.setAttribute(
      'aria-label',
      award > 0
        ? 'Deduct ' + award + ' points from ' + team.name
        : 'Deduct points from ' + team.name + ' — open a cell first',
    );

    // Announce only a score that actually MOVED. Repainting the bar because the award changed, or
    // because another team scored, must not make this team's number speak again.
    if (view.paintedScores[i] !== null && view.paintedScores[i] !== team.score) {
      announce(team.name + ', ' + team.score + ' points');
    }
    view.paintedScores[i] = team.score;
  }
}

/**
 * Repaint the score bar from a new session.
 *
 * @param {PanelView} view
 * @param {{session:object, award?:number, activeTeam?:number|null}} args
 *
 * `award` and `activeTeam` are additive to module-contracts §8's `updateScorePanel(view, {session})`
 * and are both VIEW facts rather than session facts, which is why they arrive as arguments instead
 * of being read off the state object:
 *   - the award belongs to the cell currently in play, which is a thing happening on this screen;
 *   - the active team is a marker the host sets for the room, and spec §4.4's state shape has no
 *     field for it. Persisting it would mean either an unschema'd key (dropped on the next import,
 *     so export/import would stop round-tripping exactly — Gate 3) or a state schema delta nobody
 *     ratified. plan Q4 already says there is no turn system to persist.
 */
export function updateScorePanel(view, { session, award, activeTeam }) {
  if (!view) return;
  if (award !== undefined) view.award = award;
  if (activeTeam !== undefined) view.activeTeam = activeTeam;

  const teams = session && Array.isArray(session.teams) ? session.teams : [];
  if (teams.length !== view.rows.length) {
    buildTeamRows(view, session); // the team LIST changed (host edited it): structure, not text
    return;
  }
  paintTeamRows(view, teams);
}

/**
 * The always-present footer: Export, Import, and the team editor.
 *
 * NOT part of the score bar, and that is the whole reason it exists as its own element: the score
 * bar is absent for any game type with `scoring.model: "none"` (bingo), and F10 export/import has to
 * work there too. A file a host cannot export from a bingo card is a data-loss bug wearing a layout
 * decision.
 *
 * THE FILE INPUT. `<input type="file">` is the only way to read a local file without a server, and
 * its UA-rendered button cannot be styled to match a projected theme. So the real input is `hidden`
 * and a real `<button>` opens it — the accessible name and keyboard behaviour come from the button,
 * and the input's `change` event does the work. `value` is cleared after every pick so choosing the
 * SAME file twice still fires (a host re-importing after a mistake would otherwise get silence).
 */
export function renderToolbar({ mount, handlers }) {
  const doc = mount.ownerDocument || document;
  const h = handlers || {};
  const root = el(doc, 'footer', 'qbe-toolbar');

  const exportBtn = chromeButton(doc, 'export', 'Export', 'Export this session as a JSON file');
  const importBtn = chromeButton(doc, 'import', 'Import', 'Import a session from a JSON file');

  const file = el(doc, 'input', 'qbe-file');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.hidden = true;

  // Teams… exists only when there is somewhere for a team to be seen. A game type with no scoring
  // (bingo) draws no score bar, so a team edited here would change nothing anybody could look at —
  // the caller signals that by passing no `onTeamsEdit`, and the button is then absent rather than
  // present-and-inert. A dead control on a projected screen is worse than a missing one: the host
  // presses it mid-game and has to work out whether the app is broken.
  if (h.onTeamsEdit) root.appendChild(chromeButton(doc, 'teams', 'Teams…', 'Edit the team names'));
  root.appendChild(exportBtn);
  root.appendChild(importBtn);
  root.appendChild(file);

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target || !root.contains(target)) return;
    const action = target.getAttribute('data-action');
    if (action === 'export' && h.onExport) h.onExport();
    else if (action === 'teams' && h.onTeamsEdit) h.onTeamsEdit();
    else if (action === 'import') file.click();
  });

  file.addEventListener('change', () => {
    const picked = file.files && file.files[0];
    file.value = '';
    if (picked && h.onImport) h.onImport(picked);
  });

  mount.appendChild(root);
  return { root, destroy: () => root.remove() };
}

/** The shared pre-game overlay shell: scrim, panel, title, note, body, actions. */
function buildSetup(doc, screen, title, note) {
  const root = el(doc, 'div', 'qbe-setup');
  root.setAttribute('data-screen', screen);
  // Same reasoning as `.qbe-detail`: named by its heading, focus moved into it, but NOT `aria-modal`
  // and no focus trap — trapping a keyboard user is forbidden outright (CLAUDE.md accessibility
  // rule). What IS behind it is made `inert` by `mountSetup` below: this shell used to claim there
  // was "nothing behind it worth protecting", which is true of the resume screen and false of the
  // mid-game Teams… screen, where the board, the score bar and the toolbar are all still there.
  root.setAttribute('role', 'dialog');

  const panel = el(doc, 'div', 'qbe-setup-panel');
  const heading = el(doc, 'h2', 'qbe-setup-title', title);
  heading.id = 'qbe-setup-title-' + screen;
  heading.setAttribute('tabindex', '-1');
  root.setAttribute('aria-labelledby', heading.id);

  const body = el(doc, 'div', 'qbe-setup-body');
  const actions = el(doc, 'div', 'qbe-setup-actions');

  panel.appendChild(heading);
  if (note) panel.appendChild(el(doc, 'p', 'qbe-setup-note', note));
  panel.appendChild(body);
  panel.appendChild(actions);
  root.appendChild(panel);

  return { root, panel, heading, body, actions };
}

/**
 * Put a setup shell on the stage and take it off again cleanly.
 *
 * @param {HTMLElement} mount   the stage
 * @param {object} ui           from `buildSetup`
 * @param {Function|null} onEscape  called when Escape is pressed, or null when the screen has no
 *                                  dismiss semantics
 * @returns {{root:HTMLElement, destroy:Function}}
 *
 * Two things every setup screen owes, kept here so neither caller can forget one:
 *
 * INERT BEHIND, cleared on destroy — see `inertSiblings`.
 *
 * ESCAPE, but only where there is something to cancel. The question overlay taught the host that
 * Escape closes an overlay (plan Q12), and they use it on every cell of a game, so pressing it on
 * the Teams… screen and getting nothing reads as a frozen app. It is NOT registered on the initial
 * team setup or on the resume screen: those two have no cancel — dismissing them would leave a host
 * staring at an empty stage with no way back — so they pass `null` rather than a handler that does
 * something invented. The listener lives on the document only while the screen is up, for the same
 * reason `openCell`'s does.
 */
function mountSetup(mount, ui, onEscape) {
  mount.appendChild(ui.root);
  inertSiblings(mount, ui.root, true);

  let escapeListener = null;
  if (typeof onEscape === 'function') {
    const doc = ui.root.ownerDocument || document;
    escapeListener = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onEscape();
    };
    doc.addEventListener('keydown', escapeListener);
  }

  return {
    root: ui.root,
    destroy: () => {
      if (escapeListener) {
        (ui.root.ownerDocument || document).removeEventListener('keydown', escapeListener);
        escapeListener = null;
      }
      inertSiblings(mount, ui.root, false);
      ui.root.remove();
    },
  };
}

/**
 * Team setup — the screen a NEW session starts on (spec §4.4: "teams are created in-app at session
 * start"), and the same screen the toolbar's Teams… button reopens mid-game.
 *
 * @param {{mount:HTMLElement, handlers?:object, names?:string[], editing?:boolean}} args
 * @returns {{root:HTMLElement, destroy:Function}}
 *
 * Two boxes to start, because two teams is the smallest game anyone actually runs, and a button to
 * add more up to `LIMITS.maxTeams`. Blank boxes are not an error: `state.setTeams` drops them, so a
 * host who wants three teams types three names and presses Start without deleting anything.
 *
 * STARTING WITH NO TEAMS IS ALLOWED. A host demoing a board, or one keeping score on a whiteboard,
 * presses Start on empty boxes and gets a board with an empty score bar (which `default.css` hides).
 * Refusing to start would be the app inventing a rule the spec does not have.
 */
export function renderTeamSetup({ mount, handlers, names, editing }) {
  const doc = mount.ownerDocument || document;
  const h = handlers || {};
  const initial = Array.isArray(names) && names.length > 0 ? names.slice(0, LIMITS.maxTeams) : ['', ''];

  const ui = buildSetup(
    doc,
    'teams',
    editing ? 'Edit the teams' : 'Who is playing?',
    editing
      ? 'Rename a team, add one, or clear a box to remove it. Scores are kept.'
      : 'Type a name for each team. Leave a box empty to skip it — you can add teams later.',
  );

  const inputs = [];
  const addField = (value) => {
    if (inputs.length >= LIMITS.maxTeams) return;
    const index = inputs.length;
    const field = el(doc, 'label', 'qbe-field', 'Team ' + (index + 1));
    const input = el(doc, 'input', 'qbe-field-input');
    input.type = 'text';
    input.maxLength = LIMITS.maxLabelChars;
    input.value = typeof value === 'string' ? value : '';
    input.autocomplete = 'off';
    // Enter submits, the way a form would — without a <form>, whose default submit would reload the
    // page and take the game with it.
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });
    field.appendChild(input);
    ui.body.appendChild(field);
    inputs.push(input);
  };

  const submit = () => {
    if (h.onTeamsSubmit) h.onTeamsSubmit(inputs.map((i) => i.value));
  };

  for (const value of initial) addField(value);

  const add = chromeButton(doc, 'add-team', 'Add a team', 'Add another team name box');
  const start = chromeButton(doc, 'start', editing ? 'Save teams' : 'Start the game');
  ui.actions.appendChild(add);
  ui.actions.appendChild(start);
  if (editing) {
    const cancel = chromeButton(doc, 'cancel', 'Cancel');
    ui.actions.appendChild(cancel);
  }

  ui.root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target || !ui.root.contains(target)) return;
    const action = target.getAttribute('data-action');
    if (action === 'add-team') {
      addField('');
      const last = inputs[inputs.length - 1];
      if (last) tryFocus(last);
      add.disabled = inputs.length >= LIMITS.maxTeams;
    } else if (action === 'start') {
      submit();
    } else if (action === 'cancel' && h.onCancel) {
      h.onCancel();
    }
  });

  // Escape cancels the MID-GAME edit only; the opening screen has no Cancel button and nothing to
  // go back to.
  const view = mountSetup(mount, ui, editing && h.onCancel ? () => h.onCancel() : null);
  tryFocus(inputs[0] || ui.heading);
  return view;
}

/**
 * The STARTUP screen — pick a board, pick a look, start (deltas D12 / D13, features F11 / F12).
 *
 * @param {{games:Array<{name:string,file:string}>, themes:string[], themePref:string|null,
 *          mount:HTMLElement, handlers?:{onStart?:Function}}} args
 * @returns {{root:HTMLElement, destroy:Function}}
 *
 * WHY THIS SCREEN EXISTS. Every entry point before it assumed the host already knew a URL. With no
 * server there is no directory listing, so a teacher with three boards could reach exactly one of
 * them — the `demo.json` default — and had to hand-edit a query string for the other two. That is a
 * developer's front door on a tool built for a classroom.
 *
 * WHY IT IS ONE SCREEN AND NOT TWO. Board and look are one decision made once, at the moment the
 * projector goes on. Splitting them into two sequential screens would put a Back button between a
 * host and a room full of waiting people, to separate two questions that take four seconds together.
 *
 * WHAT IT IS NOT ALLOWED TO DO. It renders NAMES. The game list holds manifest keys and manifest
 * values, and the value only ever leaves here by way of `handlers.onStart`, which hands it to
 * `loader.resolveGameParam` before anything is fetched — the same guard a `?game=` parameter meets
 * (spec §6.3). No string on this screen becomes a URL, an href, or markup: `buildSetup` and `el`
 * build everything with `createElement`/`textContent`, like the rest of this module.
 *
 * RADIOS, NOT A <select>, FOR THE BOARD. Three-to-a-dozen boards is a set you want to SEE — a host
 * scanning a projected screen for "Trivia Bingo" should not have to open a menu to discover their
 * options. The theme control is a `<select>` for the opposite reason: it is a refinement, its
 * default is almost always right, and it should not out-shout the choice that matters.
 */
export function renderStartupScreen({ games, themes, themePref, mount, handlers }) {
  const doc = mount.ownerDocument || document;
  const h = handlers || {};
  const list = Array.isArray(games) ? games : [];
  const themeList = Array.isArray(themes) ? themes : [];

  const ui = buildSetup(
    doc,
    'startup',
    'Choose a board',
    'Pick the game you want to project, and how it should look. You can change the look later by coming back here; changing it does not affect a game in progress.',
  );

  // ---- the board list ------------------------------------------------------------------------
  // A real radio group: `name` shared across the inputs, so the platform gives arrow-key navigation,
  // single-selection semantics and a "3 of 3" announcement for free. This is the CLAUDE.md
  // accessibility rule in practice — get it from the platform, not from bespoke ARIA.
  const fieldset = el(doc, 'fieldset', 'qbe-startup-games');
  const legend = el(doc, 'legend', 'qbe-startup-legend', 'Board');
  fieldset.appendChild(legend);

  for (let i = 0; i < list.length; i++) {
    const game = list[i];
    const id = 'qbe-game-' + i;
    const row = el(doc, 'div', 'qbe-startup-choice');
    const input = doc.createElement('input');
    input.type = 'radio';
    input.name = 'qbe-game';
    input.id = id;
    input.className = 'qbe-startup-radio';
    // The FILE rides on a data attribute rather than on `value`, so that nothing which reads this
    // form generically can mistake a filename for a display label or the other way round.
    input.setAttribute('data-file', game.file);
    input.value = game.name;
    if (i === 0) input.checked = true;
    const label = doc.createElement('label');
    label.className = 'qbe-startup-label';
    label.setAttribute('for', id);
    label.textContent = game.name;
    row.appendChild(input);
    row.appendChild(label);
    fieldset.appendChild(row);
  }
  ui.body.appendChild(fieldset);

  // ---- the theme control ---------------------------------------------------------------------
  const themeWrap = el(doc, 'div', 'qbe-startup-theme');
  const themeLabel = doc.createElement('label');
  themeLabel.className = 'qbe-startup-label';
  themeLabel.setAttribute('for', 'qbe-theme-select');
  themeLabel.textContent = 'Look';
  const select = doc.createElement('select');
  select.id = 'qbe-theme-select';
  select.className = 'qbe-startup-select';

  // THE FIRST OPTION IS THE GAME'S OWN THEME, and it is the default (plan Phase 4b, decision 2).
  // A content file may declare a theme, and its author meant it; the picker exists to let a host
  // overrule that for THEIR room — a washed-out projector in daylight — not to quietly discard it
  // for everyone who never touched this control. Its value is the empty string, which is exactly
  // what `readThemePreference` returns "no preference" as.
  const keep = doc.createElement('option');
  keep.value = '';
  keep.textContent = "Use this game's theme";
  select.appendChild(keep);

  for (const name of themeList) {
    const opt = doc.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === themePref) opt.selected = true;
    select.appendChild(opt);
  }
  themeWrap.appendChild(themeLabel);
  themeWrap.appendChild(select);
  ui.body.appendChild(themeWrap);

  // `begin`, not `start`: the team-setup screen's primary button is already `data-action="start"`,
  // and two different screens answering to one action name is exactly the ambiguity that makes a
  // test helper click the wrong thing six months from now.
  ui.actions.appendChild(chromeButton(doc, 'begin', 'Start', 'Start the selected board'));

  ui.root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target || !ui.root.contains(target)) return;
    if (target.getAttribute('data-action') !== 'begin') return;
    const chosen = ui.root.querySelector('input[name="qbe-game"]:checked');
    // No selection cannot normally happen — the first radio is checked on build — but a board list
    // that arrived empty would leave nothing checked, and calling `onStart(undefined)` would send a
    // non-path into the loader. Refusing here keeps that impossible rather than merely unlikely.
    if (!chosen) return;
    if (h.onStart) {
      h.onStart({
        file: chosen.getAttribute('data-file'),
        name: chosen.value,
        // '' means "use the game's theme" and is passed through as null, so every downstream
        // reader sees ONE spelling of "no override" instead of two.
        theme: select.value === '' ? null : select.value,
      });
    }
  });

  // Enter anywhere in the form starts the game. A host tabbing through radios and pressing Return
  // expects the primary action, and without this the keypress is swallowed by a form with no
  // submit behaviour of its own.
  ui.root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    event.preventDefault();
    const startButton = ui.root.querySelector('button[data-action="begin"]');
    if (startButton) startButton.click();
  });

  // No Escape handler, for the same reason the resume screen has none: this screen is the only
  // route into a game, so dismissing it would strand the host on an empty stage.
  const view = mountSetup(mount, ui, null);
  tryFocus(ui.heading);
  return view;
}

/**
 * The resume screen (spec §4.4: "a resume screen lists recent sessions by title and date with
 * resume/discard").
 *
 * @param {{sessions:object[], gameHash:string, mount:HTMLElement, handlers?:object}} args
 *
 * EVERY saved session is listed, but only the ones saved against the CURRENTLY LOADED game file can
 * be resumed — a session is keyed by the content hash, and `state.adopt` refuses a mismatch outright.
 * The others are shown with their Resume button absent and a line saying why, because the alternative
 * (hiding them) leaves a host who edited one comma in their game file staring at "no saved sessions"
 * with no way to discard the orphan and no explanation. Discard is offered on every row: the shelf
 * holds ten, and this screen is the only place it can be tidied.
 */
export function renderResumeScreen({ sessions, gameHash, mount, handlers }) {
  const doc = mount.ownerDocument || document;
  const h = handlers || {};
  const list = Array.isArray(sessions) ? sessions : [];

  const ui = buildSetup(
    doc,
    'resume',
    'Pick up where you left off?',
    // The second sentence is the one a host needs BEFORE they choose, and it was missing. The shelf
    // holds one session per game file (the key is the content hash), so starting a new game writes
    // over the saved one — there is no second slot for "period 2". Saying so here is the only place
    // it can be said in time: once the new game starts, the old board is already gone.
    'This browser has a saved session for this game. Resuming restores the board, the teams, the scores and the bonus cells exactly as they were. Starting a new game instead REPLACES it — a game file has one saved session, and there is no undo.',
  );

  for (let i = 0; i < list.length; i++) {
    const summary = list[i];
    const resumable = summary.gameHash === gameHash;
    const row = el(doc, 'div', 'qbe-session');
    row.setAttribute('data-session', String(i));

    row.appendChild(el(doc, 'div', 'qbe-session-title', summary.gameTitle));
    row.appendChild(
      el(
        doc,
        'div',
        'qbe-session-meta',
        // A non-resumable row is either another game entirely or the same game after an edit — from
        // the hash alone the two are indistinguishable, so the copy says only what is certainly true.
        describeSession(summary) + (resumable ? '' : ' · saved from a different game file, so it cannot be resumed here'),
      ),
    );
    if (resumable) {
      row.appendChild(chromeButton(doc, 'resume', 'Resume', 'Resume ' + summary.gameTitle + ', ' + describeSession(summary)));
    }
    row.appendChild(chromeButton(doc, 'discard', 'Discard', 'Discard the saved session for ' + summary.gameTitle));
    ui.body.appendChild(row);
  }

  // THE ACCESSIBLE NAME USED TO SAY THE OPPOSITE OF WHAT THE BUTTON DOES. It read "Start a new game
  // and leave the saved session alone", and a screen-reader host who believed it lost their board:
  // sessions are keyed `STORAGE_PREFIX + gameHash`, one per game file, so `newSession -> adopt ->
  // persist` writes straight over the entry this screen is offering to resume.
  ui.actions.appendChild(chromeButton(
    doc,
    'new',
    'Start a new game',
    'Start a new game — this replaces the saved session for this game, and there is no undo',
  ));

  // DISCARD ASKS TWICE, and this is the confirmation `state.discardSession`'s own comment already
  // says "belongs on the resume screen" and never had. Resume and Discard are the same size, the
  // same fill and 20px apart, with the destructive one on the right where a hurried pointer
  // overshoots — and one click removed the entry immediately, with no undo and (see the note above)
  // no second copy anywhere.
  //
  // A two-step press rather than `window.confirm`: a blocking dialog on a projected screen is
  // forbidden, and greying the button out would make the host hunt for how to enable it. The second
  // press is the deliberate act. Only the button's LABEL changes — no new class and no new
  // attribute, so nothing here has to be published to a theme.
  let pending = null; // the Discard button currently asking, if any
  const resetPending = () => {
    if (!pending) return;
    pending.button.textContent = 'Discard';
    pending.button.setAttribute('aria-label', 'Discard the saved session for ' + pending.title);
    pending = null;
  };

  ui.root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target || !ui.root.contains(target)) return;
    const action = target.getAttribute('data-action');
    // Any other button on the screen cancels a pending confirmation: a host who pressed Discard and
    // then went for Resume has plainly changed their mind, and leaving "Really discard?" armed on a
    // row they walked away from is a trap for the next click.
    if (!(action === 'discard' && pending && pending.button === target)) resetPending();
    if (action === 'new') {
      if (h.onNewGame) h.onNewGame();
      return;
    }
    const rowEl = target.closest('.qbe-session');
    if (!rowEl) return;
    const summary = list[Number(rowEl.getAttribute('data-session'))];
    if (!summary) return;
    if (action === 'resume' && h.onResume) {
      h.onResume(summary.gameHash);
    } else if (action === 'discard') {
      if (!pending) {
        pending = { button: target, title: summary.gameTitle };
        target.textContent = 'Really discard?';
        target.setAttribute(
          'aria-label',
          'Confirm: permanently discard the saved session for ' + summary.gameTitle,
        );
        return;
      }
      pending = null;
      if (h.onDiscard) h.onDiscard(summary.gameHash);
    }
  });

  // No Escape handler: this screen is the only route into the game, so dismissing it would strand
  // the host on an empty stage.
  const view = mountSetup(mount, ui, null);
  tryFocus(ui.heading);
  return view;
}

/**
 * "16 Aug 2026, 20:41 · 2 teams", or a bare team count when the timestamp will not parse.
 *
 * `toLocaleString` is the browser's job, not ours: the host is reading their own clock, and a
 * hand-rolled format would be wrong in most of the world. A stored `updatedAt` is untrusted text
 * (an edited devtools entry), so an unparseable one degrades to no date rather than "Invalid Date".
 */
function describeSession(summary) {
  const teams = summary.teamCount === 1 ? '1 team' : summary.teamCount + ' teams';
  const when = new Date(summary.updatedAt);
  if (Number.isNaN(when.getTime())) return teams;
  return when.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) + ' · ' + teams;
}

/** Focus without letting a detached or disabled node throw the caller off its feet. */
function tryFocus(node) {
  if (!node) return;
  try {
    node.focus();
  } catch (_e) {
    /* a detached mount cannot take focus; the screen is still correct */
  }
}
