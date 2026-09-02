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
// F6/F7/F10 additions. Importing state.js here does the same two jobs the renderer import does: the
// state and bonus suites drive the REAL module (never a copy of its arithmetic), and the import is
// also what pulls js/state.js into the transitive source audit below, so its forbidden-API and SPDX
// checks happen for the same reason every other module's do.
import * as state from '../js/state.js';
import { KINDS, LIMITS, NOTE_KEY } from '../js/schemas.js';

const MANIFEST = 'tests/fixtures/manifest.json';
const THEME_MANIFEST = 'themes/themes.json';
const THEMES_DIR = 'themes/';

// ---------------------------------------------------------------------------------------------
// The theme manifest, read ONCE and shared by the theme audit and the shell suite.
//
// WHY IT IS READ AT RUNTIME RATHER THAN LISTED HERE. Both suites used to carry a hardcoded pair of
// themes — `['themes/default.css', 'themes/midnight.css']` in the invariant sweep, and two literal
// {game, theme} cases in the shell suite. Three donated themes (civic, chalkboard, marquee) were
// then added to themes/themes.json and the suite went on reporting a full green without ever
// fetching one of them. That is the same defect class as the hardcoded ENTRY_SOURCES list this file
// already fixed once: a check that silently narrows itself as the repo grows. Reading the manifest
// means a sixth theme cannot arrive untested — it is audited the moment it is registered, which is
// also the moment it becomes loadable (spec §6.4).
// ---------------------------------------------------------------------------------------------

let themeManifestPromise = null;

/** Resolve to `[{ name, file }]` in manifest order. Rejects loudly; callers record the failure. */
function loadThemeManifest() {
  if (!themeManifestPromise) {
    themeManifestPromise = fetch(THEME_MANIFEST + '?v=' + Date.now(), { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        const map = json && typeof json.themes === 'object' && json.themes !== null ? json.themes : null;
        if (!map) throw new Error('no "themes" object in ' + THEME_MANIFEST);
        return Object.keys(map).map((name) => ({ name, file: map[name] }));
      });
  }
  return themeManifestPromise;
}

/** CSS with comments removed. Every scan below runs on this, never on the raw text — see §6.4. */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

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
  'qbe-strikes', 'qbe-strike-mark', 'qbe-team-strikes',
  'qbe-cell-mark',
  'qbe-detail', 'qbe-detail-prompt', 'qbe-detail-answer', 'qbe-detail-actions',
  'qbe-detail-next', 'qbe-detail-close',
  // contract v1.3 (F6/F7/F10): the host controls. The score bar published in v1.2 was a READOUT —
  // it could display a score but gave the host no way to change one, no way to mark whose turn it
  // is, and nowhere to hang Export/Import. Transcribed here from theme-contract §2 for the same
  // reason as everything above it: the published document is the authority, and this set is how a
  // divergence gets caught by an assertion rather than by the design collaborator.
  'qbe-team-controls', 'qbe-btn', 'qbe-toolbar', 'qbe-file',
  'qbe-setup', 'qbe-setup-panel', 'qbe-setup-title', 'qbe-setup-note', 'qbe-setup-body',
  'qbe-setup-actions', 'qbe-field', 'qbe-field-input',
  'qbe-session', 'qbe-session-title', 'qbe-session-meta',
  // contract v1.5 (F8): the win rail. A completed pattern is an announcement to the room, so it is
  // DOM the design collaborator has to be able to style — which is why it went into the published
  // contract before it went into the renderer, and why it is transcribed here like everything else.
  'qbe-wins', 'qbe-win',
]);

// theme-contract §3, verbatim. `null` in the list means "the attribute may also be absent", which is
// how §3 words every boolean-ish one: absent, never `false`.
const CONTRACT_ATTR_VALUES = {
  'data-state': ['hidden', 'revealed', 'answered', 'marked'],
  'data-bonus': ['true'],
  'data-locked': ['true'],
  // contract v1.4: "this cell moved at runtime", written only by updateBoard. It is what the theme
  // layer's animation selectors are gated on, so a wrong value would silently disable every reveal
  // animation rather than break anything visible in the DOM.
  'data-animate': ['true'],
  'data-layout': ['grid', 'ranked-list'],
  'data-animation': ['flip', 'zoom', 'fade'],
  'data-phase': ['prompt', 'answer'],
  'data-active': ['true'],
  // contract v1.3. `data-team`, `data-session` and `data-delta` are absent from this table on
  // purpose: they carry a NUMBER, not a value from a closed set, so there is no enum to check them
  // against. `data-delta` was also absent from the contract itself until v1.6 — the renderer had
  // been writing it on the score bar's buttons the whole time, so the published "closed attribute
  // set" was not closed and a collaborator's `.qbe-btn:not([data-delta])` would have surprised them.
  'data-screen': ['teams', 'resume'],
  // contract v1.5: which line completed. The values are spec §4.2's pattern set verbatim, and the
  // detector is driven by the game type's own `patterns` list, so an id outside this set reaching
  // the DOM would mean the renderer invented a pattern the config never asked for.
  'data-pattern': ['row', 'column', 'diagonal', 'full-card'],
  'data-action': [
    'score-up', 'score-down', 'export', 'import', 'teams',
    'add-team', 'start', 'cancel', 'resume', 'discard', 'new',
  ],
};

