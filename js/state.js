// SPDX-License-Identifier: AGPL-3.0-or-later
//
// state.js — Quiz Board Engine · F6 (session state, teams, scoring) + F7 (bonus randomization)
//            + the storage half of F10 (export/import)
//
// ROLE (CLAUDE.md module boundaries): `state` REMEMBERS. It owns the session object, the
// localStorage shelf it lives on, the content hash that names it, and the bonus draw. It does not
// judge (that is `validator`), does not draw (that is `renderer`), does not fetch (that is
// `loader`), and does not explain (that is `errors`).
//
// IMPORTS: `schemas` ONLY (module-contracts §2). In particular NOT `validator` — imported state is
// untrusted input and is validated by `validator.validateState()`, whose result `app.js` (the only
// legal caller) hands to `adopt()`. Neither module may shortcut the other; if `state` could
// validate, "untrusted input is validated" would become a promise kept in two places, and the one
// that was cheap to skip would be skipped.
//
// NO DOM, NO FETCH, NO TIMERS. `localStorage` and `crypto` are platform globals, not documents;
// nothing here touches an element, and nothing here schedules work.
//
// ---------------------------------------------------------------------------------------------
// THE v2.0 SEAM (spec §4.4)
// ---------------------------------------------------------------------------------------------
// The session is ONE plain, JSON-serializable object: no functions, no Map, no Date instances, no
// class instances, and no reference into `CleanedBundle`. Cloud sync in v2.0 replaces the two
// storage calls in `writeEntry` / `readEntry` and nothing else changes. That promise is worth
// exactly as much as it is enforced, so `update()` walks the mutated draft and REFUSES anything
// that is not a JSON primitive, a plain array, or a plain object (see `firstNonSerializable`). A
// `new Date()` assigned into state would otherwise survive here, serialize to a string on the way
// out, and come back as a string on the way in — a bug that only shows up on the second run.
//
// ---------------------------------------------------------------------------------------------
// WHY THE BUNDLE IS AN ARGUMENT, NEVER A FIELD
// ---------------------------------------------------------------------------------------------
// Scoring rules, the cell census and the bonus economy all live in `CleanedBundle`. This module
// takes the bundle as a PARAMETER of the functions that need it rather than holding one. Holding it
// would put a large frozen non-session object inside the module that owns serialization, and the
// first person to write `draft.bundle = bundle` in a mutator would ship it to storage.

import { LIMITS, PATTERNS, KINDS, getSchema } from './schemas.js';

/** localStorage key prefix. One entry per session, keyed by content hash: `qbe.session.<hash>`. */
export const STORAGE_PREFIX = 'qbe.session.';

/**
 * Written into every state object as `appVersion` (delta D6). Diagnostic ONLY — the validator
 * type-checks it and ignores it. It exists so "my export is broken" arrives with the build number
 * that wrote it attached.
 */
export const APP_VERSION = '1.0.0';

/** The state `schemaVersion` this build writes. Reading is gated on `getSchema` instead. */
export const STATE_SCHEMA_VERSION = 1;

// =============================================================================================
// SECTION 1 — failures, hand-built
// =============================================================================================
//
// `errors.failure()` is the canonical constructor, and this module may not import `errors`
// (module-contracts §2: `state -> schemas` only). So the few failures state can raise are built
// here to the same frozen shape as module-contracts §5, including the composed one-line `message`,
// so `errors.renderErrorScreen` and `errors.formatFailure` receive something indistinguishable
// from their own output. The set is deliberately tiny: storage refused, storage full, no such
// session, a stored session that will not parse, and a state object that is not for this game.

function truncate(text) {
  const s = String(text);
  return s.length <= 120 ? s : s.slice(0, 119) + '…';
}

function stateFailure({ file, stage, path, expected, found, hint }) {
  const foundText = truncate(found);
  return Object.freeze({
    file,
    kind: KINDS.STATE,
    stage,
    path,
    location: null,
    expected,
    found: foundText,
    hint,
    message: path + ': expected ' + expected + ', found ' + foundText,
  });
}

function fail(failure) {
  return { ok: false, failures: [failure] };
}

/** The §0.2 identity string for a stored session. Never a URL, never a storage key. */
export function sessionFileId(gameHash) {
  return 'localStorage:' + gameHash;
}

// =============================================================================================
// SECTION 2 — the storage shelf
// =============================================================================================
//
// Every access goes through `storage()`, which returns null instead of throwing. Reading
// `window.localStorage` THROWS (not returns undefined) in a Safari private window and under some
// enterprise cookie policies, and a host who cannot save a session should still be able to play a
// game — losing persistence is a degradation, losing the board is a failure.

