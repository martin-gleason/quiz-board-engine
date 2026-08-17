// SPDX-License-Identifier: AGPL-3.0-or-later
//
// errors.js — Quiz Board Engine
//
// ROLE (CLAUDE.md module boundaries): `errors` EXPLAINS. It builds ValidationFailure objects,
// finds the location of JSON syntax faults, owns every word of user-facing error copy, and
// draws the error screen. It fetches nothing, validates nothing, and remembers nothing.
//
// It imports ONLY `schemas` (module-contracts §2). That restriction is deliberate and load
// bearing: the error screen must be renderable from a bare array of hand-written failures, with
// no loader, no validator instance, and no Reveal in play — which is exactly how
// /tests/index.html prints the spec §9 error matrix.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS FILE IS THE SIZE IT IS
// ---------------------------------------------------------------------------------------------
// Spec §7 promotes error reporting to a product feature, on the finding that "JSON error
// messages are frequently useless to the person staring at the file." The person we are writing
// for is a teacher who edited a quiz file in the GitHub web editor twenty minutes before class.
// They did not write this app, they may never have seen JSON before this week, and they cannot
// open a debugger. Every message here has to answer four questions without them asking:
//
//   (a) WHICH FILE is broken            -> ValidationFailure.file
//   (b) WHERE in it                     -> Location (line/column/snippet/caret) or a JSON path
//   (c) WHAT was expected vs WHAT was found -> expected / found, both authored human phrases
//   (d) WHAT IS PROBABLY WRONG          -> hintText(), plain language, per error CLASS
//
// The (d) column is why hints attach to *classes* and never to individual fields (plan §7 risk
// register). Per-field prose would be 300 strings to maintain and would rot the first time a
// schema changed. A closed set of classes stays true forever.
//
// ---------------------------------------------------------------------------------------------
// WHY WE WRITE OUR OWN JSON SCANNER (plan Q6 — the single most important decision in this file)
// ---------------------------------------------------------------------------------------------
// `JSON.parse` throws a SyntaxError whose `.message` is engine-specific and unstable:
//
//   Chrome/V8:      "Unexpected token } in JSON at position 412"   (wording changed in V8 11.x)
//   Firefox/SpiderMonkey: "JSON.parse: expected double-quoted property name at line 14 column 3"
//   Safari/JSC:     "JSON Parse error: Expected '}'"               (no position at all)
//
// Scraping those strings would (1) violate spec §2.5's identical-behavior-across-engines
// constraint, (2) break silently on any browser update, and (3) still not give us a line, a
// column, a snippet, or a caret in Safari's case. So we never look at the thrown message. We do
// not even accept it as an argument. On a parse failure the caller hands us the RAW TEXT, and
// the scanner below walks it itself, deriving line/column/snippet/caret and — the part a browser
// could never give us — a fault CLASS specific enough to hint at ("there is probably an extra
// comma just before this position"). Deterministic, identical in all three engines, testable
// from a string literal with no browser at all.

import { HINT_CLASSES } from './schemas.js';

// =============================================================================================
// SECTION 1 — path rendering
// =============================================================================================

/**
 * Render the walker's path segments into spec §7's exact notation:
 *
 *   {t:'field', k:'value'} -> `.value`      {t:'index', i:1} -> `[1]`
 *   {t:'key',   k:'0:2'}   -> `["0:2"]`
 *
 * Joined once, at failure time, so the happy path allocates no strings (module-contracts §5.1).
 * The root document renders as `(file)` and never as the empty string — "expected an object,
 * found a number" with a blank location is the kind of message this file exists to abolish.
 */
export function pathFromSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return '(file)';
  let out = '';
  for (const seg of segments) {
    if (seg.t === 'field') out += '.' + seg.k;
    else if (seg.t === 'index') out += '[' + seg.i + ']';
    else if (seg.t === 'key') out += '["' + seg.k + '"]';
  }
  return out.charAt(0) === '.' ? out.slice(1) : out || '(file)';
}

// =============================================================================================
// SECTION 2 — describeValue: the `found` half of every expected-vs-found pair
// =============================================================================================

const FOUND_MAX = 120; // module-contracts §5: `found` is truncated to 120 chars.

function truncate(s, max = FOUND_MAX) {
  return s.length <= max ? s : s.slice(0, max - 1) + '\u2026';
}

/**
 * Turn any JS value into a phrase that completes "found ___".
 *
 * WHY THIS EXISTS AT ALL: the instinct is to write `found: typeof v` or to interpolate the value
 * directly. Both fail the teacher. `typeof v` says "object" for an array, which is the exact
 * confusion behind half of all JSON type errors. Raw interpolation prints `[object Object]`, or
 * dumps a 2,000-character prompt across the error screen, or renders `undefined` — a word that
 * means nothing to someone who does not write JavaScript. So every `found` value in the app comes
 * through here, and every one of them reads like English.
 *
 * The absent case is the one that matters most: "nothing (the field is absent)" tells the reader
 * to ADD something. "undefined" tells them nothing.
 */
export function describeValue(v) {
  if (v === undefined) return 'nothing (the field is absent)';
  if (v === null) return 'null (an empty value)';
  const t = typeof v;
  if (t === 'string') {
    // Quote it so trailing spaces and empty strings are visible. `""` reads as a real finding;
    // an unquoted empty string reads as a bug in the error screen.
    return truncate('the text ' + JSON.stringify(truncate(v, FOUND_MAX)));
  }
  if (t === 'number') {
    if (Number.isNaN(v)) return 'the value NaN (not a number)';
    if (!Number.isFinite(v)) return 'an infinite number';
    return 'the number ' + String(v);
  }
  if (t === 'boolean') return 'the value ' + String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return 'an empty list ([])';
    return 'a list of ' + v.length + (v.length === 1 ? ' item' : ' items');
  }
  if (t === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 0) return 'an empty object ({})';
    return truncate('an object with the keys ' + keys.map((k) => '"' + k + '"').join(', '));
  }
  // function / symbol / bigint can only arrive from a programmer error, never from JSON.parse.
  return 'a value of type ' + t;
}

// =============================================================================================
// SECTION 3 — failure(): the one and only ValidationFailure constructor
// =============================================================================================

const STAGES = Object.freeze(['fetch', 'syntax', 'structural', 'contract']);
const HINT_SET = new Set(HINT_CLASSES);

/**
 * Build a frozen ValidationFailure (module-contracts §5).
 *
 * WHY A SINGLE CONSTRUCTOR: three modules raise failures (loader, validator, and this file).
 * If each hand-rolled the object, the error screen would eventually receive one missing `found`,
 * one with `path` AND `location` set, one with a hint class nobody wrote copy for — and the
 * screen would degrade in exactly the moment it is needed. So the invariants are asserted here,
 * once, and they THROW rather than degrade:
 *
 *   - `hint` must be a HINT_CLASSES id. A typo'd hint is a bug in our code, and a bug in our
 *     code must be loud; silently rendering an unhinted error would hide it from us forever.
 *   - exactly one of `path` / `location` is non-null. A syntax fault has no path (the document
 *     did not parse, so there are no fields to name); every other stage has no location (we are
 *     inspecting a parsed object, and re-deriving byte offsets for it would be invention).
 *   - `expected` and `found` are always present, always phrases.
 */
