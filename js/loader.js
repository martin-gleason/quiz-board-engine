// SPDX-License-Identifier: AGPL-3.0-or-later
//
// loader.js — Quiz Board Engine
//
// ROLE (CLAUDE.md module boundaries): `loader` FETCHES. It resolves the `?game=` parameter,
// pulls JSON over HTTP, enforces the byte cap, and calls `JSON.parse`. It does not judge
// documents against schemas (that is `validator`), it does not word errors (that is `errors`),
// and it never touches the DOM.
//
// Imports: `schemas` (limits, kinds, patterns) and `errors` (failure construction). Never
// `validator`, never `renderer`, never `state` — module-contracts §2.

import { LIMITS, KINDS, PATTERNS } from './schemas.js';
import { failure, describeValue, syntaxFailure } from './errors.js';

export const GAMES_DIR = 'games/';
export const GAMETYPES_DIR = 'gametypes/';
export const THEMES_MANIFEST = 'themes/themes.json';
export const DEFAULT_GAME = 'games/demo.json';

/**
 * Byte cap for everything that is not a content file. Game-type configs and the themes manifest
 * are a few hundred bytes in practice; 256 KB is three orders of magnitude of headroom and still
 * refuses a hostile file before it reaches the parser.
 */
export const DEFAULT_MAX_BYTES = 262144;

// =============================================================================================
// SECTION 1 — the ?game= guard (spec §6.3, plan §6, CLAUDE.md named invariant)
// =============================================================================================
//
// THREAT MODEL, stated plainly because it drives every line below. The app is hosted on a domain
// the user trusts, and the game to load is named in the URL. So an attacker's link looks like
// yours: `https://yourname.github.io/quiz/?game=https://evil.example/x.json`. If the loader
// honoured that, a visitor would see YOUR domain in the address bar while the board, the prompts,
// and the answers came from someone else. The `?game=` guard is the entire defence.
//
// TWO RULES THAT MATTER MORE THAN THE INDIVIDUAL CASES:
//
//   1. ALLOWLIST, NEVER BLOCKLIST. We do not search for bad substrings; we require the final
//      value to match one narrow regex. Blocklists lose to encodings, to Unicode look-alikes, and
//      to the case nobody thought of. An allowlist fails closed on all of them at once.
//   2. DECODE FIRST, THEN VALIDATE. `%2e%2e%2fgames%2fx.json` reaches us as text that contains no
//      dot and no slash; validated as-is it looks harmless, and `fetch` would decode it afterwards
//      and escape the directory. So we decode ONCE and validate the result. And because
//      `%252e%252e` decodes once into `%2e%2e` — still an attack, one round behind — any `%` left
//      after that single decode is an outright rejection. No legitimate game filename needs one.
//
// The returned path is always the literal allowlisted string. We never hand back a field parsed
// out of a `URL` object: that is how a normaliser's idea of a path and `fetch`'s idea of a path
// drift apart, and the gap between them is where these bugs live.

// NUL and every other control character, plus the C1 range. Written as escapes so this rule
// survives being read, copied, or diffed in an editor that would otherwise render the literal
// bytes invisibly. A NUL is the classic truncation trick against anything C-backed downstream
// ("x.json\u0000.png"); no legitimate game filename contains any of these.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

// SUBDIRECTORIES UNDER games/ ARE ALLOWED, deliberately: `?game=games/2026/spring/history.json`
// resolves. It is safe by construction — '.' is not in the segment character class, so no segment
// can be '..' or carry a second extension — and a teacher with forty games wants folders. Stated
// here and in module-contracts §4.1 because a regex is not documentation.
const GAME_PATH_ALLOWLIST = /^games\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/;

const PARAM_FILE = '(URL parameter)';
const PARAM_KIND = '(url)';
const PARAM_EXPECTED = 'a relative path under games/ ending in .json, such as "games/demo.json"';

function rejectParam(found) {
  return {
    ok: false,
    failures: [
      failure({
        file: PARAM_FILE,
        kind: PARAM_KIND,
        stage: 'fetch',
        path: '?game',
        expected: PARAM_EXPECTED,
        found,
        hint: 'bad-game-param',
      }),
    ],
  };
}

