#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Generate a feud board (and its games.json line) from survey responses. Chore C20.

    python3 tools/csv-to-board.py examples/revenue-feud.map.json          # dry run: show the diff
    python3 tools/csv-to-board.py examples/revenue-feud.map.json --write  # land it

TWO INPUTS, AND THEY ARE DIFFERENT KINDS OF THING. The CSV is counts; the map is
judgment. `games/revenue-feud.json` was hand-entered from a 17-response CSV, and 34 of
its 35 point values are just `count / 17 * 100`. The other one is 7 where the data says
5.88 — the number that makes its column total 100. That is the whole case for this tool:
the arithmetic is mechanical and was done inconsistently (25 cells rounded, 9 floored),
while the three things that actually needed a human — merging answers that mean the same
thing, dropping the long tail, and naming rows for a projector — cannot be derived from
the responses at all. So those live in the map, by hand, and everything else is computed.

AN UNMAPPED ANSWER IS AN ERROR. When the survey grows, a new raw answer is neither
silently dropped nor silently added as a board row: this stops and names it. That is the
engine's own no-partial-render rule (never guess, never best-effort) applied to tooling.

BOTH OUTPUTS ARE GENERATED AND BOTH ARE VALIDATED. A board with no line in
`games/games.json` is invisible in the picker — a static site has no directory listing —
and that is not hypothetical: revenue-feud.json shipped valid and unreachable for exactly
that reason. So the manifest entry is an output here, not a sentence telling a human to
paste something (`D46`, `M28`). Neither output is judged by this file: shape is decided by
`js/validator.js` via `tools/validate-board.mjs`, so this tool cannot disagree with the
engine about what loads.
"""

import argparse
import csv
import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VALIDATOR = os.path.join(REPO, 'tools', 'validate-board.mjs')


class MapError(Exception):
    """A problem with the map or the CSV. Reported to the user, never a traceback."""


def safe_filename(name, field):
    """A bare `.json` filename, resolved under games/ and nowhere else.

    `CLAUDE.md` gives `?game=` an explicit no-traversal rule — relative paths under
    /games/, ending .json, no absolute URLs, no `..`, no encoded traversal — because a
    board reference is untrusted input. The map is hand-edited rather than fetched, which
    makes it a smaller risk and not a different KIND of risk: this value is used as a
    WRITE path, and `os.path.join` silently discards everything to its left when handed an
    absolute one. Review demonstrated a map writing outside the repository and outside the
    temp directory, before any validation ran and with no cleanup.

    So the same rule, enforced here rather than assumed.
    """
    if not isinstance(name, str) or not name:
        raise MapError(f'map board "{field}" must be a non-empty string')
    if not name.endswith('.json'):
        raise MapError(f'map board "{field}" must end in .json — found {name!r}')
    if os.path.isabs(name) or name != os.path.basename(name) or name in ('.', '..'):
        raise MapError(
            f'map board "{field}" must be a BARE filename, resolved under games/ — '
            f'found {name!r}. No directories, no "..", no absolute paths.')
    if any(ch in name for ch in '\\%\x00') or name.startswith('.'):
        raise MapError(f'map board "{field}" contains a character a board filename may not hold: {name!r}')
    return name


# ---------------------------------------------------------------------------
# Apportionment
# ---------------------------------------------------------------------------

def apportion(counts):
    """Largest remainder. Returns integers summing to EXACTLY 100.

    Chosen over plain rounding at the C20 gate because plain rounding is what produced a
    board whose columns total 88, 89, 95, 95, 99, 100, 100 — and one hand-nudged cell.

    The basis is the KEPT answers, not the response count, and that has a consequence
    worth stating plainly: a dropped long-tail answer redistributes its share to the
    survivors. Column 1 drops one response and so reads 56 where the hand-entered board
    read 53. The alternative — apportioning over all responses — cannot sum to 100 by
    construction whenever anything is dropped, which is the property that was asked for.

    Zero-count answers are held out of the remainder round entirely: a row nobody chose
    must not collect a point because the arithmetic had one spare.
    """
    total = sum(counts)
    if total <= 0:
        raise MapError('no responses to apportion — every mapped answer has a count of 0')

    exact = [c * 100.0 / total for c in counts]
    floors = [int(x) for x in exact]
    short = 100 - sum(floors)

    # Rank by remainder, then by raw count, then by position — all three, so the result is
    # deterministic. Two answers tied on remainder and count must not swap places because
    # a dict happened to iterate differently.
    order = sorted(
        (i for i in range(len(counts)) if counts[i] > 0),
        key=lambda i: (-(exact[i] - floors[i]), -counts[i], i),
    )
    for k in range(short):
        if not order:
            break
        floors[order[k % len(order)]] += 1
    return floors


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def read_map(path):
    with open(path, encoding='utf-8') as fh:
        m = json.load(fh)
    for field in ('schemaVersion', 'board', 'columns'):
        if field not in m:
            raise MapError(f'{path}: map is missing required field "{field}"')
    if m['schemaVersion'] != 1:
        raise MapError(f'{path}: map schemaVersion {m["schemaVersion"]!r} — this tool writes 1')
    for field in ('title', 'gameType', 'theme', 'animation', 'pickerKey', 'filename'):
        if not m['board'].get(field):
            raise MapError(f'{path}: map board is missing required field "{field}"')
    safe_filename(m['board']['filename'], 'filename')
    return m


def read_rows(path):
    with open(path, encoding='utf-8-sig', newline='') as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        raise MapError(f'{path}: no responses in the CSV')
    return rows


def check_columns(m, rows, path):
    """Every CSV column is mapped or explicitly ignored. Neither list may name a ghost."""
    present = set(rows[0].keys())
    mapped = [c['csvColumn'] for c in m['columns']]
    ignored = list(m.get('ignoreColumns', []))

    unaccounted = present - set(mapped) - set(ignored)
    if unaccounted:
        raise MapError(
            f'{path}: {len(unaccounted)} CSV column(s) are neither mapped nor ignored.\n'
            + ''.join(f'    {c!r}\n' for c in sorted(unaccounted))
            + '  Add each to a map column or to "ignoreColumns".')

    missing = [c for c in mapped + ignored if c not in present]
    if missing:
        raise MapError(
            f'the map names {len(missing)} column(s) the CSV does not have — a renamed '
            'survey question, most likely:\n'
            + ''.join(f'    {c!r}\n' for c in missing))


def tally(rows, col, path):
    """Count one question. Blanks are counted as responses but are never answers.

    The denominator is deliberately every row, blank or not, because that is what the
    hand-entered board did: the policing column reads 41 for 7 of 17 responses, not 44
    for 7 of the 16 that answered.
    """
    csv_col = col['csvColumn']
    seen = {}
    for r in rows:
        raw = (r[csv_col] or '').strip()
        if raw:
            seen[raw] = seen.get(raw, 0) + 1

    known = set(col.get('drop', []))
    for a in col['answers']:
        known.update(a['from'])

    unmapped = sorted(k for k in seen if k not in known)
    if unmapped:
        raise MapError(
            f'{path}: {len(unmapped)} answer(s) in {csv_col!r} appear in neither "from" '
            'nor "drop":\n'
            + ''.join(f'    {k!r}  ({seen[k]} response(s))\n' for k in unmapped)
            + '  Merge each into an answer, or drop it. Nothing is guessed here.')
    return seen


def build_column(col, seen):
    counts = [sum(seen.get(src, 0) for src in a['from']) for a in col['answers']]
    values = apportion(counts)
    cells = [{'answer': a['label'], 'value': v} for a, v in zip(col['answers'], values)]

    # Two different problems, and only the second one breaks a game. An answer NOBODY chose
    # is a stale map entry. An answer worth ZERO POINTS is an unplayable row on the board —
    # and it is reachable with responses behind it: at 287 responses a real answer with one
    # vote apportions to 0. This tool exists for the survey that GREW, so the case that only
    # appears past a hundred responses is the case it most needs to report.
    problems = [f'{a["label"]!r} has no responses' for a, c in zip(col['answers'], counts) if c == 0]
    problems += [f'{a["label"]!r} apportions to 0 points ({c} of {sum(counts)} responses) — '
                 'an unplayable row; merge it or drop it in the map'
                 for a, c, v in zip(col['answers'], counts, values) if v == 0 and c > 0]
    return {'label': col['label'], 'cells': cells}, problems


def build(m, rows, map_path):
    board_columns, warnings = [], []
    for col in m['columns']:
        seen = tally(rows, col, map_path)
        built, problems = build_column(col, seen)
        for problem in problems:
            warnings.append(f'{col["label"][:40]!r}: {problem}')
        board_columns.append(built)

    b = m['board']
    board = {
        '_note': (
            f'GENERATED by tools/csv-to-board.py (chore C20) from {m.get("source", "a survey CSV")} '
            f'and {os.path.basename(map_path)}. Point values are largest-remainder shares of 100 '
            'across the answers KEPT for each column; dropped long-tail answers redistribute '
            'their share, so a column total of 100 is by construction, not by luck. '
            'Edit the MAP and re-run — hand edits here are overwritten.'),
        'schemaVersion': 1,
        'title': b['title'],
        'gameType': b['gameType'],
        'theme': b['theme'],
        'animation': b['animation'],
        'board': {'columns': board_columns},
    }
    return board, warnings


def build_manifest(existing_path, picker_key, filename):
    """Add this board to games.json, preserving order and every other entry.

    Built as a whole document and validated AS a manifest, never emitted as a line of
    text for a human to paste. `M28` is the mutation that says why: a generated manifest
    line, hand-concatenated from the wrong field and never escaped, shipped once already.
    """
    with open(existing_path, encoding='utf-8') as fh:
        manifest = json.load(fh)
    games = manifest.setdefault('games', {})
    # Reassigning an existing key keeps its position; a new board goes last. Order decides
    # only which board the picker preselects, so a regeneration must not silently reorder.
    games[picker_key] = filename
    return manifest


# ---------------------------------------------------------------------------
# Validation + output
# ---------------------------------------------------------------------------

def validate(kind, path):
    """Validate with the engine's validator. A missing node FAILS — it never skips.

    `kind` is "bundle" for a board: structure AND everything the board references. See
    tools/validate-board.mjs for why the distinction is load-bearing rather than pedantic.
    """
    if shutil.which('node') is None:
        raise MapError(
            'node is not on PATH, so the generated file cannot be validated by the '
            'engine itself. Refusing to write an unvalidated board — install node, or '
            'inspect the dry-run output and place the file by hand.')
    proc = subprocess.run(
        ['node', VALIDATOR, kind, path],
        capture_output=True, text=True, cwd=REPO)
    if proc.returncode != 0:
        raise MapError(
            f'the generated {kind} does not pass the engine\'s own validator:\n'
            + '\n'.join('  ' + ln for ln in proc.stderr.strip().splitlines()
                        if 'MODULE_TYPELESS' not in ln and 'Reparsing' not in ln
                        and 'trace-warnings' not in ln and 'type.: .module' not in ln))


def dump(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + '\n'


def diff(old_path, new_text, label):
    import difflib
    old = open(old_path, encoding='utf-8').read().splitlines() if os.path.exists(old_path) else []
    d = list(difflib.unified_diff(old, new_text.splitlines(),
                                  fromfile=f'{label} (current)', tofile=f'{label} (generated)',
                                  lineterm='', n=1))
    return d


def land(board_path, board_text, manifest_path, manifest_text):
    """Write both files, or leave the tree exactly as it was."""
    for d in (os.path.dirname(board_path), os.path.dirname(manifest_path)):
        if d and not os.path.isdir(d):
            raise OSError(f'no such directory: {d}')

    previous = None
    if os.path.exists(board_path):
        with open(board_path, encoding='utf-8') as fh:
            previous = fh.read()

    def atomic(path, text):
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as fh:
            fh.write(text)
        os.replace(tmp, path)

    atomic(board_path, board_text)
    try:
        atomic(manifest_path, manifest_text)
    except OSError:
        # Roll the board back. A board on disk with no manifest line is worse than no
        # board at all, because it looks like the tool succeeded.
        if previous is None:
            os.remove(board_path)
        else:
            atomic(board_path, previous)
        raise


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('map', help='path to the map JSON')
    ap.add_argument('--csv', help='responses CSV (default: the map\'s "source", beside the map)')
    ap.add_argument('--games-dir', default=os.path.join(REPO, 'games'))
    ap.add_argument('--manifest', default=os.path.join(REPO, 'games', 'games.json'))
    ap.add_argument('--write', action='store_true', help='land the files (default: dry run)')
    args = ap.parse_args()

    try:
        m = read_map(args.map)
        csv_path = args.csv or os.path.join(os.path.dirname(os.path.abspath(args.map)),
                                            m.get('source', ''))
        rows = read_rows(csv_path)
        check_columns(m, rows, args.map)

        board, warnings = build(m, rows, args.map)
        manifest = build_manifest(args.manifest, m['board']['pickerKey'], m['board']['filename'])

        board_text, manifest_text = dump(board), dump(manifest)
        board_path = os.path.join(args.games_dir, m['board']['filename'])

        # Validate the BYTES that will be written, from a temp copy — not the object they
        # were built from. An assertion that re-derives what it expects cannot see the
        # path that produces the real thing.
        with tempfile.TemporaryDirectory() as tmp:
            tb = os.path.join(tmp, m['board']['filename'])
            tm = os.path.join(tmp, 'games.json')
            open(tb, 'w', encoding='utf-8').write(board_text)
            open(tm, 'w', encoding='utf-8').write(manifest_text)
            # `bundle`, not `content`. The structural stage alone would bless a board
            # naming a theme that is not in themes/themes.json or a gameType with no
            # config — both of which pass every shape rule and neither of which loads.
            validate('bundle', tb)
            validate('games', tm)
    except MapError as e:
        sys.stderr.write('csv-to-board: ' + str(e) + '\n')
        return 1
    except (OSError, json.JSONDecodeError) as e:
        sys.stderr.write(f'csv-to-board: {e}\n')
        return 1

    print(f'{len(rows)} responses · {len(board["board"]["columns"])} columns · '
          f'both outputs pass the engine\'s validator')
    for w in warnings:
        print(f'  warning: {w}')
    for col in board['board']['columns']:
        total = sum(c['value'] for c in col['cells'])
        print(f'  {total:>3}  {col["label"][:60]}')

    for path, text, label in ((board_path, board_text, m['board']['filename']),
                              (args.manifest, manifest_text, 'games.json')):
        d = diff(path, text, label)
        print()
        if not d:
            print(f'{label}: no change')
        else:
            print('\n'.join(d))

    if not args.write:
        print('\ndry run — nothing written. Re-run with --write to land these.')
        return 0

    # BOTH FILES OR NEITHER. A board written without its manifest entry is precisely the
    # defect this tool was built to prevent — valid, served, and invisible in the picker —
    # and the first version of this code could produce it: the board was written first,
    # outside the try block, so a read-only or missing games.json left the board behind
    # and printed a traceback. Each file is written to a sibling temp and moved into place
    # (os.replace is atomic on the same filesystem), and if the second write fails the
    # first is rolled back to what it was.
    try:
        land(board_path, board_text, args.manifest, manifest_text)
    except OSError as e:
        sys.stderr.write(f'csv-to-board: nothing was written — {e}\n')
        return 1
    for path in (board_path, args.manifest):
        print(f'wrote {os.path.relpath(path, REPO)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
