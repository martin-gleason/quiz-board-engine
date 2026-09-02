// SPDX-License-Identifier: AGPL-3.0-or-later
//
// validator.js — Quiz Board Engine
//
// ROLE (CLAUDE.md module boundaries): `validator` JUDGES. It walks a document against the
// version-keyed schema in `schemas.js`, cross-checks content against its game type, and returns
// either a CLEANED object or a list of failures. It never fetches (that is `loader`), never
// persists (that is `state`), never draws (that is `renderer`), and never words an error (that is
// `errors`).
//
// Imports: `schemas`, `errors`. Never `loader` / `state` / `renderer` — module-contracts §2. That
// restriction is what lets /tests/index.html validate a fixture from a string literal.
//
// TWO STAGES, STRICTLY SEQUENTIAL, NO PARTIAL RENDER EVER (spec §5, CLAUDE.md invariant):
//
//   structural — every document against the embedded schema for its own schemaVersion. Unknown
//                keys and every "_note" are stripped, so the renderer only ever receives a
//                cleaned object built fresh by this module.
//   contract   — content cross-checked against its game type: required cell fields, grid
//                constraints, theme/animation resolution, value-ladder coverage.
//
// The contract stage runs only when the structural stage found nothing. Judging cross-references
// against a document whose shape is unknown produces cascades of nonsense failures, and a screen
// with forty failures on it is as unusable as a screen with none.
//
// FAILURE COLLECTION: we collect everything cheap at the stage we are in, because the person
// fixing the file wants every problem in one pass, not a game of whack-a-mole (module-contracts
// §0.1). The RENDER decision remains all-or-nothing: one failure anywhere and nothing is drawn.
//
// PERFORMANCE: a maxed-out board is 12 x 12 = 144 cells. The structural walk touches each cell
// once; the contract stage touches each cell once more and derives every list the renderer and the
// state layer need in that same pass. No nested scans, no repeated Array#indexOf over cell keys
// (membership tests go through a Set), and path strings are built only at failure time.

import {
  getSchema,
  supportedVersions,
  KINDS,
  DEFAULTS,
  NOTE_KEY,
  ANIMATIONS,
} from './schemas.js';
import { failure, describeValue, pathFromSegments } from './errors.js';

// =============================================================================================
// SECTION 0 — small shared helpers
// =============================================================================================

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function has(obj, k) {
  return Object.prototype.hasOwnProperty.call(obj, k);
}

/**
 * Build a failure for the current walk position.
 *
 * `ctx` carries { file, kind, stage }; `segments` is the live path array. `pathFromSegments`
 * renders it immediately, so the shared, mutating segments array is safe to reuse.
 */
function fail(ctx, segments, expected, found, hint) {
  ctx.failures.push(
    failure({
      file: ctx.file,
      kind: ctx.kind,
      stage: ctx.stage,
      path: pathFromSegments(segments),
      expected,
      found,
      hint,
    }),
  );
}

/** Deep-freeze. Applied once, to the finished CleanedBundle: the renderer must not be able to
 *  mutate game truth, and a frozen bundle turns "who changed this?" from a hunt into a TypeError. */
function deepFreeze(v) {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  Object.freeze(v);
  for (const k of Object.keys(v)) deepFreeze(v[k]);
  return v;
}

// =============================================================================================
// SECTION 1 — the schema walker
// =============================================================================================
//
// One function per node `kind` in the closed vocabulary declared by schemas.js. An unrecognised
// kind THROWS: that is a bug in schemas.js, not bad user data, and module-contracts §0.1 reserves
// exceptions for exactly that case. Returning a failure instead would let a typo in a schema
// masquerade as a broken game file forever.
//
// Each handler returns its CLEANED value, or `undefined` when the value was unusable. Cleaning is
// constructive: we build a new object from the fields the schema names, so unknown keys and every
// "_note" (spec §2.4) are dropped by never being copied — not by being deleted afterwards. A
// delete-based strip leaks whatever it forgets; a copy-based strip cannot.

function walkNode(node, value, segments, ctx) {
  switch (node.kind) {
    case 'object':
      return walkObject(node, value, segments, ctx);
    case 'array':
      return walkArray(node, value, segments, ctx);
    case 'string':
      return walkString(node, value, segments, ctx);
    case 'integer':
      return walkInteger(node, value, segments, ctx);
    case 'number':
      return walkNumber(node, value, segments, ctx);
    case 'boolean':
      return walkBoolean(node, value, segments, ctx);
    case 'literal':
      return walkLiteral(node, value, segments, ctx);
    case 'map':
      return walkMap(node, value, segments, ctx);
    case 'subset':
      return walkSubset(node, value, segments, ctx, { ordered: false });
    case 'orderedSubset':
      return walkSubset(node, value, segments, ctx, { ordered: true });
    default:
      throw new Error('validator: unknown schema node kind "' + String(node && node.kind) + '" at ' + pathFromSegments(segments));
  }
}