export function failure(fields) {
  const {
    file,
    kind,
    stage,
    path = null,
    location = null,
    expected,
    found,
    hint,
  } = fields || {};

  if (typeof file !== 'string' || file === '') throw new TypeError('failure(): `file` is required');
  if (typeof kind !== 'string' || kind === '') throw new TypeError('failure(): `kind` is required');
  if (!STAGES.includes(stage)) throw new TypeError('failure(): bad stage ' + String(stage));
  if (!HINT_SET.has(hint)) throw new TypeError('failure(): unknown hint class ' + String(hint));
  if (typeof expected !== 'string' || expected === '') throw new TypeError('failure(): `expected` is required');
  if (typeof found !== 'string' || found === '') throw new TypeError('failure(): `found` is required');

  const hasPath = path !== null && path !== undefined;
  const hasLoc = location !== null && location !== undefined;
  if (hasPath === hasLoc) {
    throw new TypeError('failure(): exactly one of `path` / `location` must be set (stage ' + stage + ')');
  }

  const where = hasPath ? path : 'line ' + location.line + ', column ' + location.column;
  const foundText = truncate(found);

  return Object.freeze({
    file,
    kind,
    stage,
    path: hasPath ? path : null,
    location: hasLoc ? freezeLocation(location) : null,
    expected,
    found: foundText,
    hint,
    // One-line summary for the console and the test runner's table. The error SCREEN composes
    // its own richer layout from the structured fields and deliberately ignores `message` —
    // duplicating prose between the two is how they drift.
    message: where + ': expected ' + expected + ', found ' + foundText,
  });
}

function freezeLocation(loc) {
  const snippet = Array.isArray(loc.snippet)
    ? Object.freeze(loc.snippet.map((l) => Object.freeze({ lineNumber: l.lineNumber, text: l.text })))
    : Object.freeze([]);
  return Object.freeze({
    line: loc.line,
    column: loc.column,
    offset: loc.offset,
    snippet,
    caretColumn: loc.caretColumn,
    // ADDITIVE (documented extension to module-contracts §5's Location): the fault sub-class
    // from the scanner. `hint` stays the broad class `syntax` — the risk register requires hints
    // to attach to classes — while `syntaxClass` lets hintText() pick the sentence that actually
    // helps ("extra comma" vs "unclosed brace"). Nothing outside hintText() reads it.
    syntaxClass: loc.syntaxClass || 'unknown',
  });
}

/** One-line rendering for the console and the test runner's results table. */
export function formatFailure(f) {
  return f.file + ' \u2014 ' + f.message + ' [' + f.hint + ']';
}

// =============================================================================================
// SECTION 4 — the JSON scanner (plan Q6)
// =============================================================================================
//
// A minimal, complete, recursive-descent JSON scanner whose ONLY job is to find and CLASSIFY the
// first structural fault. It is not a parser: it discards every value it reads. That is what
// keeps it small enough to audit and fast enough to run on a 1 MB file without anyone noticing.
//
// Fault classes, and why each one earns its own hint:
//
//   trailing-comma            The #1 hand-edit mistake. `{"a":1,}` — every other language allows
//                             it, JSON does not, and the browser points at the `}` rather than at
//                             the comma, so people stare at a brace that is perfectly fine. We
//                             point at the COMMA.
//   unclosed-brace/bracket    Deleting a block usually takes its closer with it. The browser
//                             reports end-of-file, which is nowhere near the mistake; we report
//                             the position of the OPENING brace that never got closed.
//   unterminated-string       A missing closing quote swallows the rest of the line. Caret goes
//                             on the opening quote, because that is the character to look at.
//   single-quoted-string      Muscle memory from JS/Python. JSON has no single-quoted strings.
//   unquoted-property-name    Same muscle memory: `{title: "x"}` is JS, not JSON.
//   missing-comma             Two members with nothing between them — usually a line pasted in.
//   missing-colon             `{"a" 1}` — a colon typed as something else, or deleted.
//   trailing-content          Content after the top-level value: a duplicated paste, or a stray
//                             `}`. The document "ended" earlier than the author thinks it did.
//   empty-file               Saved empty, or the editor wrote nothing. Zero-length text throws a
//                             completely opaque parse error otherwise.
//   byte-order-mark          Windows Notepad and some editors prepend U+FEFF. It is invisible in
//                             every editor, and `JSON.parse` dies on it. Without this class the
//                             report reads "unexpected character at line 1 column 1" on a file
//                             that looks flawless — an unfixable bug for the user.
//   bad-escape                `"C:\path"` — a lone backslash. JSON needs `\\`.
//   control-character         A literal tab or newline inside a string.
//   invalid-number            `01`, `1.`, `+1`, `.5`, `1e`.
//   bad-literal               `True`, `NULL`, `None`, `NaN`, `undefined` — other languages' words.
//   unexpected-end            The text stops where a value was required.
//   unexpected-character      Honest fallback; still reports line/column/snippet/caret.
//   too-deep                  Nesting guard, so hostile input cannot blow the JS stack. This is
//                             a robustness bound, not a user-facing content rule.
//   unknown                   Only when JSON.parse rejected text our scanner accepts. Should be
//                             unreachable; reported honestly rather than pretending precision.

