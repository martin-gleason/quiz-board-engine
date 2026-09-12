// SPDX-License-Identifier: AGPL-3.0-or-later
//
// validate-board.mjs — Quiz Board Engine
//
// Validate a JSON file with THE ENGINE'S OWN VALIDATOR, from the command line.
//
// Why this exists rather than a rule-check inside the generating tool: `D46` and `M23`.
// The editor was built so it could not lie — it imports `validator.js` instead of
// restating a single rule, so "valid in the editor" and "loads in the game" cannot drift
// apart. A board generator written in Python has no such luxury; any shape-checking it
// did would be a SECOND COPY of the rules, in a second language, free to disagree with
// the engine silently. So it does none, and shells out to this instead.
//
// Usage:  node tools/validate-board.mjs <kind> <file.json>
// Exit:   0 valid · 1 invalid (failures printed in the engine's own words) · 2 usage
//
// `kind` is one of schemas.js KINDS: content · gametype · themes · games · state.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDocument, validateBundle } from '../js/validator.js';
import { KINDS } from '../js/schemas.js';
import { GAMETYPES_DIR, THEMES_MANIFEST } from '../js/loader.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KIND_VALUES = Object.values(KINDS);

// `bundle` is not a KIND — it is the WHOLE of what the engine does before it draws.
//
// This distinction cost a review finding. `validateDocument` is the STRUCTURAL stage only:
// shapes, types, limits. The checks that decide whether a file actually loads — is this
// theme in themes/themes.json (spec §6.4), does this gameType name a config that exists,
// is this animation one the engine implements — live in `checkCrossReferences`, which runs
// only from `validateBundle`. A board with `"theme": "marque"` passes `content` and fails
// the game. So a tool that validates a board it is about to ship must ask for `bundle`.
const BUNDLE = 'bundle';

function die(code, message) {
  process.stderr.write(message + '\n');
  process.exit(code);
}

const [kind, file] = process.argv.slice(2);

if (!kind || !file) {
  die(2, 'usage: node tools/validate-board.mjs <kind> <file.json>\n' +
         '       kind is one of: ' + KIND_VALUES.join(', '));
}
if (kind !== BUNDLE && !KIND_VALUES.includes(kind)) {
  die(2, `unknown kind "${kind}" — expected one of: ${KIND_VALUES.join(', ')}, ${BUNDLE}`);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Print failures in the engine's own words. Never a re-wording of them. */
function report(label, failures) {
  process.stderr.write(`${file}: INVALID ${label} — ${failures.length} failure(s)\n`);
  for (const f of failures) {
    const where = f.path || f.location || '(document root)';
    const expected = f.expected ? ` — expected ${f.expected}` : '';
    const found = f.found ? `, found ${f.found}` : '';
    process.stderr.write(`  ${where}${expected}${found}\n`);
  }
}

let data;
try {
  data = readJson(file);
} catch (e) {
  // A JSON syntax error never reaches validateDocument — it cannot parse the file to
  // hand it over. Reported here in the same shape so a caller has one failure format.
  die(1, `${file}: not valid JSON — ${e.message}`);
}

if (kind === BUNDLE) {
  // Assemble exactly what the loader assembles: the content file, the game-type config it
  // names, and the theme manifest. The game-type document is resolved from the content's
  // own `gameType`, so a board naming a config that does not exist is caught HERE, by the
  // file not being there, rather than by a blank screen in front of a room.
  const themesPath = path.join(REPO, THEMES_MANIFEST);
  const typeName = typeof data.gameType === 'string' ? data.gameType : '';
  const gametypePath = path.join(REPO, GAMETYPES_DIR, `${typeName}.json`);

  let gametype = null;
  if (typeName && fs.existsSync(gametypePath)) {
    try {
      gametype = { path: gametypePath, kind: KINDS.GAMETYPE, data: readJson(gametypePath) };
    } catch (e) {
      die(1, `${gametypePath}: not valid JSON — ${e.message}`);
    }
  } else if (typeName) {
    die(1, `${file}: INVALID bundle — 1 failure(s)\n` +
           `  gameType — expected a game type with a config in ${GAMETYPES_DIR}` +
           ` (${fs.readdirSync(path.join(REPO, GAMETYPES_DIR)).join(', ')}),` +
           ` found the text "${typeName}"`);
  }

  let themes;
  try {
    themes = { path: themesPath, kind: KINDS.THEMES, data: readJson(themesPath) };
  } catch (e) {
    die(1, `${themesPath}: not valid JSON — ${e.message}`);
  }

  const bundle = validateBundle({
    content: { path: file, kind: KINDS.CONTENT, data },
    gametype,
    themes,
  });
  if (bundle.ok) {
    process.stdout.write(`${file}: valid bundle — structure, and everything it references\n`);
    process.exit(0);
  }
  report('bundle', bundle.failures);
  process.exit(1);
}

// `raw.path` is what the validator prints in a failure's location, so it must be the
// real path: a caller validating a temp file wants to be told which file it was.
const result = validateDocument({ kind, raw: { path: file, kind, data } });

if (result.ok) {
  process.stdout.write(`${file}: valid ${kind}\n`);
  process.exit(0);
}
report(kind, result.failures);
process.exit(1);
