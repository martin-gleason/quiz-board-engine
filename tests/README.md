# Tests

Spec §9 mandates an extensive error-screen matrix and cross-browser verification. Spec §2.1
forbids GitHub Actions. So the matrix lives in a page you open, and the cross-browser runs are
driven locally.

## Running the suite

The app and its tests need an **HTTP origin**. `file://` blocks ES module imports and `fetch`,
and there is no way around that — it is a browser origin rule, not a bug (plan Q10, delta D7).

```sh
python3 -m http.server 8000        # from the repo root, not from tests/
```

Then open **http://localhost:8000/tests/**.

The page prints `PASS n/n` or `FAIL m/n` at the top and in the browser tab title. Every failing
fixture also renders its **real, human-facing error output** beneath its row — the assertions
prove the message is *correct*, your eyes prove it is *useful*. Spec §7 makes the error screen a
product feature, so a green checkmark alone is not sufficient evidence. Read the messages.

## Cross-browser

Both engines must pass, and the results must be identical (spec §2.5).

| Browser | How | Status |
|---|---|---|
| Chrome | Open the page, or drive it with the Chrome MCP | automated |
| Firefox | `python3 tools/firefox-run-tests.py` | automated (Marionette) |
| Safari | `docs/runbooks/safari-manual-test.md` | **manual — no MCP exists** |

`tools/firefox-run-tests.py` exists because Firefox's `--screenshot` fires at the `load` event,
which is *before* the async matrix finishes — a screenshot cannot prove the verdict. The script
speaks Marionette, Firefox's own remote-control protocol, and reads `window.__TEST_RESULTS__`
directly. It launches headless, uses a throwaway profile, and exits non-zero on failure.

```sh
python3 -m http.server 8127 &
python3 tools/firefox-run-tests.py http://localhost:8127/tests/
```

## Machine-readable results

For automation, the page exposes:

- `document.title` → `"PASS 87/87 — Quiz Board Engine tests"`
- `window.__TEST_RESULTS__` → `{ ok, passed, failed, total, results: [{ group, name, passed, detail }] }`

Read the object rather than scraping rendered text.

## Suite groups

| Group | What it proves |
|---|---|
| `matrix` | Every row of the spec §9 error matrix, plus 8 positive controls. Each fixture must produce the exact expected stage, JSON path, and hint class — and syntax faults must carry line, column, caret, and snippet. |
| `security` | Every `?game=` rejection case (spec §6.3): absolute and protocol-relative URLs, traversal encoded and plain, double-encoded, backslashes, wrong extensions, null-byte smuggling, query/fragment injection. Plus the cases that must be *accepted*. |
| `scanner` | Our own JSON scanner (plan Q6), fed strings directly. Never touches `JSON.parse`, because the whole point is not depending on the engine's wording. |
| `cleaning` | `_note` stripped at every depth, cleaned object not aliasing the raw one, result frozen. Spec §5: the renderer only ever receives a cleaned object. |
| `shell` | Boots the real `index.html` in an iframe and measures computed geometry: the base layer under the selected sheet, `.qbe-board` as a grid with one track per column, a projector-sized cell, the detail overlay positioned above the board. Two boots cover the content-driven theme selection; a third boot then applies **every theme registered in `themes/themes.json`** and re-measures. |
| `themes` | Audits every registered theme as a file: it fetches 200 and is non-empty, makes no external request (no `@import`, no `http(s)`/protocol-relative `url()` — `data:` is fine), carries the SPDX header, invents no custom property `themes/default.css` does not define, and targets only `.qbe-*` classes theme-contract §2 says the renderer emits. Also checks the manifest against the directory in both directions. |
| `invariants` | Fetches our own source and asserts zero forbidden DOM/dynamic-code APIs, SPDX headers present, and that the schema's limits match the numbers the spec promises. |

## Adding a fixture

1. Write the broken file in `tests/fixtures/`, **broken in exactly one way**, named for the fault.
2. Add a row to `tests/fixtures/manifest.json`: `file`, `kind`, `expectFailure`, `expectedStage`,
   `expectedPath`, `expectedHintClass`, `expectedFailingFile`, `expectedFailureCount`,
   `description`.
3. Reload the page. Set an expectation to `null` to skip checking that one field.

Fixtures whose fault is a JSON **syntax** error are deliberately not valid JSON. That is the
point — the runner fetches them as raw text. Do not "fix" them.

## A note on the invariant check

`tests/runner.js` scans its own source too. Because of that, the forbidden API names are
assembled from string fragments rather than written as one regex literal — otherwise the check
flags itself, which is exactly what happened on its first run. Comment-stripping cannot solve it:
a regex literal is code, not a comment. If you edit that check, keep the names split.