function walkObject(node, value, segments, ctx) {
  if (!isPlainObject(value)) {
    fail(ctx, segments, node.expected, describeValue(value), 'wrong-type');
    return undefined;
  }

  // Required fields first, so "you forgot the title" is reported before anything derived from it.
  for (const k of node.required || []) {
    if (value[k] === undefined) {
      segments.push({ t: 'field', k });
      const child = node.fields[k];
      fail(ctx, segments, child ? child.expected : 'this field to be present', describeValue(undefined), 'missing-required-field');
      segments.pop();
    }
  }

  // Conditionally required fields: `patterns` is meaningless unless winCondition is
  // 'pattern-complete', and mandatory when it is — a pattern-complete game with no pattern list
  // can never be won, which is a board that looks fine and cannot end.
  for (const rule of node.requiredWhen || []) {
    if (value[rule.when.field] !== rule.when.equals) continue;
    for (const k of rule.require) {
      if (value[k] === undefined) {
        segments.push({ t: 'field', k });
        const child = node.fields[k];
        fail(
          ctx,
          segments,
          (child ? child.expected : 'this field to be present') +
            ' (required because ' + rule.when.field + ' is "' + rule.when.equals + '")',
          describeValue(undefined),
          'missing-required-field',
        );
        segments.pop();
      }
    }
  }

  const clean = {};
  for (const k of Object.keys(node.fields)) {
    if (!has(value, k) || value[k] === undefined) continue; // absent optional: defaults come later
    segments.push({ t: 'field', k });
    const cleaned = walkNode(node.fields[k], value[k], segments, ctx);
    segments.pop();
    if (cleaned !== undefined) clean[k] = cleaned;
  }

  // EVERY v1 NODE STRIPS UNKNOWN KEYS, and there is no opt-out branch here on purpose. There used
  // to be one, for a hypothetical future `stripUnknown: false`, and it copied `value[k]` straight
  // out of `raw.data` — quietly breaking validateDocument's own guarantee that the cleaned object
  // shares no reference with the parsed source. A future schema that genuinely needs pass-through
  // has to implement its own copying, deliberately, at that point.
  return clean;
}

function walkArray(node, value, segments, ctx) {
  if (!Array.isArray(value)) {
    fail(ctx, segments, node.expected, describeValue(value), 'wrong-type');
    return undefined;
  }
  if (typeof node.minItems === 'number' && value.length < node.minItems) {
    fail(ctx, segments, node.expected, 'a list of ' + value.length + ' items', 'too-few-items');
  }
  if (typeof node.maxItems === 'number' && value.length > node.maxItems) {
    fail(ctx, segments, node.expected, 'a list of ' + value.length + ' items', 'too-many-items');
    // AND STOP. Walking the members after the count has already failed is how a 40 KB file turns
    // into 20,000 failures and 220,000 DOM nodes (measured): `"columns":[0,0,0,…]` reports
    // too-many-items once and then wrong-type per element. The count is fatal on its own, the list
    // has to be shortened whatever else is in it, and per-item detail adds nothing anyone can act
    // on. Note this is deliberately NOT done for minItems — a too-short list is short.
    return undefined;
  }
  const clean = [];
  for (let i = 0; i < value.length; i++) {
    segments.push({ t: 'index', i });
    const cleaned = walkNode(node.items, value[i], segments, ctx);
    segments.pop();
    if (cleaned !== undefined) clean.push(cleaned);
  }
  return clean;
}

function walkString(node, value, segments, ctx) {
  if (typeof value !== 'string') {
    // Type mismatch always reports 'wrong-type', overriding any node hint. A node whose hint is
    // 'too-long' still needs to say "this should be text" when handed a number — the hint has to
    // match the failure, not the field.
    fail(ctx, segments, node.expected, describeValue(value), 'wrong-type');
    return undefined;
  }
  let ok = true;
  if (typeof node.minLength === 'number' && value.length < node.minLength) {
    fail(ctx, segments, node.expected, value.length === 0 ? 'empty text ("")' : 'text of ' + value.length + ' characters', 'too-few-items');
    ok = false;
  }
  if (typeof node.maxLength === 'number' && value.length > node.maxLength) {
    fail(ctx, segments, node.expected, 'text of ' + value.length + ' characters', 'too-long');
    ok = false;
  }
  if (node.enum && node.enum.indexOf(value) === -1) {
    fail(ctx, segments, node.expected, describeValue(value), 'unknown-value');
    ok = false;
  }
  if (node.pattern && !node.pattern.test(value)) {
    // A pattern failure is a shape problem. Nodes whose hint describes their *reference* meaning
    // (theme -> 'unresolved-reference') would mislead here: the name is not merely unknown, it
    // could not be a name at all.
    const hint = node.hint === 'bad-key-format' ? 'bad-key-format' : 'bad-name-format';
    fail(ctx, segments, node.expected, describeValue(value), hint);
    ok = false;
  }
  return ok ? value : undefined;
}

