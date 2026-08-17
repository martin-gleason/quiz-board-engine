// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Quiz Board Engine test runner.
//
// WHY THIS EXISTS (spec §9, plan Q2 / delta D1)
// The spec forbids GitHub Actions, but mandates an "extensive" error-screen matrix that is
// "not done until it passes". Something has to run that matrix, and it has to run with no
// build step and no dependencies. So: a page you open.
//
// WHY IT DRIVES THE REAL MODULES
// This runner imports loader.js, validator.js, and errors.js directly. It mocks nothing and
// reimplements nothing. A test suite that reimplements the thing it tests only proves the two
// copies agree.
//
// WHY IT ALSO *SHOWS* THE ERRORS
// Spec §7 makes the error screen a product feature, and a green checkmark cannot tell you
// whether a message actually helps a confused human. So every failing fixture also renders its
// real, human-facing error output onto the page, through the real renderErrorScreen(). The
// assertions prove the message is *correct*; your eyes prove it is *useful*. Both are required.

import * as loader from '../js/loader.js';
import * as validator from '../js/validator.js';
import * as errors from '../js/errors.js';
// F3 additions. Importing the renderer here is load-bearing twice over: the render suite drives the
// REAL renderer (never a copy of it), and this import is also what pulls js/renderer.js into the
// transitive source audit below — the invariant suite now CONFIRMS that reachability rather than
// assuming it.
import * as renderer from '../js/renderer.js';
import { KINDS, LIMITS, NOTE_KEY } from '../js/schemas.js';

const MANIFEST = 'tests/fixtures/manifest.json';

// ---------------------------------------------------------------------------------------------
// Assertion plumbing
//
// Deliberately tiny. A test framework here would be a dependency, and dependencies are what
// spec §2.2 and §2.3 exist to forbid. `results` is also exposed on window for the MCP browser
// automation to read, so cross-browser runs do not have to scrape the DOM.
// ---------------------------------------------------------------------------------------------

const results = [];

function record(group, name, passed, detail, failures) {
  results.push({ group, name, passed, detail: detail || '', failures: failures || null });
}

