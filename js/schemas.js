// SPDX-License-Identifier: AGPL-3.0-or-later
//
// schemas.js — Quiz Board Engine
//
// ROLE (CLAUDE.md module boundaries): `schemas` DECLARES. It holds no logic, performs no
// I/O, renders nothing, and imports nothing. It is a leaf module: every other module may
// import it, it imports none of them.
//
// WHY HAND-WRITTEN SCHEMAS (plan Q5): AJV and every JSON Schema library need either a
// bundler or a CDN. Both are forbidden by spec §2.2 / §2.3. So the schema *vocabulary*
// below is a small, closed set of plain-object node descriptors that a hand-written walker
// in validator.js can interpret in ~200 lines.
//
// WHY VERSION-KEYED (plan Q5): schemas are keyed by `schemaVersion`, so `content[1]` is the
// v1 content schema. Shipping a v2 means ADDING key 2. Key 1 is append-only history and is
// never edited again — a v1 file authored in 2026 must still validate identically in 2030.
//
// WHY EVERY NODE CARRIES `expected` AND `hint` (spec §7): the error screen is a first-class
// feature. Spec §7 requires, for EVERY failure, the file, the JSON path, an
// expected-vs-found pair, and a plain-language hint. A validator cannot invent good prose at
// runtime, so each node states its own `expected` phrase up front, and names a `hint` CLASS
// (an identifier only — the human copy lives in errors.js, because `errors` explains).
//
// PATHS: the walker concatenates a `pathSegment` per step, producing exactly the shape spec
// §7 names: `board.columns[2].cells[1].value`. Object fields append `.<key>`, array items
// append `[<index>]`, map entries append `["<key>"]`.

// ---------------------------------------------------------------------------
// Node vocabulary — the complete closed set. validator.js must handle exactly
// these `kind` values and no others; an unrecognized kind is a programmer error
// in this file, not a data error, and validator.js should throw on it loudly.
// ---------------------------------------------------------------------------
//
//   { kind: "object",  fields: {k: node}, required: [k], stripUnknown: true,
//                      requiredWhen: [ {when: {field, equals}, require: [k]} ] }
//   { kind: "array",   items: node, minItems, maxItems }
//   { kind: "string",  minLength, maxLength, pattern, enum }
//   { kind: "integer", min, max }
//   { kind: "number",  min, max }
//   { kind: "boolean" }
//   { kind: "literal", value }                 // exact match (schemaVersion pinning)
//   { kind: "map",     keyPattern, values: node, maxEntries }
//   { kind: "orderedSubset", of: [...], minItems, maxItems }  // subset preserving `of` order
//   { kind: "subset",  of: [...], minItems, maxItems }        // subset, any order, no dupes
//
// Every node may additionally carry:
//   expected  — REQUIRED. Human phrase completing "expected ___". Never omit it.
//   hint      — optional hint-class identifier from HINT_CLASSES (errors.js owns the copy).
//   resolves  — optional cross-reference target from RESOLVES (contract stage, not structural).
//   note      — optional developer note. Never shown to users.

/** Hint-class identifiers. schemas.js NAMES the class; errors.js writes the prose. */
export const HINT_CLASSES = Object.freeze([
  'missing-required-field',
  'wrong-type',
  'unknown-value', // value outside an enum / subset source set
  'out-of-range', // number outside min/max
  'too-long', // string over maxLength
  'too-many-items', // array over maxItems
  'too-few-items', // array under minItems
  'bad-key-format', // map key failed keyPattern
  'bad-name-format', // identifier-ish string failed pattern
  'unsupported-schema-version', // §4.1: refuse, never best-effort
  'unresolved-reference', // gameType / theme / animation not found
  // A rejected `?game=` value. Its own class because the reader's problem is in the address bar,
  // and the unresolved-reference copy is entirely about gameType / theme / animation — three fields
  // the person following a bad link never touched.
  'bad-game-param',
  'file-too-large', // §5 1 MB cap
  'fetch-failed', // 404 or network failure IS a validation failure (§5)
  'ragged-grid', // gridConstraints.uniformRows violated
  'ladder-short', // plan Q8: ladder shorter than cells, cell has no `value`
  'lifecycle-order', // cellLifecycle not in canonical order
  'syntax', // JSON.parse threw; errors.js own scanner locates it (plan Q6)
]);