// Which element each attribute is allowed to sit on (§3's "On" column). An attribute on the wrong
// element is as much a divergence as a wrong value: a theme's `\.qbe-cell[data-state]` selector
// would silently miss it.
const CONTRACT_ATTR_HOST = {
  'data-state': '.qbe-cell',
  'data-bonus': '.qbe-cell',
  'data-locked': '.qbe-cell',
  'data-animate': '.qbe-cell',
  'data-layout': '.qbe-board',
  'data-animation': '.qbe-stage',
  'data-phase': '.qbe-detail',
  'data-active': '.qbe-team',
  'data-screen': '.qbe-setup',
  'data-pattern': '.qbe-win',
  'data-action': '.qbe-btn',
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
  // contract v1.3: the toolbar and the pre-game overlay are stage children too.
  const chrome = children.filter((n) => classOf(n) === 'qbe-toolbar' || classOf(n) === 'qbe-setup'
    || classOf(n) === 'qbe-wins' || classOf(n) === 'qbe-strikes');
  if (children.length !== scorebar.length + boards.length + details.length + chrome.length) {
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
      // §2, amended by D14: a cell never prints its QUESTION on the face but may print its ANSWER.
      // A jeopardy cell printing its prompt would spoil the question, which is the reason the rule
      // is worth asserting at all — so the rule is kept and narrowed rather than dropped. The one
      // cell allowed both children is a revealed ranked-list row: answer on the left, points on the
      // right. A HIDDEN ranked row is still forbidden both, or the reveal is given away.
      const rankedRevealed = board.getAttribute('data-layout') === 'ranked-list'
        && cell.getAttribute('data-state') !== 'hidden';
      if (values.length > 0 && texts.length > 0 && !rankedRevealed) {
        problems.push('a .qbe-cell carries BOTH .qbe-cell-value and .qbe-cell-text, and it is not a '
          + 'revealed ranked-list row — §2 allows both only there');
      }
      // DOM ORDER IS LOAD-BEARING on a ranked list and nowhere else: default.css lays the row out
      // with `justify-content: space-between`, so first child means left edge. A value emitted
      // before its text would print "38  Their keys" — right answer, wrong board.
      if (rankedRevealed && values.length > 0 && texts.length > 0
        && inner.indexOf(texts[0]) > inner.indexOf(values[0])) {
        problems.push('a revealed ranked-list row emits .qbe-cell-value BEFORE .qbe-cell-text — §2 '
          + 'orders them answer-then-points');
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

  // contract v1.5: the win rail, when the game type has one. `<aside>` and `<div>` are named in §2
  // as surely as `<button>` is for a cell — a theme's selector is written against the class, but the
  // element type is what decides whether the rail lands in the stage's flow at all.
  for (const rail of children.filter((n) => classOf(n) === 'qbe-wins')) {
    tagIs(rail, 'ASIDE', 'qbe-wins', problems, '.qbe-wins');
    if (rail.children.length > 0 && rail.hidden) {
      problems.push('.qbe-wins holds ' + rail.children.length + ' win(s) but is still hidden');
    }
    if (rail.children.length === 0 && !rail.hidden) {
      problems.push('.qbe-wins is empty but not hidden — §2 promises absence over an empty box');
    }
    for (const item of rail.children) {
      tagIs(item, 'DIV', 'qbe-win', problems, '.qbe-win');
      if (!item.hasAttribute('data-pattern')) problems.push('a .qbe-win has no data-pattern');
      if (item.textContent.trim() === '') problems.push('a .qbe-win is present but empty');
      if (item.children.length !== 0) problems.push('a .qbe-win has children; §2 gives it text only');
    }
  }

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
/**
 * A ranked board whose top answer is the EMPTY STRING.
 *
 * A valid content file: `schemas.js` puts no `minLength` on a string and `validator.js` checks a
 * required cell field for presence, not for content — so `"answer": ""` reaches the renderer. It
 * used to put an empty `.qbe-cell-text` on the face, against theme-contract §2's "text content is
 * never empty-but-meaningful: if a value is absent, the element is absent". The §2 contract checker
 * counts cell children and never reads their text, so it structurally cannot catch this one; it
 * needs its own assertion, which is why this fixture exists rather than a line in an existing one.
 */
/**
 * A three-round ranked board (`D17`). Three columns, so "one round at a time" has something to be
 * true of — `games/demo-feud.json` has a single column and cannot distinguish a board that hides
 * inactive rounds from one that has none to hide.
 */
function threeRoundContent() {
  return {
    schemaVersion: 1, title: 'Three rounds', gameType: 'feud',
    theme: 'default', animation: 'fade',
    board: {
      columns: [
        { label: 'Round 1', cells: [{ answer: 'Eggs', value: 40 }, { answer: 'Toast', value: 20 }] },
        { label: 'Round 2', cells: [{ answer: 'Dog', value: 50 }, { answer: 'Fish', value: 10 }] },
        { label: 'Round 3', cells: [{ answer: 'Soccer', value: 45 }, { answer: 'Golf', value: 15 }] },
      ],
    },
  };
}

function emptyAnswerRankedContent() {
  return {
    schemaVersion: 1, title: 'Ranked answers, one of them blank', gameType: 'feud',
    theme: 'default', animation: 'zoom',
    board: {
      columns: [{
        label: 'Name a number.',
        cells: [
          { answer: '', value: 50 },
          { answer: 'twelve', value: 12 },
        ],
      }],
    },
  };
}

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

  // ---- 5b. a RESUMED board does not replay the whole board's reveal ---------------------------
  // theme-contract §3/§8 (v1.4). `data-state` alone cannot tell "this cell just moved" from "this
  // cell was BUILT already spent", and a resumed session is nothing but the second kind. Measured
  // before the gate existed: booting a maxed 12x12 board with all 144 cells answered and
  // animation "flip" started 288 animations (qbe-flip-card + qbe-flip-face) on the first painted
  // frame — the entire board flipping itself over to announce that a page had loaded.
  //
  // Asserted on the marker rather than on document.getAnimations(): the marker is the contract the
  // theme layer is written against, and it is checkable without a stylesheet attached to this
  // harness. The CSS half — that every theme's cell animation selector actually requires the
  // marker — is asserted in the theme suite.
  if (big.ok) {
    const resumedStage = harnessStage();
    const resumedSession = { cellStates: {}, bonusCells: [] };
    for (const column of big.value.content.board.columns) {
      for (const cell of column.cells) resumedSession.cellStates[cell.key] = 'answered';
    }
    const resumedView = renderer.renderBoard({
      bundle: big.value,
      session: resumedSession,
      mount: resumedStage,
      handlers: { onCellAdvance() {} },
    });
    const built = [...resumedStage.querySelectorAll('.qbe-cell')];
    const answered = built.filter((c) => c.getAttribute('data-state') === 'answered').length;
    const armedAtBuild = built.filter((c) => c.hasAttribute('data-animate')).length;
    record('render', 'resuming a fully played 12x12 board arms ZERO cell animations',
      built.length === 144 && answered === 144 && armedAtBuild === 0,
      answered + ' of ' + built.length + ' cells built in "answered"; ' + armedAtBuild
        + ' carry data-animate (each one would start a card flip AND a face fade on frame one)');

    // ...and the marker must still arrive when a cell really moves, or the gate would have deleted
    // the animations rather than timed them.
    resumedSession.cellStates['0:0'] = 'revealed';
    renderer.updateBoard(resumedView, { bundle: big.value, session: resumedSession });
    const moved = resumedView.cells.get('0:0');
    const armedAfter = [...resumedStage.querySelectorAll('.qbe-cell[data-animate="true"]')];
    record('render', 'a cell that moves at runtime gets data-animate="true", and only that cell',
      moved.getAttribute('data-animate') === 'true' && armedAfter.length === 1,
      'moved cell data-animate="' + moved.getAttribute('data-animate') + '"; '
        + armedAfter.length + ' cell(s) armed board-wide after one updateBoard');
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

    // ---- F9, the whole scoped feature (spec §10 F9, plan Q11) ---------------------------------
    //
    // Feud is a ranked answer-reveal board and NOTHING ELSE: strikes and steals are host-mediated
    // and deliberately not modeled. So "does it play end to end" is three claims, and these are
    // them: a hidden row spoils nothing, revealing shows the answer WITH its points, and a resumed
    // session puts the revealed rows back. Points are awarded with the same team controls jeopardy
    // uses (asserted in the state suite, which is where scoring lives).
    const topRow = f.view.records.get('0:0');
    const hiddenValue = topRow.button.querySelector('.qbe-cell-value');
    record('render', 'a hidden ranked row prints no point value, so the reveal is not spoiled',
      hiddenValue === null && topRow.button.getAttribute('data-state') === feud.value.resolved.initialState,
      hiddenValue === null ? 'the highest-scoring row shows no number until it is revealed'
        : 'the row already reads "' + hiddenValue.textContent + '" while still hidden');

    // ---- EVERY RANKED ROW MUST ANNOUNCE ITSELF DISTINCTLY -------------------------------------
    //
    // Phase 5 walkthrough finding, and the reason this assertion exists at all: on a feud board
    // every row shares the survey question and every unplayed row reports "points hidden", so all
    // six announced as ONE identical sentence and a screen-reader user could not tell which row
    // they had landed on. Sighted users have the physical order; this is the equivalent.
    //
    // Asserted as "all names distinct" rather than against fixed strings, because the useful
    // property is uniqueness — a future rewording must keep it without having to edit this line.
    const feudNames = [...fStage.querySelectorAll('.qbe-cell')]
      .map((c) => c.getAttribute('aria-label'));
    record('render', 'every ranked-list row has its own accessible name (not six identical ones)',
      feudNames.length > 1 && new Set(feudNames).size === feudNames.length,
      feudNames.length + ' rows, ' + new Set(feudNames).size + ' distinct names — first is: "'
        + feudNames[0] + '"');
    // The position is the DRAWN one. drawOrder sorts this layout by descending value, so a row
    // numbered by its authored index would announce a number that contradicts the screen.
    record('render', 'the ranked-list position announced is the drawn one, counting from 1',
      /(^|, )answer 1 of 6(,|$)/.test(feudNames[0] || '')
      && /(^|, )answer 6 of 6(,|$)/.test(feudNames[feudNames.length - 1] || ''),
      'first row announces "' + feudNames[0] + '"; last row announces "'
        + feudNames[feudNames.length - 1] + '"');

    topRow.button.click();
    const promptText = f.view.detail.prompt.textContent;
    f.view.detail.next.click();
    const answerLine = f.view.detail.answer.textContent;
    const revealedValue = topRow.button.querySelector('.qbe-cell-value');
    record('render', 'revealing a ranked row shows the answer AND its point value (plan Q11)',
      answerLine === 'Their keys — 38 points'
      && revealedValue !== null && revealedValue.textContent === '38'
      && promptText === feud.value.content.board.columns[0].label,
      'overlay prompt = the survey question; overlay answer = "' + answerLine + '"; the row face now reads "'
        + (revealedValue ? revealedValue.textContent : '(nothing)') + '"');

    // ---- THE ANSWER IS ON THE BOARD, NOT ONLY IN THE OVERLAY (D14) ----------------------------
    //
    // WHY THIS ASSERTION EXISTS, in the words of the run that found the gap: the suite already
    // asserted the reveal three ways and every one of them passed while the board was broken. The
    // assertion above reads `f.view.detail.answer` — the OVERLAY — and the hidden-row assertion
    // above reads the face of a row that has not been revealed. Nothing looked at the face of a
    // REVEALED row. The overlay closes; what the room keeps looking at is the board, and the board
    // was showing "38" and no answer at all while the row's own accessible name said "answer shown".
    // A sighted room could not read a board a screen-reader user could — the bingo defect of v1.1,
    // mirrored exactly, and shipped because every test watched the moment of the reveal instead of
    // the state it leaves behind.
    const revealedText = topRow.button.querySelector('.qbe-cell-text');
    record('render', 'a revealed ranked row keeps its ANSWER on the board face, not just in the overlay',
      revealedText !== null && revealedText.textContent === 'Their keys',
      revealedText === null
        ? 'the row face carries no .qbe-cell-text at all — the answer exists only in the closed overlay'
        : 'the row face reads "' + revealedText.textContent + '"');

    // Order, because default.css lays the row out with `justify-content: space-between`: whichever
    // element is emitted first sits at the left edge. Answer left, points right.
    const revealedKids = [...topRow.button.children].map((n) => n.className);
    record('render', 'a revealed ranked row emits the answer BEFORE the points (left, then right)',
      revealedKids.indexOf('qbe-cell-text') !== -1
      && revealedKids.indexOf('qbe-cell-text') < revealedKids.indexOf('qbe-cell-value'),
      'row children in order: ' + (revealedKids.join(', ') || '(none)'));

    // The other half of the same rule, and the one that keeps the fix honest: printing the answer
    // on reveal is only correct if a row that has NOT been revealed prints nothing. Asserted on a
    // different row than the one revealed above, so it cannot pass by accident of ordering.
    const stillHidden = f.view.records.get('0:1');
    const hiddenText = stillHidden.button.querySelector('.qbe-cell-text');
    record('render', 'a hidden ranked row prints no answer either, so nothing is given away',
      hiddenText === null,
      hiddenText === null ? 'an unrevealed row carries no .qbe-cell-text'
        : 'an unrevealed row already reads "' + hiddenText.textContent + '"');

    // The resume path, at the renderer's seam: a session that already holds `revealed` rows must
    // build them revealed, values and all, without anybody clicking anything.
    const resumedFeud = harnessStage();
    renderer.renderBoard({
      bundle: feud.value,
      session: { cellStates: { '0:0': 'revealed', '0:2': 'revealed' }, bonusCells: [] },
      mount: resumedFeud,
      handlers: {},
    });
    const shown = [...resumedFeud.querySelectorAll('.qbe-cell')]
      .filter((c) => c.getAttribute('data-state') === 'revealed')
      .map((c) => c.getAttribute('data-cell')).sort();
    const shownValues = [...resumedFeud.querySelectorAll('.qbe-cell-value')].map((v) => v.textContent).sort();
    record('render', 'a resumed ranked-list board restores exactly the rows that were revealed',
      shown.join(',') === '0:0,0:2' && shownValues.join(',') === '15,38',
      'rebuilt from cellStates alone: rows ' + shown.join(',') + ' revealed, showing '
        + shownValues.join(' and ') + ' points');

    // ---- THE SAME TWO CLAIMS, ON THE BUILD PATH RATHER THAN THE UPDATE PATH (D14) --------------
    //
    // WHY THIS IS A SEPARATE ASSERTION and not a duplicate of the two above. A row is BUILT hidden
    // and gains both children on reveal, so everything asserted after a click exercises
    // `updateBoard` and never `buildCell`. Mutation M2 proved the gap rather than argued it:
    // swapping the two appendChild calls in `buildCell` — points before answer — left the suite at
    // 373/373 green. A resumed board is the only place a row is built already revealed, so it is
    // the only place `buildCell`'s ordering is observable at all. M2 fails here.
    const resumedRow = [...resumedFeud.querySelectorAll('.qbe-cell')]
      .find((c) => c.getAttribute('data-cell') === '0:0');
    const resumedText = resumedRow ? resumedRow.querySelector('.qbe-cell-text') : null;
    record('render', 'a ranked row BUILT revealed carries its answer on the face, not just one clicked open',
      resumedText !== null && resumedText.textContent === 'Their keys',
      resumedText === null ? 'the rebuilt row carries no .qbe-cell-text — resume drops the answer'
        : 'the rebuilt row reads "' + resumedText.textContent + '"');

    const resumedKids = resumedRow ? [...resumedRow.children].map((n) => n.className) : [];
    record('render', 'a ranked row BUILT revealed orders answer before points, as the update path does',
      resumedKids.indexOf('qbe-cell-text') !== -1
      && resumedKids.indexOf('qbe-cell-text') < resumedKids.indexOf('qbe-cell-value'),
      'rebuilt row children in order: ' + (resumedKids.join(', ') || '(none)'));

    // The contract checker's own ordering rule (§2) needs a board with a REVEALED ranked row to
    // have anything to look at; the fresh board asserted earlier is all hidden, so this is the run
    // that actually exercises it.
    assertContract('demo-feud.json (resumed, rows revealed)', resumedFeud);

    // ---- THE TWO NEW CROSS-CHECKS, EXERCISED (D15 / D17) --------------------------------------
    //
    // WHY THIS BLOCK EXISTS. Adversarial review disabled BOTH `stateStrikesInBounds` and
    // `stateCurrentRoundInBounds` outright — replaced the strikes loop with `for (const key of [])`
    // and prefixed the round check with `false &&` — and the suite stayed at PASS 405/405. Two
    // validator rules could be deleted whole without a single assertion noticing, while the
    // register recorded them as covered. The checkpoints in the plan claimed the error screen; only
    // the code was ever true, never the evidence.
    //
    // Driven through `validator.validateState` directly, with a real bundle, because that is the
    // one seam every untrusted-state path goes through (`app.js` resume AND import both land here).
    const feudForChecks = await fileBundle('games/demo-feud.json');
    if (!feudForChecks.ok) {
      record('state', 'the feud bundle loads for the cross-check assertions', false, 'it did not');
    } else {
      // TWO TEAMS on the probe session, because `D18`'s inner bound is checked against the teams
      // the session carries — with an empty roster every strike entry is out of bounds and the
      // cap assertion below could never reach the check it names.
      const stateDoc = (strikes, currentRound) => {
        const data = {
          schemaVersion: 1, appVersion: '1.0.0', gameHash: 'a'.repeat(64),
          gameTitle: 'Cross-check probe', createdAt: '2026-09-01T10:00:00Z',
          updatedAt: '2026-09-01T10:00:00Z',
          teams: [{ name: 'Red', score: 0 }, { name: 'Blue', score: 0 }],
          cellStates: {}, bonusCells: [],
        };
        if (strikes !== undefined) data.strikes = strikes;
        if (currentRound !== undefined) data.currentRound = currentRound;
        return { path: 'probe', kind: KINDS.STATE, text: JSON.stringify(data), data };
      };
      const judge = (strikes, currentRound, bundle) =>
        validator.validateState({ raw: stateDoc(strikes, currentRound), bundle: bundle || feudForChecks.value });

      // OVER THE GAME TYPE'S CAP. Deliberately 4, not 99: 99 is refused by the STRUCTURAL `max: 10`
      // in schemas.js and never reaches the contract stage at all — which is what the plan's own
      // M9 got wrong. 4 is the smallest value only this cross-check can reject.
      const over = judge({ '0': { '0': 4 } });
      record('state', 'an imported session with more strikes than the game type allows is refused',
        !over.ok && over.failures.some((f) => f.path === 'strikes["0"]["0"]'),
        over.ok ? 'ACCEPTED four strikes on a game type whose cap is three'
          : over.failures.map((f) => f.path + ': ' + f.message).join(' | ').slice(0, 180));

      const offBoard = judge({ '5': { '0': 1 } });
      record('state', 'an imported session with strikes on a column the board does not have is refused',
        !offBoard.ok && offBoard.failures.some((f) => f.path === 'strikes["5"]'),
        offBoard.ok ? 'ACCEPTED strikes on column 5 of a one-column board'
          : offBoard.failures.map((f) => f.message).join(' | ').slice(0, 160));

      // Absence is the switch, so a jeopardy session carrying ANY strike entry is out of bounds —
      // but an EMPTY map is not an entry and must still load, or every session written before D15
      // becomes an error screen.
      const onJeopardy = judge({ '0': { '0': 1 } }, undefined, demo.value);
      const emptyOnJeopardy = judge({}, undefined, demo.value);
      record('state', 'strikes on a game type that declares none are refused, but an empty map still loads',
        !onJeopardy.ok && emptyOnJeopardy.ok,
        'a jeopardy session with {"0":1} was ' + (onJeopardy.ok ? 'ACCEPTED' : 'refused')
        + '; with {} it was ' + (emptyOnJeopardy.ok ? 'accepted, as it must be' : 'REFUSED'));

      // A non-canonical key passes both `/^\d+$/` and `Number()`, then addresses nothing: the
      // session SAYS three strikes on round 0 and renders zero.
      const leadingZero = judge({ '00': { '0': 3 } });
      record('state', 'a non-canonical column key ("00") is refused rather than silently ignored',
        !leadingZero.ok,
        leadingZero.ok ? 'ACCEPTED "00", which strikesFor() then reads as nothing'
          : 'refused: ' + leadingZero.failures.map((f) => f.message).join(' | ').slice(0, 150));

      // `D18`. The inner bound is the TEAM, checked against the roster this session carries.
      // A session naming team 5 of a two-team game is the same stale-import class as a cell key
      // on a board that has since shrunk: left unchecked the count sits there invisibly and
      // reappears the moment a sixth team is added.
      const offRoster = judge({ '0': { '5': 1 } });
      record('state', 'an imported session with strikes against a team that does not exist is refused',
        !offRoster.ok && offRoster.failures.some((f) => f.path === 'strikes["0"]["5"]'),
        offRoster.ok ? 'ACCEPTED strikes against team 5 of a two-team session'
          : offRoster.failures.map((f) => f.message).join(' | ').slice(0, 170));

      // D17's half. demo-feud.json has ONE column, so round 1 is already off the end.
      const badRound = judge(undefined, 1);
      const goodRound = judge(undefined, 0);
      record('state', 'an imported session naming a round the board does not have is refused',
        !badRound.ok && badRound.failures.some((f) => f.path === 'currentRound') && goodRound.ok,
        badRound.ok ? 'ACCEPTED currentRound 1 on a one-column board'
          : badRound.failures.map((f) => f.message).join(' | ').slice(0, 170)
            + '; currentRound 0 was ' + (goodRound.ok ? 'accepted' : 'WRONGLY REFUSED'));
    }

    // ---- STRIKES (D15 / D16) --------------------------------------------------------------------
    //
    // Two surfaces and one number. The number lives in the session, so the display assertions here
    // are about the SURFACES agreeing with it — the cap itself is enforced in `state` and asserted
    // in the state suite, because a cap that only exists in the drawing code would let a fourth
    // strike into an exported file (`M7`).
    const strikeRounds = await synthBundle('strike-rounds', threeRoundContent(), 'feud');
    if (!strikeRounds.ok) {
      record('render', 'a ranked board for the strike assertions validates', false,
        strikeRounds.failures.map(errors.formatFailure).join(' | '));
    } else {
      const sStage = harnessStage();
      const sView = renderer.renderBoard({
        bundle: strikeRounds.value, session: { cellStates: {}, bonusCells: [] },
        mount: sStage, handlers: {},
      });
      const overlay = sStage.querySelector('.qbe-strikes');

      record('render', 'a feud board draws a strike band with one mark per allowed strike',
        overlay !== null && overlay.querySelectorAll('.qbe-strike-mark').length === 3,
        overlay === null ? 'no .qbe-strikes element was built at all'
          : overlay.querySelectorAll('.qbe-strike-mark').length + ' marks for a strikes.count of 3');

      // Hidden at zero: an empty frame parked over the board all game stops being noticed exactly
      // when it starts mattering.
      record('render', 'the strike band is hidden until there is a strike to show',
        overlay !== null && overlay.hidden === true,
        overlay ? 'hidden=' + overlay.hidden + ' at zero strikes' : '(no band)');

      renderer.updateStrikes(sView, 2);
      const struck = () => [...sStage.querySelectorAll('.qbe-strike-mark')]
        .filter((m) => m.getAttribute('data-struck') === 'true').length;
      record('render', 'two strikes mark two of the three slots and leave the third open',
        struck() === 2 && overlay.hidden === false,
        struck() + ' of 3 marks struck; band hidden=' + overlay.hidden);

      // M11. Marks are aria-hidden decoration; the COUNT is the container's accessible name. Drawn
      // without one, the band looks right on a projector and is silent to a screen reader — which
      // is the same defect F9b shipped when a face claimed "answer shown" while showing nothing.
      record('render', 'the strike band announces the count, and the marks themselves are decoration',
        overlay.getAttribute('aria-label') === '2 strikes of 3'
        && [...overlay.querySelectorAll('.qbe-strike-mark')].every((m) => m.getAttribute('aria-hidden') === 'true'),
        'aria-label="' + overlay.getAttribute('aria-label') + '", marks aria-hidden: '
        + [...overlay.querySelectorAll('.qbe-strike-mark')].every((m) => m.getAttribute('aria-hidden') === 'true'));

      // Singular, because "1 strikes of 3" read aloud is exactly the kind of detail that makes a
      // screen reader sound broken.
      renderer.updateStrikes(sView, 1);
      record('render', 'the announcement is singular at one strike',
        overlay.getAttribute('aria-label') === '1 strike of 3',
        'aria-label="' + overlay.getAttribute('aria-label') + '"');

      renderer.updateStrikes(sView, 99);
      record('render', 'the band cannot draw more marks than the game type allows',
        struck() === 3,
        'updateStrikes(99) struck ' + struck() + ' of 3');

      // M10. A game type with no `strikes` block gets NO element — absent, not empty. Same idiom as
      // `scoring.model: "none"` producing no score bar.
      const noStrikeStage = harnessStage();
      renderer.renderBoard({
        bundle: demo.value, session: { cellStates: {}, bonusCells: [] },
        mount: noStrikeStage, handlers: {},
      });
      record('render', 'a game type that declares no strikes draws no strike band at all',
        noStrikeStage.querySelector('.qbe-strikes') === null,
        noStrikeStage.querySelector('.qbe-strikes') === null
          ? 'jeopardy has no strikes block and no .qbe-strikes element'
          : 'jeopardy drew a .qbe-strikes element it has no use for');

      // ---- THE VISIBLE HALF OF D18, WHICH HAD NO ASSERTION AT ALL --------------------------------
      //
      // Adversarial review deleted four separate pieces of `D18`'s rendering and the suite stayed
      // at 422/422: every row painting team 0's count, the undo button never rendered, the band
      // ignoring the active team, and the `strikesFor` max fallback returning 0. Every assertion
      // `D18` shipped lived in the state and cross-check groups; none reached the renderer. The
      // sentence actually ratified — "every team row shows its OWN count rather than only the
      // active one" — was untested, and the PRE-`D18` renderer would have passed.
      const panelStage = harnessStage();
      const panel = renderer.renderScorePanel({
        bundle: strikeRounds.value,
        session: { teams: [{ name: 'Red', score: 0 }, { name: 'Blue', score: 0 }], cellStates: {}, bonusCells: [] },
        mount: panelStage,
        handlers: {},
      });
      renderer.updateScorePanel(panel, {
        session: { teams: [{ name: 'Red', score: 0 }, { name: 'Blue', score: 0 }], cellStates: {}, bonusCells: [] },
        activeTeam: 0,
        strikes: [2, 1],
      });
      const rowMarks = [...panelStage.querySelectorAll('.qbe-team-strikes')].map((n) => n.textContent);
      record('render', 'each team row draws ITS OWN strike count, not the active team\'s',
        rowMarks.length === 2 && rowMarks[0] === '✗✗' && rowMarks[1] === '✗',
        'rows drew ' + JSON.stringify(rowMarks) + ' for per-team counts [2, 1]');

      // The count joins the team's own accessible name, so a screen-reader host hears one utterance
      // per team rather than a detached number.
      const blueName = panelStage.querySelector('.qbe-team[data-team="1"] .qbe-team-name');
      record('render', 'a team\'s strike count joins that team\'s accessible name',
        /Blue, 0 points, 1 strike$/.test(blueName.getAttribute('aria-label') || ''),
        'Blue announces "' + blueName.getAttribute('aria-label') + '"');

      // The toolbar control D18 was ratified to add, and the gate that keeps it honest.
      const tbStage = harnessStage();
      const tb = renderer.renderToolbar({
        mount: tbStage,
        handlers: { onStrike() {}, onStrikeUndo() {}, onStrikesClear() {}, onExport() {}, onImport() {} },
      });
      const undoBtn = tbStage.querySelector('[data-action="strike-undo"]');
      const strikeBtn = tbStage.querySelector('[data-action="strike"]');
      record('render', 'the toolbar carries an undo control when the game type has strikes',
        undoBtn !== null && strikeBtn !== null,
        'strike button ' + (strikeBtn ? 'present' : 'MISSING') + ', undo button '
        + (undoBtn ? 'present' : 'MISSING'));

      // A control that silently does nothing is worse than one visibly unavailable — the rule the
      // score buttons already follow. With no team marked, both strike controls are inert.
      //
      // GUARDED, because an assertion must fail RED rather than throw. Mutating the undo button out
      // of existence made the line below dereference null, which rejected the suite's promise and
      // showed as a hang — the same failure mode a shadowed variable produced earlier in this file.
      // A mutation that kills the runner proves nothing; it has to produce a report.
      if (!strikeBtn || !undoBtn) {
        record('render', 'the strike controls disable when they would do nothing, and say why', false,
          'the toolbar did not render both strike controls, so their enabled state could not be measured');
      } else {
      tb.setStrikeEnabled(false, false);
      const offState = { strike: strikeBtn.disabled, undo: undoBtn.disabled, why: strikeBtn.title };
      tb.setStrikeEnabled(true, false);
      const noStrikes = { strike: strikeBtn.disabled, undo: undoBtn.disabled };
      tb.setStrikeEnabled(true, true);
      const armed = { strike: strikeBtn.disabled, undo: undoBtn.disabled };
      record('render', 'the strike controls disable when they would do nothing, and say why',
        offState.strike === true && offState.undo === true && /Click a team name/.test(offState.why)
        && noStrikes.strike === false && noStrikes.undo === true
        && armed.strike === false && armed.undo === false,
        'no team: strike disabled=' + offState.strike + ' undo disabled=' + offState.undo
        + ' ("' + offState.why + '"); team with none: undo disabled=' + noStrikes.undo
        + '; team with strikes: undo disabled=' + armed.undo);
      }

      // The band follows the ACTIVE team, and its documented fallback is the round's highest count
      // — the only honest single number for a round several teams have played, and it must never
      // under-report. `strikesFor` with no team index is that fallback.
      const twoTeamSession = { strikes: { '0': { '0': 3, '1': 1 } } };
      record('render', 'strikesFor reports a team\'s own count, and the round\'s highest with no team',
        state.strikesFor(twoTeamSession, 0, 0) === 3 && state.strikesFor(twoTeamSession, 0, 1) === 1
        && state.strikesFor(twoTeamSession, 0) === 3,
        'team 0: ' + state.strikesFor(twoTeamSession, 0, 0) + ', team 1: '
        + state.strikesFor(twoTeamSession, 0, 1) + ', no team: ' + state.strikesFor(twoTeamSession, 0));

      assertContract('feud board with strikes', sStage);
    }

    // ---- ONE ROUND AT A TIME (D17) ------------------------------------------------------------
    //
    // A `.qbe-column` is a CATEGORY on a grid board and a ROUND on a ranked list. The renderer, not
    // the theme, owns which rounds are on screen, so this is asserted against the DOM rather than
    // against CSS — and `demo-feud.json` cannot carry these assertions at all, because with one
    // column a board that hides inactive rounds is indistinguishable from one with none to hide.
    const rounds = await synthBundle('three-round', threeRoundContent(), 'feud');
    if (!rounds.ok) {
      record('render', 'a three-round ranked board validates', false,
        rounds.failures.map(errors.formatFailure).join(' | '));
    } else {
      const rStage = harnessStage();
      const rView = renderer.renderBoard({
        bundle: rounds.value, session: { cellStates: {}, bonusCells: [] },
        mount: rStage, handlers: {},
      });
      const cols = () => [...rStage.querySelectorAll('.qbe-column')];
      const shown = () => cols().filter((c) => !c.hidden)
        .map((c) => c.querySelector('.qbe-column-label').textContent);

      record('render', 'a ranked board shows exactly one round, and it is the first',
        shown().length === 1 && shown()[0] === 'Round 1',
        cols().length + ' rounds built, ' + shown().length + ' on screen: ' + (shown().join(', ') || '(none)'));

      // M14. Hiding with CSS alone would leave these cells in the accessibility tree and in the tab
      // order — a keyboard host could open a cell in a round the room cannot see. `hidden` removes
      // them for everybody and `inert` survives a theme overriding `[hidden]`, so both are asserted
      // rather than just the one that happens to be sufficient today.
      const offRound = cols().filter((c) => c.getAttribute('data-round') !== '0');
      record('render', 'inactive rounds are hidden AND inert, not merely styled out of sight',
        offRound.length === 2 && offRound.every((c) => c.hidden === true && c.inert === true),
        offRound.map((c) => 'round ' + c.getAttribute('data-round') + ': hidden=' + c.hidden
          + ' inert=' + c.inert).join('; '));

      // The property that actually matters, tested by trying it rather than by trusting `inert`:
      // focus a cell in a hidden round and see whether it takes.
      const focusable = [];
      for (const cell of rStage.querySelectorAll('.qbe-cell')) {
        const round = cell.closest('.qbe-column').getAttribute('data-round');
        cell.focus();
        if (round !== '0' && rStage.ownerDocument.activeElement === cell) focusable.push(cell.getAttribute('data-cell'));
      }
      record('render', 'no cell in a hidden round can take focus',
        focusable.length === 0,
        focusable.length === 0 ? 'every off-round cell refused focus'
          : 'these cells in hidden rounds took focus: ' + focusable.join(', '));

      record('render', 'the board publishes which round is active and how many there are',
        rView.root.getAttribute('data-round-active') === '0'
        && rView.root.getAttribute('data-round-count') === '3',
        'data-round-active="' + rView.root.getAttribute('data-round-active')
        + '", data-round-count="' + rView.root.getAttribute('data-round-count') + '"');

      renderer.setRound(rView, 2);
      record('render', 'advancing the round swaps which column is on screen',
        shown().length === 1 && shown()[0] === 'Round 3',
        'after setRound(2): ' + (shown().join(', ') || '(none)'));

      // Clamped, NOT wrapped. A host at the end of the game pressing advance once more must stay
      // on the final round; wrapping would put a spent round back in front of the room.
      renderer.setRound(rView, 99);
      const clampedHigh = shown()[0];
      renderer.setRound(rView, -5);
      const clampedLow = shown()[0];
      record('render', 'the round clamps at both ends rather than wrapping',
        clampedHigh === 'Round 3' && clampedLow === 'Round 1',
        'setRound(99) -> ' + clampedHigh + '; setRound(-5) -> ' + clampedLow);

      // M13. The failure a host finds on stage: a mid-show reload that comes back to Round 1 with
      // the scores intact. `currentRound` is session state precisely so this cannot happen.
      const resumedStage = harnessStage();
      renderer.renderBoard({
        bundle: rounds.value,
        session: { cellStates: {}, bonusCells: [], currentRound: 2 },
        mount: resumedStage, handlers: {},
      });
      const resumedShown = [...resumedStage.querySelectorAll('.qbe-column')]
        .filter((c) => !c.hidden).map((c) => c.querySelector('.qbe-column-label').textContent);
      record('render', 'a board rebuilt from a session opens on the round it was left on',
        resumedShown.length === 1 && resumedShown[0] === 'Round 3',
        'session said currentRound 2; the board came back on ' + (resumedShown.join(', ') || '(nothing)'));

      // A grid board's columns are CATEGORIES. Hiding five of six would destroy the game, so the
      // round machinery must be inert on every layout but ranked-list.
      const gridStage = harnessStage();
      const gridView = renderer.renderBoard({
        bundle: demo.value, session: { cellStates: {}, bonusCells: [], currentRound: 2 },
        mount: gridStage, handlers: {},
      });
      const gridHidden = [...gridStage.querySelectorAll('.qbe-column')].filter((c) => c.hidden);
      record('render', 'a grid board ignores rounds entirely — every category stays on screen',
        gridHidden.length === 0 && gridView.root.getAttribute('data-round-active') === null,
        gridHidden.length + ' of ' + gridStage.querySelectorAll('.qbe-column').length
        + ' categories hidden; data-round-active is '
        + (gridView.root.getAttribute('data-round-active') === null ? 'absent, as it must be'
          : '"' + gridView.root.getAttribute('data-round-active') + '"'));

      assertContract('three-round ranked board', rStage);
    }

    // ---- AN EMPTY ANSWER IS ABSENT, NOT BLANK (§2) --------------------------------------------
    //
    // `"answer": ""` validates, so the renderer must decide. §2: absent, never empty-but-meaningful.
    // Guarding `=== undefined` instead of truthiness put a blank <span> on the face; the contract
    // checker counts children without reading them, so this needs its own assertion. Found by
    // adversarial review — the suite had no fixture with an empty required string anywhere.
    const blank = await synthBundle('empty-answer-ranked', emptyAnswerRankedContent(), 'feud');
    if (!blank.ok) {
      record('render', 'a ranked board with an empty answer still validates', false,
        blank.failures.map(errors.formatFailure).join(' | '));
    } else {
      const blankStage = harnessStage();
      renderer.renderBoard({
        bundle: blank.value,
        session: { cellStates: { '0:0': 'revealed' }, bonusCells: [] },
        mount: blankStage,
        handlers: {},
      });
      const blankRow = [...blankStage.querySelectorAll('.qbe-cell')]
        .find((c) => c.getAttribute('data-state') === 'revealed');
      const blankText = blankRow ? blankRow.querySelector('.qbe-cell-text') : null;
      const blankValue = blankRow ? blankRow.querySelector('.qbe-cell-value') : null;
      record('render', 'a revealed ranked row with an EMPTY answer omits .qbe-cell-text entirely',
        blankRow !== null && blankText === null && blankValue !== null
        && blankValue.textContent === '50',
        blankRow === null ? 'no revealed row was built at all'
          : 'text element is ' + (blankText === null ? 'absent, as §2 requires'
            : 'PRESENT and empty — §2 promises absence instead')
          + '; the points still read "' + (blankValue ? blankValue.textContent : '(none)') + '"');
      assertContract('empty-answer ranked board', blankStage);
    }

    // The answer and the points are ONE reveal, not two. A ranked row's number is the payoff, so a
    // build that put the value on the face at open (or left it off until a second click) would
    // either spoil the row or make the host click twice for one answer. The row is watched across
    // the single advance that changes it: nothing before, both after.
    f.view.detail.close.click();
    const secondRow = f.view.records.get('0:1');
    secondRow.button.click();
    const midAnswer = f.view.detail.answer;
    const beforeReveal = {
      phase: f.view.detail.root.getAttribute('data-phase'),
      answerHidden: midAnswer.hidden,
      answerText: midAnswer.textContent,
      face: secondRow.button.querySelector('.qbe-cell-value'),
      state: secondRow.button.getAttribute('data-state'),
    };
    f.view.detail.next.click();
    const afterFace = secondRow.button.querySelector('.qbe-cell-value');
    const expectedLine = secondRow.cell.answer + ' — ' + secondRow.cell.value + ' points';
    record('render', 'a ranked row\'s answer and its points arrive in the SAME reveal, never one click apart',
      beforeReveal.phase === 'prompt' && beforeReveal.answerHidden === true
      && beforeReveal.answerText === '' && beforeReveal.face === null
      && beforeReveal.state === feud.value.resolved.initialState
      && f.view.detail.answer.hidden === false
      && f.view.detail.answer.textContent === expectedLine
      && afterFace !== null && afterFace.textContent === String(secondRow.cell.value)
      && secondRow.button.getAttribute('data-state') === 'revealed',
      'open → phase "' + beforeReveal.phase + '", no answer and no number on the face; one advance → "'
        + f.view.detail.answer.textContent + '" with '
        + (afterFace ? afterFace.textContent : '(nothing)') + ' on the row');
    f.view.detail.close.click();

    // ...and the same reveal survives the REAL persistence seam, not just the renderer's argument.
    // The board above is rebuilt from a hand-written session object; this one is rebuilt from a
    // session that has been through `state.newSession` → JSON → `validator.validateState`, which is
    // the path a host's saved game actually takes (imported state is untrusted, spec §4.4).
    const feudHash9 = await synthHash('f9-resume');
    const savedFeud = state.newSession({ bundle: feud.value, gameHash: feudHash9, teams: ['Solo'] });
    savedFeud.cellStates = { '0:1': 'revealed', '0:4': 'revealed' };
    const reimported = validator.validateState({
      raw: rawState('import:(f9-resume).json', JSON.parse(JSON.stringify(savedFeud))),
      bundle: feud.value,
    });
    if (!reimported.ok) {
      record('render', 'a feud session with revealed rows survives export and re-import', false,
        reimported.failures.map(errors.formatFailure).join(' | '));
    } else {
      const roundTrip = harnessStage();
      renderer.renderBoard({ bundle: feud.value, session: reimported.value, mount: roundTrip, handlers: {} });
      const rtCells = [...roundTrip.querySelectorAll('.qbe-cell')];
      const rtRevealed = rtCells.filter((c) => c.getAttribute('data-state') === 'revealed')
        .map((c) => c.getAttribute('data-cell')).sort().join(',');
      const byKey = (k) => feud.value.content.board.columns[0].cells.find((c) => c.key === k);
      const rtFaces = rtCells.filter((c) => c.getAttribute('data-state') === 'revealed')
        .map((c) => c.querySelector('.qbe-cell-value'))
        .map((v) => (v ? v.textContent : '(none)')).sort().join(',');
      const expectedFaces = [byKey('0:1').value, byKey('0:4').value].map(String).sort().join(',');
      record('render', 'a revealed ranked row is still revealed, with its points, after a real export/import resume',
        rtRevealed === '0:1,0:4' && rtFaces === expectedFaces,
        'through newSession → JSON → validateState → renderBoard: rows ' + rtRevealed
          + ' revealed, showing ' + rtFaces);

      // A resume must not quietly reorder the board either: the ranking is the board's meaning.
      const rtOrder = rtCells.map((c) => byKey(c.getAttribute('data-cell')).value);
      record('render', 'a resumed ranked-list board is still ordered by descending value',
        rtOrder.length === feud.value.resolved.cellKeys.length
        && rtOrder.every((v, i) => i === 0 || rtOrder[i - 1] >= v),
        'resumed DOM order: ' + rtOrder.join(' > '));
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

  // ---- 9b. the setup screens: what is behind them, and how they are dismissed ------------------
  runSetupScreenChecks(demo.value);

  // ---- 10. security: untrusted content text reaches the DOM as TEXT ONLY -----------------------
  await runRenderSecurityChecks();
}

/**
 * The three things a setup overlay owes that nothing here used to check.
 *
 * All three are keyboard- or destruction-shaped, which is why a suite built on clicking passed
 * through them: a scrim stops the pointer, so a mouse host cannot reach the board behind a modal
 * and a mouse host who mis-clicks Discard was assumed to have meant it.
 */
function runSetupScreenChecks(bundle) {
  // ---- 1. inert behind the mid-game overlay ---------------------------------------------------
  //
  // Opening Teams… mid-game leaves the board, the score bar and the toolbar in the tab order behind
  // a 0.78-alpha scrim. Measured before the fix: 13 tabs from the first input landed on a
  // `.qbe-cell` whose own centre hit-tested as `.qbe-setup`, where Space opens a question on the
  // projector from underneath a modal. A mouse host cannot do that, which is what makes the
  // keyboard path strictly worse (WCAG 2.4.3). `inert`, not a focus trap — CLAUDE.md forbids
  // confining a keyboard user, and Tab still cycles out to the browser chrome.
  const stage = harnessStage();
  drive(bundle, stage);
  const toolbar = renderer.renderToolbar({ mount: stage, handlers: {} });
  const boardEl = stage.querySelector('.qbe-board');

  const editView = renderer.renderTeamSetup({
    mount: stage, editing: true, names: ['Red'], handlers: { onCancel: () => {} },
  });
  record('render', 'the mid-game setup overlay makes the board and toolbar inert',
    boardEl.inert === true && toolbar.root.inert === true && !editView.root.inert,
    'board.inert=' + boardEl.inert + ', toolbar.inert=' + toolbar.root.inert
      + ', the overlay itself stays live (' + !editView.root.inert + ')');

  editView.destroy();
  record('render', 'destroying the setup overlay gives the board and toolbar back',
    boardEl.inert === false && toolbar.root.inert === false,
    'board.inert=' + boardEl.inert + ', toolbar.inert=' + toolbar.root.inert);

  // ---- 2. Escape, but only where there is a Cancel --------------------------------------------
  //
  // The question overlay taught the host that Escape closes an overlay (plan Q12) and they use it on
  // every cell of a game, so Escape doing nothing on Teams… reads as a frozen app. The OPENING team
  // screen must stay put: it has no Cancel, and dismissing it strands the host on an empty stage.
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  let cancelled = 0;
  const escapable = renderer.renderTeamSetup({
    mount: stage, editing: true, names: ['Red'], handlers: { onCancel: () => { cancelled += 1; } },
  });
  esc();
  escapable.destroy();
  record('render', 'Escape cancels the mid-game team editor, the way it closes a question',
    cancelled === 1, 'onCancel fired ' + cancelled + ' time(s)');

  let startedEarly = 0;
  const opening = renderer.renderTeamSetup({
    mount: stage, handlers: { onTeamsSubmit: () => { startedEarly += 1; }, onCancel: () => { startedEarly += 1; } },
  });
  esc();
  const stillOpen = opening.root.isConnected && startedEarly === 0;
  opening.destroy();
  record('render', 'Escape does NOT dismiss the opening team screen, which has nothing to go back to',
    stillOpen, stillOpen ? 'the screen is still mounted and no handler fired'
      : 'the opening screen reacted to Escape — there is no way back from an empty stage');
  stage.remove();

  // ---- 3. Discard asks twice ------------------------------------------------------------------
  //
  // Resume and Discard are the same size, the same fill and 20px apart, with the destructive one on
  // the right where a hurried pointer overshoots — and one click used to call `state.discardSession`
  // immediately. There is no undo and, because the shelf holds one session per game file, no second
  // copy anywhere. `state.discardSession`'s own comment says the confirmation "belongs on the resume
  // screen"; this is that confirmation. Two presses, not a blocking dialog (forbidden on a projected
  // screen) and not a disabled button (which sends the host hunting for how to enable it).
  const resumeStage = harnessStage();
  const discarded = [];
  const resumed = [];
  const rows = renderer.renderResumeScreen({
    sessions: [{ gameHash: 'c'.repeat(64), gameTitle: 'Period 1', updatedAt: '2026-08-16T20:41:00Z', teamCount: 2 }],
    gameHash: 'c'.repeat(64),
    mount: resumeStage,
    handlers: { onDiscard: (h2) => discarded.push(h2), onResume: (h2) => resumed.push(h2) },
  });
  const discardBtn = resumeStage.querySelector('[data-action="discard"]');
  discardBtn.click();
  const armed = discarded.length === 0 && discardBtn.textContent === 'Really discard?';
  record('render', 'one press of Discard destroys nothing and asks instead',
    armed, 'after the first press the button reads "' + discardBtn.textContent
      + '" and onDiscard fired ' + discarded.length + ' time(s)');

  discardBtn.click();
  record('render', 'the second press of Discard is the one that discards',
    discarded.length === 1 && discarded[0] === 'c'.repeat(64),
    'onDiscard fired ' + discarded.length + ' time(s)');

  // Arming a confirmation and then reaching for Resume must not leave the row armed behind you.
  discardBtn.click();
  resumeStage.querySelector('[data-action="resume"]').click();
  const disarmed = discardBtn.textContent === 'Discard' && resumed.length === 1;
  record('render', 'pressing anything else disarms a pending Discard',
    disarmed, 'the button reads "' + discardBtn.textContent + '" and onResume fired '
      + resumed.length + ' time(s)');
  rows.destroy();
  resumeStage.remove();
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

// Raised from 10s to 20s when F6 landed, and not arbitrarily: a boot is now shell + reveal + the
// pre-game screen + a click + a validated resume, and the whole matrix runs several of these in one
// page. A 10s ceiling produced one false failure in four runs on a loaded machine — and a suite that
// cries wolf is a suite people stop believing. The poll resolves the instant a themed board appears,
// so a healthy run costs nothing for the larger ceiling; only a genuinely stuck boot pays it.
const SHELL_BOOT_TIMEOUT_MS = 20000;

/** Boot index.html in an iframe and resolve once the board is on screen with its CSS applied. */
/**
 * The `qbe.session.*` keys on the shelf right now.
 *
 * The shell suite boots the REAL app, and the real app saves a session the moment the host presses
 * Start. That is the behaviour under test, so it must not be stubbed — but this page shares an
 * origin with the app, so a test run would otherwise leave its own sessions sitting in a host's
 * resume list. `dropNewSessions` removes exactly what the run added and touches nothing that was
 * there before, which is the difference between cleaning up and clearing somebody's storage.
 */
function sessionKeysNow() {
  const keys = new Set();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (typeof key === 'string' && key.indexOf('qbe.session.') === 0) keys.add(key);
    }
  } catch (_err) {
    /* storage unavailable: there is nothing to clean up either */
  }
  return keys;
}

function dropNewSessions(before) {
  for (const key of sessionKeysNow()) {
    if (before.has(key)) continue;
    try {
      localStorage.removeItem(key);
    } catch (_err) {
      /* nothing to do */
    }
  }
}

function bootShell(gamePath, options) {
  // `gamePath` may be null: that boots the shell with NO `?game=` at all, which is the only way to
  // reach the startup picker (F11) — and the only way to prove F12's override really becomes a
  // stylesheet, since the override is applied at mountTheme time inside app.js and nothing else can
  // observe it. `options.pickTheme` is a theme NAME to choose in the picker before pressing Start.
  const pickTheme = (options && options.pickTheme) || null;
  // `options.pickGame` is a FILENAME to select in the picker. Added because the theme-override
  // assertion silently depended on `games/demo.json` being the manifest's FIRST entry — the picker
  // checks its first radio — so reordering the manifest broke a test about themes. A test that
  // cares which board it boots must say which.
  const pickGame = (options && options.pickGame) || null;
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
    frame.setAttribute('title', 'shell boot: ' + (gamePath || 'startup picker'));
    // Resolved against <base href="../">, i.e. the repo root — the real shell, not a copy of it.
    frame.setAttribute('src', gamePath ? 'index.html?game=' + gamePath : 'index.html');
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

      // F6 PUT A SCREEN IN FRONT OF THE BOARD, so the shell no longer boots straight to one: a new
      // game opens on team setup, and a browser that already holds a session for this game opens on
      // the resume list. This suite is about the BOARD — its theme, its geometry, its density — so
      // the poll walks through whichever screen it meets exactly as a host would, by clicking the
      // real button. It does not reach into `state`: if the setup screen ever stops leading to a
      // board, these assertions must fail rather than be routed around.
      // THE STARTUP SCREEN IS WALKED FIRST, and it is excluded from the generic branch below. It
      // is a `.qbe-setup` like the other two pre-game screens, so a bare `.qbe-setup` lookup would
      // find it and then fail to press anything — its primary action is `begin`, not `start`.
      const startup = !board && doc ? doc.querySelector('.qbe-setup[data-screen="startup"]') : null;
      if (startup) {
        if (pickTheme) {
          const select = startup.querySelector('.qbe-startup-select');
          const offered = select ? [...select.options].some((o) => o.value === pickTheme) : false;
          // Set through the real control, not through a handler: if the option is not on the screen
          // the host could not have chosen it either, and the assertion must fail rather than be
          // routed around.
          if (select && offered) select.value = pickTheme;
        }
        if (pickGame) {
          const radio = [...startup.querySelectorAll('input[name="qbe-game"]')]
            .find((r) => r.getAttribute('data-file') === pickGame);
          // Through the real control: a board the host could not have selected must fail the
          // assertion rather than be routed around.
          if (radio) radio.checked = true;
        }
        const begin = startup.querySelector('.qbe-btn[data-action="begin"]');
        if (begin) begin.click();
      }
      const setup = !board && doc
        ? doc.querySelector('.qbe-setup:not([data-screen="startup"])')
        : null;
      if (setup) {
        // RESUME IS PREFERRED OVER "Start a new game", and that is about not damaging the host's
        // data rather than about coverage: this page shares an origin with the app, so "new" would
        // overwrite whatever real session is saved under that game's hash with an empty one — a
        // teacher who runs the suite between two classes would come back to a board with no teams
        // and no scores on it. Resuming only bumps `updatedAt`. Either path reaches a board, which
        // is all this suite measures.
        const btn = setup.querySelector('.qbe-btn[data-action="resume"]')
          || setup.querySelector('.qbe-btn[data-action="start"]')
          || setup.querySelector('.qbe-btn[data-action="new"]');
        if (btn) btn.click();
      }

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

/**
 * Resolve once a stylesheet whose href ends in `file` is loaded AND parsed in `doc`.
 *
 * WHY POLLING RATHER THAN READING styleSheets STRAIGHT AWAY. The board appearing is not the same
 * event as the theme sheet being registered: Firefox will hand you a laid-out .qbe-board while
 * document.styleSheets still has only the base layer in it, and the base-layer assertion then fails
 * for a reason that has nothing to do with the file's content. `cssRules.length > 0` is the real
 * signal — the sheet is not merely listed, it is parsed and applying. Same-origin, so readable.
 */
function waitForSheet(doc, file, timeoutMs = 5000) {
  const ends = new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  const started = performance.now();
  return new Promise((resolve) => {
    const poll = () => {
      for (const sheet of [...doc.styleSheets]) {
        if (!sheet.href || !ends.test(sheet.href.split('?')[0])) continue;
        let parsed = false;
        try {
          parsed = sheet.cssRules.length > 0;
        } catch (_err) {
          parsed = false;
        }
        if (parsed) { resolve(true); return; }
      }
      if (performance.now() - started > timeoutMs) { resolve(false); return; }
      setTimeout(poll, 25);
    };
    poll();
  });
}

/** The four geometry facts the whole projected board rests on, measured for one applied theme. */
function assertShellGeometry(label, doc, win, board, frame) {
  const boardStyle = win.getComputedStyle(board);
  const tracks = boardStyle.getPropertyValue('grid-template-columns');
  const columnCount = board.style.getPropertyValue('--qbe-column-count').trim();
  const trackCount = tracks.trim().split(/\s+/).filter((t) => t !== '' && t !== 'none').length;
  record('shell', `${label}: .qbe-board is a real grid with one track per column`,
    boardStyle.getPropertyValue('display') === 'grid' && trackCount === Number(columnCount),
    'display=' + boardStyle.getPropertyValue('display') + ', --qbe-column-count=' + columnCount
    + ', grid-template-columns resolves to ' + trackCount + ' track(s)');

  const detail = doc.querySelector('.qbe-detail');
  const detailStyle = win.getComputedStyle(detail);
  record('shell', `${label}: .qbe-detail is an overlay (positioned, above the board)`,
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
  record('shell', `${label}: a cell is a projector-sized target, not a UA-sized button`,
    rect.height >= 44 && rect.width >= 80,
    'first cell measures ' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ' px at a '
    + frame.width + 'x' + frame.height + ' viewport');
}

/**
 * Every REGISTERED theme, applied to a really-booted shell, measured.
 *
 * WHY ONE IFRAME AND A SWAPPED <link> RATHER THAN N BOOTS. The theme a game gets comes from its
 * content file, and the repo ships three games naming two themes — so "boot a game per theme" can
 * only ever cover the themes some game happens to select, which is precisely the narrowing this
 * task exists to remove. Instead the shell is booted for real once, and then the SELECTED sheet is
 * swapped on `<link id="qbe-theme">`, which is the identical DOM operation renderer.mountTheme()
 * performs at boot — same element, same href shape, same cascade position under the base layer. The
 * content-driven path (a game's `theme` name resolving through the manifest) is still covered by
 * the two real boots above; this loop covers every registered sheet's CSS actually applying.
 */
async function runThemeGeometrySuite() {
  const sessionsBefore = sessionKeysNow();
  let registered;
  try {
    registered = await loadThemeManifest();
  } catch (err) {
    record('shell', 'every registered theme is booted and measured', false,
      `could not read ${THEME_MANIFEST}: ${err && err.message}`);
    return;
  }

  const booted = await bootShell('games/demo.json');
  const { frame, doc, win, board } = booted;
  try {
    if (booted.timedOut || !board || !win) {
      record('shell', 'every registered theme is booted and measured', false,
        'the shell did not boot, so no theme could be measured');
      return;
    }
    const link = doc.getElementById('qbe-theme');
    if (!link) {
      record('shell', 'every registered theme is booted and measured', false,
        'no <link id="qbe-theme"> in the booted shell — mountTheme did not run');
      return;
    }

    // Read once, used by every iteration's contrast assertion. `stripCssComments` matters: the
    // token blocks in these files carry their measured ratios in comments, and a naive regex would
    // happily match a hex value quoted inside one.
    const fetchText = async (path) => {
      try {
        const res = await fetch(path + '?v=' + Date.now(), { cache: 'no-store' });
        return res.ok ? stripCssComments(await res.text()) : null;
      } catch (_err) {
        return null;
      }
    };
    const baseCss = await fetchText(THEMES_DIR + 'default.css');

    for (const { name, file } of registered) {
      // CACHE-BUSTED, like every other fetch in this file. Without it the iframe reuses a theme
      // stylesheet from an earlier run, and a contrast assertion then measures the colours the
      // file used to have — which is exactly how the first pass of the strike-contrast check
      // reported five failures against values that were no longer on disk.
      link.setAttribute('href', THEMES_DIR + file + '?v=' + Date.now());
      const loaded = await waitForSheet(doc, file);
      const sheets = [...doc.styleSheets].map((s) => (s.href || '(inline)').split('?')[0]);
      const baseIndex = sheets.findIndex((h) => /themes\/default\.css$/.test(h));
      const selectedIndex = sheets.map((h, i) => ({ h, i }))
        .filter(({ h }) => new RegExp('themes/' + file.replace('.', '\\.') + '$').test(h))
        .map(({ i }) => i).pop();
      // ---- THE STRIKE MARKS, IN EVERY REGISTERED THEME (D16) -----------------------------------
      //
      // THIS IS WHERE M12's ASSERTION BELONGED. The one written first sat in the per-GAME block,
      // measured a single theme, and checked only that a mark was at least 24x24 — so it closed a
      // mutation it could not see. Adversarial review then measured the shipped colours: 1.63:1 on
      // chalkboard, 2.45:1 on marquee, 2.74:1 on midnight, which is the theme demo-feud.json loads.
      //
      // COMPUTED FROM THE FILES, not from the live document, and that is the second lesson. A DOM
      // probe was tried and produced numbers that could not both be true — 16.50:1 for a mark and
      // 2.74:1 for its border, from one custom property — because the mark's colour lives on an
      // `::after` pseudo-element (so `getComputedStyle(el).color` read inherited text) and because
      // the first loop iteration races the stylesheet swap it is measuring. Reading the cascade
      // the two files actually declare is deterministic, and it checks exactly the claim every
      // contrast comment in `themes/default.css` makes.
      const themeCss = await fetchText(THEMES_DIR + file);
      const tokenOf = (prop) => {
        const own = themeCss && themeCss.match(new RegExp(prop + ':\\s*([^;/]+)'));
        if (own) return own[1].trim();
        const base = baseCss && baseCss.match(new RegExp(prop + ':\\s*([^;/]+)'));
        return base ? base[1].trim() : null;
      };
      const hex = (v) => (v && /^#[0-9a-fA-F]{6}$/.test(v) ? [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) : null);
      // --strike-slot-border derives from --strike-color, so resolve one level of var().
      const resolve = (prop) => {
        const raw = tokenOf(prop);
        const m = raw && raw.match(/var\(\s*(--[a-z-]+)\s*\)/);
        return hex(m ? tokenOf(m[1]) : raw);
      };

      // NOT `board`: that name is the booted board ELEMENT in the enclosing scope, and shadowing it
      // made `assertShellGeometry` throw on a colour array. The exception rejected the suite's
      // promise, and the page then sat on "Running…" forever with no report — which reads as a hang
      // rather than as a failure, and cost more time than the bug did.
      const boardGround = hex(tokenOf('--board-bg'));
      const scoreBg = hex(tokenOf('--score-bg'));
      const markC = resolve('--strike-color');
      const teamC = resolve('--strike-team-color');
      const slotC = resolve('--strike-slot-border');

      if (!boardGround || !scoreBg || !markC || !teamC || !slotC) {
        record('shell', `theme "${name}": the strike marks meet WCAG 2.1 AA contrast`, false,
          'a strike or ground token could not be resolved from the theme cascade');
      } else {
        const markRatio = contrastRatio(markC, boardGround);
        const teamRatio = contrastRatio(teamC, scoreBg);
        const slotRatio = contrastRatio(slotC, boardGround);
        // The band is unambiguously large text (min 2rem); the score bar's marks compute to ~17.6px,
        // so they carry the body-text floor. The empty slot is a non-text boundary and is
        // load-bearing: it is how the room sees how many strikes REMAIN.
        record('shell', `theme "${name}": the strike marks meet WCAG 2.1 AA contrast`,
          markRatio >= 3 && teamRatio >= 4.5 && slotRatio >= 3,
          `band mark ${markRatio.toFixed(2)}:1 on --board-bg (needs 3:1 large), score-bar mark `
          + `${teamRatio.toFixed(2)}:1 on --score-bg (needs 4.5:1), empty slot `
          + `${slotRatio.toFixed(2)}:1 on --board-bg (needs 3:1 non-text)`);
      }

      record('shell', `theme "${name}": default.css is the base layer under themes/${file}`,
        loaded && baseIndex !== -1 && selectedIndex !== undefined && baseIndex <= selectedIndex,
        !loaded ? `themes/${file} never parsed into document.styleSheets`
          : 'stylesheets in cascade order: ' + sheets.map((h) => h.replace(/^.*\//, '')).join(', '));

      assertShellGeometry(`theme "${name}"`, doc, win, board, frame);

      // ---- THE RING THAT VANISHED --------------------------------------------------------------
      //
      // default.css used to write the revealed cue as `inset 0 0 0 4px <accent>, var(--cell-shadow)`
      // — a THEME-OWNED whole-value token composed into a comma list. `none` is a legal box-shadow
      // but is NOT a legal item inside a shadow list, so any theme that turned its resting shadow
      // off (civic's dark scheme does: "dark surfaces rise, they don't cast") made the whole
      // declaration invalid at computed-value time. An invalid declaration computes to `unset`,
      // which for box-shadow is `none` — so the theme lost the accent ring it never asked to lose,
      // and civic dark's hidden→revealed change collapsed to a 1.13:1 fill difference. Under
      // `prefers-reduced-motion` that ring is the ONLY thing that changes shape (spec §8).
      //
      // The suite could not see it because nothing here had ever read a RESOLVED style for a themed
      // cell — `grep box-shadow tests/runner.js` returned nothing. These two assertions are that
      // missing read. The second one is the important one: it does not depend on which colour scheme
      // the machine running the tests happens to be in, because it applies the offending token value
      // itself and demands the ring survive it.
      const probe = board.querySelector('.qbe-cell');
      if (!probe) {
        record('shell', `theme "${name}": a revealed cell keeps its inset accent ring`, false,
          'no .qbe-cell to measure');
      } else {
        const wasState = probe.getAttribute('data-state');
        probe.setAttribute('data-state', 'revealed');
        const ring = win.getComputedStyle(probe).boxShadow;
        probe.style.setProperty('--cell-shadow', 'none');
        const ringWithoutShadow = win.getComputedStyle(probe).boxShadow;
        probe.style.removeProperty('--cell-shadow');
        if (wasState === null) probe.removeAttribute('data-state');
        else probe.setAttribute('data-state', wasState);

        const hasRing = (s) => typeof s === 'string' && s !== 'none' && s.indexOf('inset') !== -1;
        record('shell', `theme "${name}": a revealed cell resolves an inset accent ring`,
          hasRing(ring), 'computed box-shadow on [data-state="revealed"] = ' + ring);
        record('shell', `theme "${name}": the revealed ring survives --cell-shadow: none`,
          hasRing(ringWithoutShadow),
          'with the resting shadow switched off the ring computes to: ' + ringWithoutShadow);
      }
    }
  } finally {
    frame.remove();
    dropNewSessions(sessionsBefore);
  }
}

async function runShellSuite() {
  // The CONTENT-DRIVEN path: a game's `theme` name resolved through the manifest by the real
  // validator and mounted by the real renderer. The pairing matters — demo.json is the DEFAULT game
  // (no ?game=) and selects `midnight`, the override-only sheet that cannot stand alone. Per-theme
  // CSS coverage is runThemeGeometrySuite()'s job, driven by the manifest rather than by this list.
  const cases = [
    { game: 'games/demo.json', theme: 'midnight' },
    { game: 'games/demo-bingo.json', theme: 'default' },
  ];
  const sessionsBefore = sessionKeysNow();

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
      // a future refactor that renames the link id still passes for the right reason. Both sheets
      // are awaited first: a board can be on screen before Firefox has registered the theme sheet,
      // which used to make this assertion flake red for a load-timing reason, not a content one.
      await waitForSheet(doc, 'default.css');
      await waitForSheet(doc, theme + '.css');
      const sheets = [...doc.styleSheets].map((sheet) => (sheet.href || '(inline)').split('?')[0]);
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

      assertShellGeometry(game, doc, win, board, frame);

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

  // ---- THE RANKED ROW'S GEOMETRY, UNDER REAL THEME CSS (D14) ---------------------------------
  //
  // WHY THIS IS HERE AND NOT IN THE RENDER SUITE. The render suite draws into `harnessStage()`,
  // which carries NO stylesheet, so every assertion there is about DOM shape and none of them can
  // see a layout. That left the visual half of the D14 fix untested in the literal sense:
  // adversarial review deleted `.qbe-board[data-layout="ranked-list"] .qbe-cell-value
  // { margin-inline-start: auto }` from default.css and the suite stayed green at 377/377 while
  // the real board moved the points from the right edge into the middle of the row. Per
  // conventions, a rule no mutation can kill is not covered.
  //
  // The mechanism the rule defends against is not obvious enough to leave unwritten:
  // `.qbe-cell-mark` is ALWAYS present and is an in-flow static child, so a revealed ranked row has
  // THREE flex items, and `justify-content: space-between` divides the free space into two gaps
  // instead of pushing the points to the end. The auto margin absorbs the free space first.
  //
  // Rendered into the BOOTED iframe rather than the harness, because the iframe is the only
  // document in this suite where themes/default.css is actually loaded.
  const geomSessions = sessionKeysNow();
  const rankedBoot = await bootShell('games/demo.json');
  try {
    if (rankedBoot.timedOut || !rankedBoot.win) {
      record('shell', 'a revealed ranked row pins its points to the right edge of the row', false,
        'the shell did not boot, so no themed document was available to measure in');
    } else {
      const { doc, win } = rankedBoot;
      const feudBundle = await fileBundle('games/demo-feud.json');
      if (!feudBundle.ok) {
        record('shell', 'a revealed ranked row pins its points to the right edge of the row', false,
          'games/demo-feud.json did not validate: ' + feudBundle.failures.map(errors.formatFailure).join(' | '));
      } else {
        const mount = doc.createElement('div');
        doc.querySelector('.qbe-stage').appendChild(mount);
        renderer.renderBoard({
          bundle: feudBundle.value,
          session: { cellStates: { '0:0': 'revealed' }, bonusCells: [] },
          mount,
          handlers: {},
        });
        const row = mount.querySelector('.qbe-cell[data-state="revealed"]');
        const textNode = row && row.querySelector('.qbe-cell-text');
        const valueNode = row && row.querySelector('.qbe-cell-value');
        if (!row || !textNode || !valueNode) {
          record('shell', 'a revealed ranked row pins its points to the right edge of the row', false,
            'the themed board produced no revealed row with both a text and a value element');
        } else {
          const rowBox = row.getBoundingClientRect();
          const textBox = textNode.getBoundingClientRect();
          const valueBox = valueNode.getBoundingClientRect();
          const rightGap = rowBox.right - valueBox.right;
          const rowWidth = rowBox.width;
          // A generous threshold on purpose: the assertion is "pinned to the end", not a pixel
          // count. Without the rule the points land near the row's MIDDLE — the observed failure
          // was a gap of roughly half the row — so a tenth of the row separates the two outcomes
          // by a wide margin and survives padding and font changes.
          const pinned = rowWidth > 0 && rightGap >= 0 && rightGap < rowWidth * 0.1;
          record('shell', 'a revealed ranked row pins its points to the right edge of the row',
            pinned && valueBox.left > textBox.left,
            'row is ' + Math.round(rowWidth) + 'px wide; the points sit ' + Math.round(rightGap)
            + 'px from its right edge (must be under ' + Math.round(rowWidth * 0.1) + 'px), and '
            + Math.round(valueBox.left - textBox.left) + 'px to the right of the answer');
        }
        // ---- THE STRIKE MARKS, UNDER REAL THEME CSS (D16) ------------------------------------
        //
        // M12, and it SURVIVED the first time: styling the marks only in `default.css` and never
        // measuring them left the suite green at 404/404 while a mark rendered one pixel tall. It
        // is the same hole `M5` found — every render assertion draws into `harnessStage()`, which
        // carries no stylesheet, so the suite cannot see a size at all. Measured here because the
        // booted iframe is the only document in this suite where a theme is loaded.
        const strikeMount = doc.createElement('div');
        doc.querySelector('.qbe-stage').appendChild(strikeMount);
        const strikeView = renderer.renderBoard({
          bundle: feudBundle.value, session: { cellStates: {}, bonusCells: [] },
          mount: strikeMount, handlers: {},
        });
        renderer.updateStrikes(strikeView, 2);
        const band = strikeMount.querySelector('.qbe-strikes');
        const mark = band && band.querySelector('.qbe-strike-mark');
        if (!mark) {
          record('shell', 'a strike mark is drawn large enough to read from the back of a room', false,
            'the themed board produced no .qbe-strike-mark to measure');
        } else {
          const box = mark.getBoundingClientRect();
          // A floor, not a pixel count: the assertion is "this is projector furniture, not body
          // text". Unstyled it collapses to roughly a line-height; the shipped rule puts it at
          // 2rem minimum, so 24px separates the two outcomes by a wide margin.
          record('shell', 'a strike mark is drawn large enough to read from the back of a room',
            box.height >= 24 && box.width >= 24,
            'a struck mark measures ' + Math.round(box.width) + 'x' + Math.round(box.height)
            + 'px (must be at least 24x24)');
        }
        strikeMount.remove();

        mount.remove();
      }
    }
  } finally {
    if (rankedBoot.frame) rankedBoot.frame.remove();
  }
  dropNewSessions(geomSessions);

  dropNewSessions(sessionsBefore);
}

// ---------------------------------------------------------------------------------------------
// Theme suite — every REGISTERED theme audited as a file, plus the manifest/disk agreement
//
// WHY THIS EXISTS. themes/themes.json is the only door a stylesheet can come through (spec §6.4),
// so it is also the only honest list of what has to be checked. Everything below enumerates it at
// runtime. The five per-theme assertions are the five ways a theme file can be wrong in a way no
// human eye reliably catches:
//
//   · it does not fetch, or is empty — registered but not actually there;
//   · it reaches off-origin (@import, or url() with a scheme) — breaks spec §2.3 for the whole app;
//   · it lost its SPDX header — an AGPL obligation, and every source file carries one;
//   · it sets or reads a custom property default.css does not define — an invented token is INERT
//     (theme-contract §6): it silently does nothing, and the author never learns why;
//   · it targets a .qbe-* class the renderer does not emit — dead CSS, and in practice a typo.
//
// The class list and the token list are both derived from what the repo actually publishes — the
// contract's own §2 DOM block and default.css's own declarations — so neither can rot into a stale
// copy. Comments are stripped from every stylesheet BEFORE scanning: all four donated themes
// correctly document "no @import" in their header comment, and a naive scan flags them for saying
// the right thing. That exact bug once made this file flag itself.
// ---------------------------------------------------------------------------------------------

/** The .qbe-* classes the renderer promises to emit, parsed out of theme-contract §2's DOM block. */
/**
 * WCAG 2.1 relative luminance and contrast ratio, from the sRGB formula rather than eyeballed.
 *
 * Exists because the F9c review measured the strike marks at 1.63:1 on chalkboard and 2.74:1 on
 * midnight — the theme `games/demo-feud.json` actually ships on — while the suite was green. Every
 * contrast claim in `themes/default.css` is a comment; this is the first one an assertion can check.
 */
function parseRgb(text) {
  const m = String(text).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The GROUND a theme says an element sits on, read from the token rather than walked up the tree.
 *
 * An ancestor walk was tried first and is not reliable here: the probe is grafted into a booted
 * shell whose own theme is still painting the body, so the walk returned one theme's ground while
 * the swapped stylesheet supplied another theme's colour — the same element reported 16.50:1 for
 * its text and 2.74:1 for its border, from a single custom property. Two numbers that cannot both
 * be true is a broken measurement, not a finding.
 *
 * Reading `--board-bg` / `--score-bg` off `:root` is deterministic, and it checks the claim the
 * theme actually makes: every contrast comment in `themes/default.css` is written against these
 * two tokens, so this is the assertion those comments were always asking for.
 */
function themeGround(win, doc, token) {
  const raw = win.getComputedStyle(doc.documentElement).getPropertyValue(token).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return [1, 3, 5].map((i) => parseInt(raw.slice(i, i + 2), 16));
  }
  return parseRgb(raw) || [255, 255, 255];
}

async function contractClasses() {
  const res = await fetch('docs/plans/theme-contract.md?v=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const md = await res.text();
  const section = (md.split('## 2. DOM contract')[1] || '').split('\n## ')[0];
  const block = section.split('```')[1] || '';
  return new Set((block.match(/\.qbe-[a-z0-9-]+/g) || []).map((c) => c.slice(1)));
}

async function runThemeSuite() {
  let registered;
  try {
    registered = await loadThemeManifest();
  } catch (err) {
    record('themes', 'themes/themes.json enumerates the themes to audit', false,
      `could not read the manifest, so NOTHING was audited: ${err && err.message}`);
    return;
  }
  record('themes', 'themes/themes.json enumerates the themes to audit', registered.length > 0,
    registered.length > 0
      ? `${registered.length} registered: ${registered.map((t) => t.name).join(', ')}`
      : 'the manifest registered NO themes — every per-theme assertion below would be vacuous');

  // The token vocabulary and the class vocabulary, each read from the thing that defines it.
  let definedTokens = null;
  let emittedClasses = null;
  try {
    const res = await fetch(THEMES_DIR + 'default.css?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const css = stripCssComments(await res.text());
    definedTokens = new Set((css.match(/(--[a-z][a-z0-9-]*)\s*:/g) || [])
      .map((m) => m.replace(/\s*:$/, '')));
    // Documented exception (theme-contract §2): a per-board NUMBER the renderer sets inline on
    // .qbe-board. It is legitimately read by a theme and legitimately absent from default.css.
    definedTokens.add('--qbe-column-count');
  } catch (err) {
    record('themes', 'themes/default.css publishes the token vocabulary', false,
      `could not read default.css, so the token check went blind: ${err && err.message}`);
  }
  try {
    emittedClasses = await contractClasses();
    record('themes', 'theme-contract §2 publishes the class vocabulary the renderer emits',
      emittedClasses.size > 0,
      emittedClasses.size > 0 ? `${emittedClasses.size} classes parsed from the §2 DOM block`
        : 'PARSED NO CLASSES — the §2 heading or code block changed, so this check went blind');
  } catch (err) {
    record('themes', 'theme-contract §2 publishes the class vocabulary the renderer emits', false,
      `could not read the contract: ${err && err.message}`);
  }

  for (const { name, file } of registered) {
    const path = THEMES_DIR + file;
    let css = null;
    let bytes = 0;
    try {
      const res = await fetch(path + '?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      bytes = raw.length;
      record('themes', `theme "${name}" → ${path} fetches 200 and is non-empty`, bytes > 0,
        bytes > 0 ? `${bytes} bytes` : 'the file is registered but EMPTY');
      // SPDX is checked on the RAW text: the header is itself a comment, so stripping first would
      // delete the very thing being asserted.
      record('themes', `theme "${name}" carries the SPDX header`,
        raw.indexOf('SPDX-License-Identifier: AGPL-3.0-or-later') !== -1,
        raw.indexOf('SPDX-License-Identifier: AGPL-3.0-or-later') !== -1 ? 'AGPL-3.0-or-later'
          : 'no SPDX-License-Identifier line — every source file in this repo carries one');
      css = stripCssComments(raw);
    } catch (err) {
      record('themes', `theme "${name}" → ${path} fetches 200 and is non-empty`, false,
        `registered in themes/themes.json but did not load: ${err && err.message}`);
      record('themes', `theme "${name}" carries the SPDX header`, false, 'file did not load');
    }

    // Zero CDN in the theme layer (spec §2.3, theme-contract §5.6). data: URIs are ALLOWED — the
    // marks are inline SVG, which is the whole reason a theme needs url() at all.
    const cdnName = `theme "${name}" makes no external request (no @import, no http(s) url())`;
    if (css === null) {
      record('themes', cdnName, false, 'file did not load');
    } else {
      const imports = /@import/.test(css);
      const remote = css.match(/url\(\s*['"]?\s*(?:https?:|\/\/)/gi) || [];
      record('themes', cdnName, !imports && remote.length === 0,
        !imports && remote.length === 0 ? 'self-contained (data: URIs are fine)'
          : `${imports ? '@import present; ' : ''}${remote.length} remote url() reference(s)`);
    }

    const tokenName = `theme "${name}" invents no token — every custom property is defined in default.css`;
    if (css === null || definedTokens === null) {
      record('themes', tokenName, false, 'file or default.css did not load');
    } else {
      const used = [...new Set(css.match(/--[a-z][a-z0-9-]*/g) || [])].sort();
      const invented = used.filter((t) => !definedTokens.has(t));
      record('themes', tokenName, invented.length === 0,
        invented.length === 0 ? `${used.length} custom propert${used.length === 1 ? 'y' : 'ies'}, all known`
          : `INERT: ${invented.join(', ')} — set or read here, defined nowhere, so it does nothing`);
    }

    const className = `theme "${name}" targets only .qbe-* classes the renderer emits`;
    if (css === null || emittedClasses === null) {
      record('themes', className, false, 'file or the contract did not load');
    } else {
      const targeted = [...new Set((css.match(/\.qbe-[a-z0-9-]+/g) || []).map((c) => c.slice(1)))].sort();
      const dead = targeted.filter((c) => !emittedClasses.has(c));
      record('themes', className, dead.length === 0,
        dead.length === 0 ? `${targeted.length} class(es) targeted, all in theme-contract §2`
          : `DEAD CSS: .${dead.join(', .')} — no such element is ever rendered (usually a typo)`);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Manifest ↔ disk, in BOTH directions.
  //
  // A registered name pointing at a missing file is a game that dies at load; an unregistered .css
  // sitting in themes/ can never load at all (spec §6.4) and is a trap for whoever wrote it — they
  // will edit it for an hour and see nothing change. The forward direction is covered by the fetch
  // above; the reverse needs a directory listing, which is exactly what the documented local run
  // (`python3 -m http.server`) serves. If the listing is unavailable this assertion FAILS rather
  // than quietly passing: the whole point of this suite is that a check may not narrow itself.
  try {
    const res = await fetch(THEMES_DIR + '?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const listing = await res.text();
    const onDisk = [...new Set((listing.match(/href="[^"]*?([A-Za-z0-9_-]+\.css)"/g) || [])
      .map((m) => m.replace(/^.*?([A-Za-z0-9_-]+\.css)"$/, '$1')))].sort();
    const registeredFiles = new Set(registered.map((t) => t.file));
    const orphans = onDisk.filter((f) => !registeredFiles.has(f));
    record('themes', 'every .css in themes/ is registered in themes/themes.json',
      onDisk.length > 0 && orphans.length === 0,
      onDisk.length === 0
        ? 'NO directory listing from themes/ — run the suite over `python3 -m http.server` as the '
          + 'README documents, otherwise this direction cannot be checked at all'
        : orphans.length === 0 ? `${onDisk.length} file(s) on disk, all registered`
          : `UNREGISTERED: ${orphans.join(', ')} — spec §6.4 means it can never load`);
  } catch (err) {
    record('themes', 'every .css in themes/ is registered in themes/themes.json', false,
      `could not list themes/: ${err && err.message}`);
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
    // THREE MORE SINKS THAT VIOLATE THE SAME INVARIANT AND WERE NOT BEING LOOKED FOR. CLAUDE.md
    // names six APIs, and this list matched those six exactly — but "all content reaches the DOM via
    // createElement/textContent, and nothing evaluates a string" is the RULE, not the list. A timer
    // handed a STRING is a string-eval wearing a different name (`setTimeout("f()", 0)` runs it in
    // global scope with the same semantics as the banned call), and `srcdoc` is an HTML parse of a
    // string into a live document, which is exactly what the HTML-writing needles above exist to
    // stop. Neither had ever been searched for, so neither would have been caught. No such call
    // exists in js/ today — this closes a coverage gap, it does not report a live defect.
    // The timer needles require a QUOTE right after the paren: the callback form takes a function
    // reference or an arrow, neither of which can begin with a string delimiter.
    'set' + 'Timeout\\s*\\(\\s*[\'"`]',
    'set' + 'Interval\\s*\\(\\s*[\'"`]',
    'src' + 'doc\\b',
  ].join('|') + ')',
);

// =============================================================================================
// F11 / F12 — the startup pickers (deltas D12, D13)
// =============================================================================================
//
// Two features, one screen, and three things worth proving about them:
//
//   1. The GAME MANIFEST is judged like every other document, and — the security-relevant part —
//      a manifest value never becomes a fetch without passing `resolveGameParam` first. The picker
//      must not be a second, weaker route into `/games/`.
//   2. The THEME PREFERENCE is a device setting and NOT session state. The assertion that matters
//      is the negative one: writing a preference must leave the session shelf and an exported
//      state object byte-identical.
//   3. The SCREEN itself hands back what the host chose, and hands back `null` — not `''` — for
//      "use the game's theme", because `app.js` branches on that value.

async function runStartupSuite() {
  // ---- the manifest, as data -----------------------------------------------------------------
  const fetched = await loader.fetchManifests();
  if (!fetched.ok) {
    record('startup', 'games/games.json and themes/themes.json both fetch', false,
      fetched.failures.map(errors.formatFailure).join(' | '));
    return;
  }
  record('startup', 'games/games.json and themes/themes.json both fetch', true,
    'fetchManifests() returned both documents');

  const gamesDoc = validator.validateDocument({ kind: KINDS.GAMES, raw: fetched.value.games });
  record('startup', 'the shipped games/games.json validates against the games schema',
    gamesDoc.ok,
    gamesDoc.ok ? Object.keys(gamesDoc.value.games).length + ' games declared'
      : gamesDoc.failures.map(errors.formatFailure).join(' | '));
  if (!gamesDoc.ok) return;

  const shipped = gamesDoc.value.games;

  // EVERY DECLARED GAME MUST ACTUALLY RESOLVE AND LOAD. A manifest entry pointing at a file that
  // is not there would put the host on an error screen from a list the app itself drew — which is
  // the app blaming them for our typo.
  for (const name of Object.keys(shipped)) {
    const resolved = loader.resolveGameParam(
      new URLSearchParams({ game: loader.GAMES_DIR + shipped[name] }).toString(),
    );
    record('startup', `manifest entry "${name}" survives resolveGameParam`,
      resolved.ok,
      resolved.ok ? 'resolves to ' + resolved.value
        : resolved.failures.map(errors.formatFailure).join(' | '));
  }

  // ---- the manifest, as an attack surface ----------------------------------------------------
  // A tampered manifest is the interesting case: the picker reads a file, and if a value out of
  // that file could name something outside /games/, the manifest would be a way around spec §6.3.
  // Two independent guards have to hold — the SCHEMA (bare filename) and RESOLVEGAPARAM (the same
  // check `?game=` gets) — so both are asserted, separately, on the same hostile values.
  //
  // NOTE THE TWO LISTS. `resolveGameParam` legitimately ACCEPTS `games/sub/dir/game.json` — spec
  // §6.3 forbids escaping `games/`, not nesting inside it, and a host organising boards into
  // folders is doing nothing wrong. The MANIFEST is stricter than the URL parameter on purpose:
  // its values are bare filenames, so that a tampered manifest cannot reach even a legal
  // subdirectory the picker was never meant to offer. Asserting the two rules separately is what
  // keeps that difference deliberate instead of accidental.
  const refusedEverywhere = [
    '../secrets.json',
    '/etc/passwd.json',
    'https://example.com/x.json',
    '//example.com/x.json',
    'game.json%00.png',
  ];
  const refusedByTheManifestOnly = ['sub/dir/game.json'];

  for (const bad of refusedByTheManifestOnly) {
    const doc = validator.validateDocument({
      kind: KINDS.GAMES,
      raw: rawDoc('games/(tampered).json', KINDS.GAMES, { schemaVersion: 1, games: { nested: bad } }),
    });
    record('startup', `the games schema refuses a nested path ${JSON.stringify(bad)} as a manifest value`,
      doc.ok === false,
      doc.ok ? 'ACCEPTED IT — the manifest is meant to hold bare filenames only'
        : 'refused: manifest values are bare filenames');

    const viaLoader = loader.resolveGameParam(
      new URLSearchParams({ game: loader.GAMES_DIR + bad }).toString(),
    );
    record('startup', `?game= still ALLOWS the same nested path ${JSON.stringify(bad)}`,
      viaLoader.ok === true,
      viaLoader.ok ? 'resolved to ' + viaLoader.value + ' — nesting inside games/ is legal (spec §6.3)'
        : 'refused, which would break a host who organises boards into folders');
  }

  for (const bad of refusedEverywhere) {
    const doc = validator.validateDocument({
      kind: KINDS.GAMES,
      raw: rawDoc('games/(tampered).json', KINDS.GAMES, {
        schemaVersion: 1,
        games: { evil: bad },
      }),
    });
    record('startup', `the games schema refuses a manifest value of ${JSON.stringify(bad)}`,
      doc.ok === false,
      doc.ok ? 'ACCEPTED IT — the picker would fetch this' : 'refused at the structural stage');

    // Belt and braces: even if the schema were loosened, the loader still has to say no.
    const viaLoader = loader.resolveGameParam(
      new URLSearchParams({ game: loader.GAMES_DIR + bad }).toString(),
    );
    record('startup', `resolveGameParam independently refuses ${JSON.stringify(bad)} from a manifest`,
      viaLoader.ok === false,
      viaLoader.ok ? 'ACCEPTED IT — resolved to ' + viaLoader.value : 'refused before any fetch');
  }

  // An empty map is legal JSON and legal schema, and `app.js` is the layer that has to notice.
  const emptyDoc = validator.validateDocument({
    kind: KINDS.GAMES,
    raw: rawDoc('games/(empty).json', KINDS.GAMES, { schemaVersion: 1, games: {} }),
  });
  record('startup', 'an EMPTY games map passes the schema (app.js is what refuses it)',
    emptyDoc.ok === true,
    emptyDoc.ok ? 'schema accepts {} — the empty-picker guard lives in showStartup'
      : 'the schema refused it, so the app-level guard is now unreachable dead code');

  // ---- the theme preference is NOT session state ----------------------------------------------
  await withEmptyShelf(async () => {
    const before = state.readThemePreference();
    try {
      record('startup', 'a theme preference round-trips through localStorage',
        state.writeThemePreference('chalkboard') && state.readThemePreference() === 'chalkboard',
        'wrote and read back "chalkboard"');

      // THE ASSERTION THIS WHOLE DESIGN EXISTS FOR (delta D13). The maintainer's stated worry was
      // that a theme control would reach into game state. It must not be possible to observe a
      // theme preference from a session at all.
      const shelfBefore = JSON.stringify(state.listSessions());
      state.writeThemePreference('marquee');
      const shelfAfter = JSON.stringify(state.listSessions());
      record('startup', 'writing a theme preference does not touch the session shelf',
        shelfBefore === shelfAfter,
        shelfBefore === shelfAfter ? 'listSessions() is byte-identical across the write'
          : 'THE SHELF CHANGED: ' + shelfBefore + ' -> ' + shelfAfter);

      // And nothing named for a theme may appear in a state record, or an export would carry it.
      const demoBundle = await loadDemoBundleForStartup();
      if (demoBundle) {
        const session = state.newSession({ bundle: demoBundle, gameHash: 'a'.repeat(64), teams: ['A'] });
        const keys = Object.keys(session);
        record('startup', 'a new session record carries NO theme field',
          keys.indexOf('theme') === -1 && JSON.stringify(session).indexOf('marquee') === -1,
          'session keys: ' + keys.join(', '));
      }

      // A rubbish value written by anything else on the origin is read as "no preference" rather
      // than handed onward — the same untrusted-input posture as an imported file.
      try {
        globalThis.localStorage.setItem(state.THEME_PREF_KEY, '../evil.css');
      } catch (_e) { /* private window: the assertion below is then vacuously true */ }
      record('startup', 'a hostile stored preference reads back as null, not as a path',
        state.readThemePreference() === null,
        'readThemePreference() rejected "../evil.css"');
    } finally {
      state.writeThemePreference(before);
    }
  });

  // ---- the screen ------------------------------------------------------------------------------
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    let handed = 'never called';
    const screen = renderer.renderStartupScreen({
      games: [{ name: 'demo-jeopardy', file: 'demo.json' }, { name: 'demo-bingo', file: 'demo-bingo.json' }],
      themes: ['default', 'midnight', 'chalkboard'],
      themePref: 'chalkboard',
      mount: host,
      handlers: { onStart: (choice) => { handed = choice; } },
    });

    const radios = host.querySelectorAll('input[name="qbe-game"]');
    record('startup', 'the picker draws one radio per game, with the first preselected',
      radios.length === 2 && radios[0].checked === true,
      radios.length + ' radios, first checked = ' + (radios.length ? radios[0].checked : 'n/a'));

    const select = host.querySelector('#qbe-theme-select');
    record('startup', 'the stored preference is preselected in the theme control',
      !!select && select.value === 'chalkboard',
      select ? 'select.value = ' + JSON.stringify(select.value) : 'no select drawn');

    record('startup', "the first theme option is \"use this game's theme\" and its value is empty",
      !!select && select.options[0].value === '',
      select ? 'option[0] = ' + JSON.stringify(select.options[0].textContent) : 'no select drawn');

    // The real button, clicked. `handed.file` is what `app.js` turns into a `?game=` parameter.
    host.querySelector('button[data-action="begin"]').click();
    record('startup', 'pressing Start hands back the chosen file and theme',
      handed && handed.file === 'demo.json' && handed.theme === 'chalkboard',
      JSON.stringify(handed));

    // "Use this game's theme" must arrive as null, not '': app.js branches on falsiness, but every
    // reader downstream should see one spelling of "no override".
    select.value = '';
    host.querySelector('button[data-action="begin"]').click();
    record('startup', "choosing \"use this game's theme\" hands back null, not an empty string",
      handed && handed.theme === null,
      'theme = ' + JSON.stringify(handed && handed.theme));

    // Selecting the second board must change what is handed back — proof the radio group is read
    // at click time rather than captured when the screen was built.
    radios[1].checked = true;
    host.querySelector('button[data-action="begin"]').click();
    record('startup', 'the picker reads the radio group at click time, not at build time',
      handed && handed.file === 'demo-bingo.json',
      'file = ' + JSON.stringify(handed && handed.file));

    // No markup anywhere: the screen is built with createElement/textContent like the rest.
    const labels = [...host.querySelectorAll('.qbe-startup-label')].map((n) => n.textContent);
    record('startup', 'game names reach the DOM as text (no element children under a label)',
      [...host.querySelectorAll('.qbe-startup-label')].every((n) => n.children.length === 0),
      'labels: ' + labels.join(', '));

    screen.destroy();
    record('startup', 'destroy() removes the picker from its mount', host.children.length === 0,
      host.children.length + ' nodes left behind');
  } finally {
    host.remove();
  }

  // ---- the boot fork ---------------------------------------------------------------------------
  // `?game=` is a deep link and must still bypass the picker entirely. Asserted through the SHELL,
  // because this is a claim about `boot()`'s branch, not about a helper.
  const deep = await bootShell('games/demo.json');
  try {
    const startupScreen = deep.doc ? deep.doc.querySelector('[data-screen="startup"]') : null;
    record('startup', 'a ?game= deep link boots past the picker to the board',
      !deep.timedOut && !!deep.board && !startupScreen,
      deep.timedOut ? 'the shell did not reach a board'
        : startupScreen ? 'THE PICKER APPEARED despite an explicit ?game='
          : 'board rendered, no startup screen drawn');
  } finally {
    if (deep.frame) deep.frame.remove();
  }

  // ---- F12-T3b: the preference is a DEVICE setting, so a deep link wears it too ----------------
  //
  // Phase 5 walkthrough finding. The picker honoured the stored theme and `?game=` silently did
  // not, so the same preference behaved two ways depending on how the host arrived. Both halves
  // are asserted here, including the one that only this path can reach: a stored name the manifest
  // no longer holds must fall back to the game's own theme rather than reaching an error screen.
  const prefBeforeDeep = state.readThemePreference();
  const deepSessions = sessionKeysNow();
  try {
    state.writeThemePreference('chalkboard');
    const themed = await bootShell('games/demo.json');
    try {
      const href = themed.doc && themed.doc.getElementById('qbe-theme')
        ? (themed.doc.getElementById('qbe-theme').getAttribute('href') || '').split('?')[0] : null;
      record('startup', 'a ?game= deep link wears the stored device theme, not just the picker',
        !themed.timedOut && !!href && /themes\/chalkboard\.css$/.test(href),
        themed.timedOut ? 'the shell did not reach a board'
          : 'mounted stylesheet is ' + href + ' (demo.json asks for midnight; the device says chalkboard)');
    } finally {
      if (themed.frame) themed.frame.remove();
    }

    // A theme removed between two sessions is the ordinary case, not an attack.
    state.writeThemePreference('nosuchtheme');
    const stale = await bootShell('games/demo.json');
    try {
      const href = stale.doc && stale.doc.getElementById('qbe-theme')
        ? (stale.doc.getElementById('qbe-theme').getAttribute('href') || '').split('?')[0] : null;
      record('startup', 'a stored theme the manifest no longer holds falls back to the game\'s own',
        !stale.timedOut && !!href && /themes\/midnight\.css$/.test(href)
          && !stale.doc.querySelector('.qbe-error'),
        stale.timedOut ? 'the shell did not reach a board'
          : 'mounted stylesheet is ' + href + ', error screen present: '
            + !!stale.doc.querySelector('.qbe-error'));
    } finally {
      if (stale.frame) stale.frame.remove();
    }
  } finally {
    state.writeThemePreference(prefBeforeDeep);
    dropNewSessions(deepSessions);
  }

  // ---- F12-T3: the override is not just remembered, it becomes the stylesheet ------------------
  //
  // Everything above this point proves the PREFERENCE round-trips and the SCREEN hands back the
  // right value. Neither of those is the feature. The feature is `app.js` resolving that name
  // against the manifest at mountTheme time and the board coming up wearing it — the one step where
  // D13 could silently do nothing and every other assertion here would still be green.
  //
  // demo.json is the first board in the manifest and its own `theme` is "midnight". The picker is
  // asked for "chalkboard". If the override is ignored, the mounted sheet is midnight.css and this
  // fails; if the override were ever allowed to become a URL from something other than a manifest
  // VALUE, the href would show it.
  const prefBefore = state.readThemePreference();
  const sessionsBeforePick = sessionKeysNow();
  const picked = await bootShell(null, { pickTheme: 'chalkboard', pickGame: 'demo.json' });
  try {
    const link = picked.doc ? picked.doc.getElementById('qbe-theme') : null;
    const href = link ? (link.getAttribute('href') || '').split('?')[0] : null;
    record('startup', "a theme picked at startup overrides the game file's own theme",
      !picked.timedOut && !!href && /themes\/chalkboard\.css$/.test(href),
      picked.timedOut ? 'the shell never reached a board through the picker'
        : 'mounted stylesheet is ' + href
          + ' (games/demo.json asks for midnight; the picker asked for chalkboard)');
    record('startup', 'the picked theme is stored as a device preference',
      state.readThemePreference() === 'chalkboard',
      'readThemePreference() is ' + JSON.stringify(state.readThemePreference()));
  } finally {
    if (picked.frame) picked.frame.remove();
    // The suite shares an origin with the app, so this really did write the maintainer's own
    // preference. Put it back exactly as it was — including "unset", which is null, not ''.
    state.writeThemePreference(prefBefore);
    dropNewSessions(sessionsBeforePick);
  }
}

/** The demo bundle, for the one startup assertion that needs a real bundle to build a session. */
async function loadDemoBundleForStartup() {
  const raw = await loader.fetchContentBundle({ gamePath: 'games/demo.json' });
  if (!raw.ok) return null;
  const checked = validator.validateBundle(raw.value);
  return checked.ok ? checked.value : null;
}

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
    'js/renderer.js', 'js/state.js', 'js/app.js']) {
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

  // The zero-CDN sweep of the theme layer used to live here, hardcoded to default.css and
  // midnight.css. It is now manifest-driven and lives in runThemeSuite() with the rest of the
  // per-theme audit, so a theme cannot be registered without being swept.

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

// =============================================================================================
// STATE SUITE (F6 + F10) — the session, the shelf, the scoring rules, the import gate
// =============================================================================================
//
// WHY THIS SUITE EXISTS AT ALL, GIVEN THE MATRIX ALREADY VALIDATES STATE FILES
//
// The matrix proves that `validateState` judges a state DOCUMENT correctly. It says nothing about
// the two things a host actually depends on: that a session written to this browser comes back
// identical, and that a session which comes back WRONG never reaches the board. Both are round
// trips through three modules, and neither can be seen from a single-document assertion.
//
// NOTHING HERE IS MOCKED. The sessions are built by `state.newSession`, persisted by `state.adopt`
// into the real `localStorage`, re-read by `state.loadSession`, re-judged by
// `validator.validateState` and re-installed by `state.adopt` — the exact sequence `app.js`
// runs for a resume (module-contracts §10, `resumeSession`). There is no in-memory fake shelf: a
// fake would have neither the quota, nor the string-only values, nor the "another tab wrote this"
// property that make storage worth testing.
//
// WHICH MEANS THIS SUITE TOUCHES THE HOST'S OWN SAVED SESSIONS, and that is handled rather than
// ignored. `withEmptyShelf` snapshots every `qbe.session.*` entry (key AND value), empties the
// shelf so the retention-cap assertion has a deterministic starting point, and restores the
// snapshot exactly in a `finally`. The suite runs the real pruning code over a real shelf; it just
// gives the shelf back afterwards. Clearing without restoring would delete a teacher's game in
// progress, which is precisely the data loss the F6 code exists to prevent.

/** Canonical JSON: keys sorted at every depth, so "deep equality" is not "same key order". */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

function deepEqual(a, b) {
  return canonical(a) === canonical(b);
}

/** Every `qbe.session.*` entry, key AND value, so the shelf can be put back byte for byte. */
function snapshotSessions() {
  const snap = new Map();
  for (const key of sessionKeysNow()) {
    try {
      snap.set(key, localStorage.getItem(key));
    } catch (_err) {
      /* unreadable: there is nothing to restore either */
    }
  }
  return snap;
}

function clearSessions() {
  for (const key of sessionKeysNow()) {
    try {
      localStorage.removeItem(key);
    } catch (_err) {
      /* nothing to do */
    }
  }
}

function restoreSessions(snap) {
  clearSessions();
  for (const [key, value] of snap) {
    try {
      localStorage.setItem(key, value);
    } catch (_err) {
      /* a full shelf cannot be restored; nothing better is available from here */
    }
  }
}

/** Run `fn` against an empty session shelf, then give the host's shelf back exactly as it was. */
async function withEmptyShelf(fn) {
  const snap = snapshotSessions();
  clearSessions();
  state.__resetForTests();
  try {
    return await fn();
  } finally {
    state.__resetForTests();
    restoreSessions(snap);
  }
}

/** Poll until `predicate()` is true. Resolves false on timeout; callers assert on the result. */
function waitFor(predicate, timeoutMs = 6000) {
  const started = performance.now();
  return new Promise((resolve) => {
    const poll = () => {
      let hit = false;
      try {
        hit = !!predicate();
      } catch (_err) {
        hit = false;
      }
      if (hit) { resolve(true); return; }
      if (performance.now() - started > timeoutMs) { resolve(false); return; }
      setTimeout(poll, 25);
    };
    poll();
  });
}

/**
 * A session hash that cannot collide with a real game file's hash.
 *
 * Built by the REAL `state.hashContent`, so it is a genuine 64-hex SHA-256 that `newSession` and
 * `adopt` accept, of a string no game file contains. Keying the test sessions this way is what lets
 * most of this suite run without going anywhere near the entry a host's own game is saved under.
 */
async function synthHash(label) {
  const out = await state.hashContent('quiz-board-engine test session :: ' + label);
  return out.ok ? out.value : null;
}

/** A RawDocument for a state object, the shape `validator.validateState` expects. */
function rawState(path, data) {
  const text = JSON.stringify(data);
  return { path, kind: KINDS.STATE, text, bytes: text.length, data };
}

/** The same, from TEXT — the only way to get `__proto__` in as a real own property. */
function rawStateText(path, text) {
  return { path, kind: KINDS.STATE, text, bytes: text.length, data: JSON.parse(text) };
}

/**
 * The resume path, exactly as `app.js` runs it: raw document out of storage, validator, adopt.
 *
 * `state.loadSession` returns a RawDocument rather than a session precisely so this sequence is the
 * only way back in (module-contracts §9 deviation, deliberate) — a stored entry is untrusted input.
 */
function reopenSession(bundle, gameHash) {
  const loaded = state.loadSession(gameHash);
  if (!loaded.ok) return { ok: false, where: 'loadSession', failures: loaded.failures };
  const checked = validator.validateState({ raw: loaded.value, bundle });
  if (!checked.ok) return { ok: false, where: 'validateState', failures: checked.failures };
  const adopted = state.adopt(checked.value, { expectGameHash: gameHash, file: loaded.value.path });
  if (!adopted.ok) return { ok: false, where: 'adopt', failures: adopted.failures };
  return adopted;
}

function failureText(result) {
  return (result.failures || []).map(errors.formatFailure).join(' | ');
}

// ---------------------------------------------------------------------------------------------
// SHA-256, checked against digests this repo did not compute
// ---------------------------------------------------------------------------------------------
//
// `hashContent` is the name of every saved session, so a wrong hash is a shelf that silently never
// resumes. Comparing it against `crypto.subtle` again would only prove the call was made, so the
// expectations here come from OUTSIDE this codebase:
//
//   · the two NIST FIPS 180-4 published test vectors for SHA-256 ("abc" and the empty string);
//   · `shasum -a 256 games/demo.json`, run on the command line, which is also the number
//     tests/fixtures/valid-state.json carries in its `gameHash`. That makes this assertion a
//     three-way agreement: our hash, the OS tool's hash, and the checked-in fixture.
const SHA256_VECTORS = [
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
];
const DEMO_JSON_SHA256 = '1a9da17e64b24b73af5779630c5f3beaf593094593bb0b17afe2f746d4b4f25e';

async function runHashChecks(demoText) {
  for (const [input, expected] of SHA256_VECTORS) {
    const got = await state.hashContent(input);
    const passed = got.ok && got.value === expected;
    record('state', `hashContent matches the published SHA-256 vector for ${JSON.stringify(input)}`,
      passed,
      passed ? expected.slice(0, 16) + '… as published in FIPS 180-4'
        : got.ok ? 'got ' + got.value : failureText(got));
  }

  const demoHash = await state.hashContent(demoText);
  const matches = demoHash.ok && demoHash.value === DEMO_JSON_SHA256;
  record('state', 'the games/demo.json session hash agrees with `shasum -a 256` and with valid-state.json',
    matches,
    matches ? 'hashContent, the OS tool and the fixture all say ' + DEMO_JSON_SHA256.slice(0, 16) + '…'
      : demoHash.ok
        ? 'hashContent says ' + demoHash.value + ', the command line and tests/fixtures/valid-state.json say ' + DEMO_JSON_SHA256
        : failureText(demoHash));

  // The hash is of the BYTES, not of the parsed object, and that is load-bearing rather than
  // incidental: a hash of JSON.stringify(data) would change when our cleaning rules changed and
  // orphan every saved session in the world. One insignificant whitespace edit proves which it is.
  const spaced = await state.hashContent(demoText + '\n');
  const differs = spaced.ok && demoHash.ok && spaced.value !== demoHash.value;
  record('state', 'the hash follows the file BYTES, so a whitespace-only edit is a different game',
    differs,
    differs ? 'one appended newline produces a different session key'
      : 'the same key came back for different bytes — sessions would resume onto an edited board');
}

// ---------------------------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------------------------

async function runStateSuite() {
  const demo = await fileBundle('games/demo.json');
  const feud = await fileBundle('games/demo-feud.json');
  const bingo = await fileBundle('games/demo-bingo.json');
  for (const [label, bundle] of [['games/demo.json', demo], ['games/demo-feud.json', feud],
    ['games/demo-bingo.json', bingo]]) {
    if (!bundle.ok) {
      record('state', `${label} validates for the state suite`, false,
        bundle.failures.map(errors.formatFailure).join(' | '));
      return;
    }
  }

  const demoRaw = await loader.fetchContentBundle({ gamePath: 'games/demo.json' });
  if (!demoRaw.ok) {
    record('state', 'games/demo.json fetches for the hash assertions', false,
      demoRaw.failures.map(errors.formatFailure).join(' | '));
    return;
  }
  await runHashChecks(demoRaw.value.content.text);

  await withEmptyShelf(async () => {
    // ---- 1. the round trip ---------------------------------------------------------------------
    const hash = await synthHash('round-trip');
    const built = state.newSession({ bundle: demo.value, gameHash: hash, teams: ['Red Team', 'Blue Team'] });
    const adopted = state.adopt(built);
    if (!adopted.ok) {
      record('state', 'a new session saves, reloads from localStorage and compares equal', false,
        'adopt refused the freshly built session: ' + failureText(adopted));
    } else {
      state.setCellState('0:0', 'revealed');
      state.adjustScore({ bundle: demo.value, teamIndex: 0, delta: 300 });

      // ---- STRIKES IN STATE (D15) --------------------------------------------------------------
      //
      // M7. THE CAP IS A STATE RULE, NOT A DRAWING RULE. If the renderer clamped and `state` did
      // not, a fourth press would leave a 4 in the session that the room never saw, that survived
      // export, and that came back on import as a value its own schema rejects. Asserted against
      // the SESSION, never against the marks on screen.
      //
      // demo.json is jeopardy, which declares no `strikes` block — so it also proves the no-op:
      // `addStrike` on a game type without strikes must change nothing rather than throw.
      const beforeJeopardy = canonical(state.current().strikes || {});
      state.addStrike(demo.value, 0);
      record('state', 'addStrike does nothing on a game type that declares no strikes',
        canonical(state.current().strikes || {}) === beforeJeopardy,
        'jeopardy session strikes went from ' + beforeJeopardy + ' to '
        + canonical(state.current().strikes || {}));

      // A SEPARATE SESSION, and the reason is a bug this very block caused: driving `addStrike`
      // with the feud bundle while the JEOPARDY session was live wrote strikes into a jeopardy
      // session, and the round-trip assertion below then failed validation — correctly, because
      // `stateStrikesInBounds` refuses strikes on a game type that declares none. The suite caught
      // my test, not the code. The strikes assertions therefore run on their own session and hand
      // the shelf back exactly as they found it.
      const jeopardySession = state.current();
      // THE THREE-ROUND BOARD, because these assertions are about strikes being PER ROUND and
      // `demo-feud.json` has one column. Written against the single-round board they were quietly
      // parking strikes on a round that does not exist — invisible until `addStrike` gained its
      // column bound and started refusing them. A per-round test needs a board with rounds.
      const feudForState = await fileBundle('games/demo-feud-rounds.json');
      if (!feudForState.ok) {
        record('state', 'the feud bundle loads for the strike assertions', false, 'it did not');
      } else {
        const feudHash = await synthHash('strike-state');
        const feudSession = state.newSession({ bundle: feudForState.value, gameHash: feudHash, teams: ['Red'] });
        const feudAdopted = state.adopt(feudSession);
        if (!feudAdopted.ok) {
          record('state', 'a feud session adopts for the strike assertions', false, failureText(feudAdopted));
        } else {
          // `D18`: a strike belongs to a TEAM. The feud session above carries one team, index 0.
          for (let i = 0; i < 6; i++) state.addStrike(feudForState.value, 0, 0);
          record('state', 'strikes cap at the game type\'s own count, in the SESSION not just on screen',
            state.strikesFor(state.current(), 0, 0) === 3,
            'six calls to addStrike left the session holding '
            + state.strikesFor(state.current(), 0, 0) + ' (cap is 3)');

          // M8. Strikes belong to a ROUND. Keyed off the board instead of the column, Round 2 would
          // inherit Round 1's three strikes and start already lost.
          state.addStrike(feudForState.value, 1, 0);
          record('state', 'strikes are per round — a second round starts from its own count',
            state.strikesFor(state.current(), 0, 0) === 3 && state.strikesFor(state.current(), 1, 0) === 1,
            'round 0 holds ' + state.strikesFor(state.current(), 0, 0) + ', round 1 holds '
            + state.strikesFor(state.current(), 1, 0));

          // ---- D18: PINNED TO A TEAM, AND UNDOABLE ---------------------------------------------
          //
          // The host's rule is click the team, THEN press X. With nobody marked there is nobody to
          // charge the strike to, so it must do nothing at all rather than fall to team 0 — which
          // is what "pinned to a specific team" has to mean if it means anything.
          const beforeNoTeam = canonical(state.current().strikes || {});
          state.addStrike(feudForState.value, 1, null);
          state.addStrike(feudForState.value, 1, undefined);
          record('state', 'a strike with no active team is a no-op, not a strike against team 0',
            canonical(state.current().strikes || {}) === beforeNoTeam,
            'strikes went from ' + beforeNoTeam + ' to ' + canonical(state.current().strikes || {}));

          // Two teams, so "pinned" is observable: charging team 1 must not move team 0.
          state.setTeams(['Red', 'Blue']);
          state.addStrike(feudForState.value, 1, 1);
          record('state', 'a strike lands on the team it was charged to and no other',
            state.strikesFor(state.current(), 1, 0) === 1 && state.strikesFor(state.current(), 1, 1) === 1,
            'round 1: team 0 holds ' + state.strikesFor(state.current(), 1, 0)
            + ', team 1 holds ' + state.strikesFor(state.current(), 1, 1));

          // ONE PRESS UNDOES ONE STRIKE. An undo that wiped the row would turn a one-key slip into
          // a three-key one in the other direction, in front of the room, with no undo for the undo.
          state.addStrike(feudForState.value, 0, 0); // round 0 team 0 is at the cap of 3 already
          state.undoStrike(feudForState.value, 0, 0);
          record('state', 'undo takes back exactly one strike, not the whole row',
            state.strikesFor(state.current(), 0, 0) === 2,
            'a team on 3 strikes, after one undo, holds ' + state.strikesFor(state.current(), 0, 0));

          // At zero the entry is DELETED, so an exported session carries no row for a team that
          // never took one — absent-means-none, as everywhere else in this file.
          state.undoStrike(feudForState.value, 1, 1);
          const round1 = (state.current().strikes || {})['1'] || {};
          record('state', 'undoing a team\'s last strike removes the entry rather than zeroing it',
            !Object.prototype.hasOwnProperty.call(round1, '1') && round1['0'] === 1,
            'round 1 now reads ' + canonical(round1));

          // Undo on a team with nothing to take back must not go negative or invent a key.
          const beforeFloor = canonical(state.current().strikes || {});
          state.undoStrike(feudForState.value, 2, 0);
          record('state', 'undo on a team with no strikes changes nothing',
            canonical(state.current().strikes || {}) === beforeFloor,
            'strikes stayed ' + canonical(state.current().strikes || {}));

          // ---- REMOVING A TEAM MUST NOT STRAND ITS STRIKES (the critical) ---------------------
          //
          // THE ENGINE MUST NOT WRITE A DOCUMENT IT WILL REFUSE TO READ. `D18` keyed strikes by team
          // index on the argument that `setTeams` carries scores by index "for the same reason" —
          // but scores are carried BY `setTeams`, and strikes were carried by nothing. Clearing a
          // box to drop the third of three teams left an entry under key "2" beside a two-team
          // roster, which is precisely what `stateStrikesInBounds` rejects.
          //
          // Driven through the real UI, that cost the host their game: the resume shelf still lists
          // the session, Resume lands on the error screen, and Discard is the only other control.
          // Scores, opened cells and the current round, gone, from a supported mid-show edit.
          //
          // Asserted by REVALIDATING the session after the edit, not merely by inspecting the
          // object: the property that matters is "still loadable", and only the validator can say.
          // A CLEAN SLATE, because the assertions above deliberately left strikes on round 1 — and
          // `demo-feud.json` has ONE column, so those were parked on a round the board does not
          // have. Revalidating exposed that, which is how `addStrike` gained its column bound; the
          // setup here states what it needs rather than inheriting whatever ran before it.
          state.clearStrikes(0);
          state.clearStrikes(1);
          state.setTeams(['Red', 'Blue', 'Green']);
          state.addStrike(feudForState.value, 0, 2);
          state.addStrike(feudForState.value, 0, 0);
          const beforeDrop = canonical(state.current().strikes || {});
          state.setTeams(['Red', 'Blue']); // the host clears the third box
          const afterDrop = state.current();
          const revalidated = validator.validateState({
            raw: { path: 'probe', kind: KINDS.STATE, text: JSON.stringify(afterDrop), data: JSON.parse(JSON.stringify(afterDrop)) },
            bundle: feudForState.value,
          });
          record('state', 'removing a team drops its strikes, so the session it writes still loads',
            revalidated.ok
            && !Object.prototype.hasOwnProperty.call((afterDrop.strikes || {})['0'] || {}, '2')
            && state.strikesFor(afterDrop, 0, 0) === 1,
            'strikes went ' + beforeDrop + ' -> ' + canonical(afterDrop.strikes || {})
            + '; the session revalidates: ' + (revalidated.ok ? 'yes'
              : 'NO — ' + revalidated.failures.map((f) => f.path).join(', ')));

          // The surviving team keeps what it earned. Trimming must not become "wipe the round".
          record('state', 'a team that survives a roster edit keeps its own strikes',
            state.strikesFor(state.current(), 0, 0) === 1,
            'team 0 held 1 before the edit and holds ' + state.strikesFor(state.current(), 0, 0) + ' after');

          // Defence in depth: even asked directly, the engine must not write past the roster.
          state.addStrike(feudForState.value, 0, 5);
          record('state', 'a strike against an index the roster does not have is never written',
            !Object.prototype.hasOwnProperty.call((state.current().strikes || {})['0'] || {}, '5'),
            'round 0 reads ' + canonical((state.current().strikes || {})['0'] || {}));

          state.setTeams(['Red']);

          // Cleared, not zeroed: the between-rounds reset wipes EVERY team, which is what makes it
          // a different control from undo.
          state.clearStrikes(0);
          record('state', 'clearing a round removes its entry rather than setting it to zero',
            state.strikesFor(state.current(), 0, 0) === 0
            && !Object.prototype.hasOwnProperty.call(state.current().strikes, '0'),
            'after clearStrikes(0) the session strikes are '
            + canonical(state.current().strikes || {}));
        }
        state.discardSession(feudHash);
        state.adopt(jeopardySession); // hand the shelf back to the round-trip assertions
      }

      const live = state.current();

      // Forget everything in memory. Only what is really on the shelf can answer the next line.
      state.__resetForTests();
      const back = reopenSession(demo.value, hash);
      const equal = back.ok && deepEqual(live, back.value);
      record('state', 'a played session saves, reloads from localStorage and compares deep-equal',
        equal,
        !back.ok ? `the reload failed at ${back.where}: ${failureText(back)}`
          : equal ? 'loadSession → validateState → adopt returned an object identical to the one saved'
            : 'the reloaded session differs: ' + canonical(live) + ' vs ' + canonical(back.value));

      const frozen = back.ok && Object.isFrozen(back.value) && Object.isFrozen(back.value.teams[0]);
      record('state', 'the live session is deep-frozen, so a subscriber cannot edit it', frozen,
        frozen ? 'state.current() and its nested objects are frozen'
          : 'a subscriber could mutate the session behind state.js\'s back');
    }

    // ---- 2. the retention cap (spec §4.4) ------------------------------------------------------
    //
    // Twelve sessions against a cap of ten, each with a DIFFERENT `updatedAt`, so "the oldest were
    // pruned" is a checkable claim rather than "ten of something survived". The timestamps are set
    // on the object before `adopt` (which keeps a string `updatedAt` as it found it) because
    // `newSession` stamps `now` and twelve sessions built in one tick would all be the same age.
    //
    // The shelf is emptied again first, and that is a correction rather than a convenience: the
    // round-trip session above is stamped with `now`, so it is the NEWEST entry on the shelf, and
    // pruning 13 sessions to 10 correctly removed three of the twelve below. "Exactly ten remain and
    // the oldest went" is only a checkable sentence when the twelve are the whole shelf.
    clearSessions();
    state.__resetForTests();
    const capHashes = [];
    for (let i = 0; i < 12; i++) {
      const h = await synthHash('cap-' + i);
      capHashes.push(h);
      const s = state.newSession({ bundle: demo.value, gameHash: h, teams: ['Team ' + i] });
      const stamp = '2026-08-16T' + String(i).padStart(2, '0') + ':00:00Z';
      s.createdAt = stamp;
      s.updatedAt = stamp;
      const put = state.adopt(s);
      if (!put.ok) {
        record('state', '12 sessions can be written to the shelf', false,
          'adopt failed on session ' + i + ': ' + failureText(put));
        return;
      }
    }
    const beforePrune = state.listSessions().length;
    const removed = state.pruneToCap();
    const after = state.listSessions();
    const survivors = new Set(after.map((s) => s.gameHash));
    const prunedOldest = !survivors.has(capHashes[0]) && !survivors.has(capHashes[1])
      && capHashes.slice(2).every((h) => survivors.has(h));
    record('state', `the shelf caps at LIMITS.maxSessions (${LIMITS.maxSessions}) and prunes the OLDEST`,
      beforePrune === 12 && removed === 2 && after.length === LIMITS.maxSessions && prunedOldest,
      `12 written, pruneToCap() removed ${removed}, ${after.length} remain; `
      + (prunedOldest ? 'the two oldest updatedAt values are the two that went'
        : 'WRONG SESSIONS PRUNED — survivors: ' + [...survivors].map((h) => h.slice(0, 8)).join(',')));

    record('state', 'listSessions() orders the shelf newest-updatedAt first',
      after.length > 1 && after.every((s, i) => i === 0 || after[i - 1].updatedAt >= s.updatedAt),
      after.map((s) => s.updatedAt).join(' > '));

    // A pruned session is GONE, not merely hidden from the list: the resume screen offering a row
    // whose entry has been removed is the failure mode `listSessions` is projected to avoid.
    const goneLoad = state.loadSession(capHashes[0]);
    record('state', 'a pruned session is really removed from localStorage', goneLoad.ok === false,
      goneLoad.ok ? 'the entry is still readable after being pruned'
        : 'loadSession reports: ' + failureText(goneLoad));

    // ---- 3. scoring rules (spec §4.2) ----------------------------------------------------------
    state.__resetForTests();
    const scoreHash = await synthHash('scoring-jeopardy');
    state.adopt(state.newSession({ bundle: demo.value, gameHash: scoreHash, teams: ['Red', 'Blue'] }));
    for (const delta of [300, 200, -100]) state.adjustScore({ bundle: demo.value, teamIndex: 0, delta });
    const accumulated = state.current().teams[0].score;
    const untouched = state.current().teams[1].score;
    record('state', 'scoring accumulates adds and subtracts on the team that was clicked',
      accumulated === 400 && untouched === 0,
      `+300 +200 −100 → ${accumulated} on team 0, team 1 still ${untouched}`);

    state.adjustScore({ bundle: demo.value, teamIndex: 0, delta: -1000 });
    const negative = state.current().teams[0].score;
    record('state', 'jeopardy allows a negative total (allowNegative: true)', negative === -600,
      `400 − 1000 → ${negative}`);

    // The clamp is not cosmetic: a score outside ±1,000,000 is a state its OWN schema rejects, so an
    // unclamped run of clicks would produce a session that cannot be reloaded.
    for (let i = 0; i < 3; i++) state.adjustScore({ bundle: demo.value, teamIndex: 0, delta: 900000 });
    const clampedHigh = state.current().teams[0].score;
    const stillValid = validator.validateState({ raw: rawState('import:(clamp).json', state.current()) });
    record('state', 'a score cannot be clicked past the range its own schema allows',
      clampedHigh === 1000000 && stillValid.ok,
      `three +900000 clicks → ${clampedHigh}; the resulting session re-validates: ${stillValid.ok}`);

    state.__resetForTests();
    const feudHash = await synthHash('scoring-feud');
    state.adopt(state.newSession({ bundle: feud.value, gameHash: feudHash, teams: ['Solo'] }));
    state.adjustScore({ bundle: feud.value, teamIndex: 0, delta: 100 });
    const deducted = state.adjustScore({ bundle: feud.value, teamIndex: 0, delta: -300 });
    const floored = state.current().teams[0].score;
    record('state', 'allowNegative:false FLOORS at zero rather than refusing the deduction',
      deducted.ok === true && floored === 0,
      `100 then −300 → ${floored}, and the call still returned ok (a refused click would leave the `
      + 'board disagreeing with the room)');

    state.__resetForTests();
    const bingoHash = await synthHash('scoring-bingo');
    state.adopt(state.newSession({ bundle: bingo.value, gameHash: bingoHash, teams: ['Ignored'] }));
    const noop = state.adjustScore({ bundle: bingo.value, teamIndex: 0, delta: 500 });
    record('state', 'scoring.model "none" makes adjustScore a no-op, not a failure',
      noop.ok === true && state.current().teams[0].score === 0,
      `bingo: +500 left the score at ${state.current().teams[0].score}`);

    // ---- 4. cell state survives a reload -------------------------------------------------------
    state.__resetForTests();
    const playHash = await synthHash('three-cells');
    state.adopt(state.newSession({ bundle: demo.value, gameHash: playHash, teams: ['Red'] }));
    const played = { '0:0': 'answered', '1:2': 'revealed', '4:4': 'answered' };
    for (const key of Object.keys(played)) state.setCellState(key, played[key]);

    state.__resetForTests();
    const resumed = reopenSession(demo.value, playHash);
    if (!resumed.ok) {
      record('state', 'three played cells reload and the board restores exactly', false,
        `the reload failed at ${resumed.where}: ${failureText(resumed)}`);
    } else {
      const stage = harnessStage();
      const view = renderer.renderBoard({
        bundle: demo.value, session: resumed.value, mount: stage, handlers: {},
      });
      const wrong = [];
      for (const key of demo.value.resolved.cellKeys) {
        const expected = played[key] || 'hidden';
        const actual = view.cells.get(key).getAttribute('data-state');
        if (actual !== expected) wrong.push(key + ': expected ' + expected + ', drew ' + actual);
      }
      record('state', 'three played cells reload and the board restores exactly',
        wrong.length === 0 && deepEqual(resumed.value.cellStates, played),
        wrong.length === 0
          ? 'the restored session drew 0:0 answered, 1:2 revealed, 4:4 answered and the other 22 hidden'
          : wrong.join('; '));
      stage.remove();
    }

    // ---- 5. export → import, through the real code ---------------------------------------------
    const payload = state.exportPayload();
    const exported = state.current();
    if (!payload) {
      record('state', 'exportPayload() produces JSON that re-imports cleanly', false,
        'there was no live session to export');
    } else {
      let parsed = null;
      let parseError = null;
      try {
        parsed = JSON.parse(payload.json);
      } catch (err) {
        parseError = err && err.message;
      }
      const checked = parsed
        ? validator.validateState({ raw: rawState('import:' + payload.filename, parsed), bundle: demo.value })
        : { ok: false, failures: [] };
      state.__resetForTests();
      const reimported = checked.ok
        ? state.adopt(checked.value, { expectGameHash: playHash, file: 'import:' + payload.filename })
        : { ok: false, failures: checked.failures };
      const identical = reimported.ok && deepEqual(exported, reimported.value);
      record('state', 'exportPayload() produces JSON that re-imports cleanly and identically',
        identical,
        parseError ? 'the exported string is not JSON: ' + parseError
          : !checked.ok ? 'the validator refused our own export: ' + failureText(checked)
            : !reimported.ok ? 'adopt refused our own export: ' + failureText(reimported)
              : identical ? payload.json.length + ' bytes of pretty-printed JSON round-tripped byte-identically'
                : 'the re-imported session differs from the exported one');

      const named = /^quiz-board-[a-z0-9-]+-\d{8}-\d{4}\.json$/.test(payload.filename);
      record('state', 'the export filename is quiz-board-<slug>-<YYYYMMDD-HHMM>.json with a safe slug',
        named, payload.filename);
    }

    // ---- 6. a malformed state file, through the pipeline and through the real app ---------------
    await runMalformedImportChecks(demo.value);

    // ---- 7. untrusted-import security --------------------------------------------------------
    await runStateSecurityChecks(demo.value);
  });

  // The DOM half of the scoring rule, measured on a real boot rather than inferred. Outside the
  // empty-shelf window on purpose: `bootShell` prefers Resume, and letting it see the host's real
  // shelf is the same courtesy the rest of the shell suite already extends.
  await runScorebarPresenceChecks();
}

/**
 * A malformed state file must land on the ERROR SCREEN, never on a board (spec §4.4, §5, §6.6).
 *
 * Two halves, because either one alone can pass for the wrong reason:
 *   · the PIPELINE half proves the validator names the fault (and that `adopt` is never reached);
 *   · the APP half proves `app.js` actually routes it — a real boot, the real hidden file input, a
 *     real File dropped into it, and the board checked afterwards for any trace of the payload.
 */
async function runMalformedImportChecks(bundle) {
  let text = null;
  try {
    const res = await fetch('tests/fixtures/malformed-state.json?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    text = await res.text();
  } catch (err) {
    record('state', 'a malformed imported session is refused with a real failure', false,
      'could not read tests/fixtures/malformed-state.json: ' + (err && err.message));
    return;
  }

  const raw = rawStateText('import:malformed-state.json', text);
  const checked = validator.validateState({ raw, bundle });
  const first = checked.ok ? null : checked.failures[0];
  const named = !checked.ok && checked.failures.length === 1 && first.path === 'teams[0].score'
    && first.hint === 'wrong-type' && first.stage === 'structural'
    && first.file === 'import:malformed-state.json' && !!first.expected && !!first.found;
  record('state', 'a malformed imported session is refused, naming the field and the file',
    named,
    checked.ok ? 'THE VALIDATOR ACCEPTED IT — a corrupted export would reach the board'
      : named ? errors.formatFailure(first)
        : 'wrong report: ' + checked.failures.map(errors.formatFailure).join(' | '));

  // The screen a host would actually see. Rendered through the real error screen, into a detached
  // box, so the row below can also be READ by the reviewer at the bottom of this page.
  if (!checked.ok) {
    const box = el('div');
    let shown = '';
    try {
      errors.renderErrorScreen(checked.failures, box);
      shown = box.textContent;
    } catch (err) {
      shown = '';
      record('state', 'the refusal renders as a real error screen', false,
        'renderErrorScreen threw: ' + (err && err.message));
    }
    if (shown) {
      const complete = shown.indexOf('teams[0].score') !== -1
        && shown.indexOf('import:malformed-state.json') !== -1
        && box.querySelectorAll('.qbe-card').length === 1;
      record('state', 'the refusal renders as a real error screen naming the file and the field',
        complete,
        complete ? shown.length + ' characters, one problem card, file and path both on screen'
          : 'the screen omitted the file or the path');
    }
  }

  // ---- the app half ---------------------------------------------------------------------------
  const booted = await bootShell('games/demo.json');
  const { frame, doc, win } = booted;
  try {
    if (booted.timedOut || !doc || !win || !booted.board) {
      record('state', 'importing a malformed file into the running app lands on the error screen', false,
        'the shell did not boot, so the import path could not be driven');
      return;
    }
    const input = doc.querySelector('.qbe-file');
    if (!input || typeof win.DataTransfer !== 'function') {
      record('state', 'importing a malformed file into the running app lands on the error screen', false,
        !input ? 'no input.qbe-file in the booted toolbar — renderToolbar did not draw the import control'
          : 'this engine has no DataTransfer, so a File cannot be handed to the real input');
      return;
    }

    const cell = doc.querySelector('.qbe-cell[data-cell="0:0"]');
    const stateBefore = cell ? cell.getAttribute('data-state') : '(no cell)';

    // A real File in the FRAME's realm, handed to the real hidden input, announced with a real
    // change event: from `renderToolbar`'s point of view this is indistinguishable from a host
    // picking the file out of their Downloads folder.
    const file = new win.File([text], 'malformed-state.json', { type: 'application/json' });
    const dt = new win.DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new win.Event('change', { bubbles: true }));

    const mount = doc.getElementById('qbe-error');
    const appeared = await waitFor(() => mount && mount.textContent.length > 0, 6000);
    const reveal = doc.querySelector('.reveal');
    const screenText = mount ? mount.textContent : '';
    const routed = appeared
      && screenText.indexOf('teams[0].score') !== -1
      && screenText.indexOf('import:malformed-state.json') !== -1
      && !!reveal && reveal.hasAttribute('hidden');
    record('state', 'importing a malformed file into the running app lands on the error screen',
      routed,
      !appeared ? 'no error screen appeared within 6 s of the change event'
        : routed ? 'the report names import:malformed-state.json / teams[0].score and .reveal is hidden'
          : 'error screen text: ' + screenText.slice(0, 160));

    // NEVER ON A BOARD. The fixture carries `0:0: answered` and a 400-point team; if any of it had
    // been applied, the board behind the (hidden) report would show it.
    const stateAfter = cell ? cell.getAttribute('data-state') : '(no cell)';
    const scores = [...doc.querySelectorAll('.qbe-team-score')].map((n) => n.textContent);
    const untouched = stateAfter === stateBefore && scores.indexOf('400') === -1;
    record('state', 'a refused import applies NOTHING — no partial restore onto the live board',
      untouched,
      untouched ? `cell 0:0 is still "${stateAfter}" and no team shows the file's 400 points`
        : `cell 0:0 went ${stateBefore} → ${stateAfter}; team scores on the board: ${scores.join(',') || '(none)'}`);
  } finally {
    frame.remove();
  }
}

/**
 * `scoring.model: "none"` renders NO score bar — asserted on a real boot, with a positive control.
 *
 * Without the jeopardy half this would be the weakest kind of green: "the element is absent" passes
 * just as well when the element is never drawn for anybody.
 */
async function runScorebarPresenceChecks() {
  const sessionsBefore = sessionKeysNow();
  const cases = [
    { game: 'games/demo-bingo.json', expected: 0, why: 'bingo scoring.model is "none"' },
    { game: 'games/demo.json', expected: 1, why: 'jeopardy scoring.model is "accumulate"' },
  ];
  try {
    for (const { game, expected, why } of cases) {
      const booted = await bootShell(game);
      const { frame, doc } = booted;
      try {
        if (booted.timedOut || !doc || !booted.board) {
          record('state', `${game}: score bar presence follows the game type`, false,
            'the shell did not boot');
          continue;
        }
        const bars = doc.querySelectorAll('.qbe-scorebar').length;
        const toolbars = doc.querySelectorAll('.qbe-toolbar').length;
        const teamsButton = doc.querySelectorAll('.qbe-toolbar .qbe-btn[data-action="teams"]').length;
        record('state', `${game}: ${expected === 0 ? 'NO' : 'exactly one'} .qbe-scorebar in the DOM (${why})`,
          bars === expected && toolbars === 1 && teamsButton === expected,
          `${bars} score bar(s), ${toolbars} toolbar(s), ${teamsButton} Teams… button(s) — export/import `
          + 'is offered either way, because a card a host cannot export is data loss');
      } finally {
        frame.remove();
      }
    }
  } finally {
    dropNewSessions(sessionsBefore);
  }
}

// =============================================================================================
// SECURITY — an imported session is untrusted input (spec §4.4 / §6.6, CLAUDE.md)
// =============================================================================================
//
// Recorded into the `security` group, next to the loader's path traversal and the renderer's XSS
// assertions, because that is where a reviewer looks for this class of question. An exported session
// is a file a host mails to a colleague and a colleague opens: it is exactly as trustworthy as a
// downloaded attachment, which is to say not at all.

const HOSTILE_TITLE = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

async function runStateSecurityChecks(bundle) {
  const hash = await synthHash('security');
  const stamp = '2026-08-16T20:00:00Z';

  /** A state file as TEXT, so `__proto__` arrives as a real own property (JSON.parse keeps it). */
  const stateText = (cellStates, title) =>
    '{"schemaVersion":1,"gameHash":"' + hash + '","gameTitle":' + JSON.stringify(title || 'Security probe')
    + ',"createdAt":"' + stamp + '","updatedAt":"' + stamp + '","teams":[],"cellStates":'
    + cellStates + ',"bonusCells":[]}';

  const protoBefore = Object.keys(Object.prototype).length;

  const REJECT = [
    ['a __proto__ key in cellStates', '{"__proto__":"answered","0:0":"answered"}', 'bad-key-format'],
    ['a __proto__ key carrying an object', '{"__proto__":{"polluted":"yes"}}', 'bad-key-format'],
    ['a constructor key in cellStates', '{"constructor":"answered"}', 'bad-key-format'],
    ['a prototype key in cellStates', '{"prototype":"answered"}', 'bad-key-format'],
    ['an out-of-bounds cell key', '{"9:9":"answered"}', 'out-of-range'],
    ['a cell key outside the key grammar', '{"0:0:0":"answered"}', 'bad-key-format'],
    // "marked" is a real lifecycle state — just not one jeopardy uses. The renderer would have no
    // way to draw it, so it is refused at the contract stage rather than drawn as something else.
    ['a state outside this game type\'s cellLifecycle', '{"0:0":"marked"}', 'unknown-value'],
    ['a state outside the canonical lifecycle set', '{"0:0":"cheated"}', 'unknown-value'],
  ];

  for (const [label, cellStates, hint] of REJECT) {
    const raw = rawStateText('import:hostile-state.json', stateText(cellStates));
    const checked = validator.validateState({ raw, bundle });
    const passed = !checked.ok && checked.failures.some((f) => f.hint === hint);
    record('security', `an imported session with ${label} is refused`, passed,
      checked.ok ? 'ACCEPTED — this reaches state.adopt() and then the board'
        : passed ? errors.formatFailure(checked.failures[0])
          : `refused, but with hint "${checked.failures[0].hint}" where "${hint}" was expected: `
            + errors.formatFailure(checked.failures[0]));
  }

  // DEFENCE IN DEPTH. The rows above prove the gate holds; this one proves that even if a future
  // caller forgot the gate, adopting a proto-laden object does not pollute anything — `adopt` clones
  // through JSON and walks with Object.keys, so a "__proto__" key stays an ordinary own property.
  const forced = state.adopt(JSON.parse(stateText('{"0:0":"answered"}', 'Proto probe')));
  const polluted = ({}).polluted !== undefined || ({}).answered !== undefined
    || Object.keys(Object.prototype).length !== protoBefore;
  record('security', 'Object.prototype is untouched by every hostile session above', !polluted,
    !polluted ? `Object.prototype still has ${protoBefore} enumerable own key(s); {}.polluted is undefined`
      : 'PROTOTYPE POLLUTED — a plain object now carries keys from an imported file');
  record('security', 'adopting a session is a clone, never a merge into a shared object',
    forced.ok && forced.value !== null && Object.getPrototypeOf(forced.value) === Object.prototype,
    forced.ok ? 'the installed session is a plain object with the ordinary prototype'
      : failureText(forced));

  // ---- a hostile gameTitle is DATA, and reaches the DOM as text --------------------------------
  //
  // The title is the one string in a state file that is displayed rather than matched: it is drawn
  // on the resume screen, from a session a host may have received by email. It is legal JSON and a
  // legal string, so the answer is not "refuse it" — it is "render it as text and add no nodes".
  const titled = validator.validateState({
    raw: rawStateText('import:hostile-title.json', stateText('{"0:0":"answered"}', HOSTILE_TITLE)),
    bundle,
  });
  record('security', 'a session whose gameTitle contains markup is valid DATA (not a validation error)',
    titled.ok && titled.value.gameTitle === HOSTILE_TITLE,
    titled.ok ? 'accepted verbatim, angle brackets included — the question is how it is DRAWN'
      : 'refused: ' + failureText(titled));

  const stage = harnessStage();
  renderer.renderResumeScreen({
    sessions: [{ gameHash: hash, gameTitle: HOSTILE_TITLE, updatedAt: stamp, teamCount: 2 }],
    gameHash: hash,
    mount: stage,
    handlers: {},
  });
  const titleNode = stage.querySelector('.qbe-session-title');
  const verbatim = !!titleNode && titleNode.textContent === HOSTILE_TITLE;
  const injected = stage.querySelectorAll('script, img, svg, iframe, object, embed, a, link, style, form, input');
  record('security', 'a hostile gameTitle renders as TEXT on the resume screen and adds zero nodes',
    verbatim && injected.length === 0,
    verbatim && injected.length === 0
      ? 'the row title compares === to the payload, and no script/img/svg node exists in the screen'
      : !verbatim ? 'the title was altered or missing: ' + JSON.stringify(titleNode && titleNode.textContent)
        : 'FOUND ' + [...injected].map((n) => n.tagName).join(',') + ' — this is a live XSS');
  stage.remove();

  // ---- the resume list is the ONE read path that skips validateState ---------------------------
  //
  // Every other route from storage to the screen goes loadSession → validator.validateState →
  // adopt. `listSessions` does not: it projects rows straight from the parsed entry, because the
  // rows exist so a host can choose WHICH session to validate. localStorage is shared by every page
  // on the origin — on `<user>.github.io` that is every project of that user — and a sibling page
  // can rewrite any `qbe.session.*` value without being able to script us. So an unbounded
  // `gameTitle` is attacker-controlled prose of attacker-chosen LENGTH: a 400,000-character title
  // measured 110,462px tall in Firefox, which pushed Resume, Discard and "Start a new game" 162
  // viewports below the fold. Clicking Resume would have refused the entry correctly — but the host
  // could no longer reach the button, so the refusal has to happen before the row is drawn. The
  // bound is the state schema's own `LIMITS.maxLabelChars`, so nothing resumable is ever hidden.
  await withEmptyShelf(async () => {
    const legalHash = 'a'.repeat(64);
    const hostileHash = 'b'.repeat(64);
    const entry = (gameHash, gameTitle) => JSON.stringify({
      schemaVersion: 1, gameHash, gameTitle,
      createdAt: '2026-08-16T20:00:00Z', updatedAt: '2026-08-16T20:41:00Z',
      teams: [{ name: 'x', score: 0 }], cellStates: {}, bonusCells: [],
    });
    localStorage.setItem(state.STORAGE_PREFIX + legalHash, entry(legalHash, 'A legal title'));
    localStorage.setItem(
      state.STORAGE_PREFIX + hostileHash,
      entry(hostileHash, 'RESUME BLOCKED — visit evil.example. ' + 'P'.repeat(200000)),
    );
    const rows = state.listSessions();
    const listed = rows.map((r) => r.gameHash);
    record('security', 'a stored session whose gameTitle breaks the schema bound is never LISTED',
      listed.length === 1 && listed[0] === legalHash,
      listed.length === 1 && listed[0] === legalHash
        ? `the ${LIMITS.maxLabelChars}-char bound drops the 200k-char row and keeps the legal one`
        : 'listSessions returned ' + rows.map((r) => r.gameTitle.length + ' chars').join(', ')
          + ' — an unbounded title can push the Discard button off the screen');
  });
}

// =============================================================================================
// BONUS SUITE (F7, spec §8) — the draw, its eligibility rules, and its uniformity
// =============================================================================================
//
// WHY UNIFORMITY IS ASSERTED WITH A DISTRIBUTION AND NOT WITH A CODE READING
//
// A biased picker still picks. `Math.floor(Math.random() * n)` picks, `getRandomValues[0] % n`
// picks, and a board played with either looks exactly like a board played with a fair draw — the
// unfairness is only visible across many sessions, which is to say across a term of a teacher's
// classes and never inside one test that draws once. Modulo bias is also the specific defect
// `cryptoRandomInt` was written to avoid (state.js §4), so it is the specific defect that has to be
// measurable here. The tolerances below are set at roughly six standard deviations, so a fair draw
// effectively cannot fail them and a systematically skewed one cannot pass.

/**
 * A 3x4 jeopardy board with a KNOWN eligibility census:
 *   · eight plainly randomizable cells (0:0-0:3, 1:0-1:3) — the pool everything below measures;
 *   · 2:0 flagged randomizable AND lockValue, which the validator's census must drop (spec §4.1:
 *     a locked cell's value is never altered by randomization);
 *   · 2:1-2:3 not randomizable at all.
 * A fixture file would be a worse choice: this content exists to be a controlled pool, and a file in
 * games/ is also a thing a person can open and mistake for demo content.
 */
function bonusPoolContent() {
  const columns = [];
  for (let c = 0; c < 3; c++) {
    const cells = [];
    for (let r = 0; r < 4; r++) {
      const cell = {
        prompt: 'Bonus pool prompt ' + c + '-' + r,
        answer: 'What is ' + c + '-' + r + '?',
      };
      if (c < 2) cell.flags = { randomizable: true, lockValue: false, preMarked: false };
      else if (r === 0) cell.flags = { randomizable: true, lockValue: true, preMarked: false };
      else cell.flags = { randomizable: false, lockValue: false, preMarked: false };
      cells.push(cell);
    }
    columns.push({ label: 'Pool ' + c, valueLadder: [100, 200, 300, 400], cells });
  }
  return {
    schemaVersion: 1, title: 'Bonus pool', gameType: 'jeopardy',
    theme: 'default', animation: 'fade', board: { columns },
  };
}

const POOL_KEYS = ['0:0', '0:1', '0:2', '0:3', '1:0', '1:1', '1:2', '1:3'];
const LOCKED_KEY = '2:0';

/** Tally how often each key comes back over `runs` draws of `count`. */
function tally(draw, runs) {
  const counts = new Map();
  const shapes = [];
  for (let i = 0; i < runs; i++) {
    const picked = draw();
    shapes.push(picked);
    for (const key of picked) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return { counts, shapes };
}

/**
 * The uniformity verdict for one tally: every eligible key appeared, and none appeared more than
 * `tolerance` away from the expected share. Returns a problem string, or null when it is fair.
 */
function uniformityProblem(counts, keys, expected, tolerance) {
  const missing = keys.filter((k) => !counts.has(k));
  if (missing.length > 0) return 'never picked at all: ' + missing.join(',');
  const low = Math.floor(expected * (1 - tolerance));
  const high = Math.ceil(expected * (1 + tolerance));
  const skewed = keys.filter((k) => counts.get(k) < low || counts.get(k) > high);
  if (skewed.length > 0) {
    return 'outside [' + low + ',' + high + '] (expected ' + Math.round(expected) + ' each): '
      + skewed.map((k) => k + '=' + counts.get(k)).join(', ');
  }
  return null;
}

async function runBonusSuite() {
  const pool = await synthBundle('bonus-pool', bonusPoolContent(), 'jeopardy');
  if (!pool.ok) {
    record('bonus', 'the bonus-pool board validates', false,
      pool.failures.map(errors.formatFailure).join(' | '));
    return;
  }
  const bundle = pool.value;

  // The census this whole suite rests on. If the validator ever stopped excluding the locked cell,
  // every assertion below would still pass while the feature was broken — so the census is asserted
  // FIRST, against the flags the content file carries.
  const census = bundle.resolved.randomizableKeys;
  record('bonus', 'the validator\'s randomizable census is `randomizable && !lockValue`',
    census.join(',') === POOL_KEYS.join(',') && bundle.resolved.lockedValueKeys.join(',') === LOCKED_KEY,
    `candidates: ${census.join(',')}; locked: ${bundle.resolved.lockedValueKeys.join(',')} `
    + `(2:0 is flagged randomizable AND lockValue, and must be absent from the pool)`);

  // ---- 1. count, membership, distinctness -----------------------------------------------------
  const draws = [];
  for (let i = 0; i < 500; i++) draws.push(state.pickBonusCells({ bundle, count: 3 }));

  const rightCount = draws.every((d) => d.length === 3);
  const distinct = draws.every((d) => new Set(d).size === 3);
  const inPool = draws.every((d) => d.every((k) => POOL_KEYS.indexOf(k) !== -1));
  const boardOrder = draws.every((d) => d.every((k, i) => i === 0
    || POOL_KEYS.indexOf(d[i - 1]) < POOL_KEYS.indexOf(k)));
  record('bonus', 'a draw returns exactly `count` DISTINCT cells, in board order', rightCount && distinct && boardOrder,
    rightCount && distinct && boardOrder
      ? '500 draws of 3: every one had three different keys, sorted into board order (so two exports '
        + 'of one session are byte-identical)'
      : `right count: ${rightCount}, distinct: ${distinct}, board order: ${boardOrder}`);

  record('bonus', 'every pick comes from a cell flagged randomizable:true — never any other cell', inPool,
    inPool ? '1500 picks, all inside the 8-cell randomizable census'
      : 'a pick came from outside the census: ' + JSON.stringify(draws.find((d) => d.some((k) => POOL_KEYS.indexOf(k) === -1))));

  // ---- 2. the lockValue rule (spec §4.1) ------------------------------------------------------
  //
  // Asserted twice, deliberately. Once over many draws at the maximum possible count — where a
  // picker that merely *preferred* other cells would eventually leak — and once at the point where
  // value is actually computed, because that is where a future mechanic would be tempted to bypass
  // the rule the draw enforces.
  const maxDraws = [];
  for (let i = 0; i < 300; i++) maxDraws.push(state.pickBonusCells({ bundle, count: 99 }));
  const everLocked = maxDraws.some((d) => d.indexOf(LOCKED_KEY) !== -1);
  const clamped = maxDraws.every((d) => d.length === POOL_KEYS.length);
  record('bonus', 'a lockValue:true cell is NEVER picked, even when the draw asks for every cell',
    !everLocked && clamped,
    !everLocked && clamped
      ? `300 draws asking for 99 cells each returned all ${POOL_KEYS.length} candidates and never ${LOCKED_KEY}`
      : everLocked ? `${LOCKED_KEY} was picked — spec §4.1 says its value is never altered`
        : 'count was not clamped to the candidate list');

  const bonusSession = { cellStates: {}, bonusCells: ['0:1', LOCKED_KEY] };
  const multiplied = state.cellAward({ bundle, session: bonusSession, cellKey: '0:1' });
  const lockedAward = state.cellAward({ bundle, session: bonusSession, cellKey: LOCKED_KEY });
  const plainAward = state.cellAward({ bundle, session: bonusSession, cellKey: '1:1' });
  record('bonus', 'the multiplier applies to a bonus cell and never to a lockValue cell',
    multiplied === 400 && lockedAward === 100 && plainAward === 200,
    `bonus 0:1 (base 200) → ${multiplied}; locked ${LOCKED_KEY} (base 100) forced into bonusCells → `
    + `${lockedAward}; non-bonus 1:1 (base 200) → ${plainAward}`);

  // ---- 3. UNIFORMITY --------------------------------------------------------------------------
  const single = tally(() => state.pickBonusCells({ bundle, count: 1 }), 4000);
  const singleProblem = uniformityProblem(single.counts, POOL_KEYS, 4000 / 8, 0.25);
  record('bonus', 'UNIFORMITY: 4000 single-cell draws land on all 8 candidates, none wildly more often',
    singleProblem === null,
    singleProblem === null
      ? POOL_KEYS.map((k) => k + '=' + single.counts.get(k)).join(' ') + ' (expected 500 each; the '
        + '±25% band is about six standard deviations, so a fair draw cannot fail this and a biased '
        + 'one cannot pass)'
      : singleProblem);

  const triple = tally(() => state.pickBonusCells({ bundle, count: 3 }), 2000);
  const tripleProblem = uniformityProblem(triple.counts, POOL_KEYS, (2000 * 3) / 8, 0.2);
  record('bonus', 'UNIFORMITY: 2000 three-cell draws spread evenly across the pool too',
    tripleProblem === null,
    tripleProblem === null
      ? POOL_KEYS.map((k) => k + '=' + triple.counts.get(k)).join(' ') + ' (expected 750 each)'
      : tripleProblem);

  // The generator itself, at a NON-POWER-OF-TWO modulus. This is where modulo bias actually lives:
  // 2^32 % 3 != 0, so `getRandomValues() % 3` favours two residues over the third. The rejection
  // sampling in `cryptoRandomInt` is the reason this comes out flat.
  const residues = new Map();
  for (let i = 0; i < 6000; i++) {
    const r = state.cryptoRandomInt(3);
    residues.set(r, (residues.get(r) || 0) + 1);
  }
  const residueProblem = uniformityProblem(residues, [0, 1, 2], 2000, 0.15);
  const inRange = [...residues.keys()].every((k) => Number.isInteger(k) && k >= 0 && k < 3);
  record('bonus', 'cryptoRandomInt(3) is flat at a modulus 2^32 does not divide (the modulo-bias case)',
    residueProblem === null && inRange,
    residueProblem === null
      ? '6000 draws: ' + [0, 1, 2].map((k) => k + '=' + residues.get(k)).join(' ') + ' (expected 2000 each)'
      : residueProblem);

  // NEGATIVE CONTROL. A uniformity check that cannot fail is worse than none, because it reads as
  // coverage. The seam is an integer generator precisely so a rigged one can be substituted here.
  const rigged = tally(() => state.pickBonusCells({ bundle, count: 1, randomInt: () => 0 }), 800);
  const riggedProblem = uniformityProblem(rigged.counts, POOL_KEYS, 100, 0.25);
  record('bonus', 'NEGATIVE CONTROL: the uniformity check rejects a deliberately biased generator',
    riggedProblem !== null,
    riggedProblem !== null ? 'a randomInt that always returns 0 was caught: ' + riggedProblem
      : 'the check PASSED a generator that picks the same cell every time — it proves nothing');

  // ---- 4. resume keeps the picks; a new session reshuffles (spec §8) ---------------------------
  await withEmptyShelf(async () => {
    const hash = await synthHash('bonus-resume');
    const first = state.newSession({ bundle, gameHash: hash, teams: ['Red'] });
    const adopted = state.adopt(first);
    if (!adopted.ok) {
      record('bonus', 'resuming a session keeps the SAME bonus cells', false,
        'adopt refused the session: ' + failureText(adopted));
    } else {
      const drawn = state.current().bonusCells.slice();
      state.__resetForTests();
      const back = reopenSession(bundle, hash);
      const same = back.ok && deepEqual(back.value.bonusCells, drawn);
      record('bonus', 'resuming a session keeps the SAME bonus cells (no redraw on reload)', same,
        !back.ok ? `the reload failed at ${back.where}: ${failureText(back)}`
          : same ? `drew ${drawn.join(',')} and resumed onto ${back.value.bonusCells.join(',')}`
            : `drew ${drawn.join(',')} but resumed onto ${back.value.bonusCells.join(',')} — the room `
              + 'would see the bonus move between halves of one game');

      // The other half of the same rule: a session handed a stored list must not draw at all.
      const passed = state.newSession({ bundle, gameHash: hash, teams: [], bonusCells: ['1:3'] });
      record('bonus', 'newSession uses a SUPPLIED bonus list verbatim (the resume path)',
        passed.bonusCells.join(',') === '1:3',
        'bonusCells: ' + passed.bonusCells.join(','));
    }

    // A NEW session reshuffles. Over 60 fresh sessions on an 8-cell pool, one repeated pick is
    // ordinary and 60 identical picks is a picker that draws once and remembers.
    const picks = new Set();
    for (let i = 0; i < 60; i++) {
      picks.add(state.newSession({ bundle, gameHash: hash, teams: [] }).bonusCells.join(','));
    }
    record('bonus', 'starting a NEW session reshuffles rather than reusing the last draw',
      picks.size > 1,
      picks.size > 1 ? `60 new sessions produced ${picks.size} different bonus selections`
        : 'every new session drew ' + [...picks][0] + ' — the draw is not happening per session');
  });

  // ---- 5. data-bonus in the rendered DOM ------------------------------------------------------
  const chosen = state.pickBonusCells({ bundle, count: 3 });
  const stage = harnessStage();
  const session = { cellStates: {}, bonusCells: chosen };
  const view = renderer.renderBoard({ bundle, session, mount: stage, handlers: {} });
  const marked = [...stage.querySelectorAll('.qbe-cell[data-bonus="true"]')]
    .map((n) => n.getAttribute('data-cell')).sort();
  const values = [...stage.querySelectorAll('.qbe-cell[data-bonus]')]
    .map((n) => n.getAttribute('data-bonus'));
  record('bonus', 'data-bonus="true" appears on EXACTLY the chosen cells and nowhere else',
    marked.join(',') === chosen.slice().sort().join(',') && values.every((v) => v === 'true'),
    `chose ${chosen.join(',')}; data-bonus is on ${marked.join(',') || '(none)'} `
    + `out of ${bundle.resolved.cellKeys.length} cells`);

  // And it FOLLOWS the session on a repaint, rather than being a first-paint accident: this is the
  // path an import takes (a file whose bonusCells differ from the ones on screen).
  const swapped = { cellStates: {}, bonusCells: ['1:3'] };
  renderer.updateBoard(view, { bundle, session: swapped });
  const afterSwap = [...stage.querySelectorAll('.qbe-cell[data-bonus]')]
    .map((n) => n.getAttribute('data-cell'));
  record('bonus', 'a repaint moves data-bonus with the session (the import path)',
    afterSwap.join(',') === '1:3',
    'after updateBoard with bonusCells ["1:3"], data-bonus is on ' + (afterSwap.join(',') || '(none)'));
  stage.remove();
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
// F8 — pattern-complete win detection (spec §4.2, plan Gate 4: "a pattern win is detected exactly
// once")
//
// WHAT THIS SUITE IS DEFENDING. Four things, and each one is a way the feature could ship looking
// correct on a demo board and be wrong in a room:
//
//   1. THE CONFIG DRIVES IT. `patterns` is a per-game-type subset (spec §4.2). A detector that
//      simply checked all four shapes would win a game type that declared only `["row"]` on a
//      column, and no shipped board would ever show it — bingo.json declares all four.
//   2. TERMINAL IS DERIVED. `marked` is bingo's word, not the engine's. The same detector must work
//      for a game type whose finished state is `revealed`, so the suite runs one.
//   3. NON-SQUARE BOARDS HAVE NO DIAGONAL. A 5x4 card cannot complete one, and the wrong behaviour
//      here (reporting a "diagonal" that is really a bent line) is invisible until someone wins on
//      it in front of a room.
//   4. EXACTLY ONCE. Including the case the plan's Gate 4 names: one square that completes two
//      patterns at the same moment, and every later move after that.
// ---------------------------------------------------------------------------------------------

/** A uniform grid of `cols` x `rows` prompt-only cells — a bingo-shaped board of any dimensions. */
function gridContent(title, cols, rows, gameTypeId) {
  const columns = [];
  for (let c = 0; c < cols; c++) {
    const cells = [];
    for (let r = 0; r < rows; r++) cells.push({ prompt: 'C' + c + 'R' + r });
    columns.push({ label: 'Col ' + c, cells });
  }
  return {
    schemaVersion: 1, title, gameType: gameTypeId, theme: 'default', animation: 'fade',
    board: { columns },
  };
}

/** A board whose columns are DIFFERENT depths — the shape `uniformRows: false` permits. */
function raggedContent(title, heights, gameTypeId) {
  const columns = [];
  for (let c = 0; c < heights.length; c++) {
    const cells = [];
    for (let r = 0; r < heights[c]; r++) cells.push({ prompt: 'C' + c + 'R' + r });
    columns.push({ label: 'Col ' + c, cells });
  }
  return {
    schemaVersion: 1, title, gameType: gameTypeId, theme: 'default', animation: 'fade',
    board: { columns },
  };
}

/** A pattern-complete game type with an ARBITRARY pattern subset and lifecycle — the point of it. */
function patternGametype(id, patterns, lifecycle) {
  return {
    schemaVersion: 1, id, layout: 'grid',
    cellLifecycle: lifecycle || ['hidden', 'marked'],
    scoring: { model: 'none' },
    winCondition: 'pattern-complete',
    patterns,
    gridConstraints: { uniformRows: true },
    requiredCellFields: ['prompt'],
  };
}

/**
 * Validate a content object against a SYNTHETIC game type.
 *
 * `synthBundle` fetches a real file from /gametypes/, which is right for everything that has to
 * agree with shipped config — but the three game types this repo ships cannot express "declares only
 * row" or "finishes at revealed", and adding a fourth file to /gametypes/ to test a detector would
 * put a test fixture in the product's data directory.
 */
async function synthTypedBundle(label, contentData, gametypeData) {
  const themes = await rawSupport(loader.THEMES_MANIFEST, KINDS.THEMES);
  if (!themes.ok) return themes;
  return validator.validateBundle({
    content: rawDoc('games/(synthetic ' + label + ').json', KINDS.CONTENT, contentData),
    gametype: rawDoc('gametypes/(synthetic ' + label + ').json', KINDS.GAMETYPE, gametypeData),
    themes: themes.value,
  });
}

/** A session-shaped object holding exactly these cells in `state`. No storage involved. */
function sessionWith(keys, cellState) {
  const cellStates = {};
  for (const key of keys) cellStates[key] = cellState;
  return { cellStates, bonusCells: [] };
}

const winIds = (wins) => wins.map((w) => w.id).join(', ') || '(none)';

/** The live region's current text, or a phrase saying it has never spoken. */
function spokenText() {
  const live = document.querySelector('.qbe-live');
  return live ? live.textContent : '(no live region yet)';
}

async function runWinsSuite() {
  const bingo = await fileBundle('games/demo-bingo.json');
  if (!bingo.ok) {
    record('wins', 'games/demo-bingo.json validates for the win suite', false,
      bingo.failures.map(errors.formatFailure).join(' | '));
    return;
  }
  const B = bingo.value;

  // ---- 1. nothing is won at the start, free space and all --------------------------------------
  //
  // 2:2 is `preMarked` and therefore already terminal on a brand-new board. A detector that counted
  // "any complete line" without checking that a line has more than the free square in it, or that
  // treated a session's EMPTY cellStates as "nothing is marked", would get this wrong in opposite
  // directions.
  const fresh = state.completedPatterns({ bundle: B, session: { cellStates: {}, bonusCells: [] } });
  record('wins', 'a brand-new bingo card has won nothing, free space included',
    fresh.length === 0,
    fresh.length === 0 ? 'the preMarked centre square is terminal but is not a line'
      : 'reported ' + winIds(fresh));

  // ---- 2. one row --------------------------------------------------------------------------
  const rowKeys = ['0:0', '1:0', '2:0', '3:0', '4:0'];
  const rowWins = state.completedPatterns({ bundle: B, session: sessionWith(rowKeys, 'marked') });
  record('wins', 'marking every square of row 1 reports exactly one win, the row',
    rowWins.length === 1 && rowWins[0].id === 'row:0' && rowWins[0].pattern === 'row',
    winIds(rowWins));

  // ---- 3. the free square counts toward a line without being re-marked -------------------------
  //
  // Column 3 is B/I/N…: its centre cell IS the free space, so a host completes that column by
  // marking four squares, not five. This is the derivation `renderer.cellStateFor` publishes,
  // re-derived on the state side — and asserted equal to it below.
  const colWins = state.completedPatterns({
    bundle: B, session: sessionWith(['2:0', '2:1', '2:3', '2:4'], 'marked'),
  });
  record('wins', 'a preMarked free square completes a line without being marked again',
    colWins.length === 1 && colWins[0].id === 'column:2',
    colWins.length === 1 ? 'four marks plus the free space at 2:2 completed ' + colWins[0].id
      : 'reported ' + winIds(colWins));

  // ---- 3b. each of the four patterns on the shipped 5x5 card, named cell for cell -------------
  //
  // The tests above check WHICH pattern fired. These check WHICH CELLS it fired on, because a
  // detector can report the right id off the wrong line: a column builder reading rows, or a
  // diagonal that walks `columns[i].cells[i]` on one diagonal and re-walks it on the "other". A win
  // that names a line the room cannot see on the board is worse than no win at all, so the cell
  // list is asserted literally, in geometric order, for every shape the card contains.
  const wonCells = (wins, id) => {
    const found = wins.filter((w) => w.id === id);
    return found.length === 1 ? found[0].cells.join(',') : '(' + found.length + ' win(s) with id ' + id + ')';
  };

  record('wins', 'a row win names that row\'s five squares, left to right',
    wonCells(rowWins, 'row:0') === '0:0,1:0,2:0,3:0,4:0',
    'row:0 = ' + wonCells(rowWins, 'row:0'));

  // A column with NO free space in it, so this is the plain five-square case that test 3 (which
  // leans on the free centre) cannot make on its own.
  const colOnly = state.completedPatterns({
    bundle: B, session: sessionWith(['0:0', '0:1', '0:2', '0:3', '0:4'], 'marked'),
  });
  record('wins', 'marking a full column reports exactly one win, that column, top to bottom',
    colOnly.length === 1 && colOnly[0].pattern === 'column'
    && wonCells(colOnly, 'column:0') === '0:0,0:1,0:2,0:3,0:4',
    'reported ' + winIds(colOnly) + ' on cells ' + wonCells(colOnly, 'column:0'));

  // The two diagonals, one at a time, each through the free centre square.
  const mainDiag = state.completedPatterns({
    bundle: B, session: sessionWith(['0:0', '1:1', '3:3', '4:4'], 'marked'),
  });
  record('wins', 'the top-left→bottom-right diagonal is diagonal:0 and names its own five squares',
    mainDiag.length === 1 && wonCells(mainDiag, 'diagonal:0') === '0:0,1:1,2:2,3:3,4:4',
    'reported ' + winIds(mainDiag) + ' on cells ' + wonCells(mainDiag, 'diagonal:0'));

  const antiDiag = state.completedPatterns({
    bundle: B, session: sessionWith(['0:4', '1:3', '3:1', '4:0'], 'marked'),
  });
  record('wins', 'the bottom-left→top-right diagonal is diagonal:1 and is a DIFFERENT five squares',
    antiDiag.length === 1 && wonCells(antiDiag, 'diagonal:1') === '0:4,1:3,2:2,3:1,4:0',
    'reported ' + winIds(antiDiag) + ' on cells ' + wonCells(antiDiag, 'diagonal:1'));

  // The full card: every shape at once, and the full-card instance must be the whole census — not
  // "every cell of every row", which a ragged board would make a different set.
  const everyKey = B.resolved.cellKeys;
  const blackout = state.completedPatterns({ bundle: B, session: sessionWith(everyKey, 'marked') });
  const fullCard = blackout.filter((w) => w.pattern === 'full-card');
  record('wins', 'a blacked-out 5x5 card reports full-card over every square, plus all 5 rows, 5 columns and 2 diagonals',
    blackout.length === 5 + 5 + 2 + 1
    && fullCard.length === 1 && fullCard[0].id === 'full-card:0'
    && fullCard[0].cells.slice().sort().join(',') === everyKey.slice().sort().join(','),
    blackout.length + ' win(s): ' + winIds(blackout)
      + ' — full-card covers ' + (fullCard.length === 1 ? fullCard[0].cells.length : '?') + ' of '
      + everyKey.length + ' squares');

  // ---- 3c. the negatives: an almost-complete line is not a line -------------------------------
  //
  // Every assertion above is satisfiable by a detector that says yes too readily, so these are the
  // ones that make the suite bite. Four of five is the shape a real board is in for most of a game.
  const fourOfFive = state.completedPatterns({
    bundle: B, session: sessionWith(['0:1', '1:1', '2:1', '3:1'], 'marked'),
  });
  record('wins', 'four squares of a five-square row win nothing — one short is not a win',
    fourOfFive.length === 0,
    fourOfFive.length === 0 ? 'row 2 is marked at 0:1, 1:1, 2:1 and 3:1 and 4:1 is still hidden'
      : 'reported ' + winIds(fourOfFive));

  // One square short of a blackout. The full card must be silent, and so must every line THROUGH
  // the missing square — while the lines that avoid it still win, so this is not "silence because
  // detection stopped".
  const nearlyAll = everyKey.filter((k) => k !== '4:4');
  const nearWins = state.completedPatterns({ bundle: B, session: sessionWith(nearlyAll, 'marked') });
  const nearIds = nearWins.map((w) => w.id).sort().join(',');
  record('wins', 'one unmarked square kills the full card and every line through it, and nothing else',
    nearIds === 'column:0,column:1,column:2,column:3,diagonal:1,row:0,row:1,row:2,row:3',
    '24 of 25 squares marked (4:4 hidden) → ' + winIds(nearWins));

  // ---- 4. exactly once, including two patterns completing on the same square (Gate 4) ----------
  //
  // 4:4 is the last square of row 5 AND the last square of the top-left→bottom-right diagonal, so
  // one click completes two patterns. Both must be announced, each once, and the NEXT click must
  // announce nothing at all.
  const primed = ['0:4', '1:4', '2:4', '3:4', '0:0', '1:1', '3:3'];
  const before = state.completedPatterns({ bundle: B, session: sessionWith(primed, 'marked') });
  const after = state.completedPatterns({ bundle: B, session: sessionWith(primed.concat(['4:4']), 'marked') });
  record('wins', 'one square completing a row AND a diagonal reports both, each exactly once',
    before.length === 0 && after.length === 2
    && after.map((w) => w.id).sort().join(',') === 'diagonal:0,row:4',
    'before the last square: ' + winIds(before) + ' — after it: ' + winIds(after));

  // The same sequence through the REAL rail, which is where "exactly once" is actually kept.
  const winStage = harnessStage();
  renderer.renderBoard({ bundle: B, session: sessionWith(primed, 'marked'), mount: winStage, handlers: {} });
  const rail = renderer.renderWinRail({ mount: winStage });

  renderer.announce('(seed sentinel)');
  renderer.updateWins(rail, before);
  const silentSeed = spokenText();
  record('wins', 'the rail\'s seeding paint says nothing',
    silentSeed === '(seed sentinel)',
    'after the first updateWins the live region still says "' + silentSeed + '"');
  renderer.updateWins(rail, after);
  const firstSpoken = spokenText();
  const chips = [...rail.root.querySelectorAll('.qbe-win')].map((n) => n.textContent);

  // THIS ASSERTION USED TO CHECK ONLY `firstSpoken.indexOf('Pattern complete:') === 0`, which is
  // true whenever ANY ONE of the two was spoken — so it could not fail on the defect it was written
  // for. `announce` sets `liveRegion.textContent`, and N writes in one task collapse to the last
  // value a polite live region ever sees, so announcing per-win inside the loop spoke exactly one of
  // them: four chips, one sentence, three wins never heard. The test therefore asserts CONTENT, and
  // specifically that BOTH pattern names are in the single utterance.
  const spokeBoth = firstSpoken.indexOf('Row 5') !== -1
    && firstSpoken.indexOf('Diagonal, top left to bottom right') !== -1
    && firstSpoken.split('Pattern complete:').length === 2; // one lead-in, not one per win
  record('wins', 'the win rail paints one chip per pattern and speaks BOTH in one utterance',
    chips.length === 2
    && chips.indexOf('Pattern complete: Row 5') !== -1
    && chips.indexOf('Pattern complete: Diagonal, top left to bottom right') !== -1
    && spokeBoth
    && rail.root.hidden === false,
    'rail shows [' + chips.join(' | ') + ']; the live region says "' + firstSpoken + '"');

  // A later move — on a cell that completes nothing — must not repaint or re-announce either win.
  renderer.announce('(second sentinel)');
  const later = state.completedPatterns({
    bundle: B, session: sessionWith(primed.concat(['4:4', '0:1']), 'marked'),
  });
  renderer.updateWins(rail, later);
  const afterLater = spokenText();
  const chipsLater = [...rail.root.querySelectorAll('.qbe-win')].map((n) => n.textContent);
  record('wins', 'marking another square afterwards re-announces nothing and paints no new chip',
    chipsLater.length === 2 && afterLater === '(second sentinel)',
    'still ' + chipsLater.length + ' chip(s); the live region still says "' + afterLater + '"');

  // ---- 5. a resumed session shows its wins but does not re-announce them ------------------------
  //
  // The room already watched these happen. `completedPatterns` is pure, so a resumed session hands
  // the rail its inherited wins on the FIRST paint — which is exactly the paint the rail seeds
  // silently. Both halves matter: silent, and still visible.
  const resumeStage = harnessStage();
  renderer.renderBoard({ bundle: B, session: sessionWith(rowKeys, 'marked'), mount: resumeStage, handlers: {} });
  const resumeRail = renderer.renderWinRail({ mount: resumeStage });
  renderer.announce('(resume sentinel)');
  renderer.updateWins(resumeRail, state.completedPatterns({ bundle: B, session: sessionWith(rowKeys, 'marked') }));
  const resumeChips = [...resumeRail.root.querySelectorAll('.qbe-win')].map((n) => n.textContent);
  record('wins', 'resuming a session with a win already in it paints it but stays silent',
    resumeChips.length === 1 && resumeChips[0] === 'Pattern complete: Row 1'
    && spokenText() === '(resume sentinel)',
    'rail shows [' + resumeChips.join(' | ') + ']; the live region still says "' + spokenText() + '"');

  // The rail is published DOM (theme-contract §2 v1.5), so it is walked like the rest of the board.
  assertContract('demo-bingo.json + win rail', winStage);

  // ---- 6. the pattern set comes from the CONFIG, never from this code --------------------------
  const rowOnly = await synthTypedBundle('row-only', gridContent('Row-only wins', 4, 4, 'bingo'),
    patternGametype('bingo', ['row']));
  if (!rowOnly.ok) {
    record('wins', 'a game type declaring only ["row"] validates', false,
      rowOnly.failures.map(errors.formatFailure).join(' | '));
  } else {
    // A complete column AND a complete row on a board whose config names only rows.
    const both = ['0:0', '0:1', '0:2', '0:3', '1:0', '2:0', '3:0'];
    const wins = state.completedPatterns({ bundle: rowOnly.value, session: sessionWith(both, 'marked') });
    record('wins', 'a game type declaring only ["row"] does not win on a completed column',
      wins.length === 1 && wins[0].id === 'row:0',
      'column 1 and row 1 are both fully marked; reported ' + winIds(wins));
  }

  // ---- 7. the terminal state is derived from cellLifecycle, not the word "marked" ---------------
  const revealType = await synthTypedBundle('reveal-lifecycle',
    gridContent('Wins on revealed', 3, 3, 'bingo'),
    patternGametype('bingo', ['row'], ['hidden', 'revealed']));
  if (!revealType.ok) {
    record('wins', 'a pattern game type whose terminal state is "revealed" validates', false,
      revealType.failures.map(errors.formatFailure).join(' | '));
  } else {
    const line = ['0:1', '1:1', '2:1'];
    const onRevealed = state.completedPatterns({ bundle: revealType.value, session: sessionWith(line, 'revealed') });
    const onHidden = state.completedPatterns({ bundle: revealType.value, session: sessionWith(line, 'hidden') });
    record('wins', 'the winning state is the game type\'s terminal state, not the literal "marked"',
      onRevealed.length === 1 && onRevealed[0].id === 'row:1' && onHidden.length === 0,
      'lifecycle [hidden, revealed]: a fully revealed row wins (' + winIds(onRevealed)
        + '), a fully hidden one does not (' + winIds(onHidden) + ')');
  }

  // ---- 8. a non-square board has no diagonal, and says so by silence ---------------------------
  const oblong = await synthTypedBundle('oblong', gridContent('5 by 4', 5, 4, 'bingo'),
    patternGametype('bingo', ['row', 'column', 'diagonal', 'full-card']));
  const square = await synthTypedBundle('square', gridContent('5 by 5', 5, 5, 'bingo'),
    patternGametype('bingo', ['row', 'column', 'diagonal', 'full-card']));
  if (!oblong.ok || !square.ok) {
    record('wins', 'the square and non-square pattern boards validate', false,
      (oblong.ok ? square : oblong).failures.map(errors.formatFailure).join(' | '));
  } else {
    const everything = (bundle) => state.completedPatterns({
      bundle, session: sessionWith(bundle.resolved.cellKeys, 'marked'),
    });
    const oblongWins = everything(oblong.value);
    const squareWins = everything(square.value);
    const oblongDiagonals = oblongWins.filter((w) => w.pattern === 'diagonal');
    const squareDiagonals = squareWins.filter((w) => w.pattern === 'diagonal');

    record('wins', 'a fully marked 5x4 card reports its rows, columns and full card — and NO diagonal',
      oblongDiagonals.length === 0 && oblongWins.length === 4 + 5 + 1,
      oblongWins.length + ' win(s): ' + winIds(oblongWins)
        + ' — a 5x4 grid contains no diagonal, so reporting one would be a bent line called straight');

    record('wins', 'a fully marked 5x5 card reports BOTH diagonals, so the skip is geometry not cowardice',
      squareDiagonals.length === 2
      && squareDiagonals.map((w) => w.id).sort().join(',') === 'diagonal:0,diagonal:1'
      && squareWins.length === 5 + 5 + 2 + 1,
      squareWins.length + ' win(s) on the square board: ' + winIds(squareWins));
  }

  // ---- 8b. a RAGGED board reports no line its geometry does not contain ------------------------
  //
  // `gridConstraints.uniformRows` DEFAULTS TO FALSE (schemas.js), and nothing in the schema layer
  // ties `winCondition: "pattern-complete"` to it — so an author-written game type reaches the row
  // and column builders with columns of unequal depth. The row builder used to collect only the
  // cells that HAPPEN to exist at row index r: on columns of 5, 3 and 3, marking the single square
  // `0:4` reported `row:4`, and the rail announced "Pattern complete: Row 5" for one square on an
  // otherwise empty board. A short column likewise reported itself complete on its own — with a
  // one-cell column, on the first mark of the game. A wrong win announced to a room cannot be taken
  // back, so both builders now skip a line the board does not contain, exactly as `diagonal` has
  // always done. `gametypes/bingo.json` sets `uniformRows: true` and cannot reach this, which is
  // why a green suite could sit on top of it: the group had no ragged case at all.
  const raggedType = patternGametype('bingo', ['row', 'column', 'full-card']);
  raggedType.gridConstraints = { uniformRows: false };
  const ragged = await synthTypedBundle('ragged', raggedContent('Ragged card', [5, 3, 3], 'bingo'), raggedType);
  if (!ragged.ok) {
    record('wins', 'a ragged (non-uniform) pattern board validates', false,
      ragged.failures.map(errors.formatFailure).join(' | '));
  } else {
    const R = ragged.value;
    const raggedWins = (keys) => state.completedPatterns({ bundle: R, session: sessionWith(keys, 'marked') });

    const deepOnly = raggedWins(['0:4']);
    record('wins', 'a row only the deepest column reaches is NOT a completed row',
      deepOnly.length === 0,
      'columns of 5/3/3, only 0:4 marked → ' + winIds(deepOnly)
        + ' — row 5 exists in one column out of three, so there is no row 5 to complete');

    const shortColumn = raggedWins(['1:0', '1:1', '1:2']);
    record('wins', 'a column shorter than the board is NOT a completed column',
      shortColumn.length === 0,
      'all three squares of the 3-deep middle column marked → ' + winIds(shortColumn));

    const realRow = raggedWins(['0:0', '1:0', '2:0']);
    record('wins', 'a row that DOES span every column still wins on a ragged board',
      realRow.length === 1 && realRow[0].id === 'row:0',
      'one square in each column at row 0 → ' + winIds(realRow));

    const allMarked = raggedWins(R.resolved.cellKeys);
    record('wins', 'a fully marked ragged board reports only the lines it really contains',
      allMarked.map((w) => w.id).sort().join(',') === 'column:0,full-card:0,row:0,row:1,row:2',
      allMarked.length + ' win(s): ' + winIds(allMarked)
        + ' — rows 1-3 span all three columns, only column 1 is full depth, and the card is full');
  }

  // ---- 9. a game type that is not won by patterns is never won by one --------------------------
  const demo = await fileBundle('games/demo.json');
  if (demo.ok) {
    const played = state.completedPatterns({
      bundle: demo.value, session: sessionWith(demo.value.resolved.cellKeys, 'answered'),
    });
    record('wins', 'a fully played jeopardy board reports no pattern win (winCondition is highest-score)',
      played.length === 0,
      played.length === 0 ? 'winCondition "' + demo.value.gametype.winCondition
        + '" short-circuits before any geometry is considered'
        : 'reported ' + winIds(played));
  }

  // ---- 10. the two cellStateFor implementations agree ------------------------------------------
  //
  // `state.cellStateFor` is a deliberate twin of `renderer.cellStateFor` — the import graph
  // (module-contracts §2) forbids either module importing the other, so the derivation exists twice
  // and this is what stops the copies drifting. Every cell of every shipped board, under three
  // different sessions, including a session carrying a state the game type does not declare.
  const boards = [['games/demo.json', demo], ['games/demo-bingo.json', bingo],
    ['games/demo-feud.json', await fileBundle('games/demo-feud.json')]];
  let compared = 0;
  const disagreements = [];
  for (const [label, result] of boards) {
    if (!result.ok) { disagreements.push(label + ' did not validate'); continue; }
    const bundle = result.value;
    const sessions = [
      { cellStates: {}, bonusCells: [] },
      sessionWith(bundle.resolved.cellKeys, bundle.resolved.terminalState),
      // A foreign state that this game type does not declare: both must ignore it identically.
      sessionWith(bundle.resolved.cellKeys, 'answered'),
    ];
    for (const session of sessions) {
      for (const key of bundle.resolved.cellKeys) {
        const a = state.cellStateFor(bundle, session, key);
        const b = renderer.cellStateFor(bundle, session, key);
        compared++;
        if (a !== b) disagreements.push(label + ' ' + key + ': state says ' + a + ', renderer says ' + b);
      }
    }
  }
  record('wins', 'state.cellStateFor and renderer.cellStateFor agree on every cell of every board',
    compared > 0 && disagreements.length === 0,
    disagreements.length === 0 ? compared + ' cell/session combinations, identical in both modules'
      : disagreements.slice(0, 4).join('; '));
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
  // Every REGISTERED theme, applied to a real boot and measured — manifest-driven, so a sixth theme
  // is covered the moment it is registered.
  await runThemeGeometrySuite();
  // F6/F7/F10. After the shell suites because these boot the shell too and the boots are cheaper
  // once the browser has the app's modules cached; before the invariant suite, which only reads
  // source text. Both suites hand the session shelf back exactly as they found it (withEmptyShelf).
  await runStateSuite();
  await runBonusSuite();
  // F8. Pure detection plus the rail that shows it — no shelf, no boot, so it can run anywhere in
  // this list; it sits after the state suite because it reads `state` and after the render suite
  // because it renders a real board to hang the rail on.
  await runWinsSuite();
  // The file-level audit of the same manifest: fetchability, zero-CDN, SPDX, tokens, classes.
  await runThemeSuite();
  // F11/F12. After the state suite because it uses `withEmptyShelf` and the same shelf helpers,
  // and before the invariants, which only read source text.
  await runStartupSuite();
  await runInvariantSuite();

  mount.textContent = '';
  renderReport(mount);
}
