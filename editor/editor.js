// SPDX-License-Identifier: AGPL-3.0-or-later
//
// editor.js — Quiz Board Engine board editor (F13, delta D19)
//
// ROLE. This is an AUTHORING tool, not part of the game. `index.html` never loads it and it never
// loads the game: the two share modules, not a page. If the editor is wrong the worst case is a bad
// file, which the validator then refuses — it cannot break a board in front of a room.
//
// THE ONE DESIGN DECISION, and everything else follows from it: the editor does not know the rules.
// It imports `validator` and `schemas` and asks them, exactly as the app does. So "valid in the
// editor" and "loads in the game" are the same sentence rather than two opinions that drift. The
// alternative — restating "a label is at most 80 characters" here — rots the first time one copy
// changes, and its failure mode is an editor that exports a board the engine rejects, discovered by
// the host mid-show. Nothing about the rules is written twice in this file.
//
// The consequence is deliberate: EXPORT IS DISABLED WHILE THE BOARD IS INVALID. A tool that will
// happily hand you a broken file has not saved you the work, only moved when you find out.
//
// NO innerHTML, ANYWHERE (CLAUDE.md named invariant). The rule is about our code, not about the
// directory it happens to sit in, and a new directory is exactly where an invariant quietly stops
// applying — which is why the suite's forbidden-API sweep was widened to cover this one.

import * as loader from '../js/loader.js';
import * as validator from '../js/validator.js';
import * as errors from '../js/errors.js';
import { KINDS, PATTERNS, LIMITS, ANIMATIONS } from '../js/schemas.js';

// =============================================================================================
// SECTION 1 — the model
// =============================================================================================
//
// Deliberately NOT the file shape. The file nests answers under `board.columns[].cells[]`; the
// editor holds a flat list of rounds because that is what the screen is. `toContent` below is the
// single place the two shapes meet, so the DOM never has to know the file format and the file
// format never has to accommodate the DOM.

const GAME_TYPE = 'feud';

function emptyAnswer() {
  return { answer: '', value: 0 };
}

function emptyRound() {
  return { label: '', answers: [emptyAnswer(), emptyAnswer(), emptyAnswer()] };
}

const model = {
  title: '',
  // THE PICKER NAME IS NOT THE TITLE, and conflating them was this file's worst bug. A board title
  // is "a non-empty string of at most 80 characters"; a manifest KEY is `PATTERNS.gameName`, which
  // is ASCII letters, digits, space, dash and underscore. The repo proves they are different
  // fields: `demo-feud-rounds.json` is titled "Quiz Board Engine Demo — Three Rounds" (em dash) and
  // `games.json` lists it as "Ranked Answers - Three Rounds", because the title cannot be a key.
  //
  // The editor used to print `"<title>": "<file>"` and tell the host to paste it. With that board
  // reopened, that line is a key the manifest validator refuses — and a manifest has no partial
  // render either, so ONE bad key takes the startup picker down for EVERY board, not just the new
  // one. A title containing a quote was worse: the printed line was not JSON at all.
  pickerName: '',
  theme: 'midnight',
  animation: 'fade',
  rounds: [emptyRound()],
  filename: 'my-board.json',
  note: null, // top-level `_note`, preserved across an open/export round trip
};

/**
 * The model as a content file.
 *
 * EMPTY STRINGS ARE OMITTED, NOT SENT AS "". A blank survey question is an ABSENT label, which is
 * what the schema means by optional — sending `""` would ask the validator to accept a field that
 * says nothing, and `renderer` promises "absent, never empty" for exactly this. The one exception is
 * an answer, which is required: an empty one must reach the validator and be refused by name, or the
 * host is left guessing which row is incomplete.
 */