/** Cross-reference targets resolved at the CONTRACT stage (spec §5 stage 2). */
export const RESOLVES = Object.freeze({
  GAMETYPE: 'gametype-file', // gameType -> /gametypes/<id>.json must fetch and validate
  THEME: 'themes-manifest', // theme -> key in /themes/themes.json (spec §4.3, §6.4)
  ANIMATION: 'animation-set', // animation -> ANIMATIONS below
});

// ---------------------------------------------------------------------------
// Closed value sets (spec §4.2 table)
// ---------------------------------------------------------------------------

/** Built-in animation set (spec §10 F5). Content naming anything else fails validation. */
export const ANIMATIONS = Object.freeze(['flip', 'zoom', 'fade']);

export const ENUMS = Object.freeze({
  layout: Object.freeze(['grid', 'ranked-list']),
  cellLifecycle: Object.freeze(['hidden', 'revealed', 'answered', 'marked']),
  scoringModel: Object.freeze(['accumulate', 'none']),
  winCondition: Object.freeze(['highest-score', 'pattern-complete', 'none']),
  patterns: Object.freeze(['row', 'column', 'diagonal', 'full-card']),
  animation: ANIMATIONS,
});

/**
 * VALIDATOR-OWNED WHITELIST (spec §4.2, final table row).
 * A game-type config may demand cell fields ONLY from this set. This is a security
 * boundary, not a convenience: if a config could name arbitrary field names, a config
 * would be defining behavior instead of selecting it (spec §6.1). Frozen, and the
 * gametype schema references it as the `of` set of a `subset` node so the walker enforces
 * it structurally — there is no code path where a config widens it.
 */
export const CELL_FIELD_WHITELIST = Object.freeze(['prompt', 'answer', 'value']);

// ---------------------------------------------------------------------------
// Resource limits (spec §5) — one source of truth, imported by loader + validator + README
//
// THIS IS THE v1 LIMIT SET, and v1's forever. Every v1 node below interpolates these numbers into
// its `expected` phrase, so editing one here rewrites the contract of files authored years ago —
// which is exactly what version keying exists to prevent (module-contracts §3.2). A v2 that needs
// different numbers gets its own `LIMITS_V2`.
// ---------------------------------------------------------------------------
export const LIMITS = Object.freeze({
  contentFileBytes: 1048576, // 1 MB, measured on the raw response text before parse
  maxColumns: 12,
  maxCellsPerColumn: 12,
  maxPromptChars: 2000,
  maxAnswerChars: 2000,
  maxLabelChars: 80, // column labels, game title, team names — the "label class"
  maxTeams: 12,
  maxSessions: 10, // spec §4.4 retention cap, prune oldest silently
});

// ---------------------------------------------------------------------------
// Name patterns. These keep identifiers filename-safe and path-safe, which matters because
// `gameType` becomes a path under /gametypes/ and `theme` selects a manifest key. Rejecting
// dots, slashes and percent-escapes here is defense in depth behind the loader's own
// same-origin guard (spec §6.3).
// ---------------------------------------------------------------------------
export const PATTERNS = Object.freeze({
  gameTypeId: /^[a-z0-9][a-z0-9-]{0,31}$/,
  themeName: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/,
  themeFile: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.css$/,
  // D12 — the game manifest. `gameName` is the label the picker SHOWS, so it is deliberately
  // laxer than `gameTypeId` (mixed case, underscores) while still refusing anything that could
  // read as a path. `gameFile` is the same shape as `themeFile` with a different extension: a
  // bare filename, resolved under /games/ and then re-checked by `loader.resolveGameParam`.
  gameName: /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/,
  gameFile: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/,
  cellKey: /^\d+:\d+$/, // plan Q7: "<columnIndex>:<rowIndex>", both zero-based, column first
  // `D15`. The strikes map is keyed by COLUMN alone — strikes belong to a round, and a round is
  // a column (`D17`). Deliberately not `cellKey`: a strike is not attached to any one answer.
  columnKey: /^\d+$/,
  sha256Hex: /^[0-9a-f]{64}$/,
  iso8601Utc: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
});