/** Compare one field, returning a human phrase on mismatch and null on match. */
function diff(label, expected, actual) {
  if (expected === null || expected === undefined) return null; // manifest opted out of this check
  if (expected === actual) return null;
  return `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

// ---------------------------------------------------------------------------------------------
// Fixture matrix — spec §9
// ---------------------------------------------------------------------------------------------

/**
 * Run one document through the real pipeline the app would use for its kind.
 *
 * Content files get the full bundle path (content + game-type + themes manifest, then the
 * contract stage) because half the matrix — unknown theme, ragged grid, missing cell field,
 * short ladder — can only fail at the contract stage, which needs the bundle. Anything else is
 * a single structural document.
 */
async function runPipeline(entry) {
  if (entry.kind === KINDS.CONTENT) {
    const fetched = await loader.fetchContentBundle({ gamePath: entry.file });
    if (!fetched.ok) return fetched;
    return validator.validateBundle(fetched.value);
  }

  const fetched = await loader.fetchJsonFile({ path: entry.file, kind: entry.kind });
  if (!fetched.ok) return fetched;

  if (entry.kind === KINDS.STATE) {
    // No bundle passed: structural only. The bounds checks against a real board are exercised
    // by the state round-trip suite in F10, not here.
    return validator.validateState({ raw: fetched.value });
  }
  return validator.validateDocument({ kind: entry.kind, raw: fetched.value });
}

async function runFixture(entry) {
  let outcome;
  try {
    outcome = await runPipeline(entry);
  } catch (err) {
    // A thrown exception is always a bug. Spec §5 says failures are values routed to the error
    // screen; an escaped throw means some path forgot that and would crash the app instead of
    // explaining itself.
    record('matrix', entry.file, false, `threw instead of returning a failure: ${err && err.message}`);
    return;
  }

  if (!entry.expectFailure) {
    if (outcome.ok) {
      record('matrix', entry.file, true, 'validated clean, as a positive control must');
    } else {
      record('matrix', entry.file, false,
        `POSITIVE CONTROL FAILED — this file is supposed to be valid. ${outcome.failures.map(errors.formatFailure).join(' | ')}`,
        outcome.failures);
    }
    return;
  }

  if (outcome.ok) {
    record('matrix', entry.file, false,
      'expected a failure but the pipeline accepted this file — the fault is undetected');
    return;
  }

  const first = outcome.failures[0];
  const problems = [
    diff('failure count', entry.expectedFailureCount, outcome.failures.length),
    diff('stage', entry.expectedStage, first.stage),
    diff('hint class', entry.expectedHintClass, first.hint),
    diff('path', entry.expectedPath, first.path),
    diff('failing file', entry.expectedFailingFile, first.file),
  ].filter(Boolean);

  // Spec §7 requires expected-vs-found on every error. A failure that omits either is
  // incomplete regardless of whether its stage and hint are right.
  if (!first.expected) problems.push('no `expected` phrase — spec §7 requires expected-vs-found');
  if (!first.found) problems.push('no `found` phrase — spec §7 requires expected-vs-found');

  // Syntax failures must carry a location with a caret; schema failures must carry a path.
  // This is the exactly-one-of rule from the module contract, and it is the difference between
  // "line 14, column 3, here ↑" and a shrug.
  if (first.stage === 'syntax') {
    if (!first.location) problems.push('syntax failure with no location — no line/column/caret to show');
    else {
      if (typeof first.location.line !== 'number') problems.push('location.line is not a number');
      if (typeof first.location.caretColumn !== 'number') problems.push('location.caretColumn missing');
      if (!Array.isArray(first.location.snippet) || first.location.snippet.length === 0) {
        problems.push('location.snippet is empty — spec §7 requires surrounding lines');
      }
    }
  }

  record('matrix', entry.file, problems.length === 0,
    problems.length === 0 ? entry.description : problems.join('; '),
    outcome.failures);
}

// ---------------------------------------------------------------------------------------------
// Security suite — spec §6.3 / §9, plan §6
//
// Every one of these is an attempt to make the loader fetch something it must never fetch. They
// are assertions rather than prose because "the guard looks careful" is not a security property.
// ---------------------------------------------------------------------------------------------

const REJECT = [
  ['absolute https URL', 'https://evil.com/x.json'],
  ['absolute http URL', 'http://evil.com/x.json'],
  ['protocol-relative', '//evil.com/x.json'],
  ['scheme-ish', 'javascript:alert(1)'],
  ['data URL', 'data:application/json,{}'],
  ['root-absolute path', '/etc/passwd.json'],
  ['plain traversal', '../../etc/passwd.json'],
  ['traversal below games/', 'games/../../secret.json'],
  ['encoded traversal lower', '%2e%2e/secret.json'],
  ['encoded traversal upper', '%2E%2E/secret.json'],
  ['encoded slash', 'games%2f..%2fsecret.json'],
  ['double-encoded traversal', '%252e%252e/secret.json'],
  ['dot-dot-slash-slash', 'games/....//secret.json'],
  ['backslash separator', 'games\\..\\secret.json'],
  ['wrong extension', 'games/demo.txt'],
  ['double extension', 'games/demo.json.txt'],
  ['no extension', 'games/demo'],
  ['null byte smuggling', 'games/demo.json%00.txt'],
  ['query appended', 'games/demo.json?a=1'],
  ['fragment appended', 'games/demo.json#x'],
  ['outside games dir', 'gametypes/jeopardy.json'],
  // A leading './' is refused rather than normalized. The module contract describes the OUTPUT as
  // carrying no './', which could be read either way; refusing is the stricter reading and costs
  // nothing, because nobody hand-types './games/x.json' into a URL parameter.
  ['leading ./ segment', './games/demo.json'],
  ['bare dot segment', 'games/./demo.json'],
  ['empty string', ''],
  ['whitespace only', '   '],
  ['newline injection', 'games/demo.json\nx'],
];

const ACCEPT = [
  ['plain demo', 'games/demo.json', 'games/demo.json'],
  ['bingo demo', 'games/demo-bingo.json', 'games/demo-bingo.json'],
  // A bare filename is normalized INTO games/, not rejected. This is safe by construction: the
  // result is always games/<name>.json, so the value cannot address anything outside the games
  // directory. It is accepted because ?game=demo.json is the shape a person actually types.
  ['bare filename normalized into games/', 'demo.json', 'games/demo.json'],
  // Subdirectories under games/ ARE allowed, and that is a decision rather than an accident, so it
  // gets an assertion: a teacher with forty games wants folders, and it is safe by construction
  // because '.' is not in the allowlist's segment character class, so no segment can be '..'.
  ['subdirectory under games/', 'games/2026/spring/history.json', 'games/2026/spring/history.json'],
];

function runSecuritySuite() {
  for (const [label, value] of REJECT) {
    const out = loader.resolveGameParam(value);
    const passed = out.ok === false;
    record('security', `reject ${label}`, passed,
      passed
        ? `refused ${JSON.stringify(value)}`
        : `ACCEPTED ${JSON.stringify(value)} as ${JSON.stringify(out.value)} — this is a live vulnerability`,
      passed ? null : null);
  }

  for (const [label, value, expected] of ACCEPT) {
    const out = loader.resolveGameParam(value);
    const passed = out.ok === true && out.value === expected;
    record('security', `accept ${label}`, passed,
      passed ? `resolved to ${expected}` : `expected ${expected}, got ${JSON.stringify(out)}`);
  }

  // An absent param is not an error — it is the default game (module contract §4.1).
  for (const [label, value] of [['null', null], ['undefined', undefined]]) {
    const out = loader.resolveGameParam(value);
    const passed = out.ok === true && out.value === loader.DEFAULT_GAME;
    record('security', `absent param (${label}) → default game`, passed,
      passed ? `defaulted to ${loader.DEFAULT_GAME}` : `got ${JSON.stringify(out)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Cleaning suite — spec §5: "the renderer only ever receives a cleaned object"
// ---------------------------------------------------------------------------------------------

/** Walk any structure looking for a key. Used to prove `_note` is gone at EVERY level. */
function findsKey(value, key) {
  if (Array.isArray(value)) return value.some((v) => findsKey(v, key));
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true;
    return Object.values(value).some((v) => findsKey(v, key));
  }
  return false;
}

async function runCleaningSuite() {
  const fetched = await loader.fetchContentBundle({ gamePath: 'games/demo.json' });
  if (!fetched.ok) {
    record('cleaning', 'fetch demo bundle', false, fetched.failures.map(errors.formatFailure).join(' | '));
    return;
  }

  // The dirty document must still contain the _note fields, or this suite proves nothing.
  const dirtyHasNote = findsKey(fetched.value.content.data, NOTE_KEY);
  record('cleaning', `raw demo.json still contains "${NOTE_KEY}" (control)`, dirtyHasNote,
    dirtyHasNote ? 'present before cleaning, as authored' : 'fixture no longer exercises comment-stripping');

  const cleaned = validator.validateBundle(fetched.value);
  if (!cleaned.ok) {
    record('cleaning', 'validate demo bundle', false, cleaned.failures.map(errors.formatFailure).join(' | '));
    return;
  }

  const noteGone = !findsKey(cleaned.value, NOTE_KEY);
  record('cleaning', `cleaned bundle contains no "${NOTE_KEY}" at any depth`, noteGone,
    noteGone ? 'stripped everywhere' : `"${NOTE_KEY}" survived into the object the renderer receives`);

  const sharesRef = cleaned.value.content === fetched.value.content.data;
  record('cleaning', 'cleaned content is a fresh object, not the raw one', !sharesRef,
    sharesRef ? 'cleaned object aliases raw data — a dirty sub-object could leak' : 'built fresh');

  const frozen = Object.isFrozen(cleaned.value);
  record('cleaning', 'cleaned bundle is frozen', frozen,
    frozen ? 'frozen' : 'not frozen — the renderer could mutate validated data');
}

// ---------------------------------------------------------------------------------------------
// Scanner suite — the plan Q6 promise, tested directly
//
// These strings never touch JSON.parse. They go straight into our own scanner, because the whole
// point of Q6 is that we do not depend on the engine's opinion of what is wrong.
// ---------------------------------------------------------------------------------------------

// Expected LINE is the line the caret should land on — and which line that is, is a usability
// judgement, not an arbitrary one. For a trailing comma the useful caret is on the comma itself,
// not on the brace that followed it.
//
// FOR AN UNCLOSED BRACKET IT DEPENDS ON WHICH BRACKET, and this expectation was WRONG until A4's
// usability pass. For a NESTED one, the opening bracket localises the fault: the reader can see
// which block lost its closer. For the OUTERMOST one — which is the common case, because the
// missing character is the last character of the file — pointing at line 1 column 1 puts the caret
// on a perfectly good "{" a hundred lines from the edit, which is precisely the "the browser points
// at the wrong place" complaint this scanner exists to answer. So the outermost case now reports the
// END of the file, where the "}" has to be typed, and names the opening position in prose instead.
// `expectedClass` pins that distinction so it cannot silently regress either way.
const SCANNER_CASES = [
  ['trailing comma before }', '{\n  "a": 1,\n}', 2, 'trailing-comma'],
  ['trailing comma before ]', '{\n  "a": [1, 2,]\n}', 2, 'trailing-comma'],
  ['unterminated string', '{\n  "a": "oops\n}', 2, 'unterminated-string'],
  ['single quotes', "{\n  'a': 1\n}", 2, 'single-quoted-string'],
  ['unquoted key', '{\n  a: 1\n}', 2, 'unquoted-property-name'],
  ['missing comma between members', '{\n  "a": 1\n  "b": 2\n}', 3, 'missing-comma'],
  ['unclosed OUTERMOST brace reports the end of the file', '{\n  "a": 1', 2, 'unclosed-brace-eof'],
  ['unclosed NESTED bracket reports its opening "["', '{\n  "a": [1, 2', 2, 'unclosed-bracket'],
  ['unclosed NESTED brace reports its opening "{"', '{\n  "a": {"b": 1', 2, 'unclosed-brace'],
  ['trailing garbage', '{"a":1}\nnope', 2, 'trailing-content'],
  ['empty file', '', 1, 'empty-file'],
];

function runScannerSuite() {
  for (const [label, text, expectedLine, expectedClass] of SCANNER_CASES) {
    let loc;
    try {
      loc = errors.scanJsonSyntax(text);
    } catch (err) {
      record('scanner', label, false, `scanner threw: ${err && err.message}`);
      continue;
    }
    const problems = [];
    if (!loc) problems.push('scanner found no fault in text that is not valid JSON');
    else {
      if (typeof loc.line !== 'number') problems.push('no line number');
      if (loc.line !== expectedLine) problems.push(`line: expected ${expectedLine}, got ${loc.line}`);
      if (loc.syntaxClass !== expectedClass) {
        problems.push(`syntaxClass: expected ${expectedClass}, got ${loc.syntaxClass}`);
      }
      if (!loc.expected) problems.push('no `expected` phrase');
      if (!loc.hint) problems.push('no hint class');
    }
    record('scanner', label, problems.length === 0,
      problems.length === 0 ? `line ${loc.line}, col ${loc.column} — ${loc.expected}` : problems.join('; '));
  }

  // Valid JSON must produce NO fault. A scanner that cries wolf on good files is worse than none.
  const clean = errors.scanJsonSyntax('{"a": [1, 2, {"b": "c"}], "d": null}');
  record('scanner', 'valid JSON yields no fault', !clean,
    clean ? `false positive at line ${clean.line}` : 'silent on valid input');
}

// ---------------------------------------------------------------------------------------------
// Regression suite — one assertion per defect the A4 adversarial pass found.
//
// Each of these was GREEN before, because no fixture reached the path. They are here so the same
// defect cannot come back quietly; every one names what it is holding down.
// ---------------------------------------------------------------------------------------------

/** Build a RawDocument the way the loader would, so the validator can be driven with no HTTP. */
function rawDoc(path, kind, data) {
  const text = JSON.stringify(data);
  return { path, kind, text, bytes: text.length, data };
}

function runRegressionSuite() {
  // 1. An over-cap list must report the COUNT and stop, not report every member as well. A 200-item
  //    `columns` array used to produce 201 failures — and, at the 1 MB content cap, ~500,000 of
  //    them, which is ~5.5 million DOM nodes on the error screen.
  const columns = [];
  for (let i = 0; i < 200; i++) columns.push(0);
  const bloated = validator.validateDocument({
    kind: KINDS.CONTENT,
    raw: rawDoc('tests/(synthetic)/over-cap.json', KINDS.CONTENT,
      { schemaVersion: 1, title: 'x', gameType: 'jeopardy', board: { columns } }),
  });
  const oneFailure = !bloated.ok && bloated.failures.length === 1
    && bloated.failures[0].hint === 'too-many-items';
  record('regressions', 'an over-cap list reports the count once and stops walking its members',
    oneFailure,
    oneFailure ? '200 columns -> exactly 1 failure'
      : `expected 1 too-many-items failure, got ${bloated.ok ? 'ok' : bloated.failures.length}`);

  // 2. Same rule for a map: `cellStates` arrives from an untrusted state file (spec §4.4).
  const cellStates = {};
  for (let i = 0; i < 300; i++) cellStates['bad' + i] = 'hidden';
  const bloatedState = validator.validateState({
    raw: rawDoc('import:(synthetic).json', KINDS.STATE, {
      schemaVersion: 1,
      gameHash: '0'.repeat(64),
      gameTitle: 'x',
      createdAt: '2026-08-17T00:00:00Z',
      updatedAt: '2026-08-17T00:00:00Z',
      teams: [],
      cellStates,
    }),
  });
  const oneMapFailure = !bloatedState.ok && bloatedState.failures.length === 1
    && bloatedState.failures[0].hint === 'too-many-items';
  record('regressions', 'an over-cap map reports the count once and stops walking its entries',
    oneMapFailure,
    oneMapFailure ? '300 cellStates entries -> exactly 1 failure'
      : `expected 1 too-many-items failure, got ${bloatedState.ok ? 'ok' : bloatedState.failures.length}`);

  // 3. A minified file is one line of up to 1 MB. The snippet must be CLIPPED — both because an
  //    unclipped one cost 92 ms of caret-padding in Firefox, and because a caret 900,000 columns
  //    off the right edge of an overflow-x <pre> is invisible to the person it is for.
  const pad = 'x'.repeat(5000);
  const minified = `{"schemaVersion":1,"pad":"${pad}","board":{,}}`;
  const loc = errors.scanJsonSyntax(minified);
  const widest = loc ? Math.max(...loc.snippet.map((l) => l.text.length)) : Infinity;
  const clipped = !!loc && widest < 400 && loc.caretColumn <= widest;
  record('regressions', 'a minified one-line file gets a clipped snippet with a reachable caret',
    clipped,
    clipped ? `fault at column ${loc.column}; widest snippet line ${widest} chars, caret at ${loc.caretColumn}`
      : `widest snippet line ${widest} chars — the whole fault line is being copied`);

  // 4. The error screen must survive a hand-written failure whose location has no snippet
  //    (module-contracts §7). It used to throw inside buildSnippet AFTER clearing the mount, so the
  //    one screen whose job is to explain a failure showed a blank white page instead.
  const bare = errors.failure({
    file: 'games/(synthetic).json',
    kind: KINDS.CONTENT,
    stage: 'syntax',
    location: { line: 3, column: 5, offset: 20, caretColumn: 5 },
    expected: 'a valid JSON document',
    found: 'text the browser refused to parse',
    hint: 'syntax',
  });
  const box = el('div');
  let rendered = '';
  try {
    errors.renderErrorScreen([bare], box);
    rendered = box.textContent;
  } catch (err) {
    rendered = '';
    record('regressions', 'error screen renders a location with no snippet', false,
      `threw: ${err && err.message} — the user would see a blank page`);
  }
  if (rendered) {
    record('regressions', 'error screen renders a location with no snippet', true,
      `${rendered.length} characters of explanation, no throw`);
  }

  // 5. `fetch-failed` has two causes and they are not interchangeable. An HTTP status means a server
  //    answered, which rules file:// out entirely — so the "run a web server" advice must NOT appear
  //    for a 404, and must appear for a network error.
  const mk = (found) => errors.failure({
    file: 'games/(synthetic).json',
    kind: KINDS.CONTENT,
    stage: 'fetch',
    path: '(file)',
    expected: 'a readable JSON file at this path',
    found,
    hint: 'fetch-failed',
  });
  const httpBox = el('div');
  errors.renderErrorScreen([mk('HTTP 404 Not Found')], httpBox);
  const netBox = el('div');
  errors.renderErrorScreen([mk('a network error (the request could not be completed)')], netBox);
  const httpMentions = httpBox.textContent.indexOf('file://') !== -1;
  const netMentions = netBox.textContent.indexOf('file://') !== -1;
  record('regressions', 'a 404 is not blamed on file://, and a network error still is',
    !httpMentions && netMentions,
    !httpMentions && netMentions
      ? 'HTTP 404 screen omits the origin note; network-error screen keeps it'
      : `404 mentions it: ${httpMentions}; network error mentions it: ${netMentions}`);

  // 6. A rejected ?game= gets its own hint class. The unresolved-reference copy it used to carry is
  //    entirely about gameType / theme / animation — three fields a person following a bad link
  //    never touched, on a screen whose only actionable advice was therefore irrelevant.
  const rejected = loader.resolveGameParam('https://evil.example/x.json');
  const paramHint = !rejected.ok && rejected.failures[0].hint === 'bad-game-param';
  record('regressions', 'a rejected ?game= value gets the bad-game-param hint', paramHint,
    paramHint ? 'hint class bad-game-param'
      : `hint class ${rejected.ok ? '(accepted!)' : rejected.failures[0].hint}`);
}

// =============================================================================================
// RENDER SUITE (F3) — the published DOM contract, asserted against DOM the real renderer built
// =============================================================================================
//
// WHY THIS SUITE IS SHAPED LIKE THIS
//
// docs/plans/theme-contract.md §2 has already been handed to an external design collaborator
// (delta D11). Their CSS selectors ARE the contract, so DOM that diverges from it — an extra
// wrapper, a renamed class, a `div` where a `button` was promised, a `data-state` carrying a fifth
// value — is a defect in the renderer even when the board looks perfect on screen. Nobody notices
// that class of defect by playing a game; only an assertion does.
//
// jsdom is not available (spec §2.2 forbids npm dependencies), so the boards are built into a real
// element in this page. It is in the document rather than detached, because two of the assertions
// are about FOCUS — `document.activeElement` — and a detached subtree cannot take focus at all.
// `.qbe-harness` (styled in tests/index.html) parks it at zero opacity with pointer-events off, so
// it is fully focusable and fully out of the way of the report.
//
// NOTHING HERE MOCKS THE RENDERER. Bundles come out of the real validator; the boards come out of
// `renderer.renderBoard`; state advances by clicking the real buttons, so the delegated click path,
// the phase machine and `updateBoard` are all exercised rather than described.

const HARNESS_CLASS = 'qbe-harness';

/** A real `section.qbe-stage`, in the document, out of sight. */
function harnessStage() {
  let host = document.querySelector('.' + HARNESS_CLASS);
  if (!host) {
    host = el('div', HARNESS_CLASS);
    document.body.appendChild(host);
  }
  const stage = el('section', 'qbe-stage');
  host.appendChild(stage);
  return stage;
}

// The two documents every bundle needs besides its content file. Fetched once through the REAL
// loader, so the game-type and theme-manifest bytes under test are the shipped ones.
const rawCache = new Map();
async function rawSupport(path, kind) {
  const cacheKey = kind + ' ' + path;
  if (!rawCache.has(cacheKey)) {
    const got = await loader.fetchJsonFile({ path, kind });
    rawCache.set(cacheKey, got);
  }
  return rawCache.get(cacheKey);
}

/**
 * Validate an IN-MEMORY content object into a real CleanedBundle.
 *
 * The synthetic boards (12x12, hostile text, unsorted ranked list, an explicit value override that
 * differs from the ladder) cannot be files: a fixture file is also a thing a person might open and
 * misread as demo content, and the hostile one must never be servable at all.
 */
async function synthBundle(label, contentData, gameTypeId) {
  const gametype = await rawSupport(loader.gametypePath(gameTypeId), KINDS.GAMETYPE);
  const themes = await rawSupport(loader.THEMES_MANIFEST, KINDS.THEMES);
  if (!gametype.ok || !themes.ok) {
    return { ok: false, failures: (gametype.ok ? themes : gametype).failures };
  }
  return validator.validateBundle({
    content: rawDoc('games/(synthetic ' + label + ').json', KINDS.CONTENT, contentData),
    gametype: gametype.value,
    themes: themes.value,
  });
}

/** The same thing for a real file on disk, through the real fetch path. */
async function fileBundle(gamePath) {
  const fetched = await loader.fetchContentBundle({ gamePath });
  if (!fetched.ok) return fetched;
  return validator.validateBundle(fetched.value);
}

/**
 * Render a board wired the way app.js wires it: the handler records the new state and asks the
 * renderer to repaint. That is the whole session seam F6 replaces, and driving it here means the
 * lifecycle assertions test the real round trip instead of the renderer's private opinion.
 */
function drive(bundle, stage) {
  const session = { cellStates: {}, bonusCells: [] };
  const advances = [];
  const view = renderer.renderBoard({
    bundle,
    session,
    mount: stage,
    handlers: {
      onCellAdvance(cellKey, nextState) {
        advances.push(cellKey + '->' + nextState);
        session.cellStates[cellKey] = nextState;
        renderer.updateBoard(view, { bundle, session });
      },
    },
  });
  return { view, session, advances, stage };
}

// ---------------------------------------------------------------------------------------------
// The contract, transcribed
// ---------------------------------------------------------------------------------------------

// Every class name theme-contract §2 names, and no others. An element carrying a class outside this
// set is DOM the contract does not describe, which §2 calls a renderer defect in so many words.
const CONTRACT_CLASSES = new Set([
  'qbe-stage', 'qbe-scorebar', 'qbe-team', 'qbe-team-name', 'qbe-team-score',
  'qbe-board', 'qbe-column', 'qbe-column-label', 'qbe-cell', 'qbe-cell-value', 'qbe-cell-text',
  'qbe-cell-mark',
  'qbe-detail', 'qbe-detail-prompt', 'qbe-detail-answer', 'qbe-detail-actions',
  'qbe-detail-next', 'qbe-detail-close',
]);

// theme-contract §3, verbatim. `null` in the list means "the attribute may also be absent", which is
// how §3 words every boolean-ish one: absent, never `false`.
const CONTRACT_ATTR_VALUES = {
  'data-state': ['hidden', 'revealed', 'answered', 'marked'],
  'data-bonus': ['true'],
  'data-locked': ['true'],
  'data-layout': ['grid', 'ranked-list'],
  'data-animation': ['flip', 'zoom', 'fade'],
  'data-phase': ['prompt', 'answer'],
  'data-active': ['true'],
};

// Which element each attribute is allowed to sit on (§3's "On" column). An attribute on the wrong
// element is as much a divergence as a wrong value: a theme's `\.qbe-cell[data-state]` selector
// would silently miss it.
const CONTRACT_ATTR_HOST = {
  'data-state': '.qbe-cell',
  'data-bonus': '.qbe-cell',
  'data-locked': '.qbe-cell',
  'data-layout': '.qbe-board',
  'data-animation': '.qbe-stage',
  'data-phase': '.qbe-detail',
  'data-active': '.qbe-team',
};

function classOf(node) {
  return node.getAttribute('class') || '';
}

function tagIs(node, tag, className, problems, where) {
  if (node.tagName !== tag) {
    problems.push(where + ': expected <' + tag.toLowerCase() + '>, got <' + node.tagName.toLowerCase() + '>');
  }
  if (classOf(node) !== className) {
    problems.push(where + ': expected class "' + className + '", got "' + classOf(node) + '"');
  }
}

/** Walk the emitted subtree against theme-contract §2. Returns a list of divergences. */
function contractProblems(stage) {
  const problems = [];

  // Class allowlist first: it catches an invented element even when the nesting walk below happens
  // to tolerate it.
  for (const node of stage.querySelectorAll('*')) {
    const cls = classOf(node).trim();
    if (cls === '') { problems.push('<' + node.tagName.toLowerCase() + '> carries no class'); continue; }
    for (const one of cls.split(/\s+/)) {
      if (!CONTRACT_CLASSES.has(one)) problems.push('class "' + one + '" is not in theme-contract §2');
    }
  }

  const children = [...stage.children];
  const scorebar = children.filter((n) => classOf(n) === 'qbe-scorebar');
  const boards = children.filter((n) => classOf(n) === 'qbe-board');
  const details = children.filter((n) => classOf(n) === 'qbe-detail');
  if (children.length !== scorebar.length + boards.length + details.length) {
    problems.push('the stage has children the contract does not name');
  }
  if (boards.length !== 1) problems.push('expected exactly one .qbe-board, got ' + boards.length);
  if (details.length !== 1) problems.push('expected exactly one .qbe-detail, got ' + details.length);
  if (boards.length !== 1 || details.length !== 1) return problems;

  const board = boards[0];
  tagIs(board, 'MAIN', 'qbe-board', problems, '.qbe-board');
  if (!board.hasAttribute('data-layout')) problems.push('.qbe-board has no data-layout');

  let cellCount = 0;
  for (const column of board.children) {
    tagIs(column, 'DIV', 'qbe-column', problems, 'board child');
    const kids = [...column.children];
    let i = 0;
    if (kids.length > 0 && classOf(kids[0]) === 'qbe-column-label') {
      tagIs(kids[0], 'H2', 'qbe-column-label', problems, '.qbe-column-label');
      i = 1;
    }
    if (i === kids.length) problems.push('a .qbe-column contains no cells');
    for (; i < kids.length; i++) {
      const cell = kids[i];
      // The guarantee the whole keyboard/screen-reader story rests on (§2: "Every cell is a real
      // <button>"). A styled div would look identical and be unreachable by keyboard.
      tagIs(cell, 'BUTTON', 'qbe-cell', problems, '.qbe-cell');
      if (!cell.hasAttribute('data-cell')) problems.push('a .qbe-cell has no data-cell');
      if (!cell.hasAttribute('data-state')) problems.push('a .qbe-cell has no data-state');
      cellCount++;

      const inner = [...cell.children];
      const values = inner.filter((n) => classOf(n) === 'qbe-cell-value');
      const texts = inner.filter((n) => classOf(n) === 'qbe-cell-text');
      const marks = inner.filter((n) => classOf(n) === 'qbe-cell-mark');
      if (inner.length !== values.length + texts.length + marks.length) {
        problems.push('a .qbe-cell has an undocumented child');
      }
      if (values.length > 1) problems.push('a .qbe-cell has ' + values.length + ' value elements');
      if (texts.length > 1) problems.push('a .qbe-cell has ' + texts.length + ' text elements');
      if (marks.length !== 1) problems.push('a .qbe-cell has ' + marks.length + ' mark elements (§2: always present)');
      // §2 (v1.1): a value and face text are mutually exclusive. A jeopardy cell printing its prompt
      // on the face would spoil the question, which is the reason the rule is worth asserting.
      if (values.length > 0 && texts.length > 0) {
        problems.push('a .qbe-cell carries BOTH .qbe-cell-value and .qbe-cell-text — §2 makes them exclusive');
      }
      for (const n of inner) {
        if (n.tagName !== 'SPAN') problems.push('cell child is <' + n.tagName.toLowerCase() + '>, expected <span>');
      }
      // §2's guarantee: absent, never empty-but-meaningful.
      for (const v of values) {
        if (v.textContent === '') problems.push('.qbe-cell-value is present but empty — §2 promises absence instead');
      }
      for (const t of texts) {
        if (t.textContent === '') problems.push('.qbe-cell-text is present but empty — §2 promises absence instead');
      }
    }
  }
  if (cellCount === 0) problems.push('the board rendered no cells at all');

  const detail = details[0];
  tagIs(detail, 'DIV', 'qbe-detail', problems, '.qbe-detail');
  if (!detail.hasAttribute('data-phase')) problems.push('.qbe-detail has no data-phase');
  const dk = [...detail.children];
  if (dk.length !== 3) problems.push('.qbe-detail has ' + dk.length + ' children, expected 3');
  else {
    tagIs(dk[0], 'P', 'qbe-detail-prompt', problems, '.qbe-detail child 1');
    tagIs(dk[1], 'P', 'qbe-detail-answer', problems, '.qbe-detail child 2');
    tagIs(dk[2], 'DIV', 'qbe-detail-actions', problems, '.qbe-detail child 3');
    const ak = [...dk[2].children];
    if (ak.length !== 2) problems.push('.qbe-detail-actions has ' + ak.length + ' children, expected 2');
    else {
      tagIs(ak[0], 'BUTTON', 'qbe-detail-next', problems, '.qbe-detail-next');
      tagIs(ak[1], 'BUTTON', 'qbe-detail-close', problems, '.qbe-detail-close');
    }
  }

  return problems;
}

/** Every contract attribute in the subtree carries a permitted value, on a permitted element. */
function attributeProblems(stage) {
  const problems = [];
  const scope = [stage, ...stage.querySelectorAll('*')];
  for (const node of scope) {
    for (const attr of Object.keys(CONTRACT_ATTR_VALUES)) {
      if (!node.hasAttribute(attr)) continue;
      const value = node.getAttribute(attr);
      if (CONTRACT_ATTR_VALUES[attr].indexOf(value) === -1) {
        problems.push(attr + '="' + value + '" is not one of ' + CONTRACT_ATTR_VALUES[attr].join('/'));
      }
      if (!node.matches(CONTRACT_ATTR_HOST[attr])) {
        problems.push(attr + ' sits on ' + (classOf(node) || node.tagName.toLowerCase())
          + ', but §3 puts it on ' + CONTRACT_ATTR_HOST[attr]);
      }
    }
  }
  return problems;
}

function assertContract(label, stage) {
  const structure = contractProblems(stage);
  record('render', label + ': DOM matches theme-contract §2', structure.length === 0,
    structure.length === 0
      ? 'class names, nesting and element types all as published'
      : structure.slice(0, 6).join('; ') + (structure.length > 6 ? ` (+${structure.length - 6} more)` : ''));

  const attrs = attributeProblems(stage);
  record('render', label + ': data-* carry only theme-contract §3 values', attrs.length === 0,
    attrs.length === 0 ? 'every state attribute in range and on its documented element'
      : attrs.slice(0, 6).join('; '));
}

// ---------------------------------------------------------------------------------------------
// Content generators
// ---------------------------------------------------------------------------------------------

/** A 12x12 jeopardy board — the maximum the schema allows (LIMITS 12/12). */
function bigContent() {
  const columns = [];
  for (let c = 0; c < 12; c++) {
    const ladder = [];
    const cells = [];
    for (let r = 0; r < 12; r++) {
      ladder.push((r + 1) * 100);
      cells.push({ prompt: 'Prompt for column ' + c + ' row ' + r, answer: 'What is ' + c + '-' + r + '?' });
    }
    columns.push({ label: 'Column ' + c, valueLadder: ladder, cells });
  }
  return {
    schemaVersion: 1, title: '12x12 stress board', gameType: 'jeopardy',
    theme: 'default', animation: 'fade', board: { columns },
  };
}

// The hostile strings. Every one is a real payload rather than a token like "XSS": the point is that
// the CHARACTERS survive verbatim as text while producing no nodes, and a sanitized-looking string
// would prove neither half.
const HOSTILE_LABEL = '<script>alert("label")</script>';
const HOSTILE_PROMPT = '<img src=x onerror="alert(1)"><script>alert(2)</script> javascript:alert(3)';
const HOSTILE_ANSWER = 'javascript:alert(4)</p><svg onload=alert(5)><a href="javascript:alert(6)">go</a>';

function hostileContent() {
  return {
    schemaVersion: 1, title: 'Hostile content <script>alert(0)</script>', gameType: 'jeopardy',
    theme: 'default', animation: 'fade',
    board: {
      columns: [{
        label: HOSTILE_LABEL,
        valueLadder: [100],
        cells: [{ prompt: HOSTILE_PROMPT, answer: HOSTILE_ANSWER }],
      }],
    },
  };
}

/** A ranked list whose values are deliberately OUT of order, including a tie. */
function unsortedRankedContent() {
  return {
    schemaVersion: 1, title: 'Unsorted ranked answers', gameType: 'feud',
    theme: 'default', animation: 'zoom',
    board: {
      columns: [{
        label: 'Name a number.',
        cells: [
          { answer: 'five', value: 5 },
          { answer: 'forty-two (first)', value: 42 },
          { answer: 'seventeen', value: 17 },
          { answer: 'forty-two (second)', value: 42 },
          { answer: 'nine', value: 9 },
        ],
      }],
    },
  };
}

/** A ladder AND a per-cell value that disagrees with it, so the override is actually observable. */
function overrideContent() {
  return {
    schemaVersion: 1, title: 'Value override', gameType: 'jeopardy',
    theme: 'default', animation: 'fade',
    board: {
      columns: [{
        label: 'Overrides',
        valueLadder: [100, 200, 300],
        cells: [
          { prompt: 'ladder position 1', answer: 'a?' },
          { prompt: 'ladder says 200, cell says 777', answer: 'b?', value: 777 },
          { prompt: 'ladder position 3', answer: 'c?' },
        ],
      }],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------------------------

// Shared with the invariant suite, which asserts the no-inline-style rule against DOM rather than
// only against source text.
let demoStage = null;

async function runRenderSuite() {
  // ---- 1. the real demo board -----------------------------------------------------------------
  const demo = await fileBundle('games/demo.json');
  if (!demo.ok) {
    record('render', 'games/demo.json validates for the render suite', false,
      demo.failures.map(errors.formatFailure).join(' | '));
    return;
  }

  const stage = harnessStage();
  demoStage = stage;
  const { view, advances } = drive(demo.value, stage);

  assertContract('demo.json', stage);

  const cellCount = stage.querySelectorAll('.qbe-cell').length;
  record('render', 'demo.json renders 5x5 = 25 cells', cellCount === 25, cellCount + ' cells');

  const animation = stage.getAttribute('data-animation');
  record('render', 'data-animation lands on .qbe-stage from the content file',
    animation === demo.value.resolved.animation, 'data-animation="' + animation + '"');

  const layout = view.root.getAttribute('data-layout');
  record('render', 'grid game type renders data-layout="grid"', layout === 'grid', 'data-layout="' + layout + '"');

  // Per-cell `value` beats the ladder. demo.json's one explicit value sits on the locked cell.
  const locked = view.cells.get('4:4');
  const lockedValue = locked ? locked.querySelector('.qbe-cell-value') : null;
  const lockedOk = !!locked && locked.getAttribute('data-locked') === 'true'
    && !!lockedValue && lockedValue.textContent === '500';
  record('render', 'demo.json lockValue cell 4:4 is data-locked and shows its own value', lockedOk,
    lockedOk ? 'data-locked="true", face reads 500'
      : 'data-locked=' + (locked && locked.getAttribute('data-locked')) + ', face='
        + (lockedValue && lockedValue.textContent));

  const lockedElsewhere = [...stage.querySelectorAll('.qbe-cell[data-locked]')].map((n) => n.getAttribute('data-cell'));
  record('render', 'data-locked appears only on the cells the validator listed',
    lockedElsewhere.join(',') === demo.value.resolved.lockedValueKeys.join(','),
    'locked cells: ' + (lockedElsewhere.join(',') || '(none)'));

  // data-bonus is F7's. Absent is the CORRECT rendering today (theme-contract §3: absent, not false),
  // so this asserts absence rather than skipping the attribute.
  const bonusNodes = stage.querySelectorAll('[data-bonus]').length;
  record('render', 'no data-bonus before randomization runs (F7)', bonusNodes === 0,
    bonusNodes + ' cells carry data-bonus');
  const activeNodes = stage.querySelectorAll('[data-active]').length;
  record('render', 'no data-active and no .qbe-scorebar before scoring exists (F6)',
    activeNodes === 0 && stage.querySelectorAll('.qbe-scorebar').length === 0,
    'F6 has not landed; §2 requires this bar once scoring is rendered, and jeopardy scoring.model '
    + 'is not "none" — so this assertion inverts when F6 ships');

  // ---- 2. the jeopardy lifecycle, driven by clicking real buttons -----------------------------
  const jCell = view.cells.get('0:0');
  const detail = view.detail;
  jCell.click();
  const openedPhase = detail.root.getAttribute('data-phase');
  const openedLabel = detail.next.textContent;
  const promptShown = detail.prompt.textContent === demo.value.content.board.columns[0].cells[0].prompt;
  record('render', 'opening a cell shows its prompt at data-phase="prompt"',
    openedPhase === 'prompt' && !detail.root.hidden && promptShown,
    'phase=' + openedPhase + ', next button reads "' + openedLabel + '"');

  detail.next.click();
  const afterOne = jCell.getAttribute('data-state');
  const answerShown = !detail.answer.hidden
    && detail.answer.textContent === demo.value.content.board.columns[0].cells[0].answer;
  record('render', 'first advance moves hidden -> revealed and shows the answer',
    afterOne === 'revealed' && detail.root.getAttribute('data-phase') === 'answer' && answerShown,
    'data-state="' + afterOne + '", phase=' + detail.root.getAttribute('data-phase'));

  detail.next.click();
  const afterTwo = jCell.getAttribute('data-state');
  record('render', 'second advance moves revealed -> answered and closes the overlay',
    afterTwo === 'answered' && detail.root.hidden === true,
    'data-state="' + afterTwo + '", overlay hidden=' + detail.root.hidden);

  // Terminal means terminal: re-opening an answered cell is a no-op, which is the host-mis-click
  // path. If this regressed, a spent cell could be advanced past the end of its own lifecycle.
  jCell.click();
  const doneLabel = detail.next.textContent;
  detail.next.click();
  const stopped = advances.join(' ') === '0:0->revealed 0:0->answered';
  record('render', 'the lifecycle STOPS at the terminal state (jeopardy: 3 states, 2 advances)',
    stopped && doneLabel === 'Done' && jCell.getAttribute('data-state') === 'answered',
    stopped ? 'advances: ' + advances.join(', ') + '; a third activation reads "' + doneLabel + '" and changes nothing'
      : 'advances: ' + advances.join(', '));

  const usedMarked = advances.some((a) => a.indexOf('marked') !== -1);
  record('render', 'jeopardy never produces a state outside its own cellLifecycle', !usedMarked,
    'cellLifecycle ' + JSON.stringify(demo.value.gametype.cellLifecycle) + ' -> ' + JSON.stringify(advances));

  // ---- 3. focus restoration and Escape --------------------------------------------------------
  const focusCell = view.cells.get('1:1');
  focusCell.click();
  const focusedNext = document.activeElement === detail.next;
  detail.close.click();
  const restored = document.activeElement === focusCell;
  record('render', 'closing the overlay restores focus to the originating cell', restored,
    restored ? 'focus went to .qbe-detail-next on open and back to [data-cell="1:1"] on close'
      : 'activeElement is ' + (document.activeElement && document.activeElement.className));
  record('render', 'opening the overlay moves focus onto .qbe-detail-next', focusedNext,
    focusedNext ? 'a real button, so Space/Enter advance with no key handling of ours (plan Q12)'
      : 'focus stayed on ' + (document.activeElement && document.activeElement.className));

  const escCell = view.cells.get('2:2');
  const advancesBeforeEsc = advances.length;
  escCell.click();
  // Asserted, not assumed: if the click had failed to open the overlay, "it is closed after Escape"
  // would pass for the wrong reason and the Escape binding could rot unnoticed.
  const wasOpen = detail.root.hidden === false;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const escClosed = wasOpen && detail.root.hidden === true && advances.length === advancesBeforeEsc
    && escCell.getAttribute('data-state') === 'hidden';
  record('render', 'Escape closes the overlay without advancing the cell', escClosed,
    escClosed ? 'overlay was open, Escape hid it, cell still "hidden", no handler call'
      : 'open before Escape=' + wasOpen + ', hidden=' + detail.root.hidden
        + ', state=' + escCell.getAttribute('data-state'));

  // The listener must not outlive the overlay: one that did would swallow Escape for the rest of the
  // session, and nothing on screen would show it.
  const stateBefore = escCell.getAttribute('data-state');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  record('render', 'the Escape listener is removed on close, not left on the document',
    detail.root.hidden === true && escCell.getAttribute('data-state') === stateBefore,
    'a second Escape with the overlay closed changes nothing');

  // ---- 3b. the overlay cannot be re-targeted, and cannot leak a second Escape listener --------
  //
  // The single-open case above cannot see this. `openCell` used to overwrite view.escapeListener
  // without removing the old one, so a second open while the overlay was up left a listener on the
  // document forever: each one called preventDefault and fired onCellClose on every later Escape.
  // It is reachable because the overlay deliberately does not trap focus — a keyboard host can Tab
  // back onto a cell behind the scrim and press Enter. Counted for real by instrumenting
  // document.addEventListener/removeEventListener, then proved by dispatching Escape after close.
  const closes = [];
  const leakStage = harnessStage();
  const leakSession = { cellStates: {}, bonusCells: [] };
  const leakView = renderer.renderBoard({
    bundle: demo.value,
    session: leakSession,
    mount: leakStage,
    handlers: {
      onCellClose() { closes.push(1); },
      onCellAdvance(cellKey, nextState) {
        leakSession.cellStates[cellKey] = nextState;
        renderer.updateBoard(leakView, { bundle: demo.value, session: leakSession });
      },
    },
  });
  let added = 0;
  let removed = 0;
  const docAdd = document.addEventListener;
  const docRemove = document.removeEventListener;
  try {
    document.addEventListener = function (type, fn, opts) {
      if (type === 'keydown') added++;
      return docAdd.call(this, type, fn, opts);
    };
    document.removeEventListener = function (type, fn, opts) {
      if (type === 'keydown') removed++;
      return docRemove.call(this, type, fn, opts);
    };
    renderer.openCell(leakView, '0:0');
    renderer.openCell(leakView, '0:1'); // second open with the first still up
    renderer.openCell(leakView, '0:2'); // and a third
    renderer.closeCell(leakView);
  } finally {
    document.addEventListener = docAdd;
    document.removeEventListener = docRemove;
  }
  const promptAfterReopens = leakView.detail.prompt.textContent;
  const firstPrompt = demo.value.content.board.columns[0].cells[0].prompt;
  const closesBeforeEsc = closes.length;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const leakedCalls = closes.length - closesBeforeEsc;
  record('render', 'a second open while the overlay is up neither re-targets it nor leaks a listener',
    added === 1 && removed === 1 && leakedCalls === 0 && promptAfterReopens === firstPrompt,
    'three openCell calls then one close: ' + added + ' document keydown listener(s) added, '
    + removed + ' removed; an Escape after close fired onCellClose ' + leakedCalls + ' time(s); '
    + 'the overlay still shows the FIRST cell\'s prompt');

  // The board is inert while the overlay is up. The scrim stops clicks but not focus: 25 cells
  // behind a 0.9-alpha scrim were still tabbable, with an invisible focus ring (WCAG 2.4.7), and
  // Enter on one of them swapped the projected question.
  const inertCell = leakView.cells.get('3:3');
  inertCell.click();
  const inertWhileOpen = leakView.root.inert === true;
  leakView.detail.close.click();
  const inertAfterClose = leakView.root.inert === false;
  record('render', 'the board is inert while the overlay is open, and focusable again after close',
    inertWhileOpen && inertAfterClose && document.activeElement === inertCell,
    'inert=' + inertWhileOpen + ' while open, inert=' + leakView.root.inert
    + ' after close, and focus came back to the originating cell');

  // ---- 3c. reopening a cell that has already been played -------------------------------------
  //
  // openCell used to reset data-phase to "prompt" unconditionally, so a host who closed the overlay
  // mid-question could only get the answer back by SPENDING the cell: the button read "Mark it
  // answered" and behaved as "show the answer". The phase now follows the cell's lifecycle state.
  const reopenStage = harnessStage();
  const r = drive(demo.value, reopenStage);
  const rCell = r.view.cells.get('0:0');
  rCell.click();
  r.view.detail.next.click();               // -> revealed, answer phase
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  rCell.click();                            // reopen a `revealed` cell
  const reopenedAnswer = demo.value.content.board.columns[0].cells[0].answer;
  const reopenOk = r.view.detail.root.getAttribute('data-phase') === 'answer'
    && r.view.detail.answer.hidden === false
    && r.view.detail.answer.textContent === reopenedAnswer
    && rCell.getAttribute('data-state') === 'revealed';
  record('render', 'reopening a revealed cell shows the answer again without spending the cell',
    reopenOk,
    'phase=' + r.view.detail.root.getAttribute('data-phase') + ', answer hidden='
    + r.view.detail.answer.hidden + ', cell state=' + rCell.getAttribute('data-state')
    + ', next button reads "' + r.view.detail.next.textContent + '"');

  // ...and the terminal button closes on its FIRST click. It used to fall through to the answer
  // branch, so "Done" re-projected an answer the room had already been given.
  r.view.detail.next.click();               // revealed -> answered (terminal), overlay closes
  rCell.click();                            // reopen a spent cell
  const doneReads = r.view.detail.next.textContent;
  r.view.detail.next.click();
  record('render', 'on a terminal cell the button reads "Done" and one click CLOSES the overlay',
    doneReads === 'Done' && r.view.detail.root.hidden === true
    && rCell.getAttribute('data-state') === 'answered'
    && r.advances.join(' ') === '0:0->revealed 0:0->answered',
    'button read "' + doneReads + '"; after one click hidden=' + r.view.detail.root.hidden
    + ', state=' + rCell.getAttribute('data-state') + ', advances: ' + r.advances.join(', '));

  // ---- 4. ONE delegated click listener, not one per cell ---------------------------------------
  // Structural, and genuinely so: `getEventListeners` is a devtools-only API, so instead the real
  // `addEventListener` is instrumented for the duration of one renderBoard call and every
  // registration it makes is recorded. That counts registrations on the actual nodes, which is the
  // property under test — not a proxy for it.
  const delegationStage = harnessStage();
  const proto = EventTarget.prototype;
  const originalAdd = proto.addEventListener;
  const registrations = [];
  try {
    proto.addEventListener = function (type, fn, opts) {
      registrations.push({ target: this, type });
      return originalAdd.call(this, type, fn, opts);
    };
    drive(demo.value, delegationStage);
  } finally {
    proto.addEventListener = originalAdd;
  }
  const onCells = registrations.filter((r) => r.type === 'click' && r.target instanceof Element
    && r.target.matches('.qbe-cell')).length;
  const onBoard = registrations.filter((r) => r.type === 'click' && r.target instanceof Element
    && r.target.matches('.qbe-board')).length;
  record('render', '25 cells cost ONE delegated click listener on .qbe-board, none per cell',
    onCells === 0 && onBoard === 1,
    onBoard + ' on .qbe-board, ' + onCells + ' on cells, '
      + registrations.filter((r) => r.type === 'click').length + ' click listeners in total');

  // ---- 5. the 12x12 ceiling, timed ------------------------------------------------------------
  const big = await synthBundle('12x12', bigContent(), 'jeopardy');
  if (!big.ok) {
    record('render', '12x12 board validates', false, big.failures.map(errors.formatFailure).join(' | '));
  } else {
    const bigStage = harnessStage();
    const t0 = performance.now();
    const bigView = drive(big.value, bigStage);
    const elapsed = performance.now() - t0;

    const n = bigStage.querySelectorAll('.qbe-cell').length;
    record('render', 'a 12x12 board renders 144 cells', n === 144, n + ' cells');
    const count = bigView.view.root.style.getPropertyValue('--qbe-column-count').trim();
    record('render', 'the board carries --qbe-column-count for the theme grid', count === '12',
      '--qbe-column-count: ' + count);
    assertContract('12x12 synthetic', bigStage);

    // The bound is a REGRESSION TRIPWIRE, not a benchmark. One DocumentFragment and one delegated
    // listener put a 144-cell build in the low single-digit milliseconds on this hardware; 400 ms is
    // ~100x that, so it cannot fail on a slow machine but WILL fail if someone reintroduces
    // per-cell layout thrash or a listener per cell.
    record('render', 'a 12x12 build stays under 400 ms (regression tripwire)', elapsed < 400,
      elapsed.toFixed(1) + ' ms for 144 cells');

    // ZERO FORCED LAYOUT READS, asserted rather than eyeballed. The tripwire above measures wall
    // clock in an unstyled harness, so a regression that read geometry inside the 144-cell loop
    // could hide inside its 400 ms head-room. This patches every accessor that flushes pending
    // layout and requires the count to be 0 for a whole build AND a whole diff: interleaving a read
    // with the writes is what turns one reflow into 144.
    const probeStage = harnessStage();
    let reads = 0;
    const bump = () => { reads++; };
    const patchedProto = [
      [Element.prototype, 'getBoundingClientRect', 'value'],
      [Element.prototype, 'getClientRects', 'value'],
      [HTMLElement.prototype, 'offsetWidth', 'get'],
      [HTMLElement.prototype, 'offsetHeight', 'get'],
      [HTMLElement.prototype, 'offsetTop', 'get'],
      [Element.prototype, 'clientWidth', 'get'],
      [Element.prototype, 'clientHeight', 'get'],
      [Element.prototype, 'scrollHeight', 'get'],
    ];
    const saved = [];
    const originalComputed = window.getComputedStyle;
    try {
      for (const [proto, name, kind] of patchedProto) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (!descriptor) continue;
        saved.push([proto, name, descriptor]);
        if (kind === 'value') {
          Object.defineProperty(proto, name, Object.assign({}, descriptor, {
            value: function (...args) { bump(); return descriptor.value.apply(this, args); },
          }));
        } else {
          Object.defineProperty(proto, name, Object.assign({}, descriptor, {
            get: function () { bump(); return descriptor.get.call(this); },
          }));
        }
      }
      window.getComputedStyle = function (...args) { bump(); return originalComputed.apply(this, args); };
      const probe = drive(big.value, probeStage);
      probe.session.cellStates['0:0'] = 'revealed';
      renderer.updateBoard(probe.view, { bundle: big.value, session: probe.session });
    } finally {
      window.getComputedStyle = originalComputed;
      for (const [proto, name, descriptor] of saved) Object.defineProperty(proto, name, descriptor);
    }
    record('render', 'building and diffing a 144-cell board forces ZERO layout reads', reads === 0,
      reads === 0
        ? 'no getBoundingClientRect / offset* / client* / scroll* / getComputedStyle during '
          + 'renderBoard + updateBoard'
        : reads + ' geometry read(s) — one read interleaved with the writes reflows the whole board');
  }

  // ---- 6. bingo: two states, and "revealed" is not one of them ---------------------------------
  const bingo = await fileBundle('games/demo-bingo.json');
  if (!bingo.ok) {
    record('render', 'games/demo-bingo.json validates', false, bingo.failures.map(errors.formatFailure).join(' | '));
  } else {
    const bStage = harnessStage();
    const b = drive(bingo.value, bStage);
    assertContract('demo-bingo.json', bStage);

    const free = b.view.cells.get('2:2');
    const freeState = free && free.getAttribute('data-state');
    record('render', 'a preMarked cell starts in its TERMINAL state (bingo free space 2:2)',
      freeState === bingo.value.resolved.terminalState && freeState === 'marked',
      'data-state="' + freeState + '"; terminalState=' + bingo.value.resolved.terminalState);

    const plain = b.view.cells.get('0:0');
    plain.click();
    const bingoLabel = b.view.detail.next.textContent;
    b.view.detail.next.click();
    const marked = plain.getAttribute('data-state');
    const closedAfterOne = b.view.detail.root.hidden === true;
    record('render', 'bingo advances hidden -> marked in one step and closes (no answer to show)',
      marked === 'marked' && closedAfterOne && b.advances.join(',') === '0:0->marked',
      'next button read "' + bingoLabel + '"; advances: ' + b.advances.join(','));

    plain.click();
    b.view.detail.next.click();
    const everRevealed = b.advances.some((a) => a.indexOf('revealed') !== -1)
      || bStage.querySelectorAll('.qbe-cell[data-state="revealed"]').length > 0;
    record('render', 'bingo [hidden, marked] NEVER produces "revealed"', !everRevealed,
      'cellLifecycle ' + JSON.stringify(bingo.value.gametype.cellLifecycle)
      + '; advances after four activations: ' + JSON.stringify(b.advances));

    // A bingo square has no point value, so before .qbe-cell-text existed (theme-contract §2 v1.1)
    // every cell on this card was visually EMPTY — the term lived only in the accessible name, which
    // means a screen-reader user could play a board the room could not see. Asserted against the
    // authored prompt, per cell, so a partial regression cannot hide behind one populated cell.
    const bingoCells = [...bStage.querySelectorAll('.qbe-cell')];
    const blank = bingoCells.filter((c) => c.textContent.trim() === '');
    const wrongText = [];
    for (const column of bingo.value.content.board.columns) {
      for (const cell of column.cells) {
        const node = b.view.cells.get(cell.key).querySelector('.qbe-cell-text');
        if (!node || node.textContent !== cell.prompt) wrongText.push(cell.key);
      }
    }
    record('render', 'every bingo square prints its own term in .qbe-cell-text (nothing is blank)',
      blank.length === 0 && wrongText.length === 0 && bingoCells.length === 25,
      blank.length === 0 && wrongText.length === 0
        ? bingoCells.length + ' cells, each showing its authored prompt on the face'
        : blank.length + ' visually blank cell(s); text wrong or missing on ' + wrongText.join(','));

    // The other half of the exclusivity rule: a valueless card must not have grown value elements.
    const valueEls = bStage.querySelectorAll('.qbe-cell-value').length;
    record('render', 'a bingo card renders no .qbe-cell-value at all (no value to print)',
      valueEls === 0, valueEls + ' value elements on a card with no valueLadder');

    const states = new Set([...bStage.querySelectorAll('.qbe-cell')].map((c) => c.getAttribute('data-state')));
    const subset = [...states].every((s) => bingo.value.gametype.cellLifecycle.indexOf(s) !== -1);
    record('render', 'every rendered bingo state is a member of its cellLifecycle', subset,
      'states on the board: ' + [...states].join(', '));
  }

  // ---- 7. ranked-list ordering ----------------------------------------------------------------
  const feud = await fileBundle('games/demo-feud.json');
  if (!feud.ok) {
    record('render', 'games/demo-feud.json validates', false, feud.failures.map(errors.formatFailure).join(' | '));
  } else {
    const fStage = harnessStage();
    const f = drive(feud.value, fStage);
    assertContract('demo-feud.json', fStage);

    const order = [...fStage.querySelectorAll('.qbe-cell')].map((c) => {
      const rec = f.view.records.get(c.getAttribute('data-cell'));
      return rec.cell.value;
    });
    const descending = order.every((v, i) => i === 0 || order[i - 1] >= v);
    record('render', 'ranked-list draws rows in DESCENDING value order (games/demo-feud.json)',
      descending, 'DOM order: ' + order.join(' > '));
    record('render', 'ranked-list renders data-layout="ranked-list" in one column',
      f.view.root.getAttribute('data-layout') === 'ranked-list'
      && f.view.root.style.getPropertyValue('--qbe-column-count').trim() === '1',
      'data-layout="' + f.view.root.getAttribute('data-layout') + '", --qbe-column-count: '
      + f.view.root.style.getPropertyValue('--qbe-column-count').trim());

    // demo-feud.json is authored already-sorted, so on its own it cannot tell a real sort from no
    // sort at all. This one is authored OUT of order, with a tie, so it can.
    const unsorted = await synthBundle('unsorted-ranked', unsortedRankedContent(), 'feud');
    if (!unsorted.ok) {
      record('render', 'unsorted ranked-list board validates', false,
        unsorted.failures.map(errors.formatFailure).join(' | '));
    } else {
      const uStage = harnessStage();
      const u = drive(unsorted.value, uStage);
      const keys = [...uStage.querySelectorAll('.qbe-cell')].map((c) => c.getAttribute('data-cell'));
      const vals = keys.map((k) => u.view.records.get(k).cell.value);
      // 42 (authored 2nd), 42 (authored 4th), 17, 9, 5 — the tie keeps DOCUMENT order, which is why
      // the expectation names keys and not just values.
      const expected = '0:1,0:3,0:2,0:4,0:0';
      record('render', 'an out-of-order ranked list is sorted descending, ties keeping document order',
        keys.join(',') === expected,
        'authored 5,42,17,42,9 -> drawn ' + vals.join(',') + ' (keys ' + keys.join(',') + ')');
    }
  }

  // ---- 8. per-cell value beats the ladder -----------------------------------------------------
  const override = await synthBundle('value-override', overrideContent(), 'jeopardy');
  if (!override.ok) {
    record('render', 'value-override board validates', false,
      override.failures.map(errors.formatFailure).join(' | '));
  } else {
    const oStage = harnessStage();
    const o = drive(override.value, oStage);
    const faces = ['0:0', '0:1', '0:2'].map((k) => {
      const v = o.view.cells.get(k).querySelector('.qbe-cell-value');
      return v ? v.textContent : '(none)';
    });
    record('render', 'a per-cell "value" overrides the column valueLadder on the cell face',
      faces.join(',') === '100,777,300',
      'ladder [100,200,300] with cell 2 overridden to 777 -> faces ' + faces.join(', '));
  }

  // ---- 9. negative controls: the contract checker must be able to FAIL ------------------------
  //
  // A structural comparison that cannot fail is worse than no comparison, because it reads as
  // coverage. So a throwaway board is deliberately broken in the two ways that matter — DOM the
  // contract does not describe, and a state attribute outside §3's enum — and the checkers are
  // required to notice. If either of these ever passes, every "matches theme-contract §2" row above
  // becomes meaningless and this is the row that says so.
  const controlStage = harnessStage();
  drive(demo.value, controlStage);
  controlStage.querySelector('.qbe-column').appendChild(el('div', 'qbe-invented-wrapper'));
  const caughtStructure = contractProblems(controlStage);
  record('render', 'NEGATIVE CONTROL: the §2 checker rejects DOM the contract does not describe',
    caughtStructure.length > 0,
    caughtStructure.length > 0 ? 'an injected div.qbe-invented-wrapper was reported: '
      + caughtStructure[0] : 'the checker accepted an undocumented element — it proves nothing');

  controlStage.querySelector('.qbe-cell').setAttribute('data-state', 'nearly-answered');
  const caughtAttr = attributeProblems(controlStage);
  record('render', 'NEGATIVE CONTROL: the §3 checker rejects a state value outside the enum',
    caughtAttr.length > 0,
    caughtAttr.length > 0 ? 'reported: ' + caughtAttr[0]
      : 'the checker accepted data-state="nearly-answered" — it proves nothing');
  controlStage.remove();

  // ---- 10. security: untrusted content text reaches the DOM as TEXT ONLY -----------------------
  await runRenderSecurityChecks();
}

/**
 * The XSS assertions. Recorded into the `security` group, because that is where a reviewer looks.
 *
 * The renderer is the only module that turns author-supplied strings into DOM, so this is where the
 * no-innerHTML invariant either holds or does not. Two halves, and both are required: ZERO nodes
 * came out of the markup (a sanitizer that stripped the tags would pass this half), and the
 * characters SURVIVED VERBATIM as text (a sanitizer would fail this half — and quietly corrupting a
 * teacher's prompt about `<script>` tags is its own bug).
 */
async function runRenderSecurityChecks() {
  const hostile = await synthBundle('hostile', hostileContent(), 'jeopardy');
  if (!hostile.ok) {
    record('security', 'hostile-content board validates (it is valid JSON, just nasty)', false,
      hostile.failures.map(errors.formatFailure).join(' | '));
    return;
  }

  const stage = harnessStage();
  const h = drive(hostile.value, stage);

  // The exact element census the contract prescribes for a 1x1 board: board, column, label, cell,
  // value, mark, detail, prompt, answer, actions, next, close. Any node parsed out of the payload
  // would push this number up, whatever it looked like.
  const EXPECTED_ELEMENTS = 12;
  const before = stage.querySelectorAll('*').length;

  const cell = h.view.cells.get('0:0');
  cell.click();
  h.view.detail.next.click(); // -> revealed, answer phase: the hostile answer now goes into the DOM
  const after = stage.querySelectorAll('*').length;

  record('security', 'hostile prompt/answer/label add ZERO element nodes to the board',
    before === EXPECTED_ELEMENTS && after === EXPECTED_ELEMENTS,
    before + ' elements before opening the cell, ' + after + ' after the answer is shown; '
    + 'theme-contract §2 prescribes exactly ' + EXPECTED_ELEMENTS + ' for a 1x1 board');

  const injected = stage.querySelectorAll('script, img, svg, iframe, object, embed, a, link, style, form, input');
  record('security', 'no script/img/svg/a/iframe/style node is parsed out of content text',
    injected.length === 0,
    injected.length === 0 ? 'none present'
      : 'FOUND ' + [...injected].map((n) => n.tagName).join(',') + ' — this is a live XSS');

  const label = stage.querySelector('.qbe-column-label');
  const verbatim = label.textContent === HOSTILE_LABEL
    && h.view.detail.prompt.textContent === HOSTILE_PROMPT
    && h.view.detail.answer.textContent === HOSTILE_ANSWER;
  record('security', 'the hostile characters survive VERBATIM as text (nothing is silently stripped)',
    verbatim,
    verbatim ? 'label, prompt and answer all compare === to the authored strings, angle brackets included'
      : 'label=' + JSON.stringify(label.textContent) + '; prompt='
        + JSON.stringify(h.view.detail.prompt.textContent));

  // A `javascript:` string in content text must never become a URL-bearing attribute. The renderer
  // emits no href/src at all, which is the strongest form of that guarantee, so assert the absence
  // of the attributes rather than the safety of their values.
  const urlAttrs = [];
  for (const node of stage.querySelectorAll('*')) {
    for (const attr of node.attributes) {
      if (/^(href|src|srcset|xlink:href|action|formaction|background|poster|data)$/i.test(attr.name)) {
        urlAttrs.push(node.tagName + '@' + attr.name + '=' + attr.value);
      }
    }
  }
  record('security', 'the renderer emits no URL-bearing attribute anywhere in the board',
    urlAttrs.length === 0,
    urlAttrs.length === 0 ? 'no href/src/action/poster on any emitted node'
      : 'FOUND ' + urlAttrs.join(' | '));

  // ---- the theme <link> href ------------------------------------------------------------------
  // Mounted into a DETACHED document so this assertion cannot load default.css over the report page
  // (which would restyle it) and cannot collide with the app's own link.
  const scratch = document.implementation.createHTMLDocument('theme-href');
  const demo = await fileBundle('games/demo.json');
  if (demo.ok) {
    renderer.mountTheme(demo.value.resolved.themeFile, scratch);
    const href = scratch.getElementById('qbe-theme').getAttribute('href');
    const manifestValues = Object.keys(demo.value.themes.themes).map((k) => demo.value.themes.themes[k]);
    const fromManifest = manifestValues.indexOf(demo.value.resolved.themeFile) !== -1;
    record('security', 'the theme href is themes/ + a bare manifest VALUE, nothing else',
      href === 'themes/' + demo.value.resolved.themeFile && fromManifest,
      'content asked for theme "' + demo.value.content.theme + '"; manifest resolved it to '
      + demo.value.resolved.themeFile + '; href="' + href + '"');
  }

  // A content file cannot influence the href, and the proof is in two places at once: the renderer
  // REFUSES anything that is not a bare manifest filename, and the validator refuses a content file
  // that tries to name a file instead of a manifest key.
  const HOSTILE_THEMES = [
    'https://evil.example/x.css', '//evil.example/x.css', '../evil.css', '/etc/passwd.css',
    'javascript:alert(1)', 'default.css?v=1', 'default.css#x', 'themes/default.css',
    'default.css onerror=alert(1)', '', 'default.CSS\n', 'default.js',
  ];
  const accepted = [];
  for (const value of HOSTILE_THEMES) {
    let threw = false;
    try {
      renderer.mountTheme(value, document.implementation.createHTMLDocument('t'));
    } catch (_err) {
      threw = true;
    }
    if (!threw) accepted.push(JSON.stringify(value));
  }
  record('security', 'mountTheme refuses every string that is not a bare manifest CSS filename',
    accepted.length === 0,
    accepted.length === 0 ? 'all ' + HOSTILE_THEMES.length + ' hostile hrefs rejected'
      : 'ACCEPTED ' + accepted.join(', ') + ' — a content file could point the <link> off-origin');

  const filenameAsTheme = await synthBundle('theme-as-filename', (() => {
    const c = hostileContent();
    c.theme = 'midnight.css'; // a FILE name, not a manifest KEY
    return c;
  })(), 'jeopardy');
  record('security', 'a content file naming a CSS FILE (not a manifest key) fails validation',
    filenameAsTheme.ok === false,
    filenameAsTheme.ok ? 'ACCEPTED theme:"midnight.css" — a content file is choosing a filename'
      : 'refused: ' + errors.formatFailure(filenameAsTheme.failures[0]));
}

// ---------------------------------------------------------------------------------------------
// Shell suite — the app shell, booted for real, with its stylesheets actually applied
//
// WHY THIS EXISTS. Every other render assertion in this file runs in `.qbe-harness`, which is parked
// in <body> rather than inside .reveal/.slides and deliberately loads no theme CSS: those assertions
// test the DOM the renderer EMITS, which is the right thing for them to test. But that made a whole
// class of defect structurally invisible, and Phase 2 shipped two of them at once:
//
//   · index.html linked no base theme layer, so selecting `midnight` (which is games/demo.json, i.e.
//     what "/" loads with no ?game=) loaded midnight.css INSTEAD of default.css. midnight.css is an
//     override sheet with no layout in it, so the board had no grid, the cells were raw UA buttons
//     and .qbe-detail was `position: static` — an "overlay" laid out underneath the board.
//   · REVEAL_CONFIG.display was 'block', which reveal.js writes as an INLINE style on the slide, so
//     the theme's `section.qbe-stage { display: flex }` could never apply and the board collapsed to
//     the cell minimum height with two thirds of the screen empty.
//
// Both are computed-style facts about a real boot, so that is what this suite checks: the shell in an
// iframe, one game per shipped theme, asserting the three geometry properties the whole projected
// board rests on. It is the only place in the suite where theme CSS is loaded at all.
// ---------------------------------------------------------------------------------------------

const SHELL_BOOT_TIMEOUT_MS = 10000;

/** Boot index.html in an iframe and resolve once the board is on screen with its CSS applied. */
function bootShell(gamePath) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    // 1200x900 so the density clamps land in the same range a classroom projector uses; the frame is
    // visible-but-offscreen rather than display:none, because a display:none iframe has no layout and
    // getComputedStyle would report values no host would ever see.
    frame.width = '1200';
    frame.height = '900';
    frame.style.setProperty('position', 'absolute');
    frame.style.setProperty('left', '-4000px');
    frame.style.setProperty('top', '0');
    frame.setAttribute('title', 'shell boot: ' + gamePath);
    // Resolved against <base href="../">, i.e. the repo root — the real shell, not a copy of it.
    frame.setAttribute('src', 'index.html?game=' + gamePath);
    document.body.appendChild(frame);

    const started = performance.now();
    const poll = () => {
      let doc = null;
      try {
        doc = frame.contentDocument;
      } catch (_err) {
        doc = null;
      }
      const board = doc && doc.querySelector('.qbe-board');
      const themed = board && doc.defaultView
        && doc.defaultView.getComputedStyle(board).getPropertyValue('display') !== 'block';
      if (board && themed) {
        resolve({ frame, doc, win: doc.defaultView, board, timedOut: false });
        return;
      }
      if (performance.now() - started > SHELL_BOOT_TIMEOUT_MS) {
        resolve({ frame, doc, win: doc && doc.defaultView, board, timedOut: true });
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}

async function runShellSuite() {
  // One game per shipped theme, and the pairing matters: demo.json is the DEFAULT game (no ?game=)
  // and selects `midnight`, the override-only sheet that cannot stand alone.
  const cases = [
    { game: 'games/demo.json', theme: 'midnight' },
    { game: 'games/demo-bingo.json', theme: 'default' },
  ];

  for (const { game, theme } of cases) {
    const booted = await bootShell(game);
    const { frame, doc, win, board } = booted;
    try {
      if (booted.timedOut || !board || !win) {
        record('shell', `${game} (theme "${theme}") boots and draws a themed board`, false,
          booted.timedOut ? `no themed .qbe-board within ${SHELL_BOOT_TIMEOUT_MS} ms`
            : 'the iframe produced no board at all');
        continue;
      }

      // The base layer really is loaded, and by the SHELL rather than by a theme. Checked by href so
      // a future refactor that renames the link id still passes for the right reason.
      const sheets = [...doc.styleSheets].map((sheet) => sheet.href || '(inline)');
      const hasBase = sheets.some((href) => /themes\/default\.css$/.test(href));
      const hasSelected = sheets.some((href) => new RegExp('themes/' + theme + '\\.css$').test(href));
      record('shell', `${game}: default.css is loaded as the base layer under themes/${theme}.css`,
        hasBase && hasSelected,
        'stylesheets: ' + sheets.map((h) => h.replace(/^.*\//, '')).join(', '));

      const stage = doc.querySelector('.qbe-stage');
      const stageDisplay = win.getComputedStyle(stage).getPropertyValue('display');
      record('shell', `${game}: the stage is a flex container, so the board can fill the screen`,
        stageDisplay === 'flex',
        'computed display on .qbe-stage is "' + stageDisplay + '" (reveal writes it inline from '
        + 'REVEAL_CONFIG.display; "block" collapses the board to the cell minimum)');

      const boardStyle = win.getComputedStyle(board);
      const tracks = boardStyle.getPropertyValue('grid-template-columns');
      const columnCount = board.style.getPropertyValue('--qbe-column-count').trim();
      const trackCount = tracks.trim().split(/\s+/).filter((t) => t !== '' && t !== 'none').length;
      record('shell', `${game}: .qbe-board is a real grid with one track per column`,
        boardStyle.getPropertyValue('display') === 'grid' && trackCount === Number(columnCount),
        'display=' + boardStyle.getPropertyValue('display') + ', --qbe-column-count=' + columnCount
        + ', grid-template-columns resolves to ' + trackCount + ' track(s)');

      const detail = doc.querySelector('.qbe-detail');
      const detailStyle = win.getComputedStyle(detail);
      record('shell', `${game}: .qbe-detail is an overlay (positioned, above the board)`,
        detailStyle.getPropertyValue('position') === 'absolute'
        && Number(detailStyle.getPropertyValue('z-index')) > 0,
        'position=' + detailStyle.getPropertyValue('position') + ', z-index='
        + detailStyle.getPropertyValue('z-index')
        + ' (static means the prompt lays out UNDER the board instead of over it)');

      // The board has to be legible from the back of a room, so a cell must be a real target rather
      // than a UA-sized button. 44px is the platform touch/hit minimum and is the floor the theme's
      // --cell-min-height encodes; an unthemed cell measured 38x21.
      const cell = doc.querySelector('.qbe-cell');
      const rect = cell.getBoundingClientRect();
      record('shell', `${game}: a cell is a projector-sized target, not a UA-sized button`,
        rect.height >= 44 && rect.width >= 80,
        'first cell measures ' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ' px at a '
        + frame.width + 'x' + frame.height + ' viewport');

      // theme-contract §3's one <html> attribute. Nothing else in the suite covers app.js's
      // watchReducedMotion, and the CSS side of spec §8 keys off exactly this.
      const reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const attr = doc.documentElement.getAttribute('data-reduced-motion');
      record('shell', `${game}: <html data-reduced-motion> mirrors the OS preference`,
        reduced ? attr === 'true' : attr === null,
        'prefers-reduced-motion: reduce is ' + reduced + ', attribute is '
        + (attr === null ? 'absent' : '"' + attr + '"') + ' (theme-contract §3: absent, never "false")');
    } finally {
      frame.remove();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Invariant suite — the named CLAUDE.md invariant, asserted at runtime
//
// The grep in CI would be better, but spec §2.1 forbids Actions. So we check what we can from
// inside the browser: fetch our own source and look for the forbidden APIs. This catches a
// contributor who adds `innerHTML` and never runs a grep.
// ---------------------------------------------------------------------------------------------

// Repo-root-relative, because index.html sets <base href="../"> so that the loader's file
// identity strings resolve correctly. See the comment on that tag.
//
// THIS LIST IS SEEDS, NOT THE WHOLE SET. It used to be a hardcoded five-entry list of JS files,
// which meant the check only covered the files somebody remembered to add to it — so F3 could land
// `js/renderer.js` (the one module that will build DOM nodes out of untrusted content text) with an
// `innerHTML` in it, and this suite would stay green while printing "clean" five times about five
// other files. So instead we seed with the ENTRY POINTS and follow their imports transitively: a
// module that is actually reachable from the app or from this suite cannot escape the audit.
const ENTRY_SOURCES = [
  'index.html', // the app shell — its inline module leads to app.js and everything it draws
  'tests/index.html', // this suite's own page
  'tools/firefox-run-tests.py', // the Firefox driver: SPDX only in practice, but it is source
];

/**
 * Resolve a relative import specifier found inside `from`.
 *
 * JS resolves against the importing module's own directory. HTML inline modules resolve against the
 * DOCUMENT BASE, which for both pages in this repo is the repo root (index.html sits there, and
 * tests/index.html sets <base href="../"> for exactly that reason).
 */
function resolveSpecifier(from, spec) {
  const parts = /\.html$/.test(from) ? [] : from.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Every relative `import … from '…'` / `import '…'` specifier in a source text. */
function importedPaths(from, text) {
  const out = [];
  const re = /\bimport\b[^'"();]*['"](\.[^'"]+)['"]/g;
  let m = re.exec(text);
  while (m) {
    out.push(resolveSpecifier(from, m[1]));
    m = re.exec(text);
  }
  return out;
}
// WHY THIS IS ASSEMBLED FROM FRAGMENTS RATHER THAN WRITTEN AS ONE REGEX LITERAL:
// this file is itself reachable from ENTRY_SOURCES, and a literal /innerHTML/ in its own source
// would make the
// check flag itself — which it did, on the first run. Splitting the needles means the forbidden
// words never appear as contiguous text here, so runner.js stays honestly scannable instead of
// being excluded from its own audit. Comment-stripping alone could not fix this: a regex literal
// is code, not a comment.
// Two needles are written to catch more than one spelling, because the near-miss is the whole
// problem: `document.write\b` does NOT match `document.writeln` (the 'l' is a word character, so the
// boundary fails) even though writeln has exactly the same effect, and matching only the `new`
// constructor form misses the bare `Function("return " + userText)` call. The parenthesis form
// catches both call shapes at once, and no legitimate line in this repo names the constructor.
// Each needle carries its OWN trailing boundary: a single `\b` after the group would break the
// parenthesis needle, because there is no word boundary between "(" and the quote that follows it.
const FORBIDDEN = new RegExp(
  '\\b(' + [
    'inner' + 'HTML\\b',
    'outer' + 'HTML\\b',
    'insertAdjacent' + 'HTML\\b',
    'document\\.write(?:ln)?\\b',
    'ev' + 'al\\b',
    'Func' + 'tion\\s*\\(',
  ].join('|') + ')',
);

async function runInvariantSuite() {
  const queue = ENTRY_SOURCES.slice();
  const seen = new Set(queue);
  // Source text kept per file so the post-loop assertions can interrogate a module we have already
  // fetched instead of fetching it twice.
  const sources = new Map();

  for (let q = 0; q < queue.length; q++) {
    const src = queue[q];
    let text;
    try {
      const res = await fetch(src + '?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) { record('invariants', `read ${src}`, false, `HTTP ${res.status}`); continue; }
      text = await res.text();
    } catch (err) {
      record('invariants', `read ${src}`, false, `fetch failed: ${err && err.message}`);
      continue;
    }

    // Follow the import graph. Anything reachable joins the queue, so the audit widens by itself
    // when a module is added instead of when someone remembers to widen it.
    //
    // EXCEPT /vendor/, and this exemption is the plan's, not a convenience. Plan Q9 asks the
    // question directly — "does the no-innerHTML invariant bind vendored reveal.js?" — and answers
    // "No, and it cannot": reveal.js uses innerHTML internally, and we vendor it as a pinned,
    // unmodified, hash-recorded dependency (delta D3/D4). The invariant binds OUR code and every
    // path that carries user-authored content. So the audit stops at the vendor boundary rather
    // than reporting a violation it must never act on — and rather than tempting anyone to "fix"
    // 112 KB of minified third-party code, which would break the provenance hashes and with them
    // spec §2.3's supply-chain claim. Its MIT LICENSE is vendor/reveal.js/LICENSE; it carries no
    // AGPL SPDX header for the same reason: it is not our file.
    for (const next of importedPaths(src, text)) {
      if (next.indexOf('vendor/') === 0) continue;
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }

    // Strip comments before scanning: this very file names the forbidden APIs in prose, and a check
    // that cannot survive being documented is a check nobody will keep. The line-comment strip is
    // ANCHORED TO THE LINE. It used to be /(^|\s)\/\/[^\n]*/, which also deleted from a `//` inside a
    // string literal to end of line — so `const u = 'http: //x'; el.innerHTML = s;` stripped down to
    // `const u = 'http: ` and the violation on the rest of that line became invisible. Every comment
    // in this repo is written at the start of its own line, so anchoring costs nothing.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
    sources.set(src, code);
    const hit = FORBIDDEN.exec(code);
    // Label deliberately avoids naming the forbidden APIs — see the FORBIDDEN comment above.
    record('invariants', `${src} uses no forbidden DOM or dynamic-code API`, !hit,
      hit ? `found "${hit[1]}" — this is a build-stopping invariant violation` : 'clean');

    const hasSpdx = /SPDX-License-Identifier:\s*AGPL-3\.0-or-later/.test(text);
    record('invariants', `${src} carries the SPDX header`, hasSpdx, hasSpdx ? 'present' : 'missing');

    // Spec §5 / module-contracts §4.2: the byte cap is enforced BEFORE JSON.parse, so a hostile
    // 40 MB file never reaches the parser. The oversized fixture cannot prove this — every static
    // server, including GitHub Pages, sends Content-Length, so that test always short-circuits at
    // the cheap header pre-check and the authoritative post-body check is never reached. So we
    // assert the ORDER in the source we have already fetched: the cap's early return has to appear
    // before the parse call, not merely be commented as if it did.
    if (src === 'js/loader.js') {
      const capAt = code.indexOf('bytes > cap');
      const parseAt = code.indexOf('JSON.par' + 'se(text)');
      const ordered = capAt !== -1 && parseAt !== -1 && capAt < parseAt;
      record('invariants', 'loader enforces the byte cap before it parses', ordered,
        ordered ? `cap at index ${capAt}, parse at ${parseAt}`
          : `cap at ${capAt}, parse at ${parseAt} — the cap must come first (spec §5)`);
    }
  }

  // -------------------------------------------------------------------------------------------
  // F3: CONFIRM the audit actually reached the two new modules.
  //
  // The transitive walk is supposed to widen by itself, but "supposed to" is exactly the claim that
  // silently stopped being true the last time this list was hardcoded. So the reachability is
  // asserted rather than assumed: if a future refactor moved app.js behind a `src=` attribute or a
  // dynamic import the regex cannot see, this fails loudly instead of the audit quietly shrinking.
  // Every module in js/, not just the two F3 added. The specifier regex deliberately excludes `(`,
  // so a module reached ONLY through a dynamic `import('./x.js')` would be invisible to the walk and
  // would be scanned by neither the forbidden-API check nor the SPDX check above. Nothing in js/ uses
  // a dynamic import today; naming the whole module list here is what makes that stay true loudly
  // rather than quietly.
  for (const module of ['js/loader.js', 'js/validator.js', 'js/errors.js', 'js/schemas.js',
    'js/renderer.js', 'js/app.js']) {
    const reached = seen.has(module) && sources.has(module);
    record('invariants', `the transitive source audit reaches ${module}`, reached,
      reached ? `followed in from an entry point; ${sources.get(module).length} chars scanned`
        : 'NOT REACHED — the forbidden-API and SPDX checks above never looked at this file');
  }

  // -------------------------------------------------------------------------------------------
  // The renderer's one permitted inline style.
  //
  // theme-contract §4 only works if the renderer imposes no visual decisions of its own: a single
  // inline declaration outranks every theme rule that is not `!important`, so one stray
  // `style.width` would be unoverridable by the external collaborator and undiscoverable from the
  // contract. `--qbe-column-count` is the documented exception — a per-board NUMBER the theme
  // consumes, not a layout the renderer imposes.
  const rendererCode = sources.get('js/renderer.js');
  if (rendererCode) {
    const styleUses = rendererCode.match(/\.style\b[^;\n]*/g) || [];
    const bad = styleUses.filter((use) => use.indexOf(".style.setProperty('--qbe-column-count'") !== 0);
    const attrStyle = /setAttribute\(\s*['"]style['"]/.test(rendererCode) || /cssText/.test(rendererCode);
    record('invariants', 'renderer.js sets no inline style but the --qbe-column-count property',
      bad.length === 0 && !attrStyle,
      bad.length === 0 && !attrStyle
        ? `${styleUses.length} use of .style, and it is the documented custom property`
        : `found ${JSON.stringify(bad)}${attrStyle ? ' plus a style attribute / cssText write' : ''}`);
  }

  // The same rule checked against DOM rather than source, because a `.style` write is not the only
  // way to end up with a style attribute.
  if (demoStage) {
    const offenders = [];
    for (const node of [demoStage, ...demoStage.querySelectorAll('*')]) {
      const value = node.getAttribute('style');
      if (value === null) continue;
      if (node.matches('.qbe-board') && /^\s*--qbe-column-count:\s*\d+\s*;?\s*$/.test(value)) continue;
      offenders.push((node.getAttribute('class') || node.tagName) + ' style="' + value + '"');
    }
    record('invariants', 'the rendered board carries no style attribute except --qbe-column-count',
      offenders.length === 0,
      offenders.length === 0 ? 'only .qbe-board has one, and it is the custom property alone'
        : offenders.join(' | '));
  }

  // -------------------------------------------------------------------------------------------
  // Every token theme-contract §4 publishes is really defined in themes/default.css.
  //
  // This is the fallback layer's load-bearing promise ("A theme may override any subset; unset
  // tokens fall back", §4). A token that appears in the contract but not in default.css breaks that
  // for every theme that does not set it, AND misleads the external collaborator into styling
  // against a variable that resolves to nothing. The token list is PARSED OUT OF THE MARKDOWN so
  // the contract stays the single source of truth: adding a row to §4 automatically adds an
  // assertion here, which is the only way this check cannot rot.
  try {
    const [mdRes, cssRes] = await Promise.all([
      fetch('docs/plans/theme-contract.md?v=' + Date.now(), { cache: 'no-store' }),
      fetch('themes/default.css?v=' + Date.now(), { cache: 'no-store' }),
    ]);
    if (!mdRes.ok || !cssRes.ok) throw new Error(`HTTP ${mdRes.status}/${cssRes.status}`);
    const md = await mdRes.text();
    const defaultCss = await cssRes.text();

    // Section 4 only. §3's table names data-* attributes and §5/§6 discuss tokens in prose; the
    // token REFERENCE is what a theme author reads as the complete set.
    const afterFour = md.split('## 4. Token reference')[1] || '';
    const section = afterFour.split('\n## ')[0];
    const tokens = [...new Set(section.match(/--[a-z][a-z0-9-]*/g) || [])].sort();

    const missing = tokens.filter((t) => !new RegExp(t + '\\s*:').test(defaultCss));
    record('invariants', `every token in theme-contract §4 is defined in themes/default.css (${tokens.length} tokens)`,
      tokens.length > 0 && missing.length === 0,
      tokens.length === 0 ? 'PARSED NO TOKENS — the §4 heading or table shape changed, so this check went blind'
        : missing.length === 0 ? `all ${tokens.length} present`
          : `MISSING from default.css: ${missing.join(', ')}`);
  } catch (err) {
    record('invariants', 'every token in theme-contract §4 is defined in themes/default.css', false,
      `could not compare: ${err && err.message}`);
  }

  // -------------------------------------------------------------------------------------------
  // Zero CDN, in the theme layer too (spec §2.3, theme-contract §5.6).
  //
  // Comments are stripped FIRST, because both shipped themes correctly document "no @import, no
  // url() to another host" in a header comment — and a check that fires on its own documentation is
  // a check somebody deletes.
  for (const file of ['themes/default.css', 'themes/midnight.css']) {
    try {
      const res = await fetch(file + '?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const css = (await res.text()).replace(/\/\*[\s\S]*?\*\//g, '');
      const imports = /@import/.test(css);
      const remote = css.match(/url\(\s*['"]?\s*(?:https?:|\/\/)/gi) || [];
      record('invariants', `${file} makes no external request (no @import, no http(s) url())`,
        !imports && remote.length === 0,
        !imports && remote.length === 0 ? 'self-contained'
          : `${imports ? '@import present; ' : ''}${remote.length} remote url() reference(s)`);
    } catch (err) {
      record('invariants', `${file} makes no external request (no @import, no http(s) url())`, false,
        `could not read: ${err && err.message}`);
    }
  }

  // The limits in the schema must match the numbers the spec and README promise.
  const limitChecks = [
    ['content file bytes', LIMITS.contentFileBytes, 1048576],
    ['max columns', LIMITS.maxColumns, 12],
    ['max cells per column', LIMITS.maxCellsPerColumn, 12],
    ['max prompt chars', LIMITS.maxPromptChars, 2000],
    ['max label chars', LIMITS.maxLabelChars, 80],
  ];
  for (const [label, actual, expected] of limitChecks) {
    record('invariants', `limit: ${label}`, actual === expected,
      actual === expected ? `${actual}` : `spec says ${expected}, schema says ${actual}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Reporting — DOM built with createElement/textContent only. The invariant binds this file too.
// ---------------------------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function renderReport(mount) {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const failed = total - passed;

  const summary = el('div', failed === 0 ? 'summary pass' : 'summary fail');
  summary.appendChild(el('strong', null, failed === 0 ? 'PASS' : 'FAIL'));
  summary.appendChild(el('span', null, ` ${passed}/${total} assertions`));
  if (failed > 0) summary.appendChild(el('span', 'count', ` — ${failed} failing`));
  mount.appendChild(summary);

  const groups = [...new Set(results.map((r) => r.group))];
  for (const group of groups) {
    const rows = results.filter((r) => r.group === group);
    const groupFailed = rows.filter((r) => !r.passed).length;

    const section = el('section');
    const heading = el('h2', null, `${group} — ${rows.length - groupFailed}/${rows.length}`);
    section.appendChild(heading);

    for (const r of rows) {
      const row = el('div', r.passed ? 'row ok' : 'row bad');
      row.appendChild(el('span', 'mark', r.passed ? '✓' : '✗'));
      row.appendChild(el('span', 'name', r.name));
      row.appendChild(el('span', 'detail', r.detail));
      section.appendChild(row);

      // Spec §7: show the actual human-facing error output, not just a verdict. This is the part
      // a reviewer reads to judge whether the message would help a stranger fix their file.
      if (r.failures && r.failures.length > 0) {
        const box = el('div', 'errorscreen');
        errors.renderErrorScreen(r.failures, box);
        section.appendChild(box);
      }
    }
    mount.appendChild(section);
  }

  // Machine-readable hooks for the Chrome/Firefox MCP walkthroughs, so cross-browser runs read a
  // value instead of scraping rendered text.
  document.title = `${failed === 0 ? 'PASS' : 'FAIL'} ${passed}/${total} — Quiz Board Engine tests`;
  window.__TEST_RESULTS__ = { passed, failed, total, ok: failed === 0, results };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export async function run(mount) {
  mount.appendChild(el('p', 'running', 'Running…'));

  let manifest;
  try {
    const res = await fetch(MANIFEST + '?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    mount.textContent = '';
    const box = el('div', 'summary fail');
    box.appendChild(el('strong', null, 'Could not load the fixture manifest.'));
    box.appendChild(el('p', null, `${MANIFEST}: ${err && err.message}`));
    box.appendChild(el('p', null,
      'If you opened this file directly, that is the cause: file:// blocks module imports and '
      + 'fetch. Serve the repo root over HTTP — python3 -m http.server 8000 — then open '
      + 'http://localhost:8000/tests/.'));
    mount.appendChild(box);
    document.title = 'FAIL 0/0 — Quiz Board Engine tests';
    window.__TEST_RESULTS__ = { passed: 0, failed: 1, total: 1, ok: false, results: [] };
    return;
  }

  // Fixtures run concurrently: 27 sequential round trips is slow enough that people stop running
  // the suite, and a suite nobody runs protects nothing. Order in the report comes from the
  // manifest, not from completion order.
  await Promise.all(manifest.map(runFixture));
  results.sort((a, b) => manifest.findIndex((m) => m.file === a.name) - manifest.findIndex((m) => m.file === b.name));

  runSecuritySuite();
  runScannerSuite();
  runRegressionSuite();
  await runCleaningSuite();
  // Before the invariants: the invariant suite asserts the no-inline-style rule against a board the
  // render suite has already built, so it needs real DOM to look at.
  await runRenderSuite();
  // After the render suite (which needs no CSS) and before the invariants: this one boots the real
  // shell in an iframe, so it is the only place theme CSS is loaded and computed geometry is checked.
  await runShellSuite();
  await runInvariantSuite();

  mount.textContent = '';
  renderReport(mount);
}