function walkInteger(node, value, segments, ctx) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    fail(ctx, segments, node.expected, describeValue(value), 'wrong-type');
    return undefined;
  }
  return checkRange(node, value, segments, ctx);
}

function walkNumber(node, value, segments, ctx) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(ctx, segments, node.expected, describeValue(value), 'wrong-type');
    return undefined;
  }
  return checkRange(node, value, segments, ctx);
}

function checkRange(node, value, segments, ctx) {
  let ok = true;
  if (typeof node.min === 'number' && value < node.min) {
    fail(ctx, segments, node.expected, 'the number ' + value + ' (below the minimum of ' + node.min + ')', 'out-of-range');
    ok = false;
  }
  if (typeof node.max === 'number' && value > node.max) {
    fail(ctx, segments, node.expected, 'the number ' + value + ' (above the maximum of ' + node.max + ')', 'out-of-range');
    ok = false;
  }
  return ok ? value : undefined;
}

function walkBoolean(node, value, segments, ctx) {
  // STRICT. The string "true" is the single commonest JSON authoring mistake after the trailing
  // comma, and coercing it would make `"lockValue": "false"` silently lock a cell's value.
  if (value !== true && value !== false) {
    fail(ctx, segments, node.expected, describeValue(value), 'wrong-type');
    return undefined;
  }
  return value;
}

function walkLiteral(node, value, segments, ctx) {
  if (value !== node.value) {
    fail(ctx, segments, node.expected, describeValue(value), node.hint || 'wrong-type');
    return undefined;
  }
  return value;
}

function walkMap(node, value, segments, ctx) {
  if (!isPlainObject(value)) {
    fail(ctx, segments, node.expected, describeValue(value), 'wrong-type');
    return undefined;
  }
  const keys = Object.keys(value).filter((k) => k !== NOTE_KEY);
  if (typeof node.maxEntries === 'number' && keys.length > node.maxEntries) {
    fail(ctx, segments, node.expected, 'an object with ' + keys.length + ' entries (the limit is ' + node.maxEntries + ')', 'too-many-items');
    // AND STOP, for the reason given in walkArray. This one matters more: `cellStates` comes from a
    // STATE file, which is untrusted input (spec §4.4), and 200,000 bad keys measured at 200,006
    // failures carrying 29 MB of message text.
    return undefined;
  }
  const clean = {};
  for (const k of keys) {
    if (node.keyPattern && !node.keyPattern.test(k)) {
      // The offending key goes IN the path — cellStates["12:x"] — because in a map the key is the
      // only way to point at the problem.
      segments.push({ t: 'key', k });
      fail(ctx, segments, node.expected, 'the key ' + JSON.stringify(k), 'bad-key-format');
      segments.pop();
      continue;
    }
    segments.push({ t: 'key', k });
    const cleaned = walkNode(node.values, value[k], segments, ctx);
    segments.pop();
    if (cleaned !== undefined) clean[k] = cleaned;
  }
  return clean;
}

function walkSubset(node, value, segments, ctx, { ordered }) {
  if (!Array.isArray(value)) {
    fail(ctx, segments, node.expected, describeValue(value), 'wrong-type');
    return undefined;
  }
  let ok = true;
  if (typeof node.minItems === 'number' && value.length < node.minItems) {
    fail(ctx, segments, node.expected, 'a list of ' + value.length + ' items', 'too-few-items');
    ok = false;
  }
  if (typeof node.maxItems === 'number' && value.length > node.maxItems) {
    fail(ctx, segments, node.expected, 'a list of ' + value.length + ' items', 'too-many-items');
    // AND STOP, as in walkArray: `of` is never more than four values, so an over-long subset is
    // over-long by an unbounded amount and every extra entry would report itself.
    return undefined;
  }

  const seen = new Set();
  let lastRank = -1;
  for (let i = 0; i < value.length; i++) {
    const v = value[i];
    const rank = typeof v === 'string' ? node.of.indexOf(v) : -1;
    segments.push({ t: 'index', i });
    if (rank === -1) {
      fail(ctx, segments, node.expected, describeValue(v), 'unknown-value');
      ok = false;
    } else if (seen.has(v)) {
      fail(ctx, segments, node.expected, 'a repeat of ' + JSON.stringify(v), node.hint === 'lifecycle-order' ? 'lifecycle-order' : 'unknown-value');
      ok = false;
    } else if (ordered && rank < lastRank) {
      // An ordered subset is a PROGRESSION. ["answered","hidden"] is not a reordering, it is a
      // cell that would have to move backwards through its own lifecycle.
      fail(ctx, segments, node.expected, JSON.stringify(v) + ' listed after ' + JSON.stringify(node.of[lastRank]), 'lifecycle-order');
      ok = false;
    }
    segments.pop();
    if (rank !== -1) {
      seen.add(v);
      if (rank > lastRank) lastRank = rank;
    }
  }
  return ok ? value.slice() : undefined;
}