// ---------------------------------------------------------------------------
// Small node builders. Sugar only — they return plain frozen objects, so a reader can
// still see the literal schema shape in a debugger.
// ---------------------------------------------------------------------------
const str = (o) => Object.freeze({ kind: 'string', ...o });
const int = (o) => Object.freeze({ kind: 'integer', ...o });
const num = (o) => Object.freeze({ kind: 'number', ...o });
const bool = (expected, hint) => Object.freeze({ kind: 'boolean', expected, hint: hint || 'wrong-type' });
const arr = (o) => Object.freeze({ kind: 'array', ...o });
const obj = (o) => Object.freeze({ kind: 'object', stripUnknown: true, required: Object.freeze([]), ...o });

/**
 * `schemaVersion` node. A LITERAL, not an integer range — spec §4.1: "Renderer refuses
 * versions it does not implement — no best-effort parsing." A file claiming version 2 must
 * fail loudly against the v1 schema rather than be coerced.
 */
const schemaVersionLiteral = (v) =>
  Object.freeze({
    kind: 'literal',
    value: v,
    expected: `the integer ${v}`,
    hint: 'unsupported-schema-version',
  });

// ===========================================================================
// v1 — CONTENT (/games/*.json) — spec §4.1
// ===========================================================================

const cellFlagsV1 = obj({
  expected: 'an object of cell flags',
  fields: Object.freeze({
    // "Cell is ELIGIBLE for bonus selection. The app picks winners; content never
    // pre-marks them." (spec §4.1) — hence there is no `isBonus` field at all.
    randomizable: bool('true or false'),
    lockValue: bool('true or false'),
    preMarked: bool('true or false'),
  }),
});

/**
 * A cell. NOTE the deliberate absence of a `required` list: structurally every cell field
 * is optional. Which fields a cell MUST carry is decided at the contract stage by its
 * game-type's `requiredCellFields` (spec §5 stage 2). Putting `prompt` in `required` here
 * would break bingo, whose cells need no prompt.
 */
const cellV1 = obj({
  expected: 'a cell object',
  fields: Object.freeze({
    prompt: str({
      maxLength: LIMITS.maxPromptChars,
      expected: `a string of at most ${LIMITS.maxPromptChars} characters`,
      hint: 'too-long',
    }),
    answer: str({
      maxLength: LIMITS.maxAnswerChars,
      expected: `a string of at most ${LIMITS.maxAnswerChars} characters`,
      hint: 'too-long',
    }),
    value: int({
      min: -1000000,
      max: 1000000,
      expected: 'a whole number (per-cell point value; it overrides valueLadder)',
      hint: 'wrong-type',
    }),
    flags: cellFlagsV1,
  }),
});

const columnV1 = obj({
  expected: 'a board column object',
  required: Object.freeze(['label', 'cells']),
  fields: Object.freeze({
    label: str({
      minLength: 1,
      maxLength: LIMITS.maxLabelChars,
      expected: `a non-empty string of at most ${LIMITS.maxLabelChars} characters`,
      hint: 'too-long',
    }),
    // Optional per-column ladder applied by array position (plan Q8: cells[i] takes
    // valueLadder[i]; a per-cell `value` always wins). A ladder shorter than the cell list,
    // where the uncovered cell has no `value`, is a CONTRACT failure (hint `ladder-short`),
    // because a board with an invisible missing point value is exactly what §7 exists to
    // prevent. That check cannot live in a structural node — see CROSS_CHECKS.
    valueLadder: arr({
      minItems: 1,
      maxItems: LIMITS.maxCellsPerColumn,
      expected: `an array of 1 to ${LIMITS.maxCellsPerColumn} numbers`,
      hint: 'too-many-items',
      items: num({ min: -1000000, max: 1000000, expected: 'a number', hint: 'wrong-type' }),
    }),
    cells: arr({
      minItems: 1,
      maxItems: LIMITS.maxCellsPerColumn,
      expected: `an array of 1 to ${LIMITS.maxCellsPerColumn} cells`,
      hint: 'too-many-items',
      items: cellV1,
    }),
  }),
});

