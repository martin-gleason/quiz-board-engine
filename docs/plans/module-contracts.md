# Module Contracts — Quiz Board Engine v1.0

**Status:** ACTIVE — created 2026-08-17 · Author: A2 (Project Architect)
**Implements:** `docs/specs/quiz-board-engine-spec-v1.md` (FROZEN) via `docs/plans/v1.0-build-plan.md`
**Audience:** A3 (JS Developer) builds against this document. A1 authors fixtures against §3 and §9.
A4 reviews against §2 (the import graph) and §5 (the `ValidationFailure` shape).

This document is normative for signatures. Where it and a code comment disagree, this document
wins until it is edited. Where it and the **spec** disagree, the spec wins and this document is
the defect.

---

## 0. Conventions used throughout

### 0.1 The Result convention

Every fallible operation returns a plain object. **Expected failures are values, never
exceptions.** `throw` is reserved for programmer error (a bad `kind` string, a schema node with
an unknown `kind`) — bugs in our code, not bad data.

```js
{ ok: true,  value: <payload> }
{ ok: false, failures: [ValidationFailure, ...] }   // never empty when ok === false
```

Rules:

- `failures` is always an array, always length ≥ 1, ordered as encountered (document order).
- A validator collects **all** failures it can find at its stage, then stops before the next
  stage. It does not stop at the first fault — a file with three wrong types should show three
  rows on the error screen, not three consecutive reload-and-retry cycles.
- Stages are strictly sequential per document: `fetch` → `syntax` → `structural` → `contract`.
  A stage runs only if the previous stage produced no failures. There is **no partial render,
  ever** (CLAUDE.md invariant).

### 0.2 File identity strings

Every `ValidationFailure.file` is one of:

| Form | Example | Used for |
|---|---|---|
| repo-relative path | `games/demo.json` | anything fetched over HTTP |
| `localStorage:<gameHash>` | `localStorage:9f2c…` | a stored session that no longer validates |
| `import:<filename>` | `import:quiz-state.json` | a user-supplied state file |

Never a full URL, never with the `?v=` cache-buster attached — the user sees the path they can
actually open in their editor.

### 0.3 Naming

`camelCase` functions, `SCREAMING_SNAKE` module constants, no default exports except
`schemas.js` (which also exports `schemas` by name; prefer the named import everywhere).

---

## 1. The six modules in one line each

| Module | Verb | Owns |
|---|---|---|
| `js/schemas.js` | **declares** | versioned schemas, enums, limits, patterns, hint-class ids |
| `js/loader.js` | **fetches** | `?game=` guard, cache-busted `fetch`, byte cap, `JSON.parse` |
| `js/validator.js` | **judges** | structural walk, contract cross-checks, the cleaned object |
| `js/errors.js` | **explains** | own JSON scanner, hint prose, the error screen DOM |
| `js/renderer.js` | **draws** | board DOM, theme `<link>`, Reveal integration, score panel |
| `js/state.js` | **remembers** | session store, `localStorage`, hashing, export payload |

---

## 2. Import graph — normative

```
schemas.js  ──────────────── imports nothing (leaf)
errors.js   ──> schemas
loader.js   ──> schemas, errors
validator.js ─> schemas, errors
state.js    ──> schemas
renderer.js ──> schemas, vendor/reveal.js/reveal.esm.js
app.js      ──> schemas, loader, validator, errors, renderer, state   (composition root)
```

**Forbidden, and each for a reason:**

- `errors` → anything but `schemas`. The error screen must be renderable from a bare failure
  array, so `/tests/index.html` can print error output with no loader and no board in play.
- `validator` → `loader`. The validator judges documents it is *handed*; it never fetches. This
  is what lets a fixture be validated from a string literal in the test runner.
- `validator` → `state`, `state` → `validator`. Imported state is untrusted (CLAUDE.md) and is
  validated by `validator.validateState()`; `app.js` is the **only** caller that hands the
  result to `state.adopt()`. Neither module may shortcut the other.
- `renderer` → `state`. The renderer is a function of its arguments. `app.js` subscribes to the
  store and calls `renderer.updateBoard()`. A renderer that reads the store cannot be tested
  with a hand-built session object, and it invites the "who re-renders?" bug class.
- `renderer` → `loader`. Themes reach the DOM as a `<link>` whose filename came from the
  **validated manifest**. The renderer never resolves a theme name itself.
- Anything → `app`. `app.js` is a sink.

### 2.1 Proposed delta D8 (Pending ratification)