function storage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    return s;
  } catch (_err) {
    return null;
  }
}

const STORAGE_UNAVAILABLE = 'this browser to allow saving to localStorage';

function storageUnavailableFailure(gameHash) {
  // HINT CLASS NOTE: `HINT_CLASSES` (schemas.js, A2's file) has no `storage-unavailable` id, so
  // this reuses `fetch-failed` — the class for "the app could not read or write something it
  // needed". The expected/found phrases carry the real meaning, and `errors.hintText` degrades to
  // its network copy, which mentions needing a real HTTP origin — true here too, since `file://`
  // pages get an opaque origin whose storage is unusable.
  return stateFailure({
    file: gameHash ? sessionFileId(gameHash) : 'localStorage',
    stage: 'fetch',
    path: '(file)',
    expected: STORAGE_UNAVAILABLE,
    found: 'a browser that refused access to it (private browsing, or storage disabled for this site)',
    hint: 'fetch-failed',
  });
}

function quotaFailure(gameHash) {
  return stateFailure({
    file: sessionFileId(gameHash),
    stage: 'fetch',
    path: '(file)',
    expected: 'enough browser storage to save this session',
    found: 'a full storage area, still full after the oldest saved session was removed',
    hint: 'fetch-failed',
  });
}

/**
 * Is this the browser's storage-is-full error?
 *
 * Feature detection on the ERROR OBJECT, never on the user agent (CLAUDE.md constraint 5). Modern
 * Chrome, Firefox and Safari all throw a DOMException named `QuotaExceededError` with legacy code
 * 22; Firefox's older name and code are checked too because they cost one comparison and the
 * consequence of missing the case is a lost game in progress.
 */
function isQuotaError(err) {
  if (!err) return false;
  const name = err.name;
  const code = err.code;
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

function readEntry(gameHash) {
  const s = storage();
  if (!s) return null;
  try {
    return s.getItem(STORAGE_PREFIX + gameHash);
  } catch (_err) {
    return null;
  }
}

/**
 * Write one session, applying the plan Q13 quota policy:
 *
 *   attempt → QuotaExceededError → prune the OLDEST OTHER session → attempt ONCE more → give up
 *   with a real ValidationFailure so `app.js` can route to the error screen.
 *
 * "Give up loudly" is the whole point. A silent catch here means the host finishes a round, closes
 * the laptop, and discovers at the next session that the last forty minutes were never saved.
 */
function writeEntry(gameHash, json) {
  const s = storage();
  if (!s) return fail(storageUnavailableFailure(gameHash));

  const key = STORAGE_PREFIX + gameHash;
  try {
    s.setItem(key, json);
    return { ok: true, value: true };
  } catch (err) {
    if (!isQuotaError(err)) return fail(storageUnavailableFailure(gameHash));
    // ONE retry, after removing the oldest session that is not the one being written.
    const removed = removeOldest(1, gameHash);
    if (removed === 0) return fail(quotaFailure(gameHash));
    try {
      s.setItem(key, json);
      return { ok: true, value: true };
    } catch (_again) {
      return fail(quotaFailure(gameHash));
    }
  }
}

function removeEntry(gameHash) {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(STORAGE_PREFIX + gameHash);
  } catch (_err) {
    /* nothing to do: the entry is unreachable either way */
  }
}

/** Every session key currently on the shelf, hash only. */
function sessionHashes() {
  const s = storage();
  if (!s) return [];
  const out = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (typeof key === 'string' && key.indexOf(STORAGE_PREFIX) === 0) {
        out.push(key.slice(STORAGE_PREFIX.length));
      }
    }
  } catch (_err) {
    return out;
  }
  return out;
}

// =============================================================================================
// SECTION 3 — hashing the content file
// =============================================================================================

/**
 * SHA-256 of the CONTENT FILE TEXT, lowercase hex.
 *
 * @param {string} text  `rawBundle.content.text` — the exact bytes the loader received.
 * @returns {Promise<{ok:true,value:string} | {ok:false,failures:ValidationFailure[]}>}
 *
 * WHY THE TEXT AND NOT THE PARSED OBJECT: a hash of `JSON.stringify(data)` would depend on key
 * order and on our own cleaning rules, so re-cleaning a file differently in a later build would
 * silently orphan every saved session. The bytes are the identity. `app.js` returns `raw` from
 * `loadAndValidate` precisely so this needs no second fetch (and a second fetch could return
 * different bytes anyway — the file may have been edited between the two).
 *
 * WHY A Result AND NOT A BARE STRING (deviation from module-contracts §9, flagged): `crypto.subtle`
 * exists only in a SECURE CONTEXT. localhost and https qualify, but a teacher who serves the app
 * from `http://192.168.1.20:8000` to a projector — a real and reasonable thing to do — gets a
 * browser where `crypto.subtle` is `undefined`. That is a user-facing condition with an actionable
 * explanation, so it belongs on the error screen as a failure value, not as a thrown exception in
 * the console (module-contracts §0.1: expected failures are values).
 */