function toContent() {
  const content = {
    schemaVersion: 1,
    gameType: GAME_TYPE,
    board: {
      columns: model.rounds.map((round) => {
        const column = { cells: round.answers.map((a) => ({ answer: a.answer, value: a.value })) };
        if (round.label !== '') column.label = round.label;
        // `_note` is the project's sanctioned comment mechanism (CLAUDE.md constraint 4) and the
        // validator strips it, so nothing downstream would ever have told the host it was gone.
        // Opening a documented board, changing one point value and exporting used to delete its
        // entire documentation block silently.
        if (round.note) column._note = round.note;
        return column;
      }),
    },
  };
  if (model.note) content._note = model.note;
  if (model.title !== '') content.title = model.title;
  if (model.theme !== '') content.theme = model.theme;
  if (model.animation !== '') content.animation = model.animation;
  return content;
}

/** The exact bytes that get downloaded. Two spaces, trailing newline — a file a human will edit. */
export function toFileText() {
  return JSON.stringify(toContent(), null, 2) + '\n';
}

// =============================================================================================
// SECTION 2 — validation, through the real validator
// =============================================================================================

let supportDocs = null; // { gametype, themes } raw docs, fetched once

async function loadSupport() {
  if (supportDocs) return supportDocs;
  const gametype = await loader.fetchJsonFile({ path: loader.gametypePath(GAME_TYPE), kind: KINDS.GAMETYPE });
  const themes = await loader.fetchJsonFile({ path: loader.THEMES_MANIFEST, kind: KINDS.THEMES });
  if (!gametype.ok || !themes.ok) return null;
  supportDocs = { gametype: gametype.value, themes: themes.value };
  return supportDocs;
}

/**
 * Judge the board exactly as the app would.
 *
 * `toFileText()` is validated rather than the in-memory object, and that is not fussiness: it is the
 * only way to be sure the thing judged is the thing downloaded. Validating the object and
 * serialising separately leaves room for the two to differ — `M24` is that mutation, and it is the
 * kind of bug that produces a green editor and a red error screen.
 */
export function judge(support, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, failures: [], syntax: String(err && err.message) };
  }
  return validator.validateBundle({
    content: { path: 'editor/(unsaved board).json', kind: KINDS.CONTENT, text, bytes: text.length, data },
    gametype: support.gametype,
    themes: support.themes,
  });
}

/**
 * A picker name the manifest can actually hold (`PATTERNS.gameName`).
 *
 * Checked against the SAME pattern `schemas.js` uses on a `games.json` key — not a re-description of
 * it — for the same reason the board itself goes through `validateBundle`.
 */
export function pickerNameProblem(name) {
  if (typeof name !== 'string' || name === '') return 'a name for the picker is required';
  if (!PATTERNS.gameName.test(name)) {
    return 'games.json keys allow only letters, digits, spaces, dashes and underscores — no '
      + 'punctuation, accents or dashes like \u2014. A key outside that makes the WHOLE manifest '
      + 'invalid, which takes the picker down for every board, not just this one.';
  }
  return null;
}

/** A filename the manifest can actually hold (`PATTERNS.gameFile`). */
export function filenameProblem(name) {
  if (typeof name !== 'string' || name === '') return 'a filename is required';
  if (!PATTERNS.gameFile.test(name)) {
    return 'use letters, numbers, dashes or underscores and end in .json — a name outside that '
      + 'cannot be listed in games.json, so the picker could never reach the board';
  }
  return null;
}

// =============================================================================================
// SECTION 3 — the DOM
// =============================================================================================
//
// createElement / textContent only.