const SYNTAX_HINTS = Object.freeze({
  'trailing-comma': Object.freeze({
    title: 'There is probably an extra comma just before this position.',
    body:
      'JSON does not allow a comma after the last item in a list or the last field in an object. ' +
      'Delete the comma marked above — or, if you meant to add another entry after it, add that entry.',
  }),
  'unclosed-brace': Object.freeze({
    title: 'This "{" is never closed.',
    body:
      'Every "{" needs a matching "}". The one marked above was opened and the file ended before it ' +
      'closed, so a "}" is missing somewhere after this point. Deleting a block of text and leaving ' +
      'its closing brace behind is the usual cause.',
  }),
  'unclosed-bracket': Object.freeze({
    title: 'This "[" is never closed.',
    body:
      'Every "[" needs a matching "]". The one marked above was opened and the file ended before it ' +
      'closed, so a "]" is missing somewhere after this point.',
  }),
  // WHY THE OUTERMOST CASE IS ITS OWN CLASS (A4 usability finding). For a NESTED "{" the opening
  // brace localises the fault: the reader can see which block lost its closer. For the OUTERMOST
  // brace — the commonest missing-brace case by far, because it is the last character of the file —
  // pointing at line 1 column 1 is the worst possible position: the character under the caret is
  // perfectly good JSON and the edit belongs 150 lines away. So for depth 1 the caret goes where
  // the "}" has to be TYPED (the end of the file) and the opening position is carried in prose.
  'unclosed-brace-eof': Object.freeze({
    title: 'The file ends with an unclosed "{".',
    body:
      'The outermost "{" of the file was opened and never closed, so a "}" has to be added at the ' +
      'end of the file. The "expected" line above gives the position of the "{" that is still open. ' +
      'Deleting a block of text and taking its closing brace with it is the usual cause.',
  }),
  'unclosed-bracket-eof': Object.freeze({
    title: 'The file ends with an unclosed "[".',
    body:
      'The outermost "[" of the file was opened and never closed, so a "]" has to be added at the ' +
      'end of the file. The "expected" line above gives the position of the "[" that is still open.',
  }),
  'unterminated-string': Object.freeze({
    title: 'This piece of text is missing its closing quotation mark.',
    body:
      'A JSON string opens with " and must close with " on the same line. The quotation mark marked ' +
      'above opens a string that never closes. If your text needs to contain a " character, write it ' +
      'as \\" instead.',
  }),
  'single-quoted-string': Object.freeze({
    title: 'JSON text must use double quotes, not single quotes.',
    body:
      'Replace the \' marked above (and its partner at the other end of the text) with ". This is the ' +
      'most common difference between JSON and other languages you may have written before.',
  }),
  'unquoted-property-name': Object.freeze({
    title: 'This field name needs quotation marks around it.',
    body:
      'In JSON, every field name is a quoted string: write "title": "..." rather than title: "...". ' +
      'Other languages let you leave the quotes off; JSON does not.',
  }),
  'missing-comma': Object.freeze({
    title: 'A comma is probably missing just before this position.',
    body:
      'Items in a list and fields in an object are separated by commas. One entry appears to have ' +
      'ended and another to have begun with nothing between them — usually a line that was pasted in ' +
      'without adding the comma at the end of the line above it.',
  }),
  'missing-colon': Object.freeze({
    title: 'A colon is missing between this field name and its value.',
    body: 'Each field is written as "name": value. Check for a colon typed as something else, or deleted.',
  }),
  'trailing-content': Object.freeze({
    title: 'The file has extra content after the end of the data.',
    body:
      'A JSON file holds exactly one value. Everything the file needs must live inside the outermost ' +
      '{ ... }. Anything after the closing brace — a duplicated paste, or one closing brace too many — ' +
      'has to be removed.',
  }),
  'empty-file': Object.freeze({
    title: 'This file is empty.',
    body:
      'The file contains no text at all. If you expected content here, the save may not have completed, ' +
      'or the file may have been emptied by accident. A game file must contain at least ' +
      '{ "schemaVersion": 1, ... }.',
  }),
  'byte-order-mark': Object.freeze({
    title: 'This file starts with an invisible marker character that JSON does not allow.',
    body:
      'The first character of the file is a byte-order mark (U+FEFF). Some editors — Notepad on ' +
      'Windows especially — add it silently when saving, and no editor shows it to you. Re-save the ' +
      'file as "UTF-8" rather than "UTF-8 with BOM", or edit it in the GitHub web editor, which never ' +
      'writes one.',
  }),
  'bad-escape': Object.freeze({
    title: 'This backslash starts an escape sequence JSON does not recognise.',
    body:
      'Inside quoted text, a backslash has a special meaning. To include a literal backslash, write ' +
      'two of them: \\\\ . The sequences JSON allows are \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX.',
  }),
  'control-character': Object.freeze({
    title: 'There is an invisible control character inside this piece of text.',
    body:
      'A literal tab or line break cannot appear inside quoted text. Write a tab as \\t and a line ' +
      'break as \\n, or remove the character.',
  }),
  'invalid-number': Object.freeze({
    title: 'This is not a number JSON accepts.',
    body:
      'Numbers are written like 100, -50, or 1.5. JSON does not allow a leading + sign, a leading zero ' +
      '(write 7, not 07), a bare decimal point (write 0.5, not .5), or quotes around a number you mean ' +
      'as a number.',
  }),
  'bad-literal': Object.freeze({
    title: 'This looks like a value from another language.',
    body:
      'JSON knows exactly three bare words, all lowercase: true, false, and null. True, FALSE, None, ' +
      'NaN, and undefined are not JSON.',
  }),
  'unexpected-end': Object.freeze({
    title: 'The file ends before the data is complete.',
    body:
      'Something was expected at this point and the file simply stopped. Usually the end of the file ' +
      'was cut off, or a closing brace or bracket is missing.',
  }),
  'unexpected-character': Object.freeze({
    title: 'This character cannot appear here.',
    body:
      'Compare the marked position with a working file such as games/demo.json. A stray character left ' +
      'over from an edit is the usual cause.',
  }),
  'too-deep': Object.freeze({
    title: 'This file nests objects and lists far too deeply.',
    body: 'A game file needs only a handful of levels. This one is nested hundreds deep, which is a sign the file is not a game file at all.',
  }),
  unknown: Object.freeze({
    title: 'This file is not valid JSON, and the exact position could not be pinpointed.',
    body:
      'The file failed to parse, but our scanner found no fault it recognises — please report this file ' +
      'as a bug. In the meantime, comparing it against games/demo.json is the fastest way forward.',
  }),
});

/** Internal signal object. Not an Error: we never mix control flow with real exceptions here. */
function fault(syntaxClass, offset, expected, found) {
  return { syntaxClass, offset, expected, found };
}

const MAX_DEPTH = 200;

/**
 * Scan `text` for the first structural JSON fault.
 *
 * @returns {null | {line, column, offset, snippet, caretColumn, syntaxClass, hint, expected, found}}
 *          `null` means our scanner found no fault. (The caller decides what that means; the
 *          loader treats it as the `unknown` class, because it only ever calls us after
 *          JSON.parse has already refused the text.)
 *
 * Deliberately NOT given, and never asking for, the browser's SyntaxError message (plan Q6).
 */