/**
 * Exported for the test runner (module-contracts §6): walk one node and get the failures back.
 * `ctx` needs { file, kind, stage } — the failures array is created here.
 *
 * NAMED FOR WHAT IT RETURNS. It was called `walk`, one letter from the internal `walkNode`, which
 * returns the CLEANED VALUE and pushes failures into ctx — the opposite contract. A caller who read
 * `walk(...)` and expected a cleaned object would get an array of failures instead.
 */
export function collectFailures(node, value, segments, ctx) {
  const inner = { file: ctx.file, kind: ctx.kind, stage: ctx.stage || 'structural', failures: [] };
  walkNode(node, value, Array.isArray(segments) ? segments.slice() : [], inner);
  return inner.failures;
}

// =============================================================================================
// SECTION 2 — defaults (module-contracts §6.3: "always present" fields)
// =============================================================================================
//
// Every optional field the renderer or the state layer reads is filled in here, once. The
// alternative — `bundle.gametype.bonus?.count ?? 0` scattered through four modules — is four
// chances to pick a different default, and the bug it produces (a board that scores differently
// than it displays) is invisible in review.

function applyContentDefaults(content) {
  if (content.theme === undefined) content.theme = DEFAULTS.theme;
  if (content.animation === undefined) content.animation = DEFAULTS.animation;
  const columns = (content.board && content.board.columns) || [];
  for (const col of columns) {
    for (const cell of col.cells || []) {
      const f = cell.flags || {};
      cell.flags = {
        randomizable: f.randomizable === undefined ? DEFAULTS.flags.randomizable : f.randomizable,
        lockValue: f.lockValue === undefined ? DEFAULTS.flags.lockValue : f.lockValue,
        preMarked: f.preMarked === undefined ? DEFAULTS.flags.preMarked : f.preMarked,
      };
    }
  }
  return content;
}

function applyGametypeDefaults(gt) {
  gt.scoring = gt.scoring || {};
  if (gt.scoring.allowNegative === undefined) gt.scoring.allowNegative = DEFAULTS.allowNegative;
  // `patterns` is [] unless the win condition needs it, so the renderer can iterate it blindly.
  if (!Array.isArray(gt.patterns)) gt.patterns = [];
  const bonus = gt.bonus || {};
  gt.bonus = {
    count: bonus.count === undefined ? DEFAULTS.bonus.count : bonus.count,
    multiplier: bonus.multiplier === undefined ? DEFAULTS.bonus.multiplier : bonus.multiplier,
  };
  const grid = gt.gridConstraints || {};
  gt.gridConstraints = { uniformRows: grid.uniformRows === undefined ? DEFAULTS.uniformRows : grid.uniformRows };
  if (!Array.isArray(gt.requiredCellFields)) gt.requiredCellFields = [];
  return gt;
}

function applyStateDefaults(st) {
  if (!Array.isArray(st.bonusCells)) st.bonusCells = [];
  if (!st.cellStates) st.cellStates = {};
  if (!Array.isArray(st.teams)) st.teams = [];
  return st;
}

// =============================================================================================
// SECTION 3 — validateDocument: the structural stage for one document
// =============================================================================================

/**
 * @param {{kind:string, raw:{path:string, kind:string, data:*}}} args
 * @returns {{ok:true,value:object} | {ok:false,failures:ValidationFailure[]}}
 *
 * The returned object is built FRESH — it shares no reference with `raw.data`, so no dirty
 * sub-object can leak through to the renderer, and no later mutation of the cleaned object can
 * write back into the parsed source. It is deliberately NOT frozen: `validateBundle` enriches
 * content cells, and `state.js` copies and mutates a cleaned state. Freezing happens once, on the
 * finished CleanedBundle.
 */