export async function hashContent(text) {
  if (typeof text !== 'string') throw new TypeError('hashContent(): `text` must be a string');

  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    return fail(
      stateFailure({
        file: 'localStorage',
        stage: 'fetch',
        path: '(file)',
        expected: 'a secure page origin, so the browser can hash the game file (https://… or http://localhost)',
        found: 'a page served from an origin the browser treats as insecure, where crypto.subtle is unavailable',
        hint: 'fetch-failed',
      }),
    );
  }

  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return { ok: true, value: hex };
}

// =============================================================================================
// SECTION 4 — randomness (F7, spec §8)
// =============================================================================================
//
// UNIFORM MEANS UNIFORM. The obvious `crypto.getRandomValues(u32)[0] % n` is NOT uniform: 2^32 is
// not a multiple of most n, so the first `2^32 mod n` values of the range are each one draw more
// likely than the rest. For a 24-cell candidate list the bias is around one part in 180 million —
// invisible — but the same three lines get copied to places where n is large, and "we only need it
// to look random" is how a fairness bug ships. Rejection sampling costs one extra draw about once
// in every few billion calls and removes the argument entirely.
//
// `Math.random` is not used anywhere in this module: it is not required to be uniform across
// engines and is explicitly excluded by the F7 brief.

/** A uniformly distributed integer in [0, n). `n` must be a positive integer. */
export function cryptoRandomInt(n) {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError('cryptoRandomInt(): n must be a positive integer');
  if (n === 1) return 0;

  const rng = globalThis.crypto;
  if (!rng || typeof rng.getRandomValues !== 'function') {
    // No silent downgrade to Math.random. A bonus draw that is not from the CSPRNG is not the
    // feature spec §8 describes, and pretending otherwise would be undetectable at the call site.
    throw new Error('cryptoRandomInt(): crypto.getRandomValues is unavailable');
  }

  const range = 4294967296; // 2^32
  const limit = range - (range % n); // largest multiple of n that fits; draws >= limit are rejected
  const buf = new Uint32Array(1);
  for (;;) {
    rng.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/**
 * Pick `count` distinct cell keys uniformly at random from the eligible cells (F7, spec §8).
 *
 * @param {{bundle:CleanedBundle, count?:number, randomInt?:(n:number)=>number}} args
 * @returns {string[]} chosen keys, in board (document) order
 *
 * ELIGIBILITY (spec §8, spec §4.1): the candidate list is `bundle.resolved.randomizableKeys`, which
 * the validator built as `flags.randomizable && !flags.lockValue`. `lockValue` cells are excluded
 * unconditionally rather than only when `bonus.multiplier !== 1`, because the exclusion is the
 * conservative reading of "never `lockValue: true` for value-altering bonuses" and because every
 * bonus this build ships is value-altering. A future non-value bonus would widen the candidate set
 * in the VALIDATOR's census, not by second-guessing it here.
 *
 * `randomInt` is the test seam — an integer generator, deliberately NOT the `random = Math.random`
 * float of module-contracts §9. A float seam invites `Math.floor(random() * n)` at every call site,
 * which is the biased pattern this section exists to avoid; handing the seam an integer contract
 * means a seeded test generator and the shipping CSPRNG obey the same rule.
 *
 * The draw is a partial Fisher-Yates over a COPY of the candidate list: each of the C(n,k) subsets
 * is equally likely, and no key can be drawn twice.
 */
export function pickBonusCells({ bundle, count, randomInt = cryptoRandomInt }) {
  const candidates = (bundle && bundle.resolved && bundle.resolved.randomizableKeys) || [];
  const requested = count === undefined ? (bundle && bundle.gametype && bundle.gametype.bonus ? bundle.gametype.bonus.count : 0) : count;

  const want = Math.max(0, Math.min(Number.isInteger(requested) ? requested : 0, candidates.length));
  if (want === 0) return [];

  const pool = candidates.slice();
  const chosen = [];
  for (let i = 0; i < want; i++) {
    const j = i + randomInt(pool.length - i);
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
    chosen.push(pool[i]);
  }
  // Board order, not draw order: the winners are a SET, and a stable order makes two exports of the
  // same session byte-identical and makes a test's expectation readable.
  const order = new Map();
  for (let i = 0; i < candidates.length; i++) order.set(candidates[i], i);
  chosen.sort((a, b) => order.get(a) - order.get(b));
  return chosen;
}

// =============================================================================================
// SECTION 5 — building a session
// =============================================================================================

/** UTC ISO-8601, the exact shape `PATTERNS.iso8601Utc` accepts. */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Normalize host-typed team names into schema-legal team objects.
 *
 * TEAMS LIVE ONLY IN STATE (spec §4.4). Content files are teams-agnostic — one file serves any
 * group — so there is no team data to read from the bundle and nothing to reconcile: whatever the
 * host typed at session start is the whole truth.
 */
function normalizeTeams(names) {
  const list = Array.isArray(names) ? names : [];
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().slice(0, LIMITS.maxLabelChars);
    if (name === '') continue; // an empty box in the setup form is not a team
    out.push({ name, score: 0 });
    if (out.length === LIMITS.maxTeams) break;
  }
  return out;
}

/**
 * Build a fresh session object. PURE: it touches no storage and installs nothing. Hand it to
 * `adopt()` to make it current and persist it.
 *
 * @param {{bundle:CleanedBundle, gameHash:string, teams?:string[]|object[], bonusCells?:string[]}} args
 * @returns {object} a plain state object matching `schemas.state[1]`
 *
 * `cellStates` starts EMPTY even on a board with `preMarked` cells: `renderer.cellStateFor` already
 * derives the terminal state for a pre-marked cell from the bundle. Writing those keys into state
 * would duplicate a fact the content file owns, and a session saved against an edited board would
 * then carry marks for cells whose flags had since changed.
 *
 * A NEW SESSION RESHUFFLES (spec §8): the bonus draw happens here, once. Resuming reads the stored
 * `bonusCells` and never redraws — that is the difference the spec names, and it is the reason the
 * winners are state and not a runtime variable.
 */
export function newSession({ bundle, gameHash, teams, bonusCells }) {
  if (!bundle || !bundle.content) throw new TypeError('newSession(): a CleanedBundle is required');
  if (typeof gameHash !== 'string' || !PATTERNS.sha256Hex.test(gameHash)) {
    throw new TypeError('newSession(): `gameHash` must be a 64-character lowercase hex SHA-256');
  }

  const created = nowIso();
  const teamList = Array.isArray(teams) && teams.length > 0 && typeof teams[0] === 'object' && teams[0] !== null
    ? normalizeTeams(teams.map((t) => (t && typeof t.name === 'string' ? t.name : '')))
    : normalizeTeams(teams);

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    gameHash,
    gameTitle: String(bundle.content.title).slice(0, LIMITS.maxLabelChars),
    createdAt: created,
    updatedAt: created,
    teams: teamList,
    cellStates: {},
    bonusCells: Array.isArray(bonusCells) ? bonusCells.slice() : pickBonusCells({ bundle }),
  };
}