export function scanJsonSyntax(text) {
  if (typeof text !== 'string') return null;

  // --- Pre-checks that the character loop below could not sensibly express -------------------
  // BOM first: it is at offset 0 and would otherwise be reported as a mystery character.
  if (text.charCodeAt(0) === 0xfeff) {
    return locate(text, fault('byte-order-mark', 0, 'the file to begin with "{"', 'an invisible byte-order mark (U+FEFF)'));
  }
  if (text.trim() === '') {
    return locate(text, fault('empty-file', 0, 'a JSON object beginning with "{"', text.length === 0 ? 'an empty file' : 'a file containing only blank space'));
  }

  const len = text.length;
  let i = 0;
  let depth = 0;

  const at = (k) => (k < len ? text.charAt(k) : '');
  const isWs = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t';
  const skipWs = () => {
    while (i < len && isWs(text.charAt(i))) i++;
  };

  /**
   * The file ended with `openChar` (opened at offset `open`) still open.
   *
   * `depth === 1` means the still-open bracket is the OUTERMOST one, i.e. the whole document.
   * See the 'unclosed-brace-eof' hint copy for why that case points at the end of the file
   * instead of at the opening character.
   */
  const unclosed = (openChar, open) => {
    const closeChar = openChar === '{' ? '}' : ']';
    if (depth === 1) {
      const oc = lineColAt(text, open);
      return fault(
        openChar === '{' ? 'unclosed-brace-eof' : 'unclosed-bracket-eof',
        len,
        'a matching "' + closeChar + '" for the "' + openChar + '" opened at line ' + oc.line + ', column ' + oc.column,
        'the end of the file',
      );
    }
    return fault(
      openChar === '{' ? 'unclosed-brace' : 'unclosed-bracket',
      open,
      'a matching "' + closeChar + '" for this "' + openChar + '"',
      'the end of the file',
    );
  };

  // --- string ------------------------------------------------------------------------------
  // Returns a fault or null. The caret for an unterminated string lands on the OPENING quote,
  // because that is the character whose partner is missing; pointing at the end of the line
  // (which is what engines do) sends the reader to the wrong place.
  function scanString() {
    const open = i;
    i++; // consume the opening quote
    while (i < len) {
      const c = text.charAt(i);
      if (c === '"') {
        i++;
        return null;
      }
      if (c === '\\') {
        const e = at(i + 1);
        if (e === '') return fault('unexpected-end', i, 'an escape sequence', 'the end of the file');
        if ('"\\/bfnrt'.indexOf(e) !== -1) {
          i += 2;
          continue;
        }
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            return fault('bad-escape', i, 'four hexadecimal digits after \\u', 'the text ' + JSON.stringify('\\u' + hex));
          }
          i += 6;
          continue;
        }
        return fault('bad-escape', i, 'a valid escape such as \\" \\\\ \\n or \\t', 'the escape ' + JSON.stringify('\\' + e));
      }
      if (c === '\n' || c === '\r') {
        return fault('unterminated-string', open, 'a closing quotation mark before the end of the line', 'a line break inside the text');
      }
      const code = text.charCodeAt(i);
      if (code < 0x20) {
        return fault('control-character', i, 'ordinary text, or \\t / \\n for a tab or line break', 'an invisible control character (code ' + code + ')');
      }
      i++;
    }
    return fault('unterminated-string', open, 'a closing quotation mark for this text', 'the end of the file');
  }

  // --- number ------------------------------------------------------------------------------
  function scanNumber() {
    const start = i;
    const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/.exec(text.slice(i, i + 64));
    if (!m || m[0].length === 0) {
      return fault('invalid-number', start, 'a number such as 100, -50 or 1.5', 'the text ' + JSON.stringify(text.slice(start, start + 12)));
    }
    i += m[0].length;
    // `01`, `1.`, `1e` and friends: the regex matched a prefix and left a digit or a dot behind.
    const next = at(i);
    if (next !== '' && /[0-9.eE+]/.test(next)) {
      return fault('invalid-number', start, 'a number such as 100, -50 or 1.5', 'the text ' + JSON.stringify(text.slice(start, i + 4)));
    }
    return null;
  }

  // --- literal ----------------------------------------------------------------------------
  function scanLiteral() {
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return null;
      }
    }
    const near = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i, i + 24));
    if (near) {
      return fault('bad-literal', i, 'true, false, null, a number, or text in double quotes', 'the word ' + JSON.stringify(near[0]));
    }
    return fault('unexpected-character', i, 'a value: text in quotes, a number, true, false, null, { or [', 'the character ' + JSON.stringify(at(i)));
  }

  // --- value ------------------------------------------------------------------------------
  function scanValue() {
    if (i >= len) return fault('unexpected-end', len, 'a value', 'the end of the file');
    if (depth > MAX_DEPTH) return fault('too-deep', i, 'a game file nested a few levels deep', 'nesting more than ' + MAX_DEPTH + ' levels deep');
    const c = text.charAt(i);
    if (c === '{') return scanObject();
    if (c === '[') return scanArray();
    if (c === '"') return scanString();
    if (c === "'") return fault('single-quoted-string', i, 'text wrapped in double quotes', "text wrapped in single quotes (')");
    if (c === '-' || (c >= '0' && c <= '9')) return scanNumber();
    if (c === '+' || c === '.') return fault('invalid-number', i, 'a number such as 100, -50 or 0.5', 'the character ' + JSON.stringify(c));
    return scanLiteral();
  }

  // --- object -----------------------------------------------------------------------------
  function scanObject() {
    const open = i;
    i++; // '{'
    depth++;
    skipWs();
    if (i >= len) return unclosed('{', open);
    if (at(i) === '}') {
      i++;
      depth--;
      return null;
    }
    let lastComma = -1;
    for (;;) {
      skipWs();
      if (i >= len) return unclosed('{', open);
      const c = text.charAt(i);
      // THE TRAILING-COMMA CASE, and the reason its caret is on the comma and not on the brace.
      if (c === '}' && lastComma !== -1) {
        return fault('trailing-comma', lastComma, 'another field after this comma, or no comma at all', 'a comma followed by "}"');
      }
      if (c === ',') {
        return fault('unexpected-character', i, 'a field name in double quotes', 'a comma with no field before it');
      }
      if (c === "'") {
        return fault('single-quoted-string', i, 'a field name wrapped in double quotes', "a field name wrapped in single quotes (')");
      }
      if (c !== '"') {
        const bare = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(text.slice(i, i + 40));
        if (bare) return fault('unquoted-property-name', i, 'a field name wrapped in double quotes, e.g. "title"', 'the unquoted name ' + JSON.stringify(bare[0]));
        return fault('unexpected-character', i, 'a field name in double quotes, or "}"', 'the character ' + JSON.stringify(c));
      }
      const keyFault = scanString();
      if (keyFault) return keyFault;
      skipWs();
      if (i >= len) return unclosed('{', open);
      if (at(i) !== ':') {
        return fault('missing-colon', i, 'a colon between the field name and its value', 'the character ' + JSON.stringify(at(i)));
      }
      i++; // ':'
      skipWs();
      const valFault = scanValue();
      if (valFault) return valFault;
      skipWs();
      if (i >= len) return unclosed('{', open);
      const sep = text.charAt(i);
      if (sep === ',') {
        lastComma = i;
        i++;
        continue;
      }
      if (sep === '}') {
        i++;
        depth--;
        return null;
      }
      // Two fields with nothing between them. The caret sits at the START of the second field,
      // because the comma belongs at the end of the line above it — where the reader is looking.
      return fault('missing-comma', i, 'a comma before the next field, or "}" to end the object', 'the character ' + JSON.stringify(sep));
    }
  }

  // --- array ------------------------------------------------------------------------------
  function scanArray() {
    const open = i;
    i++; // '['
    depth++;
    skipWs();
    if (i >= len) return unclosed('[', open);
    if (at(i) === ']') {
      i++;
      depth--;
      return null;
    }
    let lastComma = -1;
    for (;;) {
      skipWs();
      if (i >= len) return unclosed('[', open);
      if (at(i) === ']' && lastComma !== -1) {
        return fault('trailing-comma', lastComma, 'another item after this comma, or no comma at all', 'a comma followed by "]"');
      }
      const valFault = scanValue();
      if (valFault) return valFault;
      skipWs();
      if (i >= len) return unclosed('[', open);
      const sep = text.charAt(i);
      if (sep === ',') {
        lastComma = i;
        i++;
        continue;
      }
      if (sep === ']') {
        i++;
        depth--;
        return null;
      }
      return fault('missing-comma', i, 'a comma before the next item, or "]" to end the list', 'the character ' + JSON.stringify(sep));
    }
  }

  // --- drive it ---------------------------------------------------------------------------
  skipWs();
  const f = scanValue();
  if (f) return locate(text, f);
  skipWs();
  if (i < len) {
    return locate(
      text,
      fault('trailing-content', i, 'the end of the file after the closing brace', 'the character ' + JSON.stringify(at(i))),
    );
  }
  return null; // Syntactically valid as far as we can tell.
}

// ---------------------------------------------------------------------------------------------
// offset -> line / column / snippet / caret
// ---------------------------------------------------------------------------------------------
//
// Computed from the raw text, not from anything a browser told us, so all three engines produce
// byte-identical output.
//
// COLUMNS ARE COUNTED IN GRAPHEME CLUSTERS, NOT CODE UNITS. This is not pedantry: `"café"` written
// decomposed (`e` + U+0301, which is what macOS filesystem tools and some editors produce) is five
// code units and four visible characters, so a code-unit column drifts one cell right of the
// character it points at for every combining mark earlier on the line — and the number printed on
// screen stops matching the number the reader's editor shows. `caretColumn`, by contrast, stays a
// CODE-UNIT index into the snippet line, because the caret pad is built by slicing that text (see
// buildSnippet) and the pad has to be able to copy tabs verbatim.
//
// SNIPPET LINES ARE CLIPPED. A minified file — what `json.dumps` and `JSON.stringify` emit — is one
// line of up to 1 MB. Left unclipped, the snippet would be twice the size of the file, the caret pad
// would be ~900,000 spaces (92 ms of string work in Firefox, measured), and the caret would sit far
// off the right edge of an `overflow-x:auto` <pre> where nobody can see it. Clipping to a window
// around the fault fixes the cost and the legibility in one move, and leaves ordinary
// pretty-printed files byte-identical.
const SNIPPET_RADIUS = 2; // up to 2 lines either side (module-contracts §5)
const SNIPPET_LINE_RADIUS = 110; // characters kept either side of the caret on the FAULT line
const SNIPPET_CONTEXT_MAX = 220; // characters kept from the start of a CONTEXT line
const ELLIPSIS = '…';