**Add `js/app.js` — the composition root — to the spec §3 file list.**
Rationale: the five spec-named modules stay honest only if *something else* wires them
together. Without `app.js`, orchestration has to live inside `loader` (which would then import
`validator` and `renderer`) and the module boundary CLAUDE.md names is dead on arrival.
`app.js` contains no schema knowledge, no DOM construction, and no fetch logic — only sequence.
It is ~150 lines of "call this, check `ok`, call that".
Fallback if D8 is refused: the same code lives as an inline `<script type="module">` in
`index.html`, at the cost of being untestable from `/tests/index.html`. **A2 recommends D8.**
The planner should copy D8 into `v1.0-build-plan.md` §2 for the D3–D7 ratification pass.

---

## 3. `js/schemas.js` — declares

No I/O, no logic, no imports. All exports are deep-frozen.

```js
export const schemas          // schemas[kind][version] -> schema node
export const KINDS            // { CONTENT:'content', GAMETYPE:'gametype', THEMES:'themes', STATE:'state' }
export const LIMITS           // spec §5 resource limits, one source of truth
export const ENUMS            // { layout, cellLifecycle, scoringModel, winCondition, patterns, animation }
export const ANIMATIONS       // ['flip','zoom','fade']  — the built-in animation set
export const CELL_FIELD_WHITELIST // ['prompt','answer','value']  — validator-owned, spec §4.2
export const PATTERNS         // { gameTypeId, themeName, themeFile, cellKey, sha256Hex, iso8601Utc }
export const HINT_CLASSES     // frozen array of hint-class identifiers (ids only, no prose)
export const RESOLVES         // { GAMETYPE, THEME, ANIMATION } cross-reference targets
export const CROSS_CHECKS     // declared contract rules: { hint, describe, pathShape }
export const DEFAULTS         // values applied when an optional field is absent
export const NOTE_KEY         // '_note'
export function supportedVersions(kind) -> number[]        // ascending; [] for unknown kind
export function getSchema(kind, version) -> node | null    // null => unsupported version
export default schemas
```

`getSchema` returning `null` is the **only** signal for an unimplemented `schemaVersion`. The
caller raises hint class `unsupported-schema-version`. Nothing anywhere attempts a best-effort
parse of a future version (spec §4.1).

### 3.1 Schema node vocabulary — the closed set

`validator.js` must handle exactly these `kind` values and `throw` on any other (that would be
a bug in `schemas.js`, not in user data).

| `kind` | Fields | Notes |
|---|---|---|
| `object` | `fields`, `required[]`, `stripUnknown`, `requiredWhen[]` | `requiredWhen: [{when:{field,equals}, require:[...]}]` |
| `array` | `items`, `minItems`, `maxItems` | |
| `string` | `minLength`, `maxLength`, `pattern`, `enum` | |
| `integer` | `min`, `max` | `Number.isInteger` required |
| `number` | `min`, `max` | finite required |
| `boolean` | — | strict `true`/`false`; `"true"` fails |
| `literal` | `value` | used for `schemaVersion` pinning |
| `map` | `keyPattern`, `values`, `maxEntries` | key failures report the key in the path |
| `orderedSubset` | `of`, `minItems`, `maxItems` | membership, no dupes, **order of `of` preserved** |
| `subset` | `of`, `minItems`, `maxItems` | membership, no dupes, any order |

Every node also carries:

- `expected` — **required on every node.** A phrase that completes "expected ___". Copied
  verbatim into `ValidationFailure.expected`. This is why §5's expected-vs-found pair is always
  available: it is authored, not inferred.
- `hint` — optional hint-class id. When absent the validator picks a class from the failure kind
  (`missing-required-field`, `wrong-type`, `out-of-range`, …).
- `resolves` — optional `RESOLVES.*` marker. **Documentation, not dispatch.** Nothing reads it at
  runtime: the contract stage is six hand-written checks (§6.2), and the marker exists so a reader of
  `schemas.js` can see which fields carry a cross-reference. Adding `resolves` to a new node does
  **not** cause anything to be validated; the check has to be written in `validator.js` too.

### 3.2 Adding a schema version — the discipline

1. Add the new node tree with a `V2` suffix.
2. Add key `2` to the relevant `schemas.<kind>` table.
3. **Never touch key `1`.** Not a typo fix, not a limit bump. A v1 file authored today must
   validate identically forever; that promise is the whole point of version keying (plan Q5).
4. If a *limit* changes in v2, v2 gets its own limit constant. `LIMITS` is v1's.

---

## 4. `js/loader.js` — fetches

Imports: `schemas` (`LIMITS`, `KINDS`), `errors` (`failure`, `syntaxFailure`).

```js
export const GAMES_DIR          = 'games/'
export const GAMETYPES_DIR      = 'gametypes/'
export const THEMES_MANIFEST    = 'themes/themes.json'
export const DEFAULT_GAME       = 'games/demo.json'
export const DEFAULT_MAX_BYTES  = 262144   // cap for everything that is not a content file

export function resolveGameParam(raw: string|null|undefined) -> Result<string>
export function gametypePath(id: string) -> string          // 'gametypes/<id>.json'; throws on bad id
export async function fetchJsonFile({ path, kind, maxBytes }) -> Promise<Result<RawDocument>>
export async function fetchContentBundle({ gamePath }) -> Promise<Result<RawBundle>>
```