/**
 * Accepts either a whole search string (`'?game=games/x.json'`) or a bare parameter value
 * (`'games/x.json'`). Both call styles exist in the wild — `app.js` passes
 * `window.location.search`, the test runner passes the raw value it is probing — and guessing
 * wrong would silently validate the string `'?game=...'` as a filename.
 */
function extractParam(raw) {
  if (raw === null || raw === undefined) return { present: false, value: null };
  if (typeof raw !== 'string') return { present: true, value: raw };
  const looksLikeSearch = raw.charAt(0) === '?' || raw.charAt(0) === '&' || /(?:^|[?&])game=/.test(raw);
  if (!looksLikeSearch) return { present: true, value: raw };
  // URLSearchParams performs its own percent-decoding of the value, which is exactly the single
  // decode step our rules assume — see decodeOnce() below for why we then refuse a second '%'.
  const params = new URLSearchParams(raw.charAt(0) === '?' ? raw.slice(1) : raw);
  if (!params.has('game')) return { present: false, value: null };
  return { present: true, value: params.get('game') };
}

/** Decode exactly once. A malformed escape (`%zz`, a lone `%`) is a rejection, not a repair. */
function decodeOnce(value) {
  try {
    // '+' is a form-encoding convention, not a path character; URLSearchParams already turned it
    // into a space, and a space is not in the allowlist, so nothing further is needed here.
    return { ok: true, value: decodeURIComponent(value) };
  } catch (_e) {
    return { ok: false, value: null };
  }
}

/**
 * Turn `?game=` into a path under `games/`, or refuse.
 *
 * @returns {{ok:true,value:string} | {ok:false,failures:ValidationFailure[]}}
 *
 * Every rejection below is a row in the plan §6 security matrix. Cases are ordered cheapest
 * first, and each one is annotated with the attack or the honest mistake it stops.
 */
export function resolveGameParam(raw) {
  const { present, value } = extractParam(raw);

  // An ABSENT parameter is not an error — the app simply loads the demo (module-contracts §4.1).
  // An EMPTY parameter is an error: `?game=` means the caller tried to name a file and failed,
  // and silently substituting the demo would hide their typo behind a working board.
  if (!present) return { ok: true, value: DEFAULT_GAME };
  if (typeof value !== 'string') return rejectParam(describeValue(value));
  if (value === '') return rejectParam('an empty value');

  // Control characters and NUL, checked on the RAW text before any decoding. A NUL byte is the
  // classic truncation trick against anything downstream that is C-backed ("x.json\0.png"), and
  // no legitimate path contains one. Whitespace goes too: a leading space would defeat a naive
  // prefix check.
  if (CONTROL_CHARS.test(value)) return rejectParam('a value containing a control character');

  const decoded = decodeOnce(value);
  if (!decoded.ok) return rejectParam('a value with a broken %-escape: ' + describeValue(value));
  const p = decoded.value;

  // Post-decode re-checks. Everything from here on inspects the DECODED value, which is the
  // string `fetch` would actually act on.
  if (CONTROL_CHARS.test(p)) return rejectParam('a value that decodes to a control character');

  // Double-encoding. `%252e%252e%252f` decodes once to `%2e%2e%2f`, which still traverses when
  // fetch decodes it again. Rather than decode in a loop (an unbounded, guessable game), we
  // declare a surviving '%' illegal outright.
  if (p.indexOf('%') !== -1) return rejectParam('a doubly-encoded value: ' + describeValue(value));

  // Backslashes. Windows separators, which some servers and normalisers treat as '/'.
  if (p.indexOf('\\') !== -1) return rejectParam('a value containing a backslash: ' + describeValue(p));

  // A scheme means an absolute URL: https://evil.example/x.json, and also javascript:, data:,
  // blob:, file:. The colon test catches all of them at once, and ':' is not a legal filename
  // character here anyway.
  if (p.indexOf(':') !== -1) return rejectParam('an absolute URL or a value containing a colon: ' + describeValue(p));

  // Protocol-relative //evil.example/x.json, and any absolute path /etc/passwd.
  if (p.charAt(0) === '/') return rejectParam('a value starting with "/": ' + describeValue(p));

  // Query and fragment smuggling: 'games/demo.json?x=1' or 'games/demo.json#/../../y'.
  if (p.indexOf('?') !== -1 || p.indexOf('#') !== -1) return rejectParam('a value containing "?" or "#": ' + describeValue(p));

  // Directory traversal. Tested per SEGMENT, not as a substring, so a legitimate name containing
  // dots would not be caught by accident and, more importantly, so 'games/..%2f' style hybrids
  // (already dead above) and 'games/../../x.json' are both caught by the same rule.
  const segments = p.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') return rejectParam('a value containing a "' + seg + '" path segment: ' + describeValue(p));
  }

  // Normalise the two harmless spellings: a leading './' and an omitted 'games/' prefix. A bare
  // filename is accepted as a convenience ('?game=history.json') because the allowlist below
  // still constrains it completely — it cannot name anything outside games/.
  let candidate = p.replace(/^\.\//, '');
  if (candidate.indexOf('/') === -1) candidate = GAMES_DIR + candidate;

  // THE ALLOWLIST. Everything above is early rejection with a useful message; this line is the
  // actual security boundary. Note the segment character class excludes '.', so the extension
  // test is exact: 'x.json.txt' has a '.' inside a segment and cannot match, and neither can
  // 'x.txt', 'x.json/', or 'x.JSON'.
  if (!GAME_PATH_ALLOWLIST.test(candidate)) {
    return rejectParam('a value that is not a .json file under games/: ' + describeValue(p));
  }

  return { ok: true, value: candidate };
}