/**
 * Split a string into grapheme clusters — the units a reader counts as "characters".
 *
 * `Intl.Segmenter` is in every browser in the support matrix; the code-point fallback exists so a
 * headless harness without it degrades to today's behaviour rather than throwing.
 */
const SEGMENTER =
  typeof Intl === 'object' && Intl !== null && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function clusters(s) {
  if (!SEGMENTER) return Array.from(s);
  const out = [];
  for (const part of SEGMENTER.segment(s)) out.push(part.segment);
  return out;
}

// For pure-ASCII text — every byte of an ordinary JSON file — code units, code points and grapheme
// clusters are the same count, so we skip the segmenter entirely. That keeps the common path at one
// native regex test instead of segmenting a possibly very long line.
const ASCII_ONLY = /^[\x00-\x7f]*$/;

/** 1-based column of the character AFTER `lead`, counted in grapheme clusters. */
function columnAfter(lead) {
  return (ASCII_ONLY.test(lead) ? lead.length : clusters(lead).length) + 1;
}

/** 1-based line and (grapheme-cluster) column of `offset` within `text`. */
function lineColAt(text, offset) {
  const at = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let n = 0; n < at; n++) {
    if (text.charCodeAt(n) === 10) {
      line++;
      lineStart = n + 1;
    }
  }
  return { line, column: columnAfter(text.slice(lineStart, at)), lineStart };
}

/** Do not cut between the two halves of a surrogate pair; a lone surrogate renders as a tofu box. */
function nudgeLeft(text, index) {
  const c = text.charCodeAt(index);
  return index > 0 && c >= 0xdc00 && c <= 0xdfff ? index - 1 : index;
}

/** Clip a context line to its opening characters. */
function clipContextLine(text) {
  if (text.length <= SNIPPET_CONTEXT_MAX) return text;
  return text.slice(0, nudgeLeft(text, SNIPPET_CONTEXT_MAX)) + ELLIPSIS;
}

/**
 * Clip the fault line to a window around the caret.
 * @returns {{text:string, caretUnits:number}} `caretUnits` is 1-based, into the CLIPPED text.
 */
function clipFaultLine(text, caretUnits) {
  const idx = Math.max(0, Math.min(caretUnits - 1, text.length));
  if (text.length <= SNIPPET_LINE_RADIUS * 2) return { text, caretUnits };
  const start = nudgeLeft(text, Math.max(0, idx - SNIPPET_LINE_RADIUS));
  const end = nudgeLeft(text, Math.min(text.length, idx + SNIPPET_LINE_RADIUS));
  const head = start > 0 ? ELLIPSIS : '';
  const tail = end < text.length ? ELLIPSIS : '';
  return { text: head + text.slice(start, end) + tail, caretUnits: idx - start + head.length + 1 };
}

function locate(text, f) {
  const offset = Math.max(0, Math.min(f.offset, text.length));
  const lines = text.split('\n');

  // Walk lines accumulating lengths until we pass the offset. O(lines), no regex, no allocation
  // per character — a 1 MB file resolves in well under a millisecond.
  let line = 1;
  let lineStart = 0;
  for (let n = 0; n < lines.length; n++) {
    const end = lineStart + lines[n].length; // index of the '\n' (or of text end)
    if (offset <= end) {
      line = n + 1;
      break;
    }
    lineStart = end + 1;
    line = n + 1;
  }
  const units = offset - lineStart + 1; // code-unit column, used for slicing
  const column = columnAfter(text.slice(lineStart, offset)); // what the reader counts

  const from = Math.max(0, line - 1 - SNIPPET_RADIUS);
  const to = Math.min(lines.length - 1, line - 1 + SNIPPET_RADIUS);
  const snippet = [];
  let caretColumn = units;
  for (let n = from; n <= to; n++) {
    // Strip a trailing \r so a CRLF file does not draw a stray glyph at the end of every line.
    const raw = lines[n].replace(/\r$/, '');
    if (n + 1 === line) {
      const clipped = clipFaultLine(raw, units);
      caretColumn = clipped.caretUnits;
      snippet.push({ lineNumber: n + 1, text: clipped.text });
    } else {
      snippet.push({ lineNumber: n + 1, text: clipContextLine(raw) });
    }
  }

  return {
    line,
    column,
    offset,
    snippet,
    caretColumn,
    syntaxClass: f.syntaxClass,
    hint: 'syntax',
    expected: f.expected,
    found: f.found,
  };
}

/**
 * The loader's entry point for a `JSON.parse` throw. Note what it does NOT take: the caught
 * Error. Passing it in would invite someone, someday, to read `.message` — so the seam simply
 * does not exist (plan Q6, CLAUDE.md constraint 5).
 *
 * MIND THE RETURN SHAPE, which is not `failure()`'s despite the near-identical name: `failure()`
 * returns ONE ValidationFailure, this returns a whole `{ok:false, failures:[…]}` Result ready to be
 * returned straight up the loader's call chain.
 *
 * @returns {{ok:false, failures:[ValidationFailure]}}
 */
export function syntaxFailure({ file, kind, text }) {
  const scan = scanJsonSyntax(text);
  const loc =
    scan ||
    {
      line: 1,
      column: 1,
      offset: 0,
      snippet: [{ lineNumber: 1, text: clipContextLine(String(text || '').split('\n')[0] || '') }],
      caretColumn: 1,
      syntaxClass: 'unknown',
      expected: 'a valid JSON document',
      found: 'text the browser refused to parse',
    };

  return {
    ok: false,
    failures: [
      failure({
        file,
        kind,
        stage: 'syntax',
        location: loc,
        expected: loc.expected,
        found: loc.found,
        hint: 'syntax',
      }),
    ],
  };
}

// =============================================================================================
// SECTION 5 — hint copy, one entry per HINT_CLASSES id
// =============================================================================================
//
// Spec §7(d): a plain-language hint. These are the sentences a person acts on. Rules applied to
// every string below:
//
//   - No jargon that only appears in this codebase. The reader has never heard of a "node", a
//     "contract stage", or a "cross-check".
//   - Say what to DO, not what went wrong twice. The expected/found pair already says what went
//     wrong; the hint's job is the next action.
//   - Name the file to edit whenever the answer is "edit a different file than the one that
//     failed" — the unresolved-reference cases especially.
//   - One class, one entry. Never per-field prose (plan §7 risk register).

