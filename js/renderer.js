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
import { PATTERNS } from './schemas.js';

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
 * Exported for the test runner and for F6's state layer, which has to record the same value the
 * board was just told to display. NOT because app.js calls it — it does not, and a reader who went
 * looking for that caller found nothing: `advance()` hands the next state to `onCellAdvance` as its
 * second argument precisely so the derivation happens once, here.
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
function accessibleName(cell, column, bundle, state) {
  const parts = [];
  if (column.label) parts.push(column.label);
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
 *     .qbe-cell-value        the point value (absent when there is none)
 *     .qbe-cell-text         the face text of a valueless cell (bingo); absent otherwise
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
 *     .qbe-cell-text        present only when the cell has no `value` and does have a `prompt`
 *
 * Present only then, on purpose. Overloading `.qbe-cell-value` would hand the designer's
 * `--value-size` clamp a 25-character string, and a jeopardy cell must never print its prompt on the
 * face — that is the question. A revealed feud row still keeps its answer in the overlay only: it
 * HAS a value, so it gets no text element, and its answer is the reveal payload rather than a label.
 */
function buildCell(doc, cell, column, bundle, session, state) {
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
  button.setAttribute('aria-label', accessibleName(cell, column, bundle, state));

  const face = faceValue(cell, bundle, state);
  let valueEl = null;
  if (face !== null) {
    valueEl = el(doc, 'span', 'qbe-cell-value', face);
    button.appendChild(valueEl);
  }
  // The face text for a valueless cell (bingo). Not state-dependent: the term is what the host
  // calls out and what the room matches against, so it is on the card from the first paint and
  // `updateBoard` never has to touch it.
  if (cell.value === undefined && cell.prompt) {
    button.appendChild(el(doc, 'span', 'qbe-cell-text', cell.prompt));
  }

  // Always present, usually empty (theme-contract §2). It is a styling surface, not text: a theme
  // draws the bingo mark on it with a pseudo-element keyed off `data-state`, so it must exist
  // before there is anything to mark.
  const mark = el(doc, 'span', 'qbe-cell-mark');
  mark.setAttribute('aria-hidden', 'true');
  button.appendChild(mark);

  return { button, valueEl, cell, column };
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

  for (const column of bundle.content.board.columns) {
    const columnEl = el(doc, 'div', 'qbe-column');
    // Omitted when the column has no label (theme-contract §2: absent, never empty).
    if (column.label) columnEl.appendChild(el(doc, 'h2', 'qbe-column-label', column.label));

    for (const cell of drawOrder(column.cells, layout)) {
      const state = cellStateFor(bundle, session, cell.key);
      const record = buildCell(doc, cell, column, bundle, session, state);
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
    detail,
    bundle,
    handlers: h,
    open: null, // { key, returnFocusTo } while the overlay is up
    escapeListener: null,
  };

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
    record.button.setAttribute('aria-label', accessibleName(record.cell, record.column, b, state));
    if (bonus) record.button.setAttribute('data-bonus', 'true');
    else record.button.removeAttribute('data-bonus');

    // The ranked-list value appears at reveal time and would have to disappear again if a session
    // reset the row, so the element is added and removed rather than emptied — theme-contract §2
    // promises an absent element rather than an empty one.
    const face = faceValue(record.cell, b, state);
    if (face === null && record.valueEl) {
      record.valueEl.remove();
      record.valueEl = null;
    } else if (face !== null && !record.valueEl) {
      record.valueEl = el(doc, 'span', 'qbe-cell-value', face);
      record.button.insertBefore(record.valueEl, record.button.firstChild);
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
  view.root.inert = true;

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
  view.root.inert = false;

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
// SECTION 6 — announcements: DELIBERATELY ABSENT UNTIL F6
// =============================================================================================
//
// There used to be an `announce()` here, writing into a hidden live region in index.html, and
// nothing in the repo called either of them. Both are gone rather than kept warm: state changes are
// announced by the platform, because `closeCell` returns focus to a cell whose `aria-label` already
// carries its new state, and a live region saying the same thing would talk over it. module-contracts
// §8 still lists `announce` among the renderer's eventual exports — it comes back with the feature
// that needs it (F6 scoring), not before.
