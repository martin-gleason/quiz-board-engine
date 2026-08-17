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
  // contract v1.3. `data-team` and `data-session` are absent from this table on purpose: they carry
  // an INDEX, not a value from a closed set, so there is no enum to check them against.
  'data-screen': ['teams', 'resume'],
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
  const chrome = children.filter((n) => classOf(n) === 'qbe-toolbar' || classOf(n) === 'qbe-setup');
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

      // F6 PUT A SCREEN IN FRONT OF THE BOARD, so the shell no longer boots straight to one: a new
      // game opens on team setup, and a browser that already holds a session for this game opens on
      // the resume list. This suite is about the BOARD — its theme, its geometry, its density — so
      // the poll walks through whichever screen it meets exactly as a host would, by clicking the
      // real button. It does not reach into `state`: if the setup screen ever stops leading to a
      // board, these assertions must fail rather than be routed around.
      const setup = !board && doc ? doc.querySelector('.qbe-setup') : null;
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

    for (const { name, file } of registered) {
      link.setAttribute('href', THEMES_DIR + file);
      const loaded = await waitForSheet(doc, file);
      const sheets = [...doc.styleSheets].map((s) => (s.href || '(inline)').split('?')[0]);
      const baseIndex = sheets.findIndex((h) => /themes\/default\.css$/.test(h));
      const selectedIndex = sheets.map((h, i) => ({ h, i }))
        .filter(({ h }) => new RegExp('themes/' + file.replace('.', '\\.') + '$').test(h))
        .map(({ i }) => i).pop();
      record('shell', `theme "${name}": default.css is the base layer under themes/${file}`,
        loaded && baseIndex !== -1 && selectedIndex !== undefined && baseIndex <= selectedIndex,
        !loaded ? `themes/${file} never parsed into document.styleSheets`
          : 'stylesheets in cascade order: ' + sheets.map((h) => h.replace(/^.*\//, '')).join(', '));

      assertShellGeometry(`theme "${name}"`, doc, win, board, frame);
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
  // The file-level audit of the same manifest: fetchability, zero-CDN, SPDX, tokens, classes.
  await runThemeSuite();
  await runInvariantSuite();

  mount.textContent = '';
  renderReport(mount);
}