export function validateDocument({ kind, raw }) {
  const ctx = { file: raw.path, kind, stage: 'structural', failures: [] };

  if (!isPlainObject(raw.data)) {
    fail(ctx, [], 'this file to contain a JSON object beginning with "{"', describeValue(raw.data), 'wrong-type');
    return { ok: false, failures: ctx.failures };
  }

  // --- schemaVersion, before anything else ------------------------------------------------
  // Spec §4.1: "Renderer refuses versions it does not implement — no best-effort parsing."
  // Walking a v3 file against the v1 schema would produce a page of failures describing rules the
  // file was never written to follow, burying the one fact that matters: this app is too old.
  const version = raw.data.schemaVersion;
  if (version === undefined) {
    fail(ctx, [{ t: 'field', k: 'schemaVersion' }], 'the integer ' + supportedVersions(kind).join(' or '), describeValue(undefined), 'missing-required-field');
    return { ok: false, failures: ctx.failures };
  }
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    fail(ctx, [{ t: 'field', k: 'schemaVersion' }], 'a whole number such as 1, written without quotation marks', describeValue(version), 'wrong-type');
    return { ok: false, failures: ctx.failures };
  }

  const schema = getSchema(kind, version);
  if (!schema) {
    // getSchema returning null is the ONLY signal for an unimplemented version (module-contracts
    // §3). Nothing anywhere tries to guess.
    fail(
      ctx,
      [{ t: 'field', k: 'schemaVersion' }],
      'schemaVersion to be one of: ' + supportedVersions(kind).join(', '),
      describeValue(version),
      'unsupported-schema-version',
    );
    return { ok: false, failures: ctx.failures };
  }

  const clean = walkNode(schema, raw.data, [], ctx);
  if (ctx.failures.length > 0) return { ok: false, failures: ctx.failures };

  if (kind === KINDS.CONTENT) applyContentDefaults(clean);
  else if (kind === KINDS.GAMETYPE) applyGametypeDefaults(clean);
  else if (kind === KINDS.STATE) applyStateDefaults(clean);

  return { ok: true, value: clean };
}

// =============================================================================================
// SECTION 4 — validateBundle: structural for three documents, then the contract stage
// =============================================================================================

function contractFail(file, kind, path, expected, found, hint, out) {
  out.push(failure({ file, kind, stage: 'contract', path, expected, found, hint }));
}

/**
 * The three whole-document cross-references: gameTypeIdMatches, themeExists, animationExists.
 * Split out of validateBundle so its top-level sequence stays readable on one screen.
 */
function checkCrossReferences({ content, gametype, themes, contentFile, gametypeFile }, out) {
  // --- CROSS_CHECKS.gameTypeIdMatches -----------------------------------------------------
  // Reported against the GAME-TYPE file, because that is the file whose `id` is wrong when the
  // filename and the id disagree — the usual cause is copying a config and forgetting to rename.
  if (gametype.id !== content.gameType) {
    contractFail(
      gametypeFile,
      KINDS.GAMETYPE,
      'id',
      'the id "' + content.gameType + '", matching the gameType named by ' + contentFile,
      describeValue(gametype.id),
      'unresolved-reference',
      out,
    );
  }

  // --- CROSS_CHECKS.themeExists (spec §6.4) ------------------------------------------------
  // Themes load ONLY via the manifest. A CSS file sitting in themes/ but absent from themes.json
  // must never load, so an unlisted name is an error and not a fallback to the default: silently
  // falling back would make a mis-typed theme look like a broken stylesheet forever.
  if (!has(themes.themes, content.theme)) {
    contractFail(
      contentFile,
      KINDS.CONTENT,
      'theme',
      'one of the theme names listed in themes/themes.json: ' + Object.keys(themes.themes).join(', '),
      describeValue(content.theme),
      'unresolved-reference',
      out,
    );
  }

  // --- CROSS_CHECKS.animationExists --------------------------------------------------------
  if (ANIMATIONS.indexOf(content.animation) === -1) {
    contractFail(
      contentFile,
      KINDS.CONTENT,
      'animation',
      'one of the built-in animations: ' + ANIMATIONS.join(', '),
      describeValue(content.animation),
      'unresolved-reference',
      out,
    );
  }
}

/**
 * The single pass over cells.
 *
 * requiredCellFields, uniformRows, ladderCoverage, the resolved value, the cell key, and all four
 * census lists the renderer and the bonus picker need — one traversal, 144 iterations at the maximum
 * board size. It MUTATES cells (adding `key`/`column`/`row` and the resolved `value`) and drops each
 * column's `valueLadder`, which is safe because `content` is the freshly built cleaned object.
 *
 * @returns {{cellKeys, randomizableKeys, lockedValueKeys, preMarkedKeys, maxRowCount, uniform}}
 */