// =============================================================================================
// SECTION 6 — serialization guard (the seam, enforced)
// =============================================================================================

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Return the path of the first value in `v` that would not survive a JSON round trip, or null.
 * Dates, Maps, Sets, class instances, functions, `undefined` and non-finite numbers all fail here
 * rather than in v2.0's sync layer, where the symptom would be a session that loads wrong.
 */
function firstNonSerializable(v, path) {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return null;
  if (t === 'number') return Number.isFinite(v) ? null : path + ' (a number that JSON cannot represent)';
  if (t === 'undefined') return path + ' (undefined)';
  if (t === 'function' || t === 'symbol' || t === 'bigint') return path + ' (a ' + t + ')';
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const found = firstNonSerializable(v[i], path + '[' + i + ']');
      if (found) return found;
    }
    return null;
  }
  if (!isPlainObject(v)) return path + ' (a ' + (v.constructor && v.constructor.name ? v.constructor.name : 'non-plain object') + ')';
  for (const key of Object.keys(v)) {
    const found = firstNonSerializable(v[key], path + '.' + key);
    if (found) return found;
  }
  return null;
}

/** Deep clone through JSON. The draft handed to a mutator shares nothing with the live state. */
function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

/** Freeze the whole tree, so a subscriber cannot edit the session it was handed. */
function deepFreeze(v) {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  Object.freeze(v);
  for (const key of Object.keys(v)) deepFreeze(v[key]);
  return v;
}