### 4.1 `resolveGameParam`

Turns `?game=` into a path, or refuses. **Refusal list (spec §6.3, plan §6):** empty string,
absolute URL (`https://…`, any `scheme:`), protocol-relative (`//evil.com/x.json`), any `..`
segment, any encoded traversal (decode once, then re-test; `%2e%2e`, `%2E%2E`, `%2f`), any
backslash, any path not under `games/`, any name not ending exactly `.json` (so `x.json.txt`
and `x.txt` both die), any embedded `?` or `#`, and any control character.

- Success → `{ ok:true, value:'games/<name>.json' }` (normalized, no leading `/`, no `./`).
  **Subdirectories under `games/` are allowed**: `games/2026/spring/history.json` resolves. Safe by
  construction — `.` is not in the allowlist's segment character class, so no segment can be `..`
  and no name can carry a second extension.
- `null`/absent → success with `DEFAULT_GAME`. An absent param is not an error.
- Failure → one failure, `stage:'fetch'`, `hint:'bad-game-param'`, `file:'(URL parameter)'`,
  `path:'?game'`, `expected:'a relative path under games/ ending in .json'`,
  `found:` the rejected value, truncated to 120 chars and rendered via `errors.describeValue`.

Implementation note for A3: match against an allowlist regex on the **decoded** value, do not
blacklist substrings. `URL` parsing is permitted for detection but the returned path is always
the literal allowlisted string, never a `URL` field.

### 4.2 `fetchJsonFile`

```js
RawDocument = {
  path:  'games/demo.json',   // identity string per §0.2, no cache-buster
  kind:  'content',           // KINDS value
  text:  '{ … }',             // raw response text, retained for errors.js line/column work
  bytes: 4211,                // byte length of `text` (TextEncoder, not string length)
  data:  { … }                // JSON.parse output, still dirty: unknown keys and _note present
}
```

- `fetch(path + '?v=' + Date.now(), { cache:'no-store' })` — plan Q14. CSS is **not**
  cache-busted; that is the renderer's business and it deliberately does not do it.
- `!response.ok` or a thrown network error → `stage:'fetch'`, `hint:'fetch-failed'`,
  `expected:'a readable JSON file at this path'`, `found:'HTTP 404'` (or `'a network error'`).
  Per spec §5 a 404 on a game-type file **is a validation failure**, not a crash.
- `bytes > maxBytes` (default `LIMITS.contentFileBytes` for content, 256 KB for the others) →
  `stage:'fetch'`, `hint:'file-too-large'`. Checked **before** `JSON.parse`, so a hostile 40 MB
  file never reaches the parser.
- `JSON.parse` throws → return `errors.syntaxFailure({ file:path, kind, text })` and **never**
  inspect the thrown `Error.message` (plan Q6, CLAUDE.md constraint 5).

### 4.3 `fetchContentBundle`

Fetches the content file, then — only if it parsed — the themes manifest and the game-type file
named by `data.gameType` (whose id is pattern-checked before it becomes a path). Themes manifest
and game-type fetches run concurrently via `Promise.all`.

```js
RawBundle = { content: RawDocument, gametype: RawDocument, themes: RawDocument }
```

If the content file's `gameType` is missing or not a string, the bundle fetch returns the
content document alone with `gametype: null`; the structural stage then reports the missing
field. The loader never guesses a game type.

---

## 5. `ValidationFailure` — the canonical shape

Every failure from every module and every stage is exactly this object, frozen.

```js
ValidationFailure = {
  file:     'games/demo.json',          // §0.2 identity string. REQUIRED.
  kind:     'content',                  // KINDS value | '(url)' for the ?game= case. REQUIRED.
  stage:    'structural',               // 'fetch' | 'syntax' | 'structural' | 'contract'. REQUIRED.
  path:     'board.columns[2].cells[1].value',   // JSON path, or null
  location: null,                       // Location object, or null
  expected: 'a whole number (per-cell point value; it overrides valueLadder)',  // REQUIRED
  found:    'the text "500"',           // REQUIRED. Human phrase from errors.describeValue().
  hint:     'wrong-type',               // a HINT_CLASSES id. REQUIRED.
  message:  'board.columns[2].cells[1].value: expected a whole number, found the text "500"'
}
```

**Exactly one of `path` and `location` is non-null.**

- `stage:'syntax'` → `location` set, `path` null. The file did not parse; there are no paths.
- every other stage → `path` set, `location` null.
- `stage:'fetch'` uses a pseudo-path: `'(file)'` for the whole document, `'?game'` for the URL
  parameter. Never null.