function walkCells({ content, gametype, contentFile }, out) {
  const requiredFields = gametype.requiredCellFields;
  const needsValue = requiredFields.indexOf('value') !== -1;
  const uniformRequired = gametype.gridConstraints.uniformRows === true;

  const columns = content.board.columns;
  const firstLen = columns.length > 0 ? columns[0].cells.length : 0;

  const cellKeys = [];
  const randomizableKeys = [];
  const lockedValueKeys = [];
  const preMarkedKeys = [];
  let maxRowCount = 0;
  let uniform = true;

  for (let c = 0; c < columns.length; c++) {
    const col = columns[c];
    const cells = col.cells;
    const ladder = col.valueLadder; // may be undefined; optional per spec §4.1
    if (cells.length !== firstLen) uniform = false;
    if (cells.length > maxRowCount) maxRowCount = cells.length;

    // --- CROSS_CHECKS.uniformRows ---------------------------------------------------------
    // Bingo cannot check a row, a column or a diagonal on a ragged card, so a ragged board under
    // a uniform-rows game type is a game that cannot be won rather than a cosmetic problem.
    if (uniformRequired && cells.length !== firstLen) {
      contractFail(
        contentFile,
        KINDS.CONTENT,
        'board.columns[' + c + '].cells',
        'the same number of cells as every other column (' + firstLen + ', set by the first column) — the "' + gametype.id + '" game type requires a rectangular board',
        'a list of ' + cells.length + ' cells',
        'ragged-grid',
        out,
      );
    }

    for (let r = 0; r < cells.length; r++) {
      const cell = cells[r];
      const key = c + ':' + r;
      cell.key = key;
      cell.column = c;
      cell.row = r;
      cellKeys.push(key);

      // --- Value resolution (plan Q8) -----------------------------------------------------
      // The per-cell `value` always wins; otherwise the column's ladder supplies it by position.
      const ladderValue = ladder && ladder[r] !== undefined ? ladder[r] : undefined;
      const resolved = cell.value !== undefined ? cell.value : ladderValue;
      if (resolved !== undefined) {
        cell.value = resolved;
      } else if (ladder !== undefined) {
        // --- CROSS_CHECKS.ladderCoverage --------------------------------------------------
        // A ladder exists, so this column plainly intends point values — but it stops short of
        // this cell and the cell carries none of its own. Scoring it as zero would be a board
        // that looks complete and plays wrong, which is exactly the failure the error screen
        // exists to prevent (plan Q8).
        contractFail(
          contentFile,
          KINDS.CONTENT,
          'board.columns[' + c + '].cells[' + r + '].value',
          'a point value: either an entry at position ' + (r + 1) + ' of this column\'s valueLadder (it has ' + ladder.length + ') or a "value" on this cell',
          'nothing (the ladder is too short and the cell has no value of its own)',
          'ladder-short',
          out,
        );
      } else if (needsValue) {
        contractFail(
          contentFile,
          KINDS.CONTENT,
          'board.columns[' + c + '].cells[' + r + '].value',
          'a point value, because the "' + gametype.id + '" game type requires "value" on every cell — give this cell a "value", or give its column a "valueLadder"',
          describeValue(undefined),
          'missing-required-field',
          out,
        );
      }

      // --- CROSS_CHECKS.requiredCellFields ----------------------------------------------
      // The value case is handled above (it has a resolution rule of its own); prompt and answer
      // are simple presence checks.
      for (const field of requiredFields) {
        if (field === 'value') continue;
        if (cell[field] === undefined) {
          contractFail(
            contentFile,
            KINDS.CONTENT,
            'board.columns[' + c + '].cells[' + r + '].' + field,
            'a "' + field + '", because the "' + gametype.id + '" game type requires it on every cell',
            describeValue(undefined),
            'missing-required-field',
            out,
          );
        }
      }

      // --- Census lists ----------------------------------------------------------------
      // randomizable AND NOT lockValue: spec §8 — a value-altering bonus must never touch a cell
      // whose value is locked, and excluding it here means the bonus picker cannot get it wrong.
      if (cell.flags.randomizable && !cell.flags.lockValue) randomizableKeys.push(key);
      if (cell.flags.lockValue) lockedValueKeys.push(key);
      if (cell.flags.preMarked) preMarkedKeys.push(key);
    }

    // The ladder has done its job: values are resolved onto the cells, so it is dropped from the
    // cleaned object. Leaving it would give the renderer two sources of truth for one number.
    delete col.valueLadder;
  }

  return { cellKeys, randomizableKeys, lockedValueKeys, preMarkedKeys, maxRowCount, uniform };
}