/**
 * The cheap invariants `adopt()` and `update()` re-check. NOT validation — `validator.validateState`
 * did that, and duplicating it here is how two implementations of one rule start to disagree.
 * These three checks exist because they are the ones whose failure would corrupt the SHELF rather
 * than the board: an unknown schemaVersion, a hash that is not a hash (which becomes a storage key),
 * or a session belonging to a different game.
 */
function cheapCheck(state, { expectGameHash, file }) {
  const id = file || (state && typeof state.gameHash === 'string' ? sessionFileId(state.gameHash) : 'localStorage');

  if (!isPlainObject(state)) {
    return stateFailure({
      file: id, stage: 'structural', path: '(file)',
      expected: 'the session to be a JSON object',
      found: 'something that is not a plain object',
      hint: 'wrong-type',
    });
  }
  if (getSchema(KINDS.STATE, state.schemaVersion) === null) {
    return stateFailure({
      file: id, stage: 'structural', path: 'schemaVersion',
      expected: 'a state schemaVersion this build implements',
      found: 'the value ' + JSON.stringify(state.schemaVersion),
      hint: 'unsupported-schema-version',
    });
  }
  if (typeof state.gameHash !== 'string' || !PATTERNS.sha256Hex.test(state.gameHash)) {
    return stateFailure({
      file: id, stage: 'structural', path: 'gameHash',
      expected: 'a 64-character lowercase hex SHA-256 of the content file',
      found: 'the value ' + JSON.stringify(state.gameHash),
      hint: 'bad-name-format',
    });
  }
  if (expectGameHash && state.gameHash !== expectGameHash) {
    // THE IMPORT GUARD (F10). A state file exported from a different game would pass the structural
    // walk and the bounds checks only by coincidence; adopting it would put another game's scores
    // on this board. Say so instead.
    return stateFailure({
      file: id, stage: 'contract', path: 'gameHash',
      expected: 'a session saved for the game currently loaded (' + expectGameHash.slice(0, 12) + '…)',
      found: 'a session saved for a different game file (' + state.gameHash.slice(0, 12) + '…)',
      hint: 'unresolved-reference',
    });
  }
  return null;
}

// =============================================================================================
// SECTION 7 — the store
// =============================================================================================

let currentState = null;
const listeners = new Set();

/** The live session, frozen, or null. One plain serializable object — the v2.0 seam. */
export function current() {
  return currentState;
}

/**
 * Subscribe to session changes. Returns an unsubscribe function.
 *
 * Listeners are called with the new state — or with `null` when the current session is discarded,
 * so a subscriber must tolerate that. `app.js` uses one subscriber to drive `renderer.updateBoard`
 * and `renderer.updateScorePanel`; the renderer never reads this store itself (module-contracts §2).
 */