/**
 * Build the path for a game-type config.
 *
 * THROWS on a bad id rather than returning a failure, deliberately: by the time anyone calls
 * this, the id has already been pattern-checked by the structural stage, so a bad id here is a
 * bug in OUR sequencing, not bad data — and module-contracts §0.1 reserves `throw` for exactly
 * that. Silently returning a failure would let the bug hide as a user-facing error message.
 */
export function gametypePath(id) {
  if (typeof id !== 'string' || !PATTERNS.gameTypeId.test(id)) {
    throw new TypeError('gametypePath(): id must match PATTERNS.gameTypeId, got ' + JSON.stringify(id));
  }
  return GAMETYPES_DIR + id + '.json';
}

// =============================================================================================
// SECTION 2 — fetching
// =============================================================================================

/** Byte length, not string length: a 1 MB cap measured in UTF-16 units would be wrong by up to 3x. */
function byteLength(text) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
  // Defensive only. Every browser in the support matrix has TextEncoder; this keeps a headless
  // test harness from silently skipping the cap.
  return unescape(encodeURIComponent(text)).length;
}

function fetchFail({ path, kind, found, hint }) {
  return {
    ok: false,
    failures: [
      failure({
        file: path,
        kind,
        stage: 'fetch',
        path: '(file)', // pseudo-path: the whole document failed, so no field can be named
        expected: 'a readable JSON file at this path',
        found,
        hint: hint || 'fetch-failed',
      }),
    ],
  };
}

/**
 * Fetch one JSON document.
 *
 * @returns {Promise<{ok:true,value:RawDocument} | {ok:false,failures:ValidationFailure[]}>}
 *
 * RawDocument = { path, kind, text, bytes, data } — `text` is retained because errors.js needs
 * the ORIGINAL characters to compute a line, a column and a caret. Re-serialising `data` would
 * point at a document the user never wrote.
 */