/**
 * @param {{content:RawDocument, gametype:RawDocument|null, themes:RawDocument}} rawBundle
 * @returns {{ok:true,value:CleanedBundle} | {ok:false,failures:ValidationFailure[]}}
 */
export function validateBundle(rawBundle) {
  const structural = [];

  const contentResult = validateDocument({ kind: KINDS.CONTENT, raw: rawBundle.content });
  if (!contentResult.ok) structural.push(...contentResult.failures);

  let gametypeResult = null;
  if (rawBundle.gametype) {
    gametypeResult = validateDocument({ kind: KINDS.GAMETYPE, raw: rawBundle.gametype });
    if (!gametypeResult.ok) structural.push(...gametypeResult.failures);
  }

  const themesResult = validateDocument({ kind: KINDS.THEMES, raw: rawBundle.themes });
  if (!themesResult.ok) structural.push(...themesResult.failures);

  // Concatenated in content -> gametype -> themes order so the error screen groups by file in the
  // order a person would open them.
  if (structural.length > 0) return { ok: false, failures: structural };

  const content = contentResult.value;
  const themes = themesResult.value;

  if (!gametypeResult) {
    // The loader only omits the game-type document when the content file's `gameType` was unusable
    // — which the structural stage above would already have reported. Reaching here means our own
    // sequencing is wrong, so we say so plainly rather than crashing on `null`.
    return {
      ok: false,
      failures: [
        failure({
          file: rawBundle.content.path,
          kind: KINDS.CONTENT,
          stage: 'contract',
          path: 'gameType',
          expected: 'a game type whose file in gametypes/ could be loaded',
          found: describeValue(content.gameType),
          hint: 'unresolved-reference',
        }),
      ],
    };
  }
  const gametype = gametypeResult.value;

  const contentFile = rawBundle.content.path;
  const gametypeFile = rawBundle.gametype.path;
  const out = [];

  checkCrossReferences({ content, gametype, themes, contentFile, gametypeFile }, out);
  const census = walkCells({ content, gametype, contentFile }, out);

  if (out.length > 0) return { ok: false, failures: out };

  const lifecycle = gametype.cellLifecycle;
  const bundle = {
    content,
    gametype,
    themes,
    resolved: {
      // The ONLY string the renderer is allowed to turn into a <link href>: a manifest VALUE,
      // already pattern-checked as a bare .css filename by the schema.
      themeFile: themes.themes[content.theme],
      animation: content.animation,
      columnCount: content.board.columns.length,
      maxRowCount: census.maxRowCount,
      uniform: census.uniform,
      cellKeys: census.cellKeys,
      randomizableKeys: census.randomizableKeys,
      lockedValueKeys: census.lockedValueKeys,
      preMarkedKeys: census.preMarkedKeys,
      terminalState: lifecycle[lifecycle.length - 1],
      initialState: lifecycle[0],
    },
  };

  return { ok: true, value: deepFreeze(bundle) };
}

// =============================================================================================
// SECTION 5 — validateState: untrusted input, treated as such
// =============================================================================================

/**
 * @param {{raw:{path:string,kind:string,data:*}, bundle?:CleanedBundle}} args
 * @returns {{ok:true,value:object} | {ok:false,failures:ValidationFailure[]}}
 *
 * Imported state is untrusted input (spec §4.4, CLAUDE.md invariant) — it arrives from a file the
 * user picked off their disk, or from localStorage written by an older build. It gets the same
 * structural walk as a content file, plus two bounds checks against the board actually loaded.
 *
 * `bundle` omitted -> structural only, which is how /tests/index.html checks a state fixture with
 * no board in play.
 */
