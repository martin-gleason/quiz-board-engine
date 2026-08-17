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
    for (const next of importedPaths(src, text)) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }

    // Strip comments before scanning: this very file names the forbidden APIs in prose, and a check
    // that cannot survive being documented is a check nobody will keep. The line-comment strip is
    // ANCHORED TO THE LINE. It used to be /(^|\s)\/\/[^\n]*/, which also deleted from a `//` inside a
    // string literal to end of line — so `const u = 'http: //x'; el.innerHTML = s;` stripped down to
    // `const u = 'http: ` and the violation on the rest of that line became invisible. Every comment
    // in this repo is written at the start of its own line, so anchoring costs nothing.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
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
  await runInvariantSuite();

  mount.textContent = '';
  renderReport(mount);
}