const contentV1 = obj({
  expected: 'the content file to be a JSON object',
  required: Object.freeze(['schemaVersion', 'title', 'gameType', 'board']),
  fields: Object.freeze({
    schemaVersion: schemaVersionLiteral(1),
    title: str({
      minLength: 1,
      maxLength: LIMITS.maxLabelChars,
      expected: `a non-empty string of at most ${LIMITS.maxLabelChars} characters`,
      hint: 'too-long',
    }),
    gameType: str({
      pattern: PATTERNS.gameTypeId,
      expected: 'a lowercase game-type id such as "jeopardy" (letters, digits, hyphens)',
      hint: 'bad-name-format',
      resolves: RESOLVES.GAMETYPE,
    }),
    // Optional. Absent means DEFAULTS.theme. Present-but-unknown is a validation error
    // (spec §4.1) — themes load only via the manifest (§6.4).
    theme: str({
      pattern: PATTERNS.themeName,
      expected: 'the name of a theme listed in /themes/themes.json',
      hint: 'unresolved-reference',
      resolves: RESOLVES.THEME,
    }),
    animation: str({
      enum: ANIMATIONS,
      expected: `one of ${ANIMATIONS.map((a) => `"${a}"`).join(', ')}`,
      hint: 'unknown-value',
      resolves: RESOLVES.ANIMATION,
    }),
    board: obj({
      expected: 'a board object',
      required: Object.freeze(['columns']),
      fields: Object.freeze({
        // Grid size is emergent (spec §4.1): the columns you declare are the board.
        columns: arr({
          minItems: 1,
          maxItems: LIMITS.maxColumns,
          expected: `an array of 1 to ${LIMITS.maxColumns} columns`,
          hint: 'too-many-items',
          items: columnV1,
        }),
      }),
    }),
  }),
});

// ===========================================================================
// v1 — GAME-TYPE CONFIG (/gametypes/*.json) — spec §4.2
// "Every field is an enum, boolean, or number selecting behavior the renderer already
//  implements. Configs SELECT behaviors; they never define them."
// There is intentionally no field anywhere below whose value is code, markup, or a URL.
// ===========================================================================