```js
Location = {
  line:        14,      // 1-based
  column:      3,       // 1-based, counted in GRAPHEME CLUSTERS — what the reader's editor shows
  offset:      412,     // 0-based index into RawDocument.text
  snippet:     [ { lineNumber: 12, text: '    "value": 100,' }, … ],  // up to 2 lines either side
  caretColumn: 3        // 1-based UTF-16 index into the snippet line whose lineNumber === line
}

`column` counts grapheme clusters because a combining mark (`e` + U+0301, which is how macOS tools
spell "café") is a code unit that occupies no cell: counting code units drifts the number one to the
right of the character it names for every mark earlier on the line. `caretColumn` stays a code-unit
index, because the caret pad is built by slicing that snippet line so that it can copy tabs verbatim.

**Snippet lines are clipped.** The fault line keeps a window around the caret and context lines keep
their opening characters, both marked with `…`. A minified file is one line of up to 1 MB; unclipped,
the snippet is larger than the file and the caret lands far off the right edge of the `<pre>`. So
`caretColumn` indexes the CLIPPED text and can differ from `column`.
```

Field rules:

- `expected` and `found` are **always both present and always both human phrases.** No bare type
  names, no `undefined`, no JS-ish `[object Object]`. `found` is truncated to 120 characters with
  a trailing `…` — a 2,000-character prompt must not blow out the error screen.