const HINT_TEXT = Object.freeze({
  'missing-required-field': Object.freeze({
    title: 'A required field is missing.',
    body:
      'Add the field named in the location above. If the location ends in a cell — for example ' +
      'board.columns[2].cells[1] — the game type you chose requires that field on EVERY cell; ' +
      'gametypes/<your game type>.json lists which fields those are, under "requiredCellFields".',
  }),
  'wrong-type': Object.freeze({
    title: 'This value is the wrong kind of thing.',
    body:
      'Compare the expected and found lines above. The commonest cause is quotation marks around a ' +
      'number: "value": "500" is text, while "value": 500 is a number, and only the number will do. ' +
      'true and false must also be bare, never quoted.',
  }),
  'unknown-value': Object.freeze({
    title: 'This value is not one of the choices allowed here.',
    body:
      'The expected line above lists every value this field accepts. Spelling and capitalisation both ' +
      'matter — everything here is lowercase.',
  }),
  'out-of-range': Object.freeze({
    title: 'This number is outside the allowed range.',
    body: 'The expected line above gives the limits. Choose a value inside them.',
  }),
  'too-long': Object.freeze({
    title: 'This text is too long.',
    body:
      'Shorten it to the length given above. The limits exist so the board stays readable when it is ' +
      'projected on a screen — a 2,000-character prompt cannot be read from the back of a room.',
  }),
  'too-many-items': Object.freeze({
    title: 'There are more items here than allowed.',
    body:
      'Remove items until the count fits the limit above. Boards are capped at 12 columns and 12 cells ' +
      'per column so they remain legible when projected.',
  }),
  'too-few-items': Object.freeze({
    title: 'This is empty, or shorter than it is allowed to be.',
    body:
      'Either the list here has no entries or the text here has too few characters — the "found" line ' +
      'above says which. Add entries, or text, until the minimum on the "expected" line is met.',
  }),
  'bad-key-format': Object.freeze({
    title: 'This name on the left-hand side is not in the required shape.',
    body:
      'Cell keys are written "column:row", counting from zero, column first — so the top-left cell is ' +
      '"0:0" and the third cell of the second column is "1:2".',
  }),
  'bad-name-format': Object.freeze({
    title: 'This name is not in the required shape.',
    body:
      'Names identifying a game type or a theme are lowercase letters, digits and hyphens — no spaces, ' +
      'no dots, no slashes. The expected line above gives an example.',
  }),
  'unsupported-schema-version': Object.freeze({
    title: 'This file was written for a newer version of the app.',
    body:
      'The "schemaVersion" number tells the app which rules the file follows, and this copy of the app ' +
      'does not implement the version claimed. It deliberately refuses to guess, because guessing means ' +
      'a board that looks right and plays wrong. Either update the app, or set "schemaVersion" to a ' +
      'version listed above and check the file against it.',
  }),
  'unresolved-reference': Object.freeze({
    title: 'This name points at something that does not exist.',
    body:
      'The value is well formed but nothing answers to it. A "gameType" must match the "id" inside a ' +
      'file in gametypes/. A "theme" must be one of the keys listed in themes/themes.json — a CSS file ' +
      'sitting in themes/ but absent from that manifest will never load, by design. An "animation" must ' +
      'be one of flip, zoom or fade.',
  }),
  'file-too-large': Object.freeze({
    title: 'This file is too big to load.',
    body:
      'Game files are capped at 1 MB. A file that size is almost always a mistake — a pasted image, or a ' +
      'whole spreadsheet. Split the game into several files and pick between them with the ?game= ' +
      'parameter in the address bar.',
  }),
  // WHY THIS CLASS HAS TWO VARIANTS (A4 usability finding). An HTTP status came back FROM A SERVER,
  // which definitively excludes the file:// case — under file:// the loader takes its catch branch
  // and reports "a network error" instead. Telling the teacher who mistyped a filename to go install
  // a web server sends them down the wrong rabbit hole ten minutes before class, so the two causes
  // get two hints, selected in hintText() on the `found` phrase the loader already distinguishes.
  'fetch-failed': Object.freeze({
    title: 'There is no file at this path.',
    body:
      'The server answered, but it has nothing at this path. Check the spelling and the capitalisation ' +
      'of the name in the address bar — on GitHub Pages, Demo.json and demo.json are two different ' +
      'files, even though on a Mac or a Windows machine they look like the same one. Check too that the ' +
      'file really is in the folder the path names, and that its name ends in .json.',
  }),
  'bad-game-param': Object.freeze({
    title: 'The game named in the web address cannot be used.',
    body:
      'The part of the address after ?game= must be the path to a .json file inside the games/ folder of ' +
      'this same site — for example ?game=games/demo.json. It cannot be a web address on another site, ' +
      'and it cannot step outside games/ with "..". Capitalisation matters: games/Demo.JSON and ' +
      'games/demo.json are different files. If you followed a link from somewhere else, delete ' +
      'everything from the "?" onwards to load the built-in demo.',
  }),
  'ragged-grid': Object.freeze({
    title: 'The columns of this board are not all the same length.',
    body:
      'The game type you chose requires a rectangular board — bingo cannot check a row, a column or a ' +
      'diagonal on a ragged card. Give every column the same number of cells, or switch to a game type ' +
      'that does not require uniform rows.',
  }),
  'ladder-short': Object.freeze({
    title: 'This cell has no point value.',
    body:
      'Add an entry to this column\'s "valueLadder", or a "value" to the cell itself. A cell takes its ' +
      'value from the ladder at the same position — the first cell takes the first ladder entry, and so ' +
      'on — unless it carries its own "value", which always wins. Here the ladder runs out before this ' +
      'cell and the cell has no "value" of its own, and the app will not quietly score it as zero.',
  }),
  'lifecycle-order': Object.freeze({
    title: 'These game states are out of order, or repeated.',
    body:
      'A cell moves forward through its states and never backwards, so "cellLifecycle" must list them in ' +
      'the order hidden, revealed, answered, marked — using only the ones your game needs, each at most ' +
      'once, at least two in total.',
  }),
  syntax: Object.freeze({
    title: 'This file is not valid JSON.',
    body: 'See the marked position above.',
  }),
});

/** The second `fetch-failed` variant: the request never reached a server at all. */
const FETCH_FAILED_NETWORK = Object.freeze({
  title: 'The app could not reach this file at all.',
  body:
    'The request never got an answer from a server. If you opened the app by double-clicking ' +
    'index.html, that is the cause — see the note at the bottom of this screen. Otherwise you are ' +
    'offline, or something on the network is blocking the request.',
});

/** True when a fetch failure carries an HTTP status, i.e. a server did answer. */
function isHttpStatusFound(f) {
  return !!f && typeof f.found === 'string' && f.found.slice(0, 5) === 'HTTP ';
}

/**
 * Map a hint CLASS (plus, for syntax faults, the scanner's sub-class) to display copy.
 *
 * The `failure` argument is what lets `syntax` carry a couple of dozen genuinely different sentences
 * while remaining one hint class: `location.syntaxClass` selects the sentence. `fetch-failed` uses it
 * too, to tell a server's 404 apart from a request that never reached a server. Every other class
 * ignores the argument entirely.
 */
export function hintText(hintClass, f) {
  if (hintClass === 'syntax') {
    const sub = (f && f.location && f.location.syntaxClass) || 'unknown';
    return SYNTAX_HINTS[sub] || SYNTAX_HINTS.unknown;
  }
  if (hintClass === 'fetch-failed' && !isHttpStatusFound(f)) return FETCH_FAILED_NETWORK;
  return (
    // Belt and braces: `failure()` throws on any hint outside HINT_CLASSES, and every id in
    // HINT_CLASSES has an entry above, so this fallback is unreachable through the constructor.
    // It stays because `hintText` is also callable directly, and a missing hint must not be a throw
    // on the one screen whose job is to survive.
    HINT_TEXT[hintClass] || {
      title: 'This file could not be accepted.',
      body: 'See the expected and found lines above.',
    }
  );
}