const gametypeV1 = obj({
  expected: 'the game-type file to be a JSON object',
  required: Object.freeze(['schemaVersion', 'id', 'layout', 'cellLifecycle', 'scoring', 'winCondition', 'requiredCellFields']),
  // `patterns` is meaningless unless the win condition needs it, and REQUIRED when it does —
  // a pattern-complete game with no pattern list can never be won.
  requiredWhen: Object.freeze([
    Object.freeze({
      when: Object.freeze({ field: 'winCondition', equals: 'pattern-complete' }),
      require: Object.freeze(['patterns']),
    }),
  ]),
  fields: Object.freeze({
    schemaVersion: schemaVersionLiteral(1),
    id: str({
      pattern: PATTERNS.gameTypeId,
      expected: 'a lowercase id matching this file\'s name, e.g. "jeopardy"',
      hint: 'bad-name-format',
    }),
    layout: str({
      enum: ENUMS.layout,
      expected: `one of ${ENUMS.layout.map((v) => `"${v}"`).join(', ')}`,
      hint: 'unknown-value',
    }),
    // ORDERED subset: the lifecycle is a progression, so ["answered","hidden"] is not a
    // reordering, it is a bug. The walker checks membership, no duplicates, AND that the
    // chosen states appear in the canonical order given by ENUMS.cellLifecycle.
    cellLifecycle: Object.freeze({
      kind: 'orderedSubset',
      of: ENUMS.cellLifecycle,
      minItems: 2,
      maxItems: ENUMS.cellLifecycle.length,
      expected: `an ordered subset of ${JSON.stringify(ENUMS.cellLifecycle)} with at least 2 states`,
      hint: 'lifecycle-order',
    }),
    scoring: obj({
      expected: 'a scoring object',
      required: Object.freeze(['model']),
      fields: Object.freeze({
        model: str({
          enum: ENUMS.scoringModel,
          expected: `one of ${ENUMS.scoringModel.map((v) => `"${v}"`).join(', ')}`,
          hint: 'unknown-value',
        }),
        allowNegative: bool('true or false'),
      }),
    }),
    winCondition: str({
      enum: ENUMS.winCondition,
      expected: `one of ${ENUMS.winCondition.map((v) => `"${v}"`).join(', ')}`,
      hint: 'unknown-value',
    }),
    patterns: Object.freeze({
      kind: 'subset',
      of: ENUMS.patterns,
      minItems: 1,
      maxItems: ENUMS.patterns.length,
      expected: `a non-empty subset of ${JSON.stringify(ENUMS.patterns)}`,
      hint: 'unknown-value',
    }),
    // Bonus economy lives in the game type, never in content (spec §4.2).
    bonus: obj({
      expected: 'a bonus object',
      fields: Object.freeze({
        count: int({ min: 0, max: LIMITS.maxColumns * LIMITS.maxCellsPerColumn, expected: 'a whole number of 0 or more', hint: 'out-of-range' }),
        multiplier: num({ min: 0, max: 100, expected: 'a number between 0 and 100', hint: 'out-of-range' }),
      }),
    }),
    // `D15`. Strikes are a GAME-TYPE economy, like bonus above and for the same reason (spec §4.2):
    // how many strikes a round allows is a property of the game, never of one board's content.
    //
    // ABSENT MEANS NO STRIKES AT ALL — jeopardy and bingo simply omit it, exactly as
    // `scoring.model: "none"` means no score bar rather than an empty one. That is why there is no
    // `count: 0` idiom here: absence is the switch, and `M10` is the mutation that proves a game
    // type without this block draws no strike surface.
    strikes: obj({
      expected: 'a strikes object',
      fields: Object.freeze({
        count: int({ min: 1, max: 10, expected: 'a whole number from 1 to 10', hint: 'out-of-range' }),
      }),
    }),
    gridConstraints: obj({
      expected: 'a gridConstraints object',
      fields: Object.freeze({
        // Bingo requires true; validation fails ragged bingo boards (spec §4.2). Enforced
        // at the contract stage — see CROSS_CHECKS.uniformRows.
        uniformRows: bool('true or false'),
      }),
    }),
    // THE WHITELIST GATE. `of` is CELL_FIELD_WHITELIST, so a config naming "script" or
    // "html" fails structurally with hint `unknown-value`. A config cannot widen this set.
    requiredCellFields: Object.freeze({
      kind: 'subset',
      of: CELL_FIELD_WHITELIST,
      minItems: 0,
      maxItems: CELL_FIELD_WHITELIST.length,
      expected: `a subset of ${JSON.stringify(CELL_FIELD_WHITELIST)} — no other field names are permitted`,
      hint: 'unknown-value',
    }),
  }),
});

// ===========================================================================
// v1 — THEMES MANIFEST (/themes/themes.json) — spec §4.3
// Only CSS files listed here ever load (§6.4). Values are bare filenames resolved under
// /themes/ — the pattern rejects slashes, dots-dots and absolute URLs so a manifest entry
// cannot point off-origin.
// ===========================================================================

const themesV1 = obj({
  expected: 'the themes manifest to be a JSON object',
  required: Object.freeze(['schemaVersion', 'themes']),
  fields: Object.freeze({
    schemaVersion: schemaVersionLiteral(1),
    themes: Object.freeze({
      kind: 'map',
      keyPattern: PATTERNS.themeName,
      maxEntries: 64,
      expected: 'an object mapping theme names to CSS filenames under /themes/',
      hint: 'bad-key-format',
      values: str({
        pattern: PATTERNS.themeFile,
        expected: 'a bare .css filename such as "midnight.css" (no paths, no URLs)',
        hint: 'bad-name-format',
      }),
    }),
  }),
});

