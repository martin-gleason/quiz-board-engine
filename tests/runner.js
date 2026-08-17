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
// not on the brace that followed it. For an unclosed brace it is on the brace that was never
// closed, not at end-of-file, because EOF tells the author nothing about where they lost track.
const SCANNER_CASES = [
  ['trailing comma before }', '{\n  "a": 1,\n}', 2],
  ['trailing comma before ]', '{\n  "a": [1, 2,]\n}', 2],
  ['unterminated string', '{\n  "a": "oops\n}', 2],
  ['single quotes', "{\n  'a': 1\n}", 2],
  ['unquoted key', '{\n  a: 1\n}', 2],
  ['missing comma between members', '{\n  "a": 1\n  "b": 2\n}', 3],
  ['unclosed brace', '{\n  "a": 1', 1],
  ['trailing garbage', '{"a":1}\nnope', 2],
  ['empty file', '', 1],
];

function runScannerSuite() {
  for (const [label, text, expectedLine] of SCANNER_CASES) {
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
// Invariant suite — the named CLAUDE.md invariant, asserted at runtime
//
// The grep in CI would be better, but spec §2.1 forbids Actions. So we check what we can from
// inside the browser: fetch our own source and look for the forbidden APIs. This catches a
// contributor who adds `innerHTML` and never runs a grep.
// ---------------------------------------------------------------------------------------------

// Repo-root-relative, because index.html sets <base href="../"> so that the loader's file
// identity strings resolve correctly. See the comment on that tag.
const SOURCES = [
  'js/schemas.js', 'js/loader.js', 'js/validator.js', 'js/errors.js',
  'tests/runner.js',
];
// WHY THIS IS ASSEMBLED FROM FRAGMENTS RATHER THAN WRITTEN AS ONE REGEX LITERAL:
// this file is itself in SOURCES, and a literal /innerHTML/ in its own source would make the
// check flag itself — which it did, on the first run. Splitting the needles means the forbidden
// words never appear as contiguous text here, so runner.js stays honestly scannable instead of
// being excluded from its own audit. Comment-stripping alone could not fix this: a regex literal
// is code, not a comment.
const FORBIDDEN = new RegExp(
  '\\b(' + ['inner' + 'HTML', 'outer' + 'HTML', 'insertAdjacent' + 'HTML',
    'document\\.write', 'ev' + 'al', 'new ' + 'Function'].join('|') + ')\\b',
);

async function runInvariantSuite() {
  for (const src of SOURCES) {
    let text;
    try {
      const res = await fetch(src + '?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) { record('invariants', `read ${src}`, false, `HTTP ${res.status}`); continue; }
      text = await res.text();
    } catch (err) {
      record('invariants', `read ${src}`, false, `fetch failed: ${err && err.message}`);
      continue;
    }

    // Strip comments before scanning: this very file names the forbidden APIs in prose, and a
    // check that cannot survive being documented is a check nobody will keep.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
    const hit = FORBIDDEN.exec(code);
    // Label deliberately avoids naming the forbidden APIs — see the FORBIDDEN comment above.
    record('invariants', `${src} uses no forbidden DOM or dynamic-code API`, !hit,
      hit ? `found "${hit[1]}" — this is a build-stopping invariant violation` : 'clean');

    const hasSpdx = /SPDX-License-Identifier:\s*AGPL-3\.0-or-later/.test(text);
    record('invariants', `${src} carries the SPDX header`, hasSpdx, hasSpdx ? 'present' : 'missing');
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
  await runCleaningSuite();
  await runInvariantSuite();

  mount.textContent = '';
  renderReport(mount);
}