// =============================================================================================
// SECTION 6 — the error screen
// =============================================================================================
//
// Built entirely with createElement / textContent / appendChild. No innerHTML, no
// insertAdjacentHTML, no template string ever reaching the DOM (CLAUDE.md named invariant). That
// is not paranoia about our own strings: every `found` value on this screen came out of an
// untrusted JSON file, and this screen is the one place in the app that displays untrusted text
// during a failure — precisely when a developer is most tempted to reach for a quick innerHTML.
//
// Layout, top to bottom:
//   1. A headline that says the game did not load and that nothing was rendered. "No partial
//      render, ever" is a promise to the host: they never have to wonder whether the board they
//      can see is complete.
//   2. One section per file, because a fault list spanning three files is unreadable otherwise.
//   3. Per failure: the location, the expected/found pair, the caret snippet, and the hint.
//   4. Footer notes that apply to the whole screen — the GitHub Pages propagation delay, and the
//      file:// vs HTTP origin note when a fetch failed.

const STYLE_ID = 'qbe-error-style';

/** Most cards drawn on one screen. See the comment at the slice in renderErrorScreen. */
const MAX_CARDS = 100;

// Author-written CSS. It contains no interpolated data of any kind, and it is applied by setting
// textContent on a <style> element — never by writing markup. Kept here rather than in a theme
// file because the error screen must render even when the theme failed to load.
const ERROR_CSS = [
  '.qbe-error{--e-bg:#12141a;--e-fg:#f2f4f8;--e-dim:#a7b0c0;--e-line:#2a2f3a;--e-bad:#ff8b7a;',
  '--e-good:#8fd6a0;--e-card:#1a1d25;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;',
  'background:var(--e-bg);color:var(--e-fg);min-height:100vh;padding:2rem 1.25rem;box-sizing:border-box}',
  '.qbe-error *{box-sizing:border-box}',
  '.qbe-error-wrap{max-width:64rem;margin:0 auto}',
  '.qbe-error h1{font-size:1.6rem;margin:0 0 .5rem;color:var(--e-bad)}',
  '.qbe-error .qbe-lede{color:var(--e-dim);margin:0 0 2rem;max-width:52rem}',
  '.qbe-error h2{font-size:1.15rem;margin:2rem 0 .75rem;padding-bottom:.35rem;',
  'border-bottom:1px solid var(--e-line);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
  '.qbe-error .qbe-card{background:var(--e-card);border:1px solid var(--e-line);border-left:4px solid var(--e-bad);',
  'border-radius:6px;padding:1rem 1.15rem;margin:0 0 1rem}',
  '.qbe-error .qbe-where{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.95rem;',
  'font-weight:600;color:var(--e-fg);margin:0 0 .35rem;word-break:break-all}',
  '.qbe-error .qbe-gloss{color:var(--e-dim);font-size:.85rem;margin:0 0 .75rem}',
  '.qbe-error .qbe-more{color:var(--e-bad);font-weight:600;margin:1.5rem 0 0}',
  '.qbe-error dl{display:grid;grid-template-columns:max-content 1fr;gap:.3rem .75rem;margin:0 0 .85rem}',
  '.qbe-error dt{color:var(--e-dim);font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;padding-top:.15rem}',
  '.qbe-error dd{margin:0}',
  '.qbe-error .qbe-expected{color:var(--e-good)}',
  '.qbe-error .qbe-found{color:var(--e-bad)}',
  '.qbe-error pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9rem;',
  'background:#0c0e13;border:1px solid var(--e-line);border-radius:4px;padding:.75rem .9rem;margin:0 0 .85rem;',
  'overflow-x:auto;white-space:pre;tab-size:2}',
  '.qbe-error .qbe-hint{background:#171b22;border:1px dashed var(--e-line);border-radius:4px;padding:.7rem .9rem}',
  '.qbe-error .qbe-hint strong{display:block;margin-bottom:.3rem}',
  '.qbe-error .qbe-hint span{color:var(--e-dim)}',
  '.qbe-error .qbe-notes{margin-top:2.5rem;border-top:1px solid var(--e-line);padding-top:1.25rem;color:var(--e-dim);font-size:.95rem}',
  '.qbe-error .qbe-notes p{margin:0 0 .75rem;max-width:52rem}',
  '.qbe-error code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#0c0e13;',
  'border-radius:3px;padding:.05rem .3rem}',
  '@media (prefers-color-scheme: light){.qbe-error{--e-bg:#fbfbfd;--e-fg:#15181f;--e-dim:#5c6474;',
  '--e-line:#d9dde6;--e-bad:#b3261e;--e-good:#1d6b3a;--e-card:#fff}',
  '.qbe-error pre{background:#f2f4f8}.qbe-error .qbe-hint{background:#f2f4f8}.qbe-error code{background:#eceff5}}',
].join('');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = ERROR_CSS; // constant, author-written; contains no data from any file
  (doc.head || doc.documentElement).appendChild(style);
}

/**
 * Build the caret pad for one snippet line.
 *
 * TABS ARE COPIED VERBATIM, never expanded. Inside a <pre> a tab is not one column wide, so a pad
 * of plain spaces would put the caret somewhere the character is not. The gutter prefix is the same
 * width on the text line and the caret line, so both hit identical tab stops at any `tab-size`.
 * This is the detail that makes the difference between a caret that helps and a caret that misleads
 * — it is why we do not simply repeat " ".repeat(column - 1). Do not "simplify" it.
 *
 * EVERYTHING ELSE IS COUNTED IN GRAPHEME CLUSTERS, not code units: a combining mark (`e` + U+0301,
 * which is how macOS tools spell "café") is its own code unit but occupies no cell of its own, so a
 * code-unit pad drifts one cell right for every mark earlier on the line. Clusters whose first code
 * point is astral get two spaces, because monospace fonts render emoji and the wide CJK planes two
 * cells wide — that is an approximation of terminal width rules, and it is the same count the old
 * surrogate-pair-based code produced, so the emoji case does not regress.
 */
function caretPad(lead) {
  let out = '';
  for (const cluster of clusters(lead)) {
    if (cluster === '\t') out += '\t';
    else out += cluster.codePointAt(0) > 0xffff ? '  ' : ' ';
  }
  return out;
}

/**
 * Render the caret snippet, or `null` when there are no snippet lines to draw.
 *
 * The null case is load-bearing, not defensive noise: `failure()` accepts a hand-written `location`
 * with no `snippet` (module-contracts §7 requires the screen to render from a bare failure array),
 * and this function used to index `snippet[-1]` and throw — AFTER renderErrorScreen had already
 * cleared the mount, leaving the user a blank white page. A blank page is the single outcome this
 * whole file exists to prevent, so the empty snippet is handled rather than trusted away.
 */
function buildSnippet(location) {
  if (!Array.isArray(location.snippet) || location.snippet.length === 0) return null;
  const gutter = String(location.snippet[location.snippet.length - 1].lineNumber).length;
  const pad = (n) => {
    const s = String(n);
    return ' '.repeat(Math.max(0, gutter - s.length)) + s;
  };

  let out = '';
  for (const l of location.snippet) {
    const marker = l.lineNumber === location.line ? '>' : ' ';
    out += marker + ' ' + pad(l.lineNumber) + ' | ' + l.text + '\n';
    if (l.lineNumber === location.line) {
      const lead = caretPad(l.text.slice(0, Math.max(0, location.caretColumn - 1)));
      out += '  ' + ' '.repeat(gutter) + ' | ' + lead + '^\n';
    }
  }
  const pre = el('pre', null, out.replace(/\n$/, ''));
  // Hidden from assistive technology on purpose. Read aloud, the caret line is "greater-than two
  // vertical-bar quote a quote colon one comma vertical-bar caret" — noise. The same information is
  // in the "line N, column M" heading above it, in words.
  pre.setAttribute('aria-hidden', 'true');
  return pre;
}