// ===========================================================================
// v1 — GAME MANIFEST (/games/games.json) — delta D12
// The structural twin of the themes manifest above, and for the same reason: a static site
// has no directory listing, so the set of things a host may choose has to be DECLARED
// somewhere. Values are bare .json filenames resolved under /games/ — the pattern rejects
// slashes, `..` and absolute URLs, and `loader.resolveGameParam` checks the resolved path a
// second time before it is fetched. Two independent guards on the same rule (spec §6.3),
// because this is the one manifest whose values become a *fetch* rather than a stylesheet.
// ===========================================================================

const gamesV1 = obj({
  expected: 'the game manifest to be a JSON object',
  required: Object.freeze(['schemaVersion', 'games']),
  fields: Object.freeze({
    schemaVersion: schemaVersionLiteral(1),
    games: Object.freeze({
      kind: 'map',
      keyPattern: PATTERNS.gameName,
      maxEntries: 64,
      expected: 'an object mapping display names to content filenames under /games/',
      hint: 'bad-key-format',
      values: str({
        pattern: PATTERNS.gameFile,
        expected: 'a bare .json filename such as "demo.json" (no paths, no URLs)',
        hint: 'bad-name-format',
      }),
    }),
  }),
});

// ===========================================================================
// v1 — STATE (localStorage + export file) — spec §4.4
// THE V2.0 SEAM. State is ONE plain serializable object, so cloud sync later is a transport
// swap and nothing else. Imported state is untrusted input and is validated exactly like a
// content file (§4.4, §6.6).
// ===========================================================================

const teamV1 = obj({
  expected: 'a team object',
  required: Object.freeze(['name', 'score']),
  fields: Object.freeze({
    name: str({
      minLength: 1,
      maxLength: LIMITS.maxLabelChars,
      expected: `a non-empty string of at most ${LIMITS.maxLabelChars} characters`,
      hint: 'too-long',
    }),
    score: int({ min: -1000000, max: 1000000, expected: 'a whole number', hint: 'wrong-type' }),
  }),
});

const cellKeyList = (expected) =>
  arr({
    minItems: 0,
    maxItems: LIMITS.maxColumns * LIMITS.maxCellsPerColumn,
    expected,
    hint: 'too-many-items',
    items: str({
      pattern: PATTERNS.cellKey,
      expected: 'a cell key of the form "column:row", both zero-based, e.g. "2:3"',
      hint: 'bad-key-format',
    }),
  });