const ui = {};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function button(label, title, onClick) {
  const b = el('button', 'ed-btn', label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function field(labelText, value, onInput, opts) {
  const wrap = el('label', 'ed-field');
  wrap.appendChild(el('span', 'ed-field-label', labelText));
  const input = document.createElement('input');
  input.type = (opts && opts.type) || 'text';
  input.className = 'ed-input';
  input.value = value;
  if (opts && opts.maxLength) input.maxLength = opts.maxLength;
  if (opts && opts.min !== undefined) input.min = String(opts.min);
  input.addEventListener('input', () => onInput(input.value));
  wrap.appendChild(input);
  return wrap;
}

function select(labelText, value, options, onChange) {
  const wrap = el('label', 'ed-field');
  wrap.appendChild(el('span', 'ed-field-label', labelText));
  const sel = el('select', 'ed-input');
  for (const name of options) {
    const opt = el('option', null, name);
    opt.value = name;
    if (name === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.appendChild(sel);
  return wrap;
}

// =============================================================================================
// SECTION 4 — rendering
// =============================================================================================

function renderRounds() {
  ui.rounds.textContent = '';
  model.rounds.forEach((round, r) => {
    const card = el('section', 'ed-round');
    const head = el('div', 'ed-round-head');
    head.appendChild(el('h2', 'ed-round-title', 'Round ' + (r + 1)));

    const tools = el('div', 'ed-round-tools');
    // Reordering is up/down rather than drag: a drag target is a mouse-only affordance, and the
    // keyboard rule in CLAUDE.md is about getting this from the platform rather than rebuilding it.
    tools.appendChild(button('↑', 'Move this round earlier', () => moveRound(r, -1)));
    tools.appendChild(button('↓', 'Move this round later', () => moveRound(r, 1)));
    tools.appendChild(button('Remove round', 'Delete this round and its answers', () => removeRound(r)));
    head.appendChild(tools);
    card.appendChild(head);

    card.appendChild(field('Survey question', round.label, (v) => {
      round.label = v;
      refresh();
    }, { maxLength: LIMITS.maxLabelChars }));

    const list = el('div', 'ed-answers');
    round.answers.forEach((a, i) => {
      const row = el('div', 'ed-answer');
      row.appendChild(field('Answer ' + (i + 1), a.answer, (v) => {
        a.answer = v;
        refresh();
      }, { maxLength: LIMITS.maxAnswerChars }));
      row.appendChild(field('Points', String(a.value), (v) => {
        // Number(), not parseInt: "12abc" must NOT quietly become 12. A value the host cannot see
        // is wrong is exactly what the validator is for, so a non-number is passed through as NaN
        // -> null and reported by name rather than repaired here.
        const n = Number(v);
        a.value = v.trim() !== '' && Number.isFinite(n) ? Math.trunc(n) : v.trim();
        refresh();
      }, { type: 'text' }));
      const rowTools = el('div', 'ed-answer-tools');
      rowTools.appendChild(button('↑', 'Move this answer up', () => moveAnswer(round, i, -1)));
      rowTools.appendChild(button('↓', 'Move this answer down', () => moveAnswer(round, i, 1)));
      rowTools.appendChild(button('×', 'Remove this answer', () => removeAnswer(round, i)));
      row.appendChild(rowTools);
      list.appendChild(row);
    });
    card.appendChild(list);
    card.appendChild(button('Add an answer', 'Add another ranked answer to this round', () => {
      round.answers.push(emptyAnswer());
      rebuild();
    }));
    ui.rounds.appendChild(card);
  });
}

let spokenVerdict = null;

function renderVerdict(result, text) {
  ui.verdict.textContent = '';
  const ok = result && result.ok;
  const phrase = ok ? 'The board is valid and can be exported.'
    : 'The board is not ready: ' + ((result && result.failures) || []).length + ' problem(s).';
  if (ui.live && phrase !== spokenVerdict) {
    spokenVerdict = phrase;
    ui.live.textContent = phrase;
  }
  ui.verdict.className = 'ed-verdict ' + (ok ? 'ok' : 'bad');

  if (ok) {
    ui.verdict.appendChild(el('strong', null, 'This board is valid.'));
    ui.verdict.appendChild(el('p', null,
      'It was judged by the same validator the game uses, so it will load.'));
    return;
  }
  if (result && result.syntax) {
    ui.verdict.appendChild(el('strong', null, 'The board could not be built as JSON.'));
    ui.verdict.appendChild(el('p', null, result.syntax));
    return;
  }
  const failures = (result && result.failures) || [];
  ui.verdict.appendChild(el('strong', null,
    'Not ready yet — ' + failures.length + (failures.length === 1 ? ' problem' : ' problems')));
  const list = el('ul', 'ed-problems');
  for (const f of failures) {
    // `errors.formatFailure` is the app's own prose. The host reads the same sentence here that
    // they would have read off the error screen, which is the point of not restating the rules.
    list.appendChild(el('li', null, errors.formatFailure(f)));
  }
  ui.verdict.appendChild(list);
}

function renderExport(result) {
  const nameProblem = filenameProblem(model.filename);
  const keyProblem = pickerNameProblem(model.pickerName);
  const boardOk = !!(result && result.ok);
  const ok = boardOk && !nameProblem && !keyProblem;

  ui.download.disabled = !ok;

  // THE REASON IS VISIBLE TEXT, not `title`. `title` is mouse-hover only, and a disabled button is
  // out of the tab order — so the reason a keyboard or screen-reader host could not export was
  // reaching nobody, while the suite asserted on exactly that unreachable string.
  const reason = !boardOk
    ? 'Fix the problems above first — an invalid board would not load in the game.'
    : keyProblem ? 'Picker name: ' + keyProblem
      : nameProblem ? 'File name: ' + nameProblem
        : '';
  ui.exportReason.textContent = reason;
  ui.exportReason.hidden = reason === '';
  ui.download.title = ok ? 'Download ' + model.filename : reason;

  // JSON.stringify on BOTH halves, so a quote or a backslash in either produces a line that is
  // still JSON. Concatenating quotes by hand printed `"Round 1: "Best" Quiz": "x.json"`, which does
  // not parse — and one unparseable key invalidates the entire manifest.
  ui.manifest.textContent = ok
    ? JSON.stringify(model.pickerName) + ': ' + JSON.stringify(model.filename)
    : '';
  ui.manifestNote.hidden = !ok;
}

// THE EXACT STRING THAT WAS JUDGED, or null while the board is invalid.
//
// `toFileText()` used to be called twice — once in `refresh()` to judge, once again at click time
// to download — and the register recorded that as "prevented by construction". It was not: the two
// calls agreed only because every input handler schedules `refresh()` in a task that happens to run
// before any later click. Review proved the gap by replacing the download argument with a constant
// and getting a green 444/444, which means the assertion protecting it could not fail.
//
// Now there is one string. It is produced once, judged, and handed to the Blob unchanged, and the
// suite asserts on THIS variable rather than re-deriving the text it expects.
let judgedText = null;

let refreshHandle = null;

/**
 * Re-judge and repaint the verdict. Does NOT rebuild the round inputs.
 *
 * TWO BUGS LIVED IN THE FIRST VERSION OF THIS FUNCTION, both of which look like details and are not.
 *
 * It rebuilt every round input on every keystroke. The values survived — they come from the model —
 * but the focused element did not, so typing a survey question would drop the caret after the first
 * character. A field you cannot type a sentence into is not a field. Structure and content are now
 * separate: `rebuild()` redraws the rounds when their SHAPE changes; this only re-judges.
 *
 * And it debounced on `requestAnimationFrame`, which does not fire in a background tab — so
 * validation stalled silently whenever the editor was not the front tab, and no headless run could
 * drive it either. `setTimeout` is clamped in the background but it still fires. Found by the
 * editor appearing to ignore a filled-in board that the model had actually recorded correctly.
 */
function refresh() {
  if (refreshHandle !== null) return;
  refreshHandle = setTimeout(async () => {
    refreshHandle = null;
    const support = await loadSupport();
    if (!support) {
      ui.verdict.textContent = '';
      ui.verdict.className = 'ed-verdict bad';
      ui.verdict.appendChild(el('strong', null, 'Could not load the game type or theme list.'));
      ui.verdict.appendChild(el('p', null,
        'The editor needs gametypes/feud.json and themes/themes.json. Serve the repo over HTTP — '
        + 'python3 -m http.server 8000 — and open http://localhost:8000/editor/.'));
      ui.download.disabled = true;
      return;
    }
    const text = toFileText();
    const result = judge(support, text);
    judgedText = result && result.ok ? text : null;
    renderVerdict(result, text);
    renderExport(result);
  }, 0);
}

/** Redraw the rounds AND re-judge. Structural edits only — add, remove, reorder. */
function rebuild() {
  renderRounds();
  refresh();
}

// =============================================================================================
// SECTION 5 — actions
// =============================================================================================

function moveRound(index, delta) {
  const to = index + delta;
  if (to < 0 || to >= model.rounds.length) return;
  const [row] = model.rounds.splice(index, 1);
  model.rounds.splice(to, 0, row);
  rebuild();
}

function removeRound(index) {
  model.rounds.splice(index, 1);
  // A board with no rounds cannot be authored back up from nothing on this screen, so the last one
  // is replaced rather than removed. The validator would refuse an empty board anyway; this keeps
  // the host from reaching a screen with no controls on it.
  if (model.rounds.length === 0) model.rounds.push(emptyRound());
  rebuild();
}

function moveAnswer(round, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= round.answers.length) return;
  const [row] = round.answers.splice(index, 1);
  round.answers.splice(to, 0, row);
  rebuild();
}

function removeAnswer(round, index) {
  round.answers.splice(index, 1);
  if (round.answers.length === 0) round.answers.push(emptyAnswer());
  rebuild();
}

/**
 * Download the board.
 *
 * The SAME string that was validated, not a re-serialisation: `toFileText()` is called once and the
 * bytes handed to the Blob are the bytes that were judged (`M24`).
 */
let lastDownloaded = null;

function download(text) {
  // RECORDED AT THE POINT OF NO RETURN. The suite asserts on this rather than on the text it
  // expects, because the first two versions of the M24 assertion both re-derived the expected bytes
  // and so could not see the DOWNLOAD PATH at all — review replaced the click handler with a
  // constant and the suite stayed green, twice. Whatever reaches the Blob is what a host opens.
  lastDownloaded = text;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = model.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next frame rather than immediately: some engines have not started reading the
  // blob when `click()` returns, and a revoked URL there produces a silently empty file.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Open an existing board.
 *
 * THROUGH `resolveGameParam`, never as a raw path — the same guard the game applies to `?game=`
 * (spec §6.3). The editor is a second front door to the same files, and a second door with a weaker
 * lock is not a second door, it is a hole.
 */
async function openBoard(name) {
  // A leading "?" is a search string to `resolveGameParam`, and one with no `game` key resolves to
  // the DEFAULT board — so typing "?foo=bar" here used to load a board the host never named. The
  // editor takes a FILENAME, so anything query-shaped is rejected before the guard rather than
  // quietly resolving to something else.
  if (typeof name !== 'string' || name.trim() === '' || /^[?&]/.test(name.trim())) {
    return setOpenMessage('Type the name of a board file under games/, such as demo-feud-rounds.json.');
  }
  const resolved = loader.resolveGameParam(name.trim());
  if (!resolved.ok) {
    return setOpenMessage('That name was refused: a board must be a .json file under games/, with '
      + 'no ".." and no absolute or protocol-relative address.');
  }
  const fetched = await loader.fetchContentBundle({ gamePath: resolved.value });
  if (!fetched.ok) {
    // The loader's own prose, not a sentence invented here. Discarding `fetched.failures` and
    // showing a generic message threw away the file, the path, the expectation and what was found —
    // all of which the host needs and all of which already existed.
    return setOpenMessage((fetched.failures || []).map(errors.formatFailure).join(' · ')
      || 'That board could not be read.');
  }

  // VALIDATED BEFORE ANYTHING IS WRITTEN. `fetchContentBundle` fetches and parses; it does not
  // judge. Reading `data.board.columns` straight off a half-written board threw, and because the
  // title and theme had already been assigned the model was left as the PREVIOUS board's rounds
  // under the NEW board's title — a blend of two boards, exported without a word. Nothing touches
  // `model` now until the file is known to be a loadable board.
  const support = await loadSupport();
  if (!support) return setOpenMessage('The game type or theme list could not be loaded.');
  const checked = validator.validateBundle({
    content: fetched.value.content, gametype: support.gametype, themes: support.themes,
  });
  if (!checked.ok) {
    return setOpenMessage('That board does not currently validate, so it cannot be opened for '
      + 'editing: ' + checked.failures.map(errors.formatFailure).join(' · '));
  }
  const data = fetched.value.content.data;
  if (data.gameType !== GAME_TYPE) {
    return setOpenMessage('The editor authors ' + GAME_TYPE + ' boards only, and that one is "'
      + data.gameType + '".');
  }

  model.title = typeof data.title === 'string' ? data.title : '';
  model.theme = typeof data.theme === 'string' ? data.theme : model.theme;
  model.animation = typeof data.animation === 'string' ? data.animation : model.animation;
  model.note = typeof data._note === 'string' ? data._note : null;
  model.rounds = (data.board.columns || []).map((c) => ({
    label: typeof c.label === 'string' ? c.label : '',
    note: typeof c._note === 'string' ? c._note : null,
    answers: (c.cells || []).map((cell) => ({
      answer: typeof cell.answer === 'string' ? cell.answer : '',
      value: cell.value,
    })),
  }));
  model.filename = resolved.value.replace(/^games\//, '');
  model.pickerName = suggestPickerName(model.title);
  setOpenMessage('');
  buildChrome();
  rebuild();
}

/**
 * A starting point for the picker name, derived from the title.
 *
 * A SUGGESTION, never a silent substitution: the host sees it in an editable field and the field is
 * validated like everything else. Deriving it saves typing for the common case (an ASCII title)
 * without pretending the two fields are one, which is the mistake this file already made once.
 */
export function suggestPickerName(title) {
  const ascii = String(title || '')
    .replace(/[\u2010-\u2015]/g, '-') // the dash family, which is what real titles actually carry
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return /^[A-Za-z0-9]/.test(ascii) ? ascii : '';
}

// =============================================================================================
// SECTION 6 — page assembly
// =============================================================================================

let themeNames = ['midnight'];

function buildChrome() {
  ui.meta.textContent = '';
  ui.meta.appendChild(field('Board title', model.title, (v) => {
    model.title = v;
    // The picker name FOLLOWS the title only while the host has not set one of their own. Once
    // they have, typing in the title must not silently rewrite it underneath them.
    if (model.pickerName === '' || model.pickerName === suggestPickerName(model.titleWas || '')) {
      model.pickerName = suggestPickerName(v);
      if (ui.pickerInput) ui.pickerInput.value = model.pickerName;
    }
    model.titleWas = v;
    refresh();
  }, { maxLength: LIMITS.maxLabelChars }));
  const pickerField = field('Name in the picker', model.pickerName, (v) => {
    model.pickerName = v;
    refresh();
  }, { maxLength: 64 });
  ui.pickerInput = pickerField.querySelector('input');
  ui.meta.appendChild(pickerField);
  ui.meta.appendChild(select('Look', model.theme, themeNames, (v) => {
    model.theme = v;
    refresh();
  }));
  ui.meta.appendChild(select('Reveal animation', model.animation, ANIMATIONS, (v) => {
    model.animation = v;
    refresh();
  }));
  ui.meta.appendChild(field('File name', model.filename, (v) => {
    model.filename = v;
    refresh();
  }));
}

export async function boot(root) {
  const mount = root || document.getElementById('editor');

  ui.meta = el('section', 'ed-meta');
  ui.rounds = el('div', 'ed-rounds');
  ui.verdict = el('section', 'ed-verdict');

  const addRound = button('Add a round', 'Add another survey question', () => {
    model.rounds.push(emptyRound());
    rebuild();
  });

  ui.download = el('button', 'ed-btn ed-primary', 'Download board');
  ui.download.type = 'button';
  ui.download.disabled = true;
  ui.download.addEventListener('click', () => {
    // The judged bytes, never a re-serialisation. Null cannot be reached through the UI — the
    // control is disabled whenever it is null — but downloading nothing is the right failure if it
    // ever is, rather than shipping a file no one checked.
    if (judgedText !== null) download(judgedText);
  });

  ui.exportReason = el('p', 'ed-export-reason');
  ui.exportReason.hidden = true;

  ui.manifestNote = el('section', 'ed-manifest');
  ui.manifestNote.hidden = true;
  ui.manifestNote.appendChild(el('p', null,
    'Drop the file in games/ and add this line to games.json:'));
  ui.manifest = el('code', 'ed-manifest-line');
  ui.manifestNote.appendChild(ui.manifest);

  // A REAL <label>, like every other field on this page. This one control was hand-rolled with a
  // bare span and therefore had no accessible name at all — a text box a screen-reader user reaches
  // and is told nothing about. Every other field goes through `field()`, which wraps properly.
  const openWrap = el('label', 'ed-open');
  openWrap.appendChild(el('span', 'ed-field-label', 'Open an existing board'));
  const openInput = document.createElement('input');
  openInput.type = 'text';
  openInput.className = 'ed-input';
  openInput.placeholder = 'demo-feud-rounds.json';
  openWrap.appendChild(openInput);

  // TWO PRESSES WHEN THERE IS WORK TO LOSE, the same shape the game's Discard uses. Downloads are
  // the only persistence by design, so one mistaken click on Open would take an hour of authoring
  // with it and there is no undo. Not a blocking dialog: this page has no precedent for one and the
  // engine has none either.
  let armed = false;
  const openBtn = button('Open', 'Load a board from games/ and edit it', async () => {
    const dirty = model.title !== '' || model.rounds.some((r) => r.label !== ''
      || r.answers.some((a) => a.answer !== ''));
    if (dirty && !armed) {
      armed = true;
      openBtn.textContent = 'Replace this board?';
      setOpenMessage('Opening replaces what is on screen, and nothing here is saved. '
        + 'Press again to go ahead.');
      return;
    }
    armed = false;
    openBtn.textContent = 'Open';
    await openBoard(openInput.value);
  });
  openInput.addEventListener('input', () => {
    if (!armed) return;
    armed = false;
    openBtn.textContent = 'Open';
    setOpenMessage('');
  });
  openWrap.appendChild(openBtn);
  ui.openMessage = el('p', 'ed-open-message');
  ui.openMessage.hidden = true;
  openWrap.appendChild(ui.openMessage);

  mount.appendChild(openWrap);
  mount.appendChild(ui.meta);
  mount.appendChild(ui.rounds);
  mount.appendChild(addRound);
  mount.appendChild(ui.verdict);
  mount.appendChild(ui.download);
  mount.appendChild(ui.exportReason);
  mount.appendChild(ui.manifestNote);

  // THE VERDICT IS THE WHOLE PRODUCT OF THIS PAGE and it changed with nobody being told. A separate
  // polite region rather than `aria-live` on the panel itself: the panel repaints on every
  // keystroke, and announcing every repaint would read the whole problem list aloud per character.
  // This speaks only when the verdict FLIPS.
  ui.live = el('p', 'ed-live');
  ui.live.setAttribute('role', 'status');
  ui.live.setAttribute('aria-live', 'polite');
  mount.appendChild(ui.live);

  // The theme list comes from the manifest, never from a hard-coded list: themes load only via
  // themes.json (CLAUDE.md), and an editor offering a name outside it would author a board the
  // validator refuses on a field the host cannot see is wrong.
  const support = await loadSupport();
  if (support) {
    themeNames = Object.keys(support.themes.data.themes || {});
    if (themeNames.length > 0 && themeNames.indexOf(model.theme) === -1) {
      model.theme = themeNames[0];
    }
  }
  buildChrome();
  rebuild();
}

/** Show or clear the message beside the Open control. */
function setOpenMessage(text) {
  if (!ui.openMessage) return;
  ui.openMessage.textContent = text;
  ui.openMessage.hidden = text === '';
}

/** Test seam: the suite drives the model without a page. */
export const __editor = {
  model, toFileText, judge, loadSupport, filenameProblem, pickerNameProblem,
  suggestPickerName, emptyRound,
  // `refresh` is exposed so a test that sets the model directly can run the SAME judge-and-paint
  // pass a keystroke runs. Without it the suite would have to assert against a `judgedText` no code
  // path had produced, which is how the first version of the M24 assertion ended up unable to fail.
  refresh: () => refresh(),
  judgedText: () => judgedText,
  lastDownloaded: () => lastDownloaded,
};