export function subscribe(listener) {
  if (typeof listener !== 'function') throw new TypeError('subscribe(): listener must be a function');
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(state) {
  for (const listener of Array.from(listeners)) {
    try {
      listener(state);
    } catch (err) {
      // One broken subscriber must not stop the others from repainting, and must not unwind a
      // persist that already succeeded. Loud in the console, harmless to the game.
      console.error('state subscriber threw:', err);
    }
  }
}

function install(state) {
  currentState = deepFreeze(state);
  notify(currentState);
  return { ok: true, value: currentState };
}

/**
 * Make a state object the current session and persist it.
 *
 * @param {object} cleanedState  MUST be a `validator.validateState()` result when it came from
 *                               localStorage or from an imported file. `app.js` is the only legal
 *                               caller (module-contracts §9); a freshly built `newSession()` object
 *                               needs no validation because this module built it.
 * @param {{expectGameHash?:string, file?:string}} [opts]  `file` is the §0.2 identity used in any
 *                               failure — `import:quiz-state.json` for F10 imports.
 */
export function adopt(cleanedState, opts = {}) {
  const bad = cheapCheck(cleanedState, opts);
  if (bad) return fail(bad);

  const next = clone(cleanedState);
  next.appVersion = APP_VERSION; // stamp the build that is now writing it (D6)
  if (typeof next.updatedAt !== 'string') next.updatedAt = nowIso();

  const written = persist(next);
  if (!written.ok) return written;
  return install(next);
}

function persist(state) {
  const nonSerializable = firstNonSerializable(state, 'state');
  if (nonSerializable) {
    // A programmer error, not bad data: someone put a Date or a Map into the session. Loud.
    throw new TypeError('state: value is not JSON-serializable at ' + nonSerializable);
  }
  return writeEntry(state.gameHash, JSON.stringify(state));
}

/**
 * Apply `mutator` to a COPY of the current session, stamp `updatedAt`, persist, then notify.
 *
 * @param {(draft:object)=>void} mutator
 * @returns {{ok:true,value:object} | {ok:false,failures:ValidationFailure[]}}
 *
 * The mutator sees a mutable draft and returns nothing. Copy-then-swap rather than mutate-in-place
 * means a failed write leaves the live session exactly as it was: if storage refuses, the host
 * keeps playing off a board that still matches what they can see, and the error screen explains why
 * the save did not happen (plan Q13).
 */
export function update(mutator) {
  if (typeof mutator !== 'function') throw new TypeError('update(): mutator must be a function');
  if (!currentState) throw new Error('update(): no current session — call adopt() first');

  const draft = clone(currentState);
  mutator(draft);
  draft.updatedAt = nowIso();
  draft.appVersion = APP_VERSION;

  const bad = cheapCheck(draft, {});
  if (bad) return fail(bad);

  const written = persist(draft);
  if (!written.ok) return written;
  return install(draft);
}

// =============================================================================================
// SECTION 8 — the shelf: list, load, discard, prune (spec §4.4)
// =============================================================================================

/**
 * Parse one stored entry far enough to summarize it. Returns null when the entry is missing,
 * unparseable, or not shaped like a session — such an entry cannot be offered on a resume list
 * because there is nothing truthful to put in the row.
 */
function summaryOf(gameHash) {
  const text = readEntry(gameHash);
  if (typeof text !== 'string') return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch (_err) {
    return null;
  }
  if (!isPlainObject(data)) return null;
  if (typeof data.gameTitle !== 'string' || typeof data.updatedAt !== 'string') return null;
  return {
    gameHash,
    gameTitle: data.gameTitle,
    updatedAt: data.updatedAt,
    teamCount: Array.isArray(data.teams) ? data.teams.length : 0,
  };
}

/**
 * Recent sessions, newest `updatedAt` first — exactly what the resume screen needs and nothing
 * more (`SessionSummary`, module-contracts §9).
 *
 * The summaries are projected from parsed entries rather than from a separate index key. An index
 * would avoid parsing ten small JSON blobs (a fraction of a millisecond) at the cost of a second
 * source of truth that can drift from the sessions it describes — and a resume list that offers a
 * session which no longer exists is worse than a resume list that took 0.4 ms to build.
 */
export function listSessions() {
  const out = [];
  for (const hash of sessionHashes()) {
    const summary = summaryOf(hash);
    if (summary) out.push(summary);
  }
  out.sort((a, b) => {
    if (a.updatedAt === b.updatedAt) return a.gameHash < b.gameHash ? -1 : 1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
  return out;
}

/**
 * Read one stored session as a `RawDocument`, ready to hand to `validator.validateState`.
 *
 * @returns {{ok:true,value:{path,kind,text,bytes,data}} | {ok:false,failures:[…],raw?:{path,kind,text}}}
 *
 * DEVIATION from module-contracts §9, flagged: the contract writes this as
 * `loadSession(gameHash) -> Result<CleanedState>`, but `state` may not import `validator` (§2) and
 * a stored session is untrusted input (CLAUDE.md) — an older build or a hand-edited devtools entry
 * can put anything on that shelf. So this returns the RAW document and `app.js` runs the same
 * `validator.validateState({raw, bundle})` → `adopt()` path it runs for an imported file. One
 * validation path for both untrusted sources is the point.
 *
 * When the entry exists but will not parse, the Result carries `raw` alongside `failures` so the
 * caller can get a located syntax report out of `errors.syntaxFailure(raw)` — this module owns no
 * scanner and must not grow one. The failure in `failures` is the serviceable fallback for a caller
 * that ignores `raw`.
 */
export function loadSession(gameHash) {
  const file = sessionFileId(gameHash);
  const text = readEntry(gameHash);

  if (typeof text !== 'string') {
    return fail(
      stateFailure({
        file, stage: 'fetch', path: '(file)',
        expected: 'a saved session for this game in this browser',
        found: 'nothing saved under that game (it may have been discarded, pruned, or saved in another browser)',
        hint: 'fetch-failed',
      }),
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (_err) {
    const result = fail(
      stateFailure({
        file, stage: 'syntax', path: '(file)',
        expected: 'the saved session to be readable JSON',
        found: 'stored text that could not be parsed',
        hint: 'syntax',
      }),
    );
    result.raw = { path: file, kind: KINDS.STATE, text };
    return result;
  }

  return {
    ok: true,
    value: { path: file, kind: KINDS.STATE, text, bytes: new TextEncoder().encode(text).length, data },
  };
}

/**
 * Forget one session. If it is the live one, the store goes empty and subscribers are told (null).
 * Discard is a deliberate act by the host on the resume screen, so it is silent and immediate —
 * there is no undo, and the resume screen is where the confirmation belongs.
 */
export function discardSession(gameHash) {
  removeEntry(gameHash);
  if (currentState && currentState.gameHash === gameHash) {
    currentState = null;
    notify(null);
  }
}

/**
 * Remove the `n` oldest sessions by `updatedAt`, never touching `keepHash`. Returns the count
 * removed. Entries that cannot be summarized (corrupt, foreign, half-written) go FIRST: they can
 * never be resumed, so they are pure cost on a shelf with a cap.
 */
function removeOldest(n, keepHash) {
  let removed = 0;
  const summaries = [];
  for (const hash of sessionHashes()) {
    if (hash === keepHash) continue;
    const summary = summaryOf(hash);
    if (!summary) {
      if (removed < n) {
        removeEntry(hash);
        removed += 1;
      }
      continue;
    }
    summaries.push(summary);
  }
  if (removed >= n) return removed;

  summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.gameHash < b.gameHash ? -1 : 1));
  for (const summary of summaries) {
    if (removed >= n) break;
    removeEntry(summary.gameHash);
    removed += 1;
  }
  return removed;
}

/**
 * Enforce the spec §4.4 retention cap: keep the last `LIMITS.maxSessions` sessions, prune the
 * oldest SILENTLY. Returns the number removed.
 *
 * Silence is the spec's word and the right behavior: state longevity is a declared non-goal for
 * v1, and a modal saying "your session from three weeks ago was deleted" during setup for a live
 * room would be noise about something the host does not care about. The export button (F10) is the
 * documented escape hatch for anything worth keeping.
 */
export function pruneToCap() {
  const summaries = listSessions(); // newest first
  const corrupt = sessionHashes().length - summaries.length;
  let removed = 0;

  // Unreadable entries are removed regardless of the cap — they occupy the quota and can never be
  // resumed, which is the worst of both.
  if (corrupt > 0) removed += removeOldest(corrupt, currentState ? currentState.gameHash : null);

  const excess = summaries.length - LIMITS.maxSessions;
  if (excess > 0) {
    for (let i = summaries.length - 1; i >= summaries.length - excess; i--) {
      if (currentState && summaries[i].gameHash === currentState.gameHash) continue;
      removeEntry(summaries[i].gameHash);
      removed += 1;
    }
  }
  return removed;
}

// =============================================================================================
// SECTION 9 — export (F10)
// =============================================================================================

/**
 * The payload for the Export button.
 *
 * @returns {{filename:string, json:string} | null}  null when there is no session to export.
 *
 * This module produces STRINGS, not downloads: `app.js` makes the Blob and the `<a download>`,
 * because a download is DOM work and `state` never touches the DOM. The JSON is pretty-printed
 * because the export file is also the thing a user hand-edits and mails in when something breaks —
 * spec §4.4 calls it the escape hatch, and an escape hatch on one long line is a poor one.
 */
export function exportPayload() {
  if (!currentState) return null;
  return {
    filename: exportFilename(currentState),
    json: JSON.stringify(currentState, null, 2),
  };
}

/** `quiz-board-<title-slug>-<YYYYMMDD-HHMM>.json`. Slug is [a-z0-9-] only — never a path. */
export function exportFilename(state) {
  const slug =
    String(state.gameTitle || 'game')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'game';
  const stamp = String(state.updatedAt || nowIso()).replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-').slice(0, 13);
  return 'quiz-board-' + slug + '-' + stamp + '.json';
}

// =============================================================================================
// SECTION 10 — the game moves: cells, teams, scoring
// =============================================================================================
//
// Each of these is a thin, NAMED wrapper over `update()`. The names matter more than the lines
// they save: `app.js`'s handlers then read as the host's actions ("advance this cell", "award this
// team"), and the rules that decide what an action is allowed to do live here, next to the object
// they change, rather than being re-derived in a click handler.

/**
 * Record the lifecycle state a cell has moved INTO. The next state is derived by the renderer
 * (`nextLifecycleState`) and handed to `onCellAdvance`, so it is derived exactly once — deriving it
 * again here is how a board comes to disagree with the session it was drawn from.
 */
export function setCellState(cellKey, nextState) {
  return update((draft) => {
    draft.cellStates[cellKey] = nextState;
  });
}

/**
 * Replace the team list. Names are trimmed, capped, and empties dropped.
 *
 * SCORES SURVIVE A RENAME (F6). The host reaches this function twice: once at session start, where
 * every score is 0 and the point is moot, and once mid-game from the toolbar's Teams… button, where
 * they are fixing a typo in front of a room. Rebuilding the list from names alone reset the scores
 * to zero there — a silent data loss with no undo, on the one action whose whole purpose is to
 * correct a mistake. The score at the same INDEX is carried over, because the index is the only
 * identity a team has: `teams[1]` is the second team before and after the edit, whatever it is
 * called. A team added at the end starts at 0; a box cleared to remove a team takes its score with
 * it, which is the same "no undo" the resume screen's Discard has and for the same reason.
 */
export function setTeams(names) {
  return update((draft) => {
    const previous = Array.isArray(draft.teams) ? draft.teams : [];
    const next = normalizeTeams(names);
    for (let i = 0; i < next.length; i++) {
      const was = previous[i];
      if (was && Number.isInteger(was.score)) next[i].score = was.score;
    }
    draft.teams = next;
  });
}

const SCORE_MIN = -1000000; // schemas.js `teamV1.score` range — state must stay schema-valid
const SCORE_MAX = 1000000;

/**
 * Award or deduct points, per the GAME TYPE's scoring rules (spec §4.2).
 *
 * @param {{bundle:CleanedBundle, teamIndex:number, delta:number}} args
 *
 *   - `scoring.model === 'none'` (bingo): scores are not part of that game. The call is a no-op
 *     rather than a failure — a game type with no scoring simply has no score panel to click.
 *   - `scoring.allowNegative === false`: the score FLOORS at zero rather than refusing the deduct.
 *     A host deducting 200 from a team on 100 means "they got it wrong"; refusing the click would
 *     leave the board disagreeing with what just happened in the room.
 *   - Both ends clamp to the schema's own integer range, so no sequence of clicks can produce a
 *     session that its own schema would reject on reload.
 */
export function adjustScore({ bundle, teamIndex, delta }) {
  const scoring = (bundle && bundle.gametype && bundle.gametype.scoring) || {};
  if (scoring.model === 'none') return { ok: true, value: currentState };
  if (!Number.isFinite(delta)) throw new TypeError('adjustScore(): `delta` must be a finite number');

  return update((draft) => {
    const team = draft.teams[teamIndex];
    if (!team) return; // a stale click after a team list changed: nothing to score, nothing to break
    let next = Math.round(team.score + delta);
    if (scoring.allowNegative !== true && next < 0) next = 0;
    if (next < SCORE_MIN) next = SCORE_MIN;
    if (next > SCORE_MAX) next = SCORE_MAX;
    team.score = next;
  });
}

/**
 * What a cell is worth right now, bonus included (F7's payoff, spec §8).
 *
 * The multiplier applies only to cells the session drew as bonus winners, and never to a
 * `lockValue` cell — "the cell's value must never be altered by randomization or any future
 * mechanic" (spec §4.1). The draw already excludes those cells; the second check here is cheap and
 * makes the rule true at the point where value is actually computed, which is where a future
 * mechanic would be tempted to bypass it.
 */
export function cellAward({ bundle, session, cellKey }) {
  const s = session || currentState;
  const cell = findCell(bundle, cellKey);
  const base = cell && Number.isFinite(cell.value) ? cell.value : 0;

  const isBonus = !!(s && Array.isArray(s.bonusCells) && s.bonusCells.indexOf(cellKey) !== -1);
  const locked = bundle.resolved.lockedValueKeys.indexOf(cellKey) !== -1;
  if (!isBonus || locked) return base;

  const multiplier = bundle.gametype.bonus ? bundle.gametype.bonus.multiplier : 1;
  return Math.round(base * (Number.isFinite(multiplier) ? multiplier : 1));
}

function findCell(bundle, cellKey) {
  const parts = String(cellKey).split(':');
  const col = bundle.content.board.columns[Number(parts[0])];
  if (!col) return null;
  return col.cells[Number(parts[1])] || null;
}

/**
 * Reset the module between test cases. Not part of the app's flow: `/tests/index.html` runs many
 * scenarios in one page, and a module-level store that cannot be emptied makes every test after the
 * first one depend on the one before it.
 */
export function __resetForTests() {
  currentState = null;
  listeners.clear();
}