const stateV1 = obj({
  expected: 'the state file to be a JSON object',
  required: Object.freeze(['schemaVersion', 'gameHash', 'gameTitle', 'createdAt', 'updatedAt', 'teams', 'cellStates']),
  fields: Object.freeze({
    schemaVersion: schemaVersionLiteral(1),
    // Plan D6: purely diagnostic, written by state.js, IGNORED by the validator beyond this
    // type check. It turns "my export is broken" into a fixable bug report.
    appVersion: str({ maxLength: LIMITS.maxLabelChars, expected: 'a version string', hint: 'wrong-type' }),
    gameHash: str({
      pattern: PATTERNS.sha256Hex,
      expected: 'a 64-character lowercase hex SHA-256 of the content file',
      hint: 'bad-name-format',
    }),
    gameTitle: str({
      minLength: 1,
      maxLength: LIMITS.maxLabelChars,
      expected: `a non-empty string of at most ${LIMITS.maxLabelChars} characters`,
      hint: 'too-long',
    }),
    createdAt: str({ pattern: PATTERNS.iso8601Utc, expected: 'a UTC ISO-8601 timestamp such as "2026-08-16T20:00:00Z"', hint: 'bad-name-format' }),
    updatedAt: str({ pattern: PATTERNS.iso8601Utc, expected: 'a UTC ISO-8601 timestamp such as "2026-08-16T20:41:00Z"', hint: 'bad-name-format' }),
    teams: arr({
      minItems: 0,
      maxItems: LIMITS.maxTeams,
      expected: `an array of 0 to ${LIMITS.maxTeams} teams`,
      hint: 'too-many-items',
      items: teamV1,
    }),
    // Keys are "column:row" (plan Q7). Values are lifecycle state names from the FULL
    // canonical set; whether a given state is legal for THIS game is a contract check
    // against the game-type's own cellLifecycle, not a structural one.
    cellStates: Object.freeze({
      kind: 'map',
      keyPattern: PATTERNS.cellKey,
      maxEntries: LIMITS.maxColumns * LIMITS.maxCellsPerColumn,
      expected: 'an object whose keys are "column:row" (both zero-based) and whose values are cell states',
      hint: 'bad-key-format',
      values: str({
        enum: ENUMS.cellLifecycle,
        expected: `one of ${ENUMS.cellLifecycle.map((v) => `"${v}"`).join(', ')}`,
        hint: 'unknown-value',
      }),
    }),
    bonusCells: cellKeyList('an array of cell keys chosen by the app at session start'),
    // `D17`. WHICH ROUND IS ON SCREEN, and it is SESSION state rather than view state on purpose:
    // a ranked board shows one column at a time, and a host who reloads mid-show — a dropped
    // laptop lid, a browser crash, a projector replug — must come back to the round they were on,
    // not to Round 1 with the scores intact. That is the failure nobody finds until they are on
    // stage, and it is `M13`.
    //
    // Optional, and absent means Round 0. Every session written before D17 therefore keeps
    // working without a schemaVersion bump, which is the point of making it optional rather than
    // required: an existing saved game must not become an error screen because the app grew a
    // feature. Structurally it is only bounded by the column cap here; that it addresses a column
    // this BOARD actually has is a contract check (`CROSS_CHECKS.currentRoundExists`), because
    // only the content file knows how many columns there are.
    // `D15`. Strikes per round. Keys are column indices as strings, values are counts.
    //
    // The CAP is a contract check, not a structural one, for the same reason `currentRound`'s is:
    // the schema knows the column cap but not how many strikes THIS game type allows, and only the
    // game-type file carries that. `M9` is the mutation for the untrusted-input path — an imported
    // `{"0": 99}` must reach the error screen, never a board wearing 99 marks.
    strikes: Object.freeze({
      kind: 'map',
      keyPattern: PATTERNS.columnKey,
      maxEntries: LIMITS.maxColumns,
      expected: 'an object whose keys are column indices and whose values are strike counts',
      hint: 'bad-key-format',
      values: int({ min: 0, max: 10, expected: 'a whole number from 0 to 10', hint: 'out-of-range' }),
    }),
    currentRound: int({
      min: 0,
      max: LIMITS.maxColumns - 1,
      expected: `a whole number from 0 to ${LIMITS.maxColumns - 1}`,
      hint: 'out-of-range',
    }),
  }),
});