export async function fetchJsonFile({ path, kind, maxBytes }) {
  const cap = typeof maxBytes === 'number' ? maxBytes : kind === KINDS.CONTENT ? LIMITS.contentFileBytes : DEFAULT_MAX_BYTES;

  let response;
  try {
    // Cache-busting (plan Q14). GitHub Pages' edge caches aggressively, and spec §7 names
    // edit-propagation confusion as a documented pain point: a user fixes a file, reloads, sees
    // the old error, and starts undoing correct work. `?v=<timestamp>` plus `no-store` costs one
    // uncached request per load — nothing, for four small files — and buys a fix that appears
    // when the user expects it. CSS theme files are deliberately NOT cache-busted; that is the
    // renderer's business and it does not do it.
    response = await fetch(path + '?v=' + Date.now(), { cache: 'no-store' });
  } catch (_e) {
    // Offline, DNS failure, blocked request, or file:// (plan Q10). Per spec §5 this is a
    // VALIDATION failure, not a crash: the user gets the error screen with the file:// note, not
    // a blank page and a console trace they will never open.
    return fetchFail({ path, kind, found: 'a network error (the request could not be completed)' });
  }

  if (!response.ok) {
    return fetchFail({ path, kind, found: 'HTTP ' + response.status + (response.statusText ? ' ' + response.statusText : '') });
  }

  // Cheap pre-check: refuse an oversized body from the header before downloading it at all. The
  // authoritative check is on the actual text below, since Content-Length may be absent (chunked
  // responses) or wrong.
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    return fetchFail({
      path,
      kind,
      hint: 'file-too-large',
      found: 'a file of about ' + Math.round(declared / 1024) + ' KB (the limit is ' + Math.round(cap / 1024) + ' KB)',
    });
  }

  let text;
  try {
    text = await response.text();
  } catch (_e) {
    return fetchFail({ path, kind, found: 'a response that could not be read as text' });
  }

  // THE CAP IS ENFORCED BEFORE JSON.parse, not after (spec §5, module-contracts §4.2). Parsing
  // first would hand a hostile 40 MB file to the parser and freeze the tab — the cap would then
  // be a report on a denial of service that had already happened.
  const bytes = byteLength(text);
  if (bytes > cap) {
    return fetchFail({
      path,
      kind,
      hint: 'file-too-large',
      found: 'a file of ' + Math.round(bytes / 1024) + ' KB (the limit is ' + Math.round(cap / 1024) + ' KB)',
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (_e) {
    // NOTE WHAT IS NOT HAPPENING HERE: the caught error is discarded unread. Its `.message` is
    // engine-specific (plan Q6 / CLAUDE.md constraint 5), so errors.js re-scans the raw text
    // itself and derives an identical line, column, snippet and caret in all three browsers.
    return syntaxFailure({ file: path, kind, text });
  }

  return { ok: true, value: Object.freeze({ path, kind, text, bytes, data }) };
}

/**
 * Fetch the three documents a board needs: the content file, the themes manifest, and the
 * game-type config the content file names.
 *
 * @returns {Promise<{ok:true,value:RawBundle} | {ok:false,failures:ValidationFailure[]}>}
 *
 * Sequencing, and why: the content file must land first, because it is the only thing that says
 * which game-type file to ask for. After that the manifest and the game-type file are independent,
 * so they go out together under `Promise.all` — two round trips instead of three, and on a
 * GitHub Pages cold edge that is a visible difference.
 */
export async function fetchContentBundle({ gamePath }) {
  const contentResult = await fetchJsonFile({ path: gamePath, kind: KINDS.CONTENT, maxBytes: LIMITS.contentFileBytes });
  if (!contentResult.ok) return contentResult;

  const content = contentResult.value;

  // THE LOADER NEVER GUESSES A GAME TYPE. If `gameType` is absent, not a string, or not a legal
  // id, we fetch the manifest alone and return `gametype: null`; the structural stage then reports
  // the real problem against the real path (`gameType`). Substituting 'jeopardy' here would turn a
  // clear "you forgot gameType" into a baffling downstream contract failure.
  const rawId = content.data && typeof content.data === 'object' ? content.data.gameType : undefined;
  const idIsUsable = typeof rawId === 'string' && PATTERNS.gameTypeId.test(rawId);

  const jobs = [fetchJsonFile({ path: THEMES_MANIFEST, kind: KINDS.THEMES })];
  if (idIsUsable) jobs.push(fetchJsonFile({ path: gametypePath(rawId), kind: KINDS.GAMETYPE }));

  const settled = await Promise.all(jobs);
  const themesResult = settled[0];
  const gametypeResult = idIsUsable ? settled[1] : null;

  // Report every fetch/syntax problem at once. A person whose manifest is missing AND whose
  // game-type file is a 404 should see both, not discover the second after fixing the first.
  const failures = [];
  if (gametypeResult && !gametypeResult.ok) failures.push(...gametypeResult.failures);
  if (!themesResult.ok) failures.push(...themesResult.failures);
  if (failures.length > 0) return { ok: false, failures };

  return {
    ok: true,
    value: Object.freeze({
      content,
      gametype: gametypeResult ? gametypeResult.value : null,
      themes: themesResult.value,
    }),
  };
}