- `hint` is a **class**, never per-field prose (plan §7 risk register: "hints attach to error
  classes, not individual fields"). `errors.hintText()` maps the class to copy.
- `message` is a one-line summary for the console and the test runner's table. The error screen
  composes its own richer layout from the structured fields and ignores `message`.
- `path` uses spec §7's exact notation: `.field`, `[index]`, `["map key"]`. Root document is
  `'(file)'`, never the empty string.

### 5.1 Path construction

The walker threads an array of segments and joins once, at failure time:

| Step | Segment pushed | Rendered |
|---|---|---|
| object field | `{t:'field', k:'value'}` | `.value` |
| array item | `{t:'index', i:1}` | `[1]` |
| map entry | `{t:'key', k:'0:2'}` | `["0:2"]` |

Leading `.` is stripped. `board.columns[2].cells[1].value` and `cellStates["0:2"]` are the two
shapes A1's fixtures assert against.

---

## 6. `js/validator.js` — judges

Imports: `schemas`, `errors`. **Never** `loader`, `state`, or `renderer`.

```js
export function validateDocument({ kind, raw }) -> Result<cleaned>
export function validateBundle(rawBundle) -> Result<CleanedBundle>
export function validateState({ raw, bundle }) -> Result<CleanedState>
export function collectFailures(node, value, segments, ctx) -> ValidationFailure[]  // for tests
```

### 6.1 `validateDocument({ kind, raw })`

Structural stage only, one document.

1. Read `raw.data.schemaVersion`. Not an integer → one failure, `hint:'wrong-type'`.
2. `getSchema(kind, version)` → `null` → one failure, `hint:'unsupported-schema-version'`,
   `expected:'schemaVersion to be one of: 1'` (built from `supportedVersions(kind)`),
   `found:'the number 2'`. **Stop.** No further checks against a schema we do not have.
3. `walk` the tree. Collect every failure.
4. On success, return the **cleaned** value: unknown keys dropped, every `_note` dropped at every
   level, `DEFAULTS` filled in for absent optionals. The cleaned object shares no reference with
   `raw.data` — it is built fresh, so no dirty sub-object can leak to the renderer.

### 6.2 `validateBundle(rawBundle)`

`validateDocument` on `content`, `gametype`, and `themes`; then, only if all three are clean, the
contract stage. Failures from all three documents are concatenated in that order, so the error
screen can group by `file`.

Contract checks. `schemas.CROSS_CHECKS` is a **documentation table cross-referenced by comment**,
not a dispatch table — the six checks below are hand-written in `validator.js` and nothing reads
`CROSS_CHECKS` at runtime. Do not build a dispatcher for six checks; do keep the names in step.

| Check | Rule | hint |
|---|---|---|
| `gameTypeIdMatches` | `gametype.id === content.gameType` | `unresolved-reference` |
| `themeExists` | `content.theme` is a key of `themes.themes` | `unresolved-reference` |
| `animationExists` | `content.animation ∈ ANIMATIONS` | `unresolved-reference` |
| `requiredCellFields` | every cell carries every field in `gametype.requiredCellFields` | `missing-required-field` |
| `uniformRows` | if `gridConstraints.uniformRows`, all columns have equal `cells.length` | `ragged-grid` |
| `ladderCoverage` | a cell with no `value` needs `valueLadder[i]` to exist (plan Q8) | `ladder-short` |

`gameTypeExists` and the byte/parse failures are the loader's; the validator never re-checks them.

### 6.3 `CleanedBundle` — the object the renderer receives

This is the **only** shape `renderer.js` ever sees. It is frozen, contains no `_note`, no unknown
keys, and no unresolved values.

```js
CleanedBundle = {
  content: {
    schemaVersion: 1,
    title:     'OCS Policy Review',
    gameType:  'jeopardy',
    theme:     'midnight',            // always present — DEFAULTS.theme when the file omitted it
    animation: 'flip',                // always present — DEFAULTS.animation when omitted
    board: {
      columns: [
        {
          label: 'Case Law',
          cells: [
            {
              key:    '0:0',          // ADDED by the validator: "<col>:<row>", plan Q7
              column: 0,              // ADDED
              row:    0,              // ADDED
              prompt: 'This 1967 case…',   // present only if the source had it
              answer: 'What is In re Gault?',
              value:  100,            // RESOLVED: per-cell value, else valueLadder[row].
                                      // Absent only when the game type does not require `value`.
              flags: { randomizable: true, lockValue: false, preMarked: false }  // always all three
            }
          ]
        }
      ]
    }
  },

  gametype: {                          // all optionals filled from DEFAULTS
    schemaVersion: 1, id: 'jeopardy', layout: 'grid',
    cellLifecycle: ['hidden','revealed','answered'],
    scoring: { model: 'accumulate', allowNegative: true },
    winCondition: 'highest-score',
    patterns: [],                      // [] unless winCondition === 'pattern-complete'
    bonus: { count: 1, multiplier: 2 },
    gridConstraints: { uniformRows: false },
    requiredCellFields: ['prompt','answer','value']
  },

  themes: { schemaVersion: 1, themes: { default:'default.css', midnight:'midnight.css' } },

  resolved: {                          // precomputed so the renderer computes no economy at all
    themeFile:        'midnight.css',  // themes.themes[content.theme] — the ONLY string the
                                       // renderer is allowed to turn into a <link href>
    animation:        'flip',
    columnCount:      5,
    maxRowCount:      5,               // longest column
    uniform:          true,            // every column same length
    cellKeys:         ['0:0','0:1', …],        // document order, column-major
    randomizableKeys: ['1:2', …],              // flags.randomizable && !flags.lockValue
    lockedValueKeys:  ['0:3', …],
    preMarkedKeys:    ['2:2', …],
    terminalState:    'answered',              // last entry of cellLifecycle
    initialState:     'hidden'                 // first entry of cellLifecycle
  }
}
```

Why `key`/`column`/`row` are added: the state layer, the renderer, and the bonus picker all
address cells by the `"<col>:<row>"` key (plan Q7). Deriving it in three places is three chances
to derive it differently. The validator derives it once, and `resolved.cellKeys` is the
authoritative census a state file's keys are bounds-checked against.

### 6.4 `validateState({ raw, bundle })`

Structural walk against `schemas.state[1]`, then — only when `bundle` is supplied — two bounds
checks: every `cellStates` key and every `bonusCells` entry must appear in
`bundle.resolved.cellKeys` (`stateCellKeysInBounds`, `out-of-range`), and every `cellStates`
value must appear in `bundle.gametype.cellLifecycle` (`stateCellStatesInLifecycle`,
`unknown-value`). `bundle` omitted → structural only, used by the test runner.
`appVersion` (delta D6) is type-checked and otherwise ignored.

---

## 7. `js/errors.js` — explains

Imports: `schemas` (`HINT_CLASSES`) only. **Heavily commented per spec §7** — the *why* of each
message class lives beside the code that emits it. That is a requirement, not a nicety.

```js
export function failure(fields) -> ValidationFailure      // frozen; throws on unknown hint class
export function describeValue(v) -> string                // 'the text "abc"', 'a list of 3 items', 'nothing (the field is absent)'
export function pathFromSegments(segments) -> string      // §5.1 notation; '(file)' for the root
export function scanJsonSyntax(text) -> Location & { hint, expected, found }
export function syntaxFailure({ file, kind, text }) -> Result<never>   // {ok:false, failures:[…]}
export function hintText(hintClass, failure) -> { title: string, body: string }
export function formatFailure(f) -> string                // one-line, for console + test table
export function renderErrorScreen(failures, mountEl) -> void
```

- `failure()` is the **only** constructor. It fills `message` from the structured fields, asserts
  exactly-one-of `path`/`location`, and throws a `TypeError` if `hint` is not in `HINT_CLASSES`.
  A mistyped hint class is a build-time-ish bug and must be loud, not silently unhinted.
- `scanJsonSyntax` is our **own** minimal JSON scanner (plan Q6). It never sees, and must never
  be given, a browser's `JSON.parse` error message. It returns the first structural fault with
  line, column, offset, a snippet of up to two lines either side, a caret column, and a hint
  class — deterministic and byte-identical in all three engines. Trailing-comma detection is the
  named case: a `,` followed by `}` or `]` yields `hint:'syntax'` and hint copy "there is
  probably an extra comma just before this position."
- `renderErrorScreen` draws at most 100 cards and appends an "…and N more problems" line beyond
  that, so a fault-dense document cannot ask the browser for millions of nodes on the way to
  explaining itself. It builds DOM with `createElement`/`textContent` only. No `innerHTML`, no
  template strings into the DOM (CLAUDE.md named invariant). It groups failures by `file`, and
  for `location` failures renders the snippet in a `<pre>` with the caret line built as its own
  text node. It must render sensibly from a bare hand-written failure array with no board, no
  loader, and no Reveal instance in play — that is how `/tests/index.html` prints the §9 matrix.
- The screen also carries the plan Q10 / delta D7 note about needing an HTTP origin whenever the
  hint class is `fetch-failed`.

---

## 8. `js/renderer.js` — draws

Imports: `schemas`, and `vendor/reveal.js/reveal.esm.js`. Nothing else. Pure function of its
arguments; it holds view handles, never game truth.

```js
export const REVEAL_CONFIG                                            // frozen; `display` included

export async function initReveal(revealMount, overrides?) -> Promise<RevealApi>  // keyboard:false (Q12)
export function mountTheme(themeFile: string, doc = document) -> void
export function prefersReducedMotion() -> boolean
export function nextLifecycleState(lifecycle: string[], current: string) -> string | null
export function cellStateFor(bundle, session, cellKey) -> string

export function renderBoard({ bundle, session, mount, handlers }) -> BoardView
export function updateBoard(view, { bundle, session }) -> void
export function openCell(view, cellKey) -> void
export function closeCell(view) -> void

export function renderWinRail({ mount }) -> WinRailView
export function updateWins(view, wins) -> void

export function renderScorePanel({ bundle, session, mount, handlers }) -> PanelView
export function updateScorePanel(view, { session, award?, activeTeam? }) -> void
export function renderToolbar({ mount, handlers }) -> { root, destroy }

export function renderTeamSetup({ mount, handlers, names?, editing? }) -> { root, destroy }
export function renderResumeScreen({ sessions, gameHash, mount, handlers }) -> { root, destroy }

export function announce(text: string, doc = document) -> void   // the ARIA live region
```

This block is the AUTHORITY for signatures (§1). It was eight calls stale after F6-F10 — a stranger
coding against it wrote calls that do not exist — so it is now written from the shipped export list
rather than from the phase plans.

- `mountTheme` accepts **only** `bundle.resolved.themeFile` — a bare filename already checked
  against `PATTERNS.themeFile` by the schema and already proven to be a manifest value. It
  creates or updates a single `<link id="qbe-theme">` at `themes/<file>`, never cache-busted
  (plan Q14). It does not accept a theme *name*; resolution is not the renderer's job.
- `handlers` is how the renderer reports intent without importing `state`:
  `{ onCellActivate(cellKey), onCellAdvance(cellKey, nextState), onCellClose(), onScoreAdjust(teamIndex, delta), onTeamsSubmit(names), onResume(gameHash), onDiscard(gameHash), onExport(), onImport(file) }`.
  `onCellAdvance`'s second argument is the lifecycle state the cell is moving INTO. The renderer has
  already derived it to label the next button, and deriving it again in the caller is the same
  derivation twice — which is how a board comes to disagree with the saved session.
  All optional; a missing handler makes that affordance inert, never throws.
- **One delegated listener** on the board root, not one per cell (A4 performance lens). Cells are
  real `<button>` elements so keyboard and screen-reader support come from the platform
  (CLAUDE.md accessibility rule); **`data-cell`** carries identity — that is the attribute
  theme-contract §2/§3 publishes and the one the renderer emits. An earlier draft of this section
  said `data-cell-key`; the contract is the authority and the attribute is `data-cell`.
- `renderBoard` builds into a `DocumentFragment` and appends once — one layout pass for a 12×12
  board, not 144.
- `BoardView = { root: HTMLElement, cells: Map<string, HTMLButtonElement> }` — the published
  minimum. The renderer also hangs private handles off the same object (`stage`, `records`,
  `renderedStates`, `detail`, `bundle`, `handlers`, `open`, `escapeListener`); `cells` is a
  projection of `records`, so `cells.get(k) === records.get(k).button` always holds. `updateBoard`
  diffs by cell key and touches only changed nodes; it never rebuilds the board.
- `nextLifecycleState` and `cellStateFor` are exported but **imported by nobody**. They are
  lifecycle vocabulary kept for a future caller; `state.js` cannot import them (§2 forbids
  `state -> renderer`), which is why `state.cellStateFor` is a deliberate twin rather than a reuse.
- `announce` EXISTS and is live (renderer.js §6): the score bar speaks a moved score through it and
  the win rail speaks completed patterns. Earlier drafts of this section said it did not exist yet.
  When several patterns complete on one move it makes **one** call listing them all — `textContent`
  writes in a single task collapse to the last value a polite region ever sees, so a call per win
  spoke exactly one of them.
- `renderTeamSetup` and `renderResumeScreen` return a `{ root, destroy }` view; `destroy()` also
  clears the `inert` it set on the stage's other children and removes its Escape listener.
  `renderTeamSetup` takes `names` and `editing` (the mid-game Teams… screen); `editing` is the only
  variant with a `cancel` action and the only one Escape dismisses.
- `handlers` also carries `onTeamActivate(teamIndex)`, `onNewGame()`, `onTeamsEdit()` and
  `onCancel()`, which the list further up did not mention.
- **F8 additions (win rail).** `renderWinRail({ mount }) -> WinRailView` and
  `updateWins(view, wins)` draw `aside.qbe-wins` / `.qbe-win[data-pattern]` (theme-contract §2,
  v1.5) and speak each new win through `announce()`. `wins` is `state.completedPatterns()` output
  and is a COMPLETE statement of what is currently won; the view diffs it by `win.id`, which is
  where "exactly once per pattern instance" is kept. The first call after mounting seeds silently,
  so a resumed session shows its wins without re-announcing them. `cellStateFor` is exported and is
  the twin of `state.cellStateFor` (§9); the runner asserts the two agree.
- Animations `flip` / `zoom` / `fade` are CSS classes gated on `prefersReducedMotion()`.
- Reveal handles slide mechanics only. The board is our DOM inside one slide. The markdown plugin
  is never imported — it is not in the repo (delta D4).

---

## 9. `js/state.js` — remembers

Imports: `schemas` only. Never `validator` (see §2), never touches the DOM.

```js
export const STORAGE_PREFIX  // 'qbe.session.'
export const APP_VERSION     // delta D6, written into every state object

export const STATE_SCHEMA_VERSION                              // 1 (spec §4.4, frozen)

export async function hashContent(text: string) -> Result<string>   // SHA-256 hex, crypto.subtle
export function sessionFileId(gameHash: string) -> string
export function newSession({ bundle, gameHash, teams, bonusCells }) -> CleanedState
export function adopt(cleanedState, opts = {}) -> Result<CleanedState>  // caller MUST pass validator output
export function current() -> CleanedState | null
export function update(mutator: (draft) => void) -> Result<CleanedState>
export function subscribe(listener: (state) => void) -> () => void
export function listSessions() -> SessionSummary[]            // newest updatedAt first
export function loadSession(gameHash) -> Result<RawDocument>  // a raw document, NOT a session
export function discardSession(gameHash) -> void
export function pruneToCap() -> number                        // count removed; cap LIMITS.maxSessions
export function exportPayload() -> { filename: string, json: string } | null
export function exportFilename(state) -> string
export function setCellState(cellKey, nextState) -> Result<CleanedState>
export function setTeams(names: string[]) -> Result<CleanedState>
export function adjustScore({ bundle, teamIndex, delta }) -> Result<CleanedState>
export function cellAward({ bundle, session, cellKey }) -> number
export function cryptoRandomInt(n: number) -> number          // CSPRNG, rejection-sampled
export function pickBonusCells({ bundle, count, randomInt = cryptoRandomInt }) -> string[]
export function __resetForTests() -> void                     // test seam; never called by app.js
```

Corrected against the shipped exports. Three of these were **wrong** in a way that silently changed
behaviour rather than failing loudly, which is why this section is worth keeping honest:
`hashContent` returns a Result and not a bare promise of a string; `loadSession` returns a RAW
DOCUMENT so the caller is forced back through `validator.validateState` (a stored session is
untrusted input); and `pickBonusCells` takes `randomInt`, not `random` — a test written from the old
signature passes a `random` the function ignores, keeps the CSPRNG, and is green and
non-deterministic at the same time.

- **The v2.0 seam (spec §4.4).** `current()` returns one plain, JSON-serializable object with no
  functions, no `Map`, no `Date` instances, no class instances, and no reference into
  `CleanedBundle`. Cloud sync in v2.0 replaces `localStorage` in `update`/`loadSession` and
  nothing else changes. Any non-serializable value entering state is a defect.
- `update(mutator)` applies the mutator to a **copy**, sets `updatedAt` to a fresh UTC ISO-8601
  string, persists, then notifies subscribers. It returns the new state. On
  `QuotaExceededError`: prune the oldest session and retry **once**; on a second failure return
  a `ValidationFailure`-shaped result so `app.js` can route to the error screen rather than
  silently losing a game in progress (plan Q13).
- `adopt()` exists so `state` never validates and `validator` never persists. It re-checks only
  cheap invariants (a `schemaVersion` this build knows, `gameHash` matching the loaded game) and
  is documented as callable **only** by `app.js`, only with a `validator.validateState()` result.
- `pickBonusCells` draws uniformly from `bundle.resolved.randomizableKeys` (already excluding
  `lockValue`, spec §8) through the injectable `randomInt`, which defaults to `cryptoRandomInt` —
  `crypto.getRandomValues` with rejection sampling, so there is no modulo bias. New session
  reshuffles; resume keeps the stored picks.
- `adopt` takes an `opts` second argument (`app.js` passes `{ expectGameHash, file }`) so a resumed
  or imported session can be refused with a message naming the file it came from.
- `listSessions` bounds every field it projects, because it is the ONE read path from storage to the
  screen that does not run `validator.validateState` — an entry breaking the state schema's
  `maxLabelChars` is not listed rather than drawn. localStorage is shared by every page on the
  origin, so a stored title is untrusted input of untrusted length.
- **F8 additions (win detection).** `completedPatterns({ bundle, session }) -> Win[]` and
  `cellStateFor(bundle, session, cellKey) -> string`. `completedPatterns` is PURE — no storage, no
  DOM, and nothing remembered between calls — and returns every currently-complete pattern instance
  as `{ id: 'row:2', pattern, index, cells }`, driven by `gametype.patterns` and finishing on
  `resolved.terminalState`, never on the literal `"marked"`. **A line the board's geometry does not
  contain is never reported:** diagonals only on a square board, and (since the Phase 4 review) rows
  only when they span every column and columns only when they span every row. `uniformRows` defaults
  to `false` and nothing ties it to `winCondition: "pattern-complete"`, so on a ragged board the row
  builder used to assemble a "complete" row out of whichever squares happened to exist at that index
  — one mark announcing "Row 5" to a room. It lives here rather than in a seventh module because the import graph (§2) allows only
  `state` to hold a pure rule that reads a session, and because `adjustScore` / `cellAward` /
  `pickBonusCells` — the other rules that read one — are already here. Wins are NOT a state field:
  they are derived from `cellStates`, which is persisted, so a resume reconstructs them exactly and
  the state schema (v1, frozen — §3.2) needs no new key. `cellStateFor` duplicates
  `renderer.cellStateFor` because §2 forbids either module importing the other; the runner asserts
  the two agree on every cell of every shipped board.
- `SessionSummary = { gameHash, gameTitle, updatedAt, teamCount }` — enough for the resume screen
  and nothing more, so listing sessions never deserializes 10 full boards.

---

## 10. `js/app.js` — sequence (pending delta D8)

Imports everything; exported surface is deliberately tiny so `/tests/index.html` can drive it.

```js
export async function boot({ search = window.location.search, mounts }) -> Promise<void>
export async function loadAndValidate(search) -> Promise<Result<CleanedBundle>>
```

`boot` sequence, and the only place the stages are strung together:

1. `loader.resolveGameParam` → on failure, `errors.renderErrorScreen` and **stop**.
2. `loader.fetchContentBundle` → on failure, error screen, stop.
3. `validator.validateBundle` → on failure, error screen, stop. (No partial render, ever.)
4. `state.hashContent(rawBundle.content.text)`; `state.listSessions()` → resume screen if a
   session matches the hash, else `renderer.renderTeamSetup`.
5. `renderer.mountTheme(bundle.resolved.themeFile)`; `renderer.initReveal`.
6. `state.newSession(...)` or `state.loadSession(...)`; new sessions get
   `state.pickBonusCells(...)`.
7. `renderer.renderBoard({ bundle, session, mount, handlers })`, handlers wired to
   `state.update(...)`.
8. `state.subscribe(s => { renderer.updateBoard(view, {bundle, session:s}); renderer.updateScorePanel(panel, {session:s}); })`.

Import/export (F10): `onExport` → `state.exportPayload()` → `app` creates the Blob and the
`<a download>`; `onImport(file)` → `file.text()` → `JSON.parse` guarded by
`errors.syntaxFailure` → `validator.validateState({raw, bundle})` → `state.adopt(...)`. Untrusted
input never reaches `state` unvalidated.

---

## 11. Definition of done for this document (A2 charter)

> "A reader can name what each module does from its exports alone."

Test it: cover §1, read only §§3–9's export blocks, and write down each module's job. If any
export makes you look up its prose to know which module it belongs in, the boundary is wrong and
this document — not the code — is what gets fixed first.

-----
2026-08-17

#AI/Claude