// ===========================================================================
// CONTRACT-STAGE CROSS-CHECKS (spec §5 stage 2)
// Declared here so the rules are readable in one place and testable by name; IMPLEMENTED in
// validator.js, because `validator` judges. Each entry names the hint class it raises so the
// error screen copy stays attached to a CLASS rather than to individual fields.
// ===========================================================================
export const CROSS_CHECKS = Object.freeze({
  requiredCellFields: Object.freeze({
    hint: 'missing-required-field',
    describe: 'Every cell must carry every field named in the game type\'s requiredCellFields.',
    pathShape: 'board.columns[<c>].cells[<r>].<field>',
  }),
  uniformRows: Object.freeze({
    hint: 'ragged-grid',
    describe: 'When gridConstraints.uniformRows is true, every column must have the same cell count.',
    pathShape: 'board.columns[<c>].cells',
  }),
  ladderCoverage: Object.freeze({
    hint: 'ladder-short',
    describe: 'A cell with no `value` must be covered by valueLadder at its own index (plan Q8).',
    pathShape: 'board.columns[<c>].cells[<r>].value',
  }),
  gameTypeExists: Object.freeze({
    hint: 'unresolved-reference',
    describe: 'gameType must name a file in /gametypes/ that fetches and validates; a 404 is a validation failure.',
    pathShape: 'gameType',
  }),
  gameTypeIdMatches: Object.freeze({
    hint: 'unresolved-reference',
    describe: 'The game-type file\'s `id` must equal the gameType named by the content file.',
    pathShape: 'id',
  }),
  themeExists: Object.freeze({
    hint: 'unresolved-reference',
    describe: 'theme must be a key in /themes/themes.json. Nothing else ever loads (spec §6.4).',
    pathShape: 'theme',
  }),
  animationExists: Object.freeze({
    hint: 'unresolved-reference',
    describe: 'animation must be one of the built-in set: flip, zoom, fade.',
    pathShape: 'animation',
  }),
  stateCellStatesInLifecycle: Object.freeze({
    hint: 'unknown-value',
    describe: 'Each cellStates value must be a state this game type\'s cellLifecycle contains.',
    pathShape: 'cellStates["<c>:<r>"]',
  }),
  stateCellKeysInBounds: Object.freeze({
    hint: 'out-of-range',
    describe: 'Each cellStates / bonusCells key must address a cell that exists on the board.',
    pathShape: 'cellStates["<c>:<r>"]',
  }),
  // `D17`. The structural stage caps `currentRound` at the COLUMN CAP, which is all a schema can
  // know; that it addresses a column THIS board has is a contract question, because only the
  // content file carries the count. Imported state is untrusted input (CLAUDE.md), and a session
  // claiming round 7 of a three-round board must reach the error screen rather than a blank board
  // — with one round on screen at a time, an out-of-range round renders NOTHING, which reads as a
  // broken app rather than as bad data.
  // `D15`. Two questions the schema cannot answer alone: does this column exist on THIS board, and
  // does this count fit the game type's own `strikes.count`? Both need a file the state does not
  // carry, so both live here.
  stateStrikesInBounds: Object.freeze({
    hint: 'out-of-range',
    describe: 'Each strikes key must address a column on the board, and each value must not exceed the game type\'s strikes.count.',
    pathShape: 'strikes["<c>"]',
  }),
  stateCurrentRoundInBounds: Object.freeze({
    hint: 'out-of-range',
    describe: 'currentRound must address a column that exists on the board.',
    pathShape: 'currentRound',
  }),
});

/** Defaults applied by the validator when an optional field is absent. */
export const DEFAULTS = Object.freeze({
  theme: 'default',
  animation: 'fade',
  allowNegative: false,
  uniformRows: false,
  bonus: Object.freeze({ count: 0, multiplier: 1 }),
  flags: Object.freeze({ randomizable: false, lockValue: false, preMarked: false }),
});

/**
 * `"_note"` is the comment mechanism (spec §2.4). It is legal at every object level and is
 * STRIPPED, not rejected — as are all unknown keys, so the renderer only ever receives a
 * cleaned object (spec §5 stage 1).
 */
export const NOTE_KEY = '_note';

// ---------------------------------------------------------------------------
// THE EXPORT. Keyed by document kind, then by schemaVersion.
// schemas.content[1] is the v1 content schema. Adding v2 means adding key 2 — never editing 1.
// ---------------------------------------------------------------------------
export const schemas = Object.freeze({
  content: Object.freeze({ 1: contentV1 }),
  gametype: Object.freeze({ 1: gametypeV1 }),
  themes: Object.freeze({ 1: themesV1 }),
  games: Object.freeze({ 1: gamesV1 }),
  state: Object.freeze({ 1: stateV1 }),
});

/** Document kinds, for loader/validator call sites that want a constant instead of a string. */
export const KINDS = Object.freeze({
  CONTENT: 'content',
  GAMETYPE: 'gametype',
  THEMES: 'themes',
  GAMES: 'games',
  STATE: 'state',
});

/** Versions this build implements, per kind. Ascending. */
export function supportedVersions(kind) {
  const table = schemas[kind];
  if (!table) return [];
  return Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Look up a schema. Returns the node, or null when the kind is unknown or the version is
 * one this build does not implement — the caller then raises `unsupported-schema-version`
 * rather than attempting a best-effort parse (spec §4.1).
 */
export function getSchema(kind, version) {
  const table = schemas[kind];
  if (!table) return null;
  return Object.prototype.hasOwnProperty.call(table, version) ? table[version] : null;
}

export default schemas;