const ORDINALS = Object.freeze(['0th', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', '13th']);

function ordinal(n) {
  return ORDINALS[n] || n + 'th';
}

/**
 * Gloss the zero-based indexes in a JSON path, or return '' when there are none.
 *
 * WHY: `board.columns[2]` is the THIRD column, and a reader who does not know that opens the second
 * one, finds nothing wrong with it, and concludes the error screen is lying. Spec §7 sanctions the
 * path notation, so the notation stays — this line translates it.
 */
function glossPath(path) {
  if (typeof path !== 'string') return '';
  const parts = [];
  const re = /([A-Za-z0-9_]+)\[(\d+)\]/g;
  let m = re.exec(path);
  while (m) {
    parts.push(m[1] + '[' + m[2] + '] is the ' + ordinal(Number(m[2]) + 1));
    m = re.exec(path);
  }
  if (parts.length === 0) return '';
  return 'Lists count from zero: ' + parts.join(', ') + '.';
}

/** The "where" line, in words rather than in codebase vocabulary. */
function whereText(f) {
  if (f.location) return 'line ' + f.location.line + ', column ' + f.location.column;
  if (f.path === '(file)') return 'this file as a whole';
  return f.path;
}

function buildCard(f, index, total) {
  const card = el('div', 'qbe-card');

  // An <h3>, not a <p>: with four problems in one file there was previously exactly one heading for
  // all four, so heading navigation could not move between them. The "N of M" also tells a sighted
  // reader how much is left.
  const where = el('h3', 'qbe-where', 'Problem ' + index + ' of ' + total + ' — ' + whereText(f));
  card.appendChild(where);

  const gloss = f.location ? '' : glossPath(f.path);
  if (gloss) card.appendChild(el('p', 'qbe-gloss', gloss));

  if (f.location) {
    const pre = buildSnippet(f.location);
    if (pre) card.appendChild(pre);
  }

  const dl = el('dl');
  dl.appendChild(el('dt', null, 'Expected'));
  dl.appendChild(el('dd', 'qbe-expected', f.expected));
  dl.appendChild(el('dt', null, 'Found'));
  dl.appendChild(el('dd', 'qbe-found', f.found));
  card.appendChild(dl);

  const copy = hintText(f.hint, f);
  const hint = el('div', 'qbe-hint');
  hint.appendChild(el('strong', null, copy.title));
  hint.appendChild(el('span', null, copy.body));
  card.appendChild(hint);

  return card;
}

/**
 * Draw the error screen for a list of failures into `mountEl`.
 *
 * Renderable from a bare hand-written failure array: no loader, no validator, no board, no
 * Reveal instance. /tests/index.html depends on that, and so does anyone debugging a fixture.
 */
export function renderErrorScreen(failures, mountEl) {
  const mount = mountEl || document.body;
  const doc = mount.ownerDocument || document;
  ensureStyle(doc);

  const list = Array.isArray(failures) ? failures.filter(Boolean) : [];

  mount.textContent = ''; // clear without markup
  mount.classList.add('qbe-error');

  const wrap = el('div', 'qbe-error-wrap');

  // NO role="alert" / aria-live HERE, deliberately. This wrapper holds the whole screen — headline,
  // lede, every card, every hint, the footer notes. A live region inserted already populated is
  // announced by most screen readers not at all, and by the rest as one uninterruptible assertive
  // utterance thousands of words long. Focusing the headline instead lands the reader at the top of
  // the screen and lets them navigate it like the document it is.
  const h1 = el(
    'h1',
    null,
    list.length === 1 ? 'This game could not be loaded (1 problem)' : 'This game could not be loaded (' + list.length + ' problems)',
  );
  h1.setAttribute('tabindex', '-1');
  wrap.appendChild(h1);
  wrap.appendChild(
    el(
      'p',
      'qbe-lede',
      'Nothing was drawn on purpose: a half-loaded board would look playable and score wrongly. ' +
        'Fix the problems below and reload. Every problem names the file, the exact place inside it, ' +
        'what was expected there, and what was actually found.',
    ),
  );

  if (list.length === 0) {
    wrap.appendChild(el('p', 'qbe-lede', 'No details were supplied, which is itself a bug in the app — please report it.'));
    mount.appendChild(wrap);
    return;
  }

  // A HARD CEILING ON DRAWN CARDS. One card is ~11 DOM nodes, so an unusually fault-dense document
  // could otherwise ask the browser for millions of them and hang the tab on the way to explaining
  // itself. Nobody fixes a hundred problems from one screen anyway: the first few are the ones that
  // get acted on, and the rest are usually consequences of them.
  const shown = list.slice(0, MAX_CARDS);

  // Group by file, preserving first-encounter order, so someone fixing one file reads one block.
  const byFile = new Map();
  for (const f of shown) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  let n = 0;
  for (const [file, group] of byFile) {
    wrap.appendChild(el('h2', null, file));
    for (const f of group) wrap.appendChild(buildCard(f, ++n, shown.length));
  }

  if (list.length > shown.length) {
    wrap.appendChild(
      el(
        'p',
        'qbe-more',
        '…and ' + (list.length - shown.length) + ' more problems, not shown. Fix these ' +
          shown.length + ' first and reload — later problems are often consequences of earlier ones.',
      ),
    );
  }

  // ---- Footer notes ------------------------------------------------------------------------
  const notes = el('div', 'qbe-notes');
  // Gated on the NETWORK-error variant only. An HTTP status means a server answered, which excludes
  // file:// outright — see the two `fetch-failed` hint variants above.
  const anyNetworkFail = list.some((f) => f.hint === 'fetch-failed' && !isHttpStatusFound(f));

  if (anyNetworkFail) {
    // Plan Q10 / delta D7. This is the single most common "the app is broken" report from a
    // first-time forker, and it is not a bug: browsers refuse module imports and local fetches
    // over file://. It belongs on the screen the user is actually looking at, not only in a
    // README they have not opened.
    const p = el('p');
    p.appendChild(document.createTextNode('Opened this file by double-clicking it? The app needs a web address, not a file path. Browsers block a page served from '));
    p.appendChild(el('code', null, 'file://'));
    p.appendChild(document.createTextNode(' from loading its own modules and data files. Run '));
    p.appendChild(el('code', null, 'python3 -m http.server 8000'));
    p.appendChild(document.createTextNode(' in the project folder and open '));
    p.appendChild(el('code', null, 'http://localhost:8000/'));
    p.appendChild(document.createTextNode(' instead. On GitHub Pages this never happens.'));
    notes.appendChild(p);
  }

  // Spec §7 names this explicitly: the propagation delay is a documented pain point, and without
  // this note a user who has ALREADY fixed the file concludes the fix did not work and starts
  // undoing correct edits.
  notes.appendChild(
    el(
      'p',
      null,
      'Just edited the file on GitHub? Published changes take a few minutes to reach the web. If you ' +
        'have fixed the problem above and still see it, wait a minute and reload — the app already asks ' +
        'for a fresh copy of every file on every load, so a hard refresh is not needed.',
    ),
  );

  // NOTHING HERE POINTS AT A README. There was a note sending a stuck reader to a "Fixing JSON
  // errors" section of a README that does not exist in this repo, printed unconditionally on every
  // failure. A closing instruction that dead-ends is worse than no closing instruction; when that
  // section is written, this is where the pointer goes back.

  wrap.appendChild(notes);
  mount.appendChild(wrap);

  // Move the reader to the headline. Wrapped because a detached mount (the test runner renders into
  // an unattached div) cannot take focus, and a failure to focus must never break the screen.
  try {
    h1.focus();
  } catch (_e) {
    /* not focusable in this context; the screen is still complete */
  }
}