export function validateState({ raw, bundle }) {
  const result = validateDocument({ kind: KINDS.STATE, raw });
  if (!result.ok) return result;

  const state = result.value;
  if (!bundle) return { ok: true, value: state };

  const out = [];
  const file = raw.path;

  // Set membership, not indexOf: a 144-key state against a 144-cell board would otherwise be
  // 20,736 comparisons for a check that should be free.
  const validKeys = new Set(bundle.resolved.cellKeys);
  const validStates = new Set(bundle.gametype.cellLifecycle);

  for (const key of Object.keys(state.cellStates)) {
    // --- CROSS_CHECKS.stateCellKeysInBounds --------------------------------------------
    // A saved session whose board has since been edited smaller. Restoring "5:5" onto a 3x3 board
    // would either throw or silently drop a scored cell; both are worse than saying so.
    if (!validKeys.has(key)) {
      contractFail(
        file,
        KINDS.STATE,
        'cellStates["' + key + '"]',
        'a cell that exists on this board (' + bundle.resolved.columnCount + ' columns, up to ' + bundle.resolved.maxRowCount + ' cells each)',
        'the key ' + JSON.stringify(key),
        'out-of-range',
        out,
      );
      continue;
    }
    // --- CROSS_CHECKS.stateCellStatesInLifecycle --------------------------------------
    // "marked" in a jeopardy session, for instance: a legal state name, but not one this game
    // type uses, so the renderer would have no way to draw it.
    const st = state.cellStates[key];
    if (!validStates.has(st)) {
      contractFail(
        file,
        KINDS.STATE,
        'cellStates["' + key + '"]',
        'one of the states the "' + bundle.gametype.id + '" game type uses: ' + bundle.gametype.cellLifecycle.join(', '),
        describeValue(st),
        'unknown-value',
        out,
      );
    }
  }

  for (let i = 0; i < state.bonusCells.length; i++) {
    if (!validKeys.has(state.bonusCells[i])) {
      contractFail(
        file,
        KINDS.STATE,
        'bonusCells[' + i + ']',
        'a cell that exists on this board',
        'the key ' + JSON.stringify(state.bonusCells[i]),
        'out-of-range',
        out,
      );
    }
  }

  // --- CROSS_CHECKS.stateStrikesInBounds ----------------------------------------------
  // `D15`. Two bounds the structural stage could not check, because both need a file the state
  // does not carry: the column must exist on THIS board, and the count must fit THIS game type's
  // `strikes.count`. `M9` is the mutation — an imported `{"0": 99}` must reach the error screen
  // rather than a board wearing 99 marks.
  //
  // A game type with no `strikes` block allows none at all, so ANY entry is out of bounds there.
  // That is the honest reading of absence-as-the-switch: a jeopardy session carrying strikes was
  // not written by this app against this game type, and quietly dropping the field would be the
  // partial-render behaviour spec §5 forbids.
  const strikeCap = bundle.gametype.strikes ? bundle.gametype.strikes.count : 0;
  for (const key of Object.keys(state.strikes || {})) {
    // CANONICAL FORM, not merely numeric. `/^\d+$/` admits "00", which passes both stages and then
    // addresses nothing: `strikesFor` reads `strikes["0"]`, so an imported session SAYING three
    // strikes on round 0 renders zero, and the next X writes a second, separate key. Accept-or-
    // reject is the validator's contract; silently displaying something other than what the file
    // says is the one outcome it must not produce. Found in adversarial review.
    const column = Number(key);
    if (!Number.isInteger(column) || String(column) !== key || column >= bundle.resolved.columnCount) {
      contractFail(
        file, KINDS.STATE, 'strikes["' + key + '"]',
        'a column that exists on this board (' + bundle.resolved.columnCount + ' column'
          + (bundle.resolved.columnCount === 1 ? '' : 's') + ')',
        'the key ' + JSON.stringify(key), 'out-of-range', out,
      );
      continue;
    }
    const value = state.strikes[key];
    if (value > strikeCap) {
      contractFail(
        file, KINDS.STATE, 'strikes["' + key + '"]',
        strikeCap === 0
          ? 'no strikes at all — the "' + bundle.gametype.id + '" game type does not use them'
          : 'at most ' + strikeCap + ' strikes, which is what the "' + bundle.gametype.id
            + '" game type allows',
        describeValue(value), 'out-of-range', out,
      );
    }
  }

  // --- CROSS_CHECKS.stateCurrentRoundInBounds -----------------------------------------
  // `D17`. The structural stage capped this at the COLUMN CAP (12), which is all a schema can know
  // without the content file. Whether round 7 exists on THIS board is a contract question.
  //
  // It matters more than the cell-key checks above, and for a reason particular to one round being
  // on screen at a time: an out-of-range round draws NO column at all. A host would see an empty
  // board and read it as the app being broken, not as a session that outlived the file it was
  // saved against — which is exactly what it is when somebody trims a round out of their content
  // and reopens yesterday's game. `undefined` is legal and means Round 0 (see the schema note).
  if (state.currentRound !== undefined && state.currentRound >= bundle.resolved.columnCount) {
    contractFail(
      file,
      KINDS.STATE,
      'currentRound',
      'a round that exists on this board (' + bundle.resolved.columnCount + ' column'
        + (bundle.resolved.columnCount === 1 ? '' : 's') + ', so 0 to '
        + (bundle.resolved.columnCount - 1) + ')',
      describeValue(state.currentRound),
      'out-of-range',
      out,
    );
  }

  if (out.length > 0) return { ok: false, failures: out };
  return { ok: true, value: state };
}
